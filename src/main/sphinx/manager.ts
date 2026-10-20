// Runs a project's Sphinx build in the background: environment setup, debounced
// incremental builds, and merged results for the renderer.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ProjectInfo } from '../../shared/api.js';
import { mergeWarnings, type BuildResult, type SphinxInfo, type SphinxState, type SphinxStatus } from '../../shared/sphinx.js';
import { ensureEnvironment, findUv, uvEnv, type EnvPaths } from './environment.js';
import { planEnvironment } from './discover.js';
import { run, CommandError } from './run.js';

export interface ManagerOptions {
  dataDir: string; // e.g. <userData>/sphinx
  appRoot: string; // for development: where resources/ lives
  resourcesPath: string | null; // packaged app resources
  trusted: boolean;
  emit: (state: SphinxState) => void;
}

const BUILD_DELAY_MS = 600;
const BUILD_TIMEOUT_MS = 20 * 60_000;

export class SphinxManager {
  private state: SphinxState = { status: { kind: 'off' }, info: null };
  private abort = new AbortController();
  private python: string | null = null;
  private building = false;
  private pending: { fresh: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  // The first build of a session re-reads everything, so all warnings are known.
  private fresh = true;
  private log: WriteStream;
  private logTail = '';
  private readonly key: string;
  private readonly paths: EnvPaths;

  constructor(
    private project: ProjectInfo,
    private opts: ManagerOptions,
  ) {
    this.key = createHash('sha256').update(project.root).digest('hex').slice(0, 16);
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
    if (!this.project.confPy) return; // not a Sphinx project
    if (this.opts.trusted) void this.setUp();
    else {
      const plan = planEnvironment(this.project.root, this.project.sourceDir);
      this.setStatus({ kind: 'needs-trust', requirements: plan.description });
    }
  }

  trust() {
    this.opts.trusted = true;
    void this.setUp();
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
    this.state = { ...this.state, status };
    this.opts.emit(this.state);
  }

  private async setUp() {
    const uv = findUv(this.opts.resourcesPath, this.opts.appRoot);
    if (!uv) {
      this.setStatus({ kind: 'error', message: 'The uv tool needed to set up Sphinx was not found.' });
      return;
    }
    try {
      this.setStatus({ kind: 'setting-up', step: 'Checking the Python environment' });
      const { python } = await ensureEnvironment(
        uv,
        this.project.root,
        this.project.sourceDir,
        this.paths,
        (step) => this.setStatus({ kind: 'setting-up', step }),
        { log: (t) => this.write(t), signal: this.abort.signal },
      );
      this.python = python;
      await this.build();
    } catch (e) {
      if (this.abort.signal.aborted) return;
      this.setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
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
        env: { ...uvEnv(this.paths), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', ELECTRON_RUN_AS_NODE: undefined },
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
    }
    if (this.pending && !this.abort.signal.aborted) {
      const { fresh: again } = this.pending;
      this.pending = null;
      this.requestBuild({ fresh: again });
    }
  }

  private apply(result: BuildResult, fresh: boolean) {
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
    };
    this.state = { status: { kind: 'ready' }, info };
    this.opts.emit(this.state);
  }

  private driverPath(): string {
    const packaged = this.opts.resourcesPath && join(this.opts.resourcesPath, 'sphinx', 'mysteditor_build.py');
    return packaged && existsSync(packaged) ? packaged : join(this.opts.appRoot, 'resources', 'sphinx', 'mysteditor_build.py');
  }
}
