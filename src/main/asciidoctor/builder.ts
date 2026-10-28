// An Asciidoctor project's builder: builds its pages in the background when they
// change (see build.ts). Asciidoctor.js runs in the app itself, so there's nothing to
// set up or allow first.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Project } from '../../shared/api.js';
import type { BuildState } from '../../shared/build.js';
import type { Builder, BuilderFactory } from '../builders/builder.js';
import { buildAsciidoctor } from './build.js';

const BUILD_DELAY_MS = 400;
// Files changing this long after a build may still be its output.
const BUSY_GRACE_MS = 1500;

export class AsciidoctorBuilder implements Builder {
  readonly name = 'Asciidoctor';
  private state: BuildState = { status: { kind: 'off' }, info: null, environment: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private building = false;
  private pending = false;
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

  start() {
    this.requestBuild();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  busy(): boolean {
    return this.building || Date.now() < this.busyUntil;
  }

  // Asciidoctor builds every page each time, so a fresh build is like any other.
  requestBuild() {
    if (this.disposed) return;
    this.pending = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.build(), BUILD_DELAY_MS);
  }

  getState(): BuildState {
    return this.state;
  }

  getLog(): string {
    return this.log;
  }

  private emit(status: BuildState['status'], info = this.state.info) {
    this.state = { ...this.state, status, info };
    if (!this.disposed) this.opts.emit(this.state);
  }

  private async build() {
    if (this.building || !this.pending) return;
    this.building = true;
    this.pending = false;
    this.emit({ kind: 'building' });
    try {
      const info = await buildAsciidoctor(this.project, this.outputDir);
      this.log = `Built ${Object.keys(info.docs).length} pages in ${info.duration.toFixed(1)} s with Asciidoctor ${info.builtWith.version}\n${info.warnings.map((w) => `${w.source}${w.line ? `:${w.line}` : ''}: ${w.level}: ${w.message}`).join('\n')}`;
      this.emit({ kind: 'ready' }, info);
    } catch (e) {
      this.log = String(e instanceof Error ? e.stack : e);
      this.emit({ kind: 'error', message: `The Asciidoctor build failed:\n${String(e instanceof Error ? e.message : e)}` });
    } finally {
      this.building = false;
      this.busyUntil = Date.now() + BUSY_GRACE_MS;
      if (this.pending && !this.disposed) this.requestBuild();
    }
  }
}

export const asciidoctorBuilders = (dataDir: string): BuilderFactory => async (_folder, projects, emit) =>
  new Map(projects.map((p) => [p.id, new AsciidoctorBuilder(p, { dataDir, emit: (state) => emit(p, state) })]));
