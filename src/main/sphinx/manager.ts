// Runs a project's Sphinx build in the background: environment setup, debounced
// incremental builds, and merged results for the renderer.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs, readFileSync, renameSync, rmSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { SphinxProject } from '../../shared/api.js';
import { fromProject } from '../../shared/projects.js';
import {
  mergeWarnings,
  usable,
  type BuildResult,
  type EnvironmentChoice,
  type PythonCandidate,
  type SphinxInfo,
  type SphinxState,
  type SphinxStatus,
  type SphinxWarning,
} from '../../shared/sphinx.js';
import { ensureEnvironment, environmentIsCurrent, findUv, hasManagedPython, uvEnv, type EnvPaths } from './environment.js';
import { planEnvironment } from './discover.js';
import { existingEnv, findPythons, probePython } from './pythons.js';
import { canDownload } from './network.js';
import { run, CommandError } from './run.js';

export interface ManagerOptions {
  root: string; // the opened folder
  searchDirs: string[]; // where to look for existing virtualenvs (all projects' source dirs)
  dataDir: string; // e.g. <userData>/sphinx
  appRoot: string; // for development: where resources/ lives
  resourcesPath: string | null; // packaged app resources
  trusted: boolean;
  // See ProjectInfo.buildInputs: when it changes, the next build starts afresh.
  buildInputs: () => string;
  // Environment variables for setup and builds, on top of the app's own.
  extraEnv: () => Record<string, string>;
  // The writer's saved choice for this project; managed if none.
  environment: EnvironmentChoice | null;
  emit: (state: SphinxState) => void;
}

// What uv prints when it can't reach the network.
const NETWORK_ERROR = /dns error|failed to lookup address|could not connect|connection refused|tcp connect error|error sending request|network is unreachable|operation timed out|offline mode|no route to host/i;

const BUILD_DELAY_MS = 600;
// Files changing this long after a build or setup finished may still be its output.
const BUSY_GRACE_MS = 2000;

// The last build's results, kept between sessions so opening a project shows them at
// once and only needs an incremental build.
interface SavedState {
  version: 1;
  key: string; // what the results depend on: see buildKey()
  info: SphinxInfo;
}
const BUILD_TIMEOUT_MS = 20 * 60_000;

export class SphinxManager {
  private state: SphinxState = { status: { kind: 'off' }, info: null, environment: null };
  private abort = new AbortController();
  private python: string | null = null;
  private building = false;
  private pending: { fresh: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Whether the next build re-reads everything. The first build of a session does,
  // unless the last session's results still apply.
  private fresh = true;
  private busyUntil = 0;
  private log: WriteStream;
  private logTail = '';
  private readonly key: string;
  private readonly paths: EnvPaths;

  constructor(
    private project: SphinxProject,
    private opts: ManagerOptions,
  ) {
    this.key = createHash('sha256').update(project.sourceDir).digest('hex').slice(0, 16);
    this.paths = { dataDir: opts.dataDir, envDir: join(opts.dataDir, 'envs', this.key) };
    mkdirSync(join(opts.dataDir, 'logs'), { recursive: true });
    this.log = createWriteStream(join(opts.dataDir, 'logs', `${this.key}.log`), { flags: 'w' });
  }

  get outputDir(): string {
    return join(this.opts.dataDir, 'builds', this.key, 'html');
  }

  getState(): SphinxState {
    return this.state;
  }

  getLog(): string {
    return this.logTail;
  }

  start() {
    if (this.opts.trusted) {
      const saved = this.loadSaved();
      if (saved) this.state = { ...this.state, info: saved.info };
      void this.setUp();
    } else void this.askForTrust();
  }

  // Building or setting up, or only just finished: files changing now may be its output.
  busy(): boolean {
    const kind = this.state.status.kind;
    return this.building || kind === 'setting-up' || Date.now() < this.busyUntil;
  }

  private get savedFile() {
    return join(this.opts.dataDir, 'builds', this.key, 'editor-state.json');
  }

  private loadSaved(): SavedState | null {
    try {
      const saved = JSON.parse(readFileSync(this.savedFile, 'utf8')) as SavedState;
      return saved.version === 1 && saved.info ? saved : null;
    } catch {
      return null;
    }
  }

  // The Python, the build driver and the project's extensions: when any of them
  // changed, earlier results (and Sphinx's own saved environment) can't be trusted.
  private buildKey(): string {
    let driver = '';
    try {
      driver = readFileSync(this.driverPath(), 'utf8');
    } catch {
      // reported when the build runs
    }
    const env = JSON.stringify(Object.entries(this.opts.extraEnv()).sort(([a], [b]) => a.localeCompare(b)));
    return createHash('sha256').update(`${this.python}\0${this.opts.buildInputs()}\0${env}\0${driver}`).digest('hex').slice(0, 24);
  }

  // Pythons on this computer that could build the project (for choosing one).
  candidates(): Promise<PythonCandidate[]> {
    return findPythons(this.opts.root, this.opts.searchDirs);
  }

  // Allow builds, with the given environment.
  use(choice: EnvironmentChoice) {
    this.opts.trusted = true;
    this.opts.environment = choice;
    this.python = null;
    this.fresh = true;
    this.state = { ...this.state, info: null };
    rmSync(this.savedFile, { force: true });
    void this.setUp();
  }

  // Sets up the environment without building or asking (the command line's PDF export,
  // where running the command is the say-so). Throws what the window would show.
  async prepare(): Promise<void> {
    await (this.opts.environment?.kind === 'existing' ? this.useExisting(this.opts.environment.python) : this.useManaged());
    if (!this.python) throw new Error(this.state.status.kind === 'error' ? this.state.status.message : 'Sphinx couldn’t be set up.');
  }

  private async askForTrust() {
    const plan = planEnvironment(this.opts.root, this.project.sourceDir);
    const candidates = await this.candidates();
    if (this.abort.signal.aborted) return;
    this.setStatus({ kind: 'needs-trust', requirements: plan.description, candidates });
  }

  decline() {
    this.setStatus({ kind: 'declined' });
  }

  // Schedule a build, e.g. after a save. Builds never overlap; requests made while
  // one runs are folded into a single follow-up build.
  requestBuild({ fresh = false } = {}) {
    if (!this.python) return;
    if (this.building) {
      this.pending = { fresh: fresh || !!this.pending?.fresh };
      return;
    }
    if (fresh) this.fresh = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.build(), BUILD_DELAY_MS);
  }

  dispose() {
    clearTimeout(this.timer);
    this.abort.abort();
    this.log.end();
  }

  private write(text: string) {
    this.log.write(text);
    this.logTail = (this.logTail + text).slice(-200_000);
  }

  private setStatus(status: SphinxStatus) {
    if (this.state.status.kind === 'setting-up' && status.kind !== 'setting-up') this.busyUntil = Date.now() + BUSY_GRACE_MS;
    this.state = { ...this.state, status };
    this.opts.emit(this.state);
  }

  private async setUp() {
    const choice = this.opts.environment ?? { kind: 'managed' };
    try {
      if (choice.kind === 'existing') await this.useExisting(choice.python);
      else await this.useManaged();
      if (!this.python) return;
      // Nothing the build depends on changed since last time: carry on from there.
      if (this.state.info && this.loadSaved()?.key === this.buildKey()) this.fresh = false;
      else this.state = { ...this.state, info: null };
      await this.build();
    } catch (e) {
      if (this.abort.signal.aborted) return;
      const message = e instanceof Error ? e.message : String(e);
      const output = e instanceof CommandError ? e.output : '';
      if (choice.kind === 'managed' && NETWORK_ERROR.test(output + message)) this.offline();
      else this.setStatus({ kind: 'error', message });
    }
  }

  private async useExisting(python: string) {
    this.setStatus({ kind: 'setting-up', step: 'Checking the Python environment' });
    const found = await probePython(python, 'Chosen');
    if (!found) throw new Error(`The Python at ${python} couldn’t be started. Choose another environment.`);
    if (!usable(found)) {
      const missing = [!found.sphinx && 'Sphinx', !found.myst && 'MyST-Parser'].filter(Boolean).join(' and ');
      throw new Error(`The Python at ${python} (${found.pythonVersion}) doesn’t have ${missing} installed. Install it there, or choose another environment.`);
    }
    this.write(`Using ${python}: Python ${found.pythonVersion}, Sphinx ${found.sphinx}, MyST-Parser ${found.myst}\n`);
    this.state = { ...this.state, environment: { kind: 'existing', python, pythonVersion: found.pythonVersion, sphinx: found.sphinx! } };
    this.python = python;
  }

  private async useManaged() {
    const uv = findUv(this.opts.resourcesPath, this.opts.appRoot);
    if (!uv) throw new Error('The uv tool needed to set up Sphinx was not found.');
    const plan = planEnvironment(this.opts.root, this.project.sourceDir);
    this.state = { ...this.state, environment: { kind: 'managed', requirements: plan.description } };
    // An environment that's already set up needs no network; otherwise check first,
    // rather than letting downloads time out.
    if (!(await environmentIsCurrent(plan, this.paths))) {
      this.setStatus({ kind: 'setting-up', step: 'Checking the internet connection' });
      if (!(await canDownload(!hasManagedPython(this.paths)))) return this.offline();
    }
    this.setStatus({ kind: 'setting-up', step: 'Checking the Python environment' });
    const { python } = await ensureEnvironment(
      uv,
      this.opts.root,
      this.project.sourceDir,
      this.paths,
      (step) => this.setStatus({ kind: 'setting-up', step }),
      { log: (t) => this.write(t), signal: this.abort.signal, env: this.opts.extraEnv() },
    );
    this.python = python;
  }

  private offline() {
    const plan = planEnvironment(this.opts.root, this.project.sourceDir);
    this.write('No internet connection: the managed environment can’t be set up.\n');
    this.setStatus({
      kind: 'error',
      offline: true,
      message:
        `This computer can’t reach the internet, which setting up Sphinx needs the first time ` +
        `(to download Python and the packages from ${plan.description}). ` +
        `Choose a Python environment on this computer that already has Sphinx and MyST-Parser.`,
    });
  }

  private async build() {
    if (!this.python || this.building || this.abort.signal.aborted) return;
    this.building = true;
    const fresh = this.fresh;
    this.setStatus({ kind: 'building' });
    const buildDir = join(this.opts.dataDir, 'builds', this.key);
    const resultFile = join(buildDir, 'result.json');
    try {
      await fs.mkdir(buildDir, { recursive: true });
      await fs.rm(resultFile, { force: true });
      const driver = this.driverPath();
      const args = [driver, '--srcdir', this.project.sourceDir, '--outdir', this.outputDir, '--doctreedir', join(buildDir, 'doctrees'), '--result', resultFile];
      if (fresh) args.push('--fresh');
      const { output } = await run(this.python, args, {
        cwd: this.project.sourceDir, // like Read the Docs; conf.py paths are often relative to it
        env: this.buildEnv(),
        log: (t) => this.write(t),
        signal: this.abort.signal,
        timeoutMs: BUILD_TIMEOUT_MS,
      });
      if (this.abort.signal.aborted) return;
      if (!existsSync(resultFile)) throw new CommandError(`Sphinx stopped unexpectedly:\n${output.trim().split('\n').slice(-12).join('\n')}`, output);
      const result: BuildResult = JSON.parse(await fs.readFile(resultFile, 'utf8'));
      this.apply(result, fresh);
    } catch (e) {
      if (this.abort.signal.aborted) return;
      this.setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.building = false;
      this.busyUntil = Date.now() + BUSY_GRACE_MS;
    }
    if (this.pending && !this.abort.signal.aborted) {
      const { fresh: again } = this.pending;
      this.pending = null;
      this.requestBuild({ fresh: again });
    }
  }

  private buildEnv() {
    return {
      ...(this.state.environment?.kind === 'existing'
        ? existingEnv()
        : { ...uvEnv(this.paths), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', ELECTRON_RUN_AS_NODE: undefined }),
      ...this.opts.extraEnv(),
    };
  }

  // The whole project as one page, with Sphinx's plain theme, for a PDF: the page's
  // file. Built apart from the preview's builds (its own folders), so neither makes
  // the other read every page again.
  async buildOnePage(signal: AbortSignal, siteCss = true): Promise<{ html: string; variables: Record<string, string>; version: string; release: string; warnings: SphinxWarning[] }> {
    if (!this.python) throw new Error('Sphinx isn’t set up for this project yet. Allow it to build first (the banner at the top).');
    const dir = join(this.opts.dataDir, 'builds', this.key, 'pdf');
    const resultFile = join(dir, 'result.json');
    await fs.mkdir(dir, { recursive: true });
    await fs.rm(resultFile, { force: true });
    const args = [this.driverPath(), '--srcdir', this.project.sourceDir, '--outdir', join(dir, 'html'), '--doctreedir', join(dir, 'doctrees'), '--result', resultFile, '--pdf', ...(siteCss ? [] : ['--no-site-css'])];
    const { output } = await run(this.python, args, { cwd: this.project.sourceDir, env: this.buildEnv(), log: (t) => this.write(t), signal, timeoutMs: BUILD_TIMEOUT_MS });
    if (signal.aborted) throw new Error('Cancelled');
    if (!existsSync(resultFile)) throw new CommandError(`Sphinx stopped unexpectedly:\n${output.trim().split('\n').slice(-12).join('\n')}`, output);
    const result: BuildResult = JSON.parse(await fs.readFile(resultFile, 'utf8'));
    if (!result.ok) throw new Error(`The Sphinx build failed:\n${(result.error ?? 'Unknown error').trim().split('\n').slice(-3).join('\n')}`);
    return { html: join(dir, 'html', `${result.root_doc ?? 'index'}.html`), variables: result.variables ?? {}, version: result.version ?? '', release: result.release ?? '', warnings: result.warnings };
  }

  private apply(raw: BuildResult, fresh: boolean) {
    // The driver reports paths relative to the source directory; the app uses paths
    // relative to the opened folder.
    const result: BuildResult = {
      ...raw,
      docs: raw.docs && Object.fromEntries(Object.entries(raw.docs).map(([name, d]) => [name, { ...d, source: fromProject(this.project, d.source) }])),
      warnings: raw.warnings.map((w) => ({ ...w, source: w.source && fromProject(this.project, w.source) })),
    };
    if (!result.ok) {
      const last = (result.error ?? 'Unknown error').trim().split('\n').slice(-3).join('\n');
      this.state = { ...this.state, status: { kind: 'error', message: `The Sphinx build failed:\n${last}` } };
      this.opts.emit(this.state);
      return;
    }
    this.fresh = false;
    const previous = fresh ? [] : (this.state.info?.warnings ?? []);
    const info: SphinxInfo = {
      sphinxVersion: result.sphinx_version ?? '',
      rootDoc: result.root_doc ?? 'index',
      docs: result.docs ?? {},
      objects: result.objects ?? [],
      warnings: mergeWarnings(previous, result),
      builtAt: Date.now(),
      duration: result.duration,
      variables: result.variables ?? {},
    };
    this.state = { ...this.state, status: { kind: 'ready' }, info };
    this.opts.emit(this.state);
    const saved: SavedState = { version: 1, key: this.buildKey(), info };
    // Written at once, under another name and then moved into place: the app may close
    // (or another session start) right after a build, and must find all of it or none.
    try {
      const tmp = `${this.savedFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(saved));
      renameSync(tmp, this.savedFile);
    } catch {
      // not saved: the next session builds afresh
    }
  }

  private driverPath(): string {
    const packaged = this.opts.resourcesPath && join(this.opts.resourcesPath, 'sphinx', 'mysteditor_build.py');
    return packaged && existsSync(packaged) ? packaged : join(this.opts.appRoot, 'resources', 'sphinx', 'mysteditor_build.py');
  }
}
