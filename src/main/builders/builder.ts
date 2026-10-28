// A project's builder in the main process: it builds the project's pages in the
// background and tells the window how that's going (see shared/build.ts). Sphinx's
// is in sphinx/.
import type { BuildState, BuildWarning } from '../../shared/build.js';
import type { BuilderId, Project, ProjectInfo } from '../../shared/api.js';

// The whole project built as one HTML page, for a PDF (see pdf/export.ts): the
// file, the project's variables for the PDF's {name}s, its version, and what the
// build warned about. The page has its content in [role="main"], each page's in a
// <section> (nested as the pages are) after a <span id="document-NAME"> marker.
export interface OnePage {
  html: string;
  variables: Record<string, string>;
  version: string;
  release: string;
  warnings: BuildWarning[];
}

export interface Builder {
  readonly name: string; // what builds, for the writer: "Sphinx"
  readonly outputDir: string; // the built pages, for the preview
  // Where what the built pages link to is, when it isn't in outputDir (pictures
  // beside the pages they're in, for a builder that doesn't copy them).
  readonly assetsDir?: string;
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
  // Get ready to build, when the builder needs to (an environment to set up).
  prepare?(): Promise<void>;
  // The project as one page, for a PDF; `siteCss`: with the site's stylesheets.
  onePage?(signal: AbortSignal, opts: { siteCss: boolean }): Promise<OnePage>;
}

// Makes the builders of a folder's projects of one kind. `emit` tells the window a
// project's build state.
export type BuilderFactory = (folder: ProjectInfo, projects: Project[], emit: (project: Project, state: BuildState) => void) => Promise<Map<string, Builder>>;

export type BuilderFactories = Record<BuilderId, BuilderFactory>;
