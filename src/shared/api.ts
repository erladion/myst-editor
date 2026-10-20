// The API the preload script exposes to the renderer as `window.myst`.
import type { MystConfig } from '../core/project-config.js';
import type { SphinxState } from './sphinx.js';

export interface ProjectInfo {
  root: string; // the folder the writer opened
  sourceDir: string; // the Sphinx source directory (where conf.py is), or root
  name: string;
  confPy: string | null; // relative to root
  config: MystConfig;
  files: string[]; // Markdown files, POSIX paths relative to sourceDir
  titles: Record<string, string>; // first heading of each file, where found
}

export interface FilesChanged {
  files: string[]; // the current file list
  titles: Record<string, string>;
  changed: string[]; // files whose content changed on disk (not by us)
}

export type MenuCommand = 'open-folder' | 'save' | 'toggle-source';

export interface MystApi {
  // The project from the command line or the last session, if any.
  initialProject(): Promise<ProjectInfo | null>;
  chooseProject(): Promise<ProjectInfo | null>;
  openProject(folder: string): Promise<ProjectInfo>;
  readFile(rel: string): Promise<string>;
  writeFile(rel: string, text: string): Promise<void>;
  // URL the renderer can load an image from; `rel` is relative to the project root.
  assetUrl(rel: string): string;
  // Tell the main process whether closing the window would lose changes.
  setUnsaved(unsaved: boolean): void;
  // Close after the renderer has finished saving.
  closeWindow(): void;
  onFilesChanged(cb: (e: FilesChanged) => void): () => void;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onCloseRequested(cb: () => void): () => void;

  // Background Sphinx builds.
  sphinxState(): Promise<SphinxState>;
  onSphinxState(cb: (state: SphinxState) => void): () => void;
  // Allow this project to run Sphinx (remembered), or not for now.
  trustSphinx(): Promise<void>;
  declineSphinx(): Promise<void>;
  rebuild(): Promise<void>;
  sphinxLog(): Promise<string>;
  // URL of a page in the HTML output, for the preview; `uri` as in SphinxDoc.
  buildUrl(uri: string): string;
}

export const ASSET_SCHEME = 'myst-asset';
export const BUILD_SCHEME = 'myst-build';
