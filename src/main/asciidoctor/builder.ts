// An Asciidoctor project's builder: builds its pages in the background when they
// change, only what the changes affect (see build.ts). Asciidoctor.js runs in the app
// itself, so there's nothing to set up or allow first. What each page gave is kept for
// the next session, which then builds only the pages changed since.
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '../../shared/api.js';
import type { BuildState } from '../../shared/build.js';
import type { Builder, BuilderFactory } from '../builders/builder.js';
import { buildAsciidoctor, onePage, type BuildCache } from './build.js';
import { withinProject } from '../../shared/projects.js';

const BUILD_DELAY_MS = 400;
// Files changing this long after a build may still be its output.
const BUSY_GRACE_MS = 1500;

export class AsciidoctorBuilder implements Builder {
  readonly name = 'Asciidoctor';
  private state: BuildState = { status: { kind: 'off' }, info: null, environment: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private building = false;
  private pending = false;
  private fresh = false;
  private changed = new Set<string>(); // since the last build, relative to the project
  private cache: BuildCache | null = null;
  private disposed = false;
  private busyUntil = 0;
  private log = '';
  private readonly key: string;

  constructor(
    private project: Project,
    private opts: { dataDir: string; emit: (state: BuildState) => void },
  ) {
    this.key = createHash('sha256').update(project.sourceDir).digest('hex').slice(0, 16);
  }

  get outputDir(): string {
    return join(this.opts.dataDir, 'builds', this.key, 'html');
  }

  private get cacheFile(): string {
    return join(this.opts.dataDir, 'builds', this.key, 'pages.json');
  }

  start() {
    try {
      this.cache = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as BuildCache;
    } catch {
      this.cache = null;
    }
    this.requestBuild();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  busy(): boolean {
    return this.building || Date.now() < this.busyUntil;
  }

  requestBuild({ fresh = false, changed }: { fresh?: boolean; changed?: string } = {}) {
    if (this.disposed) return;
    this.pending = true;
    this.fresh ||= fresh;
    if (changed && (this.project.dir === '' || changed.startsWith(this.project.dir + '/'))) this.changed.add(withinProject(this.project, changed));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.build(), BUILD_DELAY_MS);
  }

  getState(): BuildState {
    return this.state;
  }

  getLog(): string {
    return this.log;
  }

  // Apart from the preview's pages: a folder of its own.
  onePage(signal: AbortSignal, { siteCss }: { siteCss: boolean }) {
    return onePage(this.project, join(this.opts.dataDir, 'builds', this.key, 'pdf'), siteCss).then((page) => {
      if (signal.aborted) throw new Error('Cancelled');
      return page;
    });
  }

  private emit(status: BuildState['status'], info = this.state.info) {
    this.state = { ...this.state, status, info };
    if (!this.disposed) this.opts.emit(this.state);
  }

  private async build() {
    if (this.building || !this.pending) return;
    this.building = true;
    this.pending = false;
    const request = { previous: this.cache, changed: [...this.changed], fresh: this.fresh };
    this.changed.clear();
    this.fresh = false;
    this.emit({ kind: 'building' });
    try {
      const { info, cache, built } = await buildAsciidoctor(this.project, this.outputDir, request);
      this.cache = cache;
      void this.saveCache(cache);
      this.log = `Built ${built.length} of ${Object.keys(info.docs).length} pages in ${info.duration.toFixed(1)} s with Asciidoctor ${info.builtWith.version}${built.length ? `: ${built.join(', ')}` : ''}\n${info.warnings.map((w) => `${w.source}${w.line ? `:${w.line}` : ''}: ${w.level}: ${w.message}`).join('\n')}`;
      this.emit({ kind: 'ready' }, info);
    } catch (e) {
      this.log = String(e instanceof Error ? e.stack : e);
      // What was asked for isn't built: next time, everything is.
      this.fresh = true;
      this.emit({ kind: 'error', message: `The Asciidoctor build failed:\n${String(e instanceof Error ? e.message : e)}` });
    } finally {
      this.building = false;
      this.busyUntil = Date.now() + BUSY_GRACE_MS;
      if (this.pending && !this.disposed) this.requestBuild();
    }
  }

  // Written under another name and moved into place: a session closing mid-write
  // leaves the last one whole.
  private async saveCache(cache: BuildCache) {
    try {
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(cache));
      await fs.rename(tmp, this.cacheFile);
    } catch {
      // not kept: the next session builds everything
    }
  }
}

// Where Asciidoctor projects' builds go: beside Sphinx's.
export const asciidoctorData = (sphinxData: string) => join(sphinxData, '..', 'asciidoctor');

export const asciidoctorBuilders = (dataDir: string): BuilderFactory => async (_folder, projects, emit) =>
  new Map(projects.map((p) => [p.id, new AsciidoctorBuilder(p, { dataDir, emit: (state) => emit(p, state) })]));
