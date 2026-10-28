// Builds for the open folder: a builder per project, what a changed file makes build
// again, and the window's requests about builds.
import { ipcMain } from 'electron';
import { isBuildInput } from '../project.js';
import type { ProjectInfo } from '../../shared/api.js';
import type { BuildInfo } from '../../shared/build.js';
import { projectFor } from '../../shared/projects.js';
import { toWindow } from '../state.js';
import { sphinxBuilders } from '../sphinx/service.js';
import type { Builder, BuilderFactories } from './builder.js';

// (Made when asked: the builders' modules use this one too.)
const factories = (): BuilderFactories => ({ sphinx: sphinxBuilders });

// One builder per project, by project id.
const builders = new Map<string, Builder>();

export const builderOf = (id: string) => builders.get(id) ?? null;
export const allBuilders = () => [...builders.values()];

// Where a project's built pages are, for the preview (see protocols.ts).
export const outputDirOf = (id: string) => builders.get(id)?.outputDir ?? null;

// `onBuilt` hears about every finished build.
export async function startBuilders(p: ProjectInfo, onBuilt: (p: ProjectInfo, info: BuildInfo) => void) {
  stopBuilders();
  for (const [kind, make] of Object.entries(factories()) as [keyof BuilderFactories, BuilderFactories[keyof BuilderFactories]][]) {
    const projects = p.projects.filter((x) => x.builder === kind);
    if (!projects.length) continue;
    const made = await make(p, projects, (project, state) => {
      toWindow('build-state', { project: project.id, state });
      if (state.info) onBuilt(p, state.info);
    });
    made.forEach((b, id) => builders.set(id, b));
  }
  builders.forEach((b) => b.start());
}

export function stopBuilders() {
  builders.forEach((b) => b.dispose());
  builders.clear();
}

// Build these projects again from scratch (their settings changed).
export function rebuildFresh(ids: string[]) {
  ids.forEach((id) => builders.get(id)?.requestBuild({ fresh: true }));
}

// Files that changed while their project was building, in how many builds in a row.
// One changing during two builds is output of the build itself (an extension that
// generates pages, say), not an edit, so it doesn't start yet another build.
const changedInBuilds = new Map<string, number>();
export const forgetChangesInBuilds = () => changedInBuilds.clear();

// Build what a changed file can affect: its own project, incrementally (the builder
// works out what's outdated, including included files and images). Python files and
// data files are extension code and inputs builds can't track, so those builds start
// afresh, and a shared one outside every project affects them all.
export function buildFor(p: ProjectInfo, rel: string, external: boolean) {
  const owner = projectFor(p.projects, rel);
  const name = rel.split('/').pop()!;
  const fresh = isBuildInput(name);
  const targets = owner ? [builders.get(owner.id)!].filter(Boolean) : fresh || /\.(html|jinja2?)$/.test(name) ? [...builders.values()] : [];
  if (external) {
    if (targets.some((b) => b.busy())) {
      const n = (changedInBuilds.get(rel) ?? 0) + 1;
      changedInBuilds.set(rel, n);
      if (n >= 2) return;
    } else changedInBuilds.delete(rel);
  }
  targets.forEach((b) => b.requestBuild({ fresh }));
}

export function registerBuildIpc() {
  ipcMain.handle('build-state', () => Object.fromEntries([...builders].map(([id, b]) => [id, b.getState()])));
  ipcMain.handle('build-rebuild', (_e, id: string) => builders.get(id)?.requestBuild({ fresh: true }));
  ipcMain.handle('build-log', (_e, id: string) => builders.get(id)?.getLog() ?? '');
}
