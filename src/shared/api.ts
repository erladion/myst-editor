// The API the preload script exposes to the renderer as `window.myst`.
import type { MystConfig } from '../core/project-config.js';
import type { EnvironmentChoice, PythonCandidate, SphinxState } from './sphinx.js';
import type { Branches, ConflictFile, GitInfo, GitOperation, PageVersion } from './git.js';
import type { ValeResult } from './vale.js';

// One Sphinx project (a conf.py and the pages under it) inside the opened folder.
export interface SphinxProject {
  id: string; // stable, hostname-safe; also names the project's preview origin
  name: string; // `project = "..."` from conf.py, or the folder name
  dir: string; // source directory relative to the opened folder ('' for the folder itself)
  sourceDir: string; // absolute
  confPy: string; // relative to the opened folder
  config: MystConfig;
}

export interface ProjectInfo {
  root: string; // the folder the writer opened
  name: string;
  projects: SphinxProject[]; // may be empty: a plain Markdown folder
  defaultConfig: MystConfig; // for pages outside every project
  files: string[]; // Markdown files, POSIX paths relative to root
  titles: Record<string, string>; // first heading of each file, where found
  // Sizes and times of the folder's Python files and capabilities files (extensions
  // and the data they read), which Sphinx doesn't track: when it differs from the
  // last build's, the first build starts afresh.
  buildInputs: string;
}

// Search results in one page: each match with its line (1-based) and where in it.
export interface PageMatches {
  path: string;
  matches: { line: number; text: string; from: number; to: number }[];
}

export interface OpenProgress {
  folder: string;
  step: string; // e.g. "Reading page titles"
  detail?: string; // e.g. "1200 of 3400"
}

export interface FilesChanged {
  files: string[]; // the current file list
  titles: Record<string, string>;
  changed: string[]; // files whose content changed on disk (not by us)
}

// The folder's projects or their settings changed (conf.py, .mysteditor.toml, ...).
export interface ProjectChanged {
  project: ProjectInfo;
}

export interface AboutInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  system: string;
}

export type MenuCommand = 'open-folder' | 'save' | 'toggle-source' | 'clone' | 'new-page' | 'delete-page' | 'go-to-page' | 'toggle-outline' | 'page-history' | 'switch-branch' | 'rename-page' | 'find' | 'toggle-emacs' | 'search-pages' | 'about';

export interface MystApi {
  // The project from the command line or the last session, if any.
  initialProject(): Promise<ProjectInfo | null>;
  chooseProject(): Promise<ProjectInfo | null>;
  openProject(folder: string): Promise<ProjectInfo>;
  // Emacs keys on or off (the menu then leaves Emacs' keys alone).
  setEmacsKeys(on: boolean): void;
  // Folders opened lately that still exist, most recent first.
  recentFolders(): Promise<string[]>;
  // File → Open Recent asked for a folder.
  onOpenFolderPath(cb: (folder: string) => void): () => void;
  // Environment variables for a project's Sphinx builds: from its .mysteditor.toml,
  // and the writer's own for the opened folder (which win). Setting them rebuilds.
  sphinxEnv(project: string): Promise<{ project: Record<string, string>; yours: Record<string, string> }>;
  setSphinxEnv(vars: Record<string, string>): Promise<void>;
  // Create a page (never replacing a file), or delete one: to the trash, or
  // permanently when asked (`trashed: false` means the trash wasn't available).
  createPage(rel: string, text: string): Promise<void>;
  // Move a page's file (and its history in the app) to a new path.
  renamePage(from: string, to: string): Promise<void>;
  deletePage(rel: string, permanently: boolean): Promise<{ trashed: boolean }>;
  // An image pasted or dropped into a page, as the path to write in it: a file (its
  // path from filePath), or a picture's bytes with a file name.
  addImageFile(page: string, path: string): Promise<string>;
  addImageData(page: string, name: string, bytes: Uint8Array): Promise<string>;
  // Where a dropped or pasted File is on disk ('' for a clipboard picture).
  filePath(file: File): string;
  // A page's earlier versions, newest first, and one of them as text (null if it
  // can't be read). snapshotPage keeps the page as it is now, before a restore.
  pageHistory(rel: string): Promise<PageVersion[]>;
  pageVersion(rel: string, version: PageVersion): Promise<string | null>;
  snapshotPage(rel: string): Promise<void>;
  // Search every page's Markdown for some text.
  searchPages(query: string, caseSensitive: boolean): Promise<{ results: PageMatches[]; truncated: boolean }>;
  // Vale's alerts for a saved page, when Vale is installed and configured for it.
  valeLint(rel: string): Promise<ValeResult>;
  // The app's version and what it runs on, for Help → About.
  about(): Promise<AboutInfo>;
  // Pick an image for a page: its path relative to the page, or null if cancelled.
  // Images from outside the opened folder are copied into one.
  chooseImage(page: string): Promise<string | null>;
  readFile(rel: string): Promise<string>;
  writeFile(rel: string, text: string): Promise<void>;
  // URL the renderer can load an image from; `rel` is relative to the project root.
  assetUrl(rel: string): string;
  // Tell the main process whether closing the window would lose changes.
  setUnsaved(unsaved: boolean): void;
  // Close after the renderer has finished saving.
  closeWindow(): void;
  onFilesChanged(cb: (e: FilesChanged) => void): () => void;
  // Whether the app is dark (the writer's choice, or the system's), now and on change.
  isDark(): Promise<boolean>;
  onDarkChanged(cb: (dark: boolean) => void): () => void;
  // While a folder is being opened; null when done.
  onOpenProgress(cb: (p: OpenProgress | null) => void): () => void;
  onProjectChanged(cb: (e: ProjectChanged) => void): () => void;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onCloseRequested(cb: () => void): () => void;

  // Background Sphinx builds, per project id.
  sphinxState(): Promise<Record<string, SphinxState>>;
  onSphinxState(cb: (update: { project: string; state: SphinxState }) => void): () => void;
  // Allow the opened folder's projects to run Sphinx with the given environment
  // (remembered for the folder), or not for now.
  useEnvironment(choice: EnvironmentChoice): Promise<void>;
  declineSphinx(): Promise<void>;
  // Pythons on this computer that could build the projects.
  pythonCandidates(): Promise<PythonCandidate[]>;
  // Let the writer pick an interpreter; null if cancelled or not a working Python.
  browsePython(): Promise<PythonCandidate | null>;
  rebuild(project: string): Promise<void>;
  sphinxLog(project: string): Promise<string>;
  // URL of a page in a project's HTML output, for the preview; `uri` as in SphinxDoc.
  buildUrl(project: string, uri: string): string;

  // Git, through the system's git (works with any host).
  gitInfo(): Promise<GitInfo>;
  onGitInfo(cb: (info: GitInfo) => void): () => void;
  // Clone `url` into a new folder inside `parent`; returns the new folder.
  gitClone(url: string, parent: string): Promise<string>;
  onGitProgress(cb: (line: string) => void): () => void;
  chooseFolder(title: string): Promise<string | null>;
  defaultCloneFolder(): Promise<string>;
  gitCommit(paths: string[], message: string, push: boolean): Promise<void>;
  gitPush(): Promise<void>;
  // Branches; switching (`leave`: uncommitted changes stay with the branch left) and
  // starting one (from `base`, e.g. origin/main, or from what's checked out: null).
  gitBranches(): Promise<Branches>;
  gitSwitch(branch: string, leave: boolean): Promise<GitOperation>;
  gitCreateBranch(name: string, base: string | null): Promise<void>;
  // Check the server for new commits now (quietly; the result comes as git info).
  gitCheck(): Promise<void>;
  // Get the latest from the server (rebasing the writer's commits onto it). Returns
  // what's left to settle if something clashed.
  gitGetLatest(): Promise<GitOperation>;
  gitConflicts(): Promise<ConflictFile[]>;
  gitResolve(path: string, text: string | null): Promise<void>;
  gitTakeSide(path: string, side: 'server' | 'yours'): Promise<void>;
  gitContinue(): Promise<GitOperation>;
  gitAbort(): Promise<void>;
  // Throw away a file's uncommitted changes (paths relative to the repository root),
  // and a file as last committed (null if it's new).
  gitDiscard(path: string): Promise<void>;
  gitCommitted(path: string): Promise<string | null>;
  gitSetIdentity(name: string, email: string, global: boolean): Promise<void>;
  // Questions from git or ssh (passwords, passphrases, host keys).
  onAskPass(cb: (q: { id: number; question: string }) => void): () => void;
  answerAskPass(id: number, answer: string | null): void;
}

export const ASSET_SCHEME = 'myst-asset';
export const BUILD_SCHEME = 'myst-build';
