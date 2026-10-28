// A project's builder in the main process: it builds the project's pages in the
// background and tells the window how that's going (see shared/build.ts). Sphinx's
// is in sphinx/.
import type { BuildState } from '../../shared/build.js';
import type { BuilderId, Project, ProjectInfo } from '../../shared/api.js';

export interface Builder {
  readonly outputDir: string; // the built pages, for the preview
  start(): void;
  dispose(): void;
  // Building, or only just finished: files changing now may be its output.
  busy(): boolean;
  // Build soon (several requests make one build); `fresh`: everything again.
  // `changed`: the file that changed (relative to the opened folder), for builders
  // that work out what it affects themselves.
  requestBuild(opts?: { fresh?: boolean; changed?: string }): void;
  getState(): BuildState;
  getLog(): string;
}

// Makes the builders of a folder's projects of one kind. `emit` tells the window a
// project's build state.
export type BuilderFactory = (folder: ProjectInfo, projects: Project[], emit: (project: Project, state: BuildState) => void) => Promise<Map<string, Builder>>;

export type BuilderFactories = Record<BuilderId, BuilderFactory>;
