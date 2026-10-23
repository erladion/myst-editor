// Electron main process: window, menu, project file access and change watching.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
// The version being built (app.getVersion() is Electron's own when run from out/).
import { version as appVersion } from '../../package.json';
// The window's icon, for Linux taskbars and docks (Windows and macOS take the
// executable's).
import icon from '../../build/icon.png?asset';
import { existsSync, promises as fs, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildInputsOf, firstHeading, isBuildInput, listDocuments, openProject, readDocument, readTitle, IMAGE_EXTENSIONS, placeImage, resolveInside, saveImage, searchPages, UNWATCHED_DIRS, unwatchedDir, writeDocument } from './project.js';
import { FolderWatcher } from './watch.js';
import { accept as acceptWithVale, lint as lintWithVale } from './vale.js';
import { Snapshots } from './history.js';
import { SphinxManager } from './sphinx/manager.js';
import { ASSET_SCHEME, BUILD_SCHEME, type AppMenuItem, type MenuCommand, type ProjectInfo } from '../shared/api.js';
import type { EnvironmentChoice, SphinxInfo, SphinxState } from '../shared/sphinx.js';
import { probePython } from './sphinx/pythons.js';
import { fragmentPage } from './sphinx/fragments.js';
import { builtPage } from './sphinx/preview.js';
import { Git, GitError } from './git/git.js';
import { AskPass } from './git/askpass.js';
import type { ConflictFile, GitInfo, PageVersion } from '../shared/git.js';
import { projectFor } from '../shared/projects.js';
import { ENV_NAME, SETTINGS_FILE } from '../core/editor-config.js';

// Lets tests (and portable setups) keep settings out of the real profile.
if (process.env.MYSTEDITOR_USER_DATA) app.setPath('userData', process.env.MYSTEDITOR_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BUILD_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let project: ProjectInfo | null = null;
let watcher: FolderWatcher | null = null;
// Git and the prompts it needs answered (see git/askpass.ts).
let askpass: AskPass | null = null;
const git = new Git(() => askpass?.env() ?? { GIT_TERMINAL_PROMPT: '0' });
const pendingQuestions = new Map<number, (answer: string | null) => void>();
let questionId = 0;
// Earlier versions of pages, kept by the app (see history.ts).
let snapshots: Snapshots;

function askWriter(question: string): Promise<string | null> {
  if (!win) return Promise.resolve(null);
  const id = ++questionId;
  win.webContents.send('askpass', { id, question });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingQuestions.delete(id);
      resolve(null);
    }, 5 * 60_000);
    pendingQuestions.set(id, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

async function gitInfo(): Promise<GitInfo> {
  const available = !!(await git.available());
  const repoRoot = project && available ? await git.repoRoot(project.root) : null;
  if (!project || !repoRoot) return { available, repoRoot: null, prefix: '', status: null, identity: null, operation: null, checked: null };
  const [status, identity] = await Promise.all([git.status(repoRoot).catch(() => null), git.identity(repoRoot)]);
  const prefix = relative(repoRoot, project.root).split(sep).join('/');
  const operation = status ? await git.operation(repoRoot, status) : null;
  return { available, repoRoot, prefix, status, identity, operation: operation ?? finishing, checked: lastCheck };
}

// The background check of the server (git fetch), so "N new on the server" is true:
// every few minutes, and when the window comes back to the front. Skipped while the
// writer is doing something with git.
const CHECK_EVERY_MS = 3 * 60_000;
let lastCheck: { at: number; error: string | null } | null = null;
let gitBusy = false;
// A clash with set-aside edits being settled: nothing on disk says so once the files
// are settled (see Git.continue).
let finishing: GitInfo['operation'] = null;
let checking = false;
async function checkServer() {
  if (gitBusy || checking || !project) return;
  const root = await git.repoRoot(project.root);
  if (!root || gitBusy) return;
  const status = await git.status(root).catch(() => null);
  if (!status?.upstream) return;
  checking = true;
  try {
    await exclusive(() => git.fetch(root));
    lastCheck = { at: Date.now(), error: null };
  } catch (e) {
    lastCheck = { at: Date.now(), error: e instanceof Error ? e.message : String(e) };
  } finally {
    checking = false;
  }
  refreshGit();
}

// Git commands that change the repository take turns: two at once (a background
// check fetching while the writer gets the latest, say) can trip over git's locks.
let gitLock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const turn = gitLock.then(fn, fn);
  gitLock = turn.catch(() => {});
  return turn;
}
setInterval(() => void checkServer(), CHECK_EVERY_MS).unref();
let lastFocusCheck = 0;
function checkOnFocus() {
  if (Date.now() - lastFocusCheck < 60_000) return;
  lastFocusCheck = Date.now();
  void checkServer();
}

// A git action the writer started: no background check meanwhile, and the window
// hears about the result.
async function gitAction<T>(fn: (root: string) => Promise<T>): Promise<T> {
  gitBusy = true;
  try {
    const root = await requireRepo();
    return await exclusive(() => fn(root));
  } finally {
    gitBusy = false;
    refreshGit();
  }
}

let gitTimer: NodeJS.Timeout | undefined;
// Tell the window about the repository's state, soon (several changes → one update).
function refreshGit() {
  clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => win?.webContents.send('git-info', await gitInfo()), 400);
}

async function requireRepo(): Promise<string> {
  const root = project && (await git.repoRoot(project.root));
  if (!root) throw new Error('This folder isn’t part of a git repository.');
  return root;
}

// Errors cross IPC as plain messages; GitError's is already written for the writer.
function plain<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    throw new Error(e instanceof GitError ? e.message : e instanceof Error ? e.message : String(e));
  });
}

// One build manager per Sphinx project, by project id.
const sphinx = new Map<string, SphinxManager>();
let unsaved = false;
let closing = false;
// The content of files as last seen (or written by us), by path relative to the
// opened folder: a file event only counts when the content really changed.
const fingerprints = new Map<string, string>();
const fingerprintText = (text: string | Buffer) => createHash('sha1').update(text).digest('hex');

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

interface Settings {
  lastProject?: string;
  // Folders opened lately, most recent first.
  recent?: string[];
  // Projects the writer allowed to run Sphinx (which executes their conf.py).
  trusted?: string[];
  // Per project root: where its builds get Python from.
  environments?: Record<string, EnvironmentChoice>;
  // Light or dark, or as the system is.
  theme?: Theme;
  // Who draws the title bar: the app, with the menus in it (as in VS Code), or the
  // system, with its own menu bar below. Applies from the next start.
  titleBar?: 'custom' | 'system';
  // Per project root: the writer's own environment variables for Sphinx builds, on
  // top of (and overriding) the projects' [sphinx.env].
  sphinxEnv?: Record<string, Record<string, string>>;
}

// Settings.recent, for the File → Open Recent menu.
let recentFolders: string[] = [];
// Emacs keys (set from the window): the menu then leaves the keys Emacs uses alone.
let emacsKeys = false;

// A menu item's shortcut, unless Emacs keys are on: then the window handles the keys,
// and the label shows the Emacs ones (see withKeys; Electron can't show a chord).
function keys(accelerator: string, _emacs: string | null): Partial<MenuItemConstructorOptions> {
  return emacsKeys ? { registerAccelerator: false } : { accelerator };
}
const withKeys = (label: string, emacs: string | null) => (emacsKeys && emacs ? `${label}    ${emacs}` : label);

// The writer's variables for the open folder (see Settings.sphinxEnv).
let userEnv: Record<string, string> = {};

// A project's variables for its builds: its settings file's, then the writer's.
function envFor(p: ProjectInfo, id: string): Record<string, string> {
  const project = p.projects.find((x) => x.id === id);
  return { ...project?.config.editor.sphinxEnv, ...userEnv };
}

type Theme = 'system' | 'light' | 'dark';

// The window's colour before the page has drawn, matching the theme (no white flash).
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#17191d' : '#ffffff');

// Electron applies the choice everywhere: the app's own styles, and built pages whose
// Sphinx theme follows the system's (Furo, PyData, Book theme).
async function setTheme(theme: Theme, save = true) {
  nativeTheme.themeSource = theme;
  if (save) await updateSettings((s) => ({ ...s, theme }));
  buildMenu(theme);
}

async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

// One change at a time (each reads what the last wrote), and written whole: to a
// temporary file first, so the file is never seen half-written, even after a crash.
let settingsWrite: Promise<void> = Promise.resolve();
function updateSettings(patch: (s: Settings) => Settings): Promise<void> {
  const write = async () => {
    const next = patch(await loadSettings());
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const temp = `${settingsPath()}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(next, null, 2));
    // Windows refuses the rename while another program has the file open: try again.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, settingsPath());
        return;
      } catch (e) {
        if (attempt >= 10 || (e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  settingsWrite = settingsWrite.then(write, write);
  return settingsWrite;
}

// Opening a large folder takes a while: tell the window what's happening.
let progressTimer: NodeJS.Timeout | undefined;
let progressNext: { step: string; detail?: string } | null = null;
function openProgress(folder: string, step: string | null, detail?: string) {
  clearTimeout(progressTimer);
  if (step === null) {
    progressNext = null;
    win?.webContents.send('open-progress', null);
    return;
  }
  const first = !progressNext;
  progressNext = { step, detail };
  const send = () => win?.webContents.send('open-progress', { folder, ...progressNext });
  if (first) send();
  else progressTimer = setTimeout(send, 100);
}

async function useProject(folder: string): Promise<ProjectInfo> {
  try {
    project = await openProject(folder, (step, detail) => openProgress(folder, step, detail));
  } finally {
    openProgress(folder, null);
  }
  fingerprints.clear();
  builtPages.clear();
  finishing = null;
  lastCheck = null;
  startWatching(project);
  setTimeout(() => void checkServer(), 2000);
  setWindowTitle(`${project.name} — MyST Editor`);
  const root = project.root;
  await updateSettings((s) => ({ ...s, lastProject: root, recent: [root, ...(s.recent ?? []).filter((r) => r !== root)].slice(0, 10) }));
  recentFolders = (await loadSettings()).recent ?? [];
  buildMenu();
  await startSphinx(project);
  refreshGit();
  return project;
}

// Trust and the environment choice belong to the opened folder, so one decision
// covers all its projects (e.g. two guides sharing one .venv).
async function startSphinx(p: ProjectInfo) {
  sphinx.forEach((m) => m.dispose());
  sphinx.clear();
  const settings = await loadSettings();
  userEnv = settings.sphinxEnv?.[p.root] ?? {};
  for (const sp of p.projects) {
    const manager = new SphinxManager(sp, {
      root: p.root,
      searchDirs: p.projects.map((x) => x.sourceDir),
      // Tests share one data dir so Python and packages are only downloaded once.
      dataDir: process.env.MYSTEDITOR_SPHINX_DATA ?? join(app.getPath('userData'), 'sphinx'),
      // out/main/index.js → the repository, where resources/ lives in development.
      appRoot: join(import.meta.dirname, '..', '..'),
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
      trusted: !!settings.trusted?.includes(p.root),
      buildInputs: () => p.buildInputs,
      extraEnv: () => envFor(p, sp.id),
      environment: settings.environments?.[p.root] ?? null,
      emit: (state: SphinxState) => {
        win?.webContents.send('sphinx-state', { project: sp.id, state });
        if (state.info) void addBuiltPages(p, state.info);
      },
    });
    sphinx.set(sp.id, manager);
    manager.start();
  }
}

// Pages Sphinx built that the folder scan didn't list (in a folder skipped by its name,
// say): they're pages all the same, so add them and keep them when the list is re-read.
const builtPages = new Set<string>();
async function addBuiltPages(p: ProjectInfo, info: SphinxInfo) {
  const listed = new Set(p.files);
  const missing = [...new Set(Object.values(info.docs).map((d) => d.source))].filter((s) => s.endsWith('.md') && !listed.has(s));
  const found: string[] = [];
  for (const rel of missing) {
    try {
      if ((await fs.stat(resolveInside(p.root, rel))).isFile()) found.push(rel);
    } catch {
      // gone, or outside the folder
    }
  }
  if (!found.length || project !== p) return;
  const titles = { ...p.titles };
  for (const rel of found) {
    builtPages.add(rel);
    const title = await readTitle(join(p.root, rel));
    if (title) titles[rel] = title;
  }
  if (project !== p) return;
  p.files = [...new Set([...p.files, ...found])].sort((a, b) => a.localeCompare(b));
  p.titles = titles;
  win?.webContents.send('files-changed', { files: p.files, titles, changed: [] });
}

// The page list changed by the app itself (a page added or deleted): tell the window
// now rather than waiting for the watcher. `added` gets its title read.
async function pagesChanged(p: ProjectInfo, files: string[], added?: string) {
  p.files = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  p.titles = Object.fromEntries(Object.entries(p.titles).filter(([f]) => p.files.includes(f)));
  if (added) {
    const title = await readTitle(join(p.root, added));
    if (title) p.titles[added] = title;
  }
  win?.webContents.send('files-changed', { files: p.files, titles: p.titles, changed: [] });
  refreshGit();
}

async function existing(root: string, rels: Iterable<string>): Promise<string[]> {
  const out: string[] = [];
  for (const rel of rels) {
    try {
      if ((await fs.stat(join(root, rel))).isFile()) out.push(rel);
    } catch {
      // gone
    }
  }
  return out;
}

// Re-read the folder's projects and settings, and tell the renderer if they changed.
// The same projects keep their build managers; new or removed ones restart them all.
async function refreshProject(p: ProjectInfo) {
  const next = await openProject(p.root);
  if (project !== p) return;
  const same = (a: ProjectInfo, b: ProjectInfo) => JSON.stringify([a.projects, a.defaultConfig]) === JSON.stringify([b.projects, b.defaultConfig]);
  if (same(next, p)) return;
  const restart = JSON.stringify(next.projects.map((x) => x.id)) !== JSON.stringify(p.projects.map((x) => x.id));
  // Projects whose [sphinx.env] changed build again from scratch (conf.py may read it).
  const envChanged = next.projects.filter((x) => JSON.stringify(x.config.editor.sphinxEnv) !== JSON.stringify(p.projects.find((y) => y.id === x.id)?.config.editor.sphinxEnv));
  Object.assign(p, { projects: next.projects, defaultConfig: next.defaultConfig, buildInputs: next.buildInputs });
  win?.webContents.send('project-changed', { project: p });
  if (restart) await startSphinx(p);
  else envChanged.forEach((x) => sphinx.get(x.id)?.requestBuild({ fresh: true }));
}

// Files that changed while their project was building, in how many builds in a row.
// One changing during two builds is output of the build itself (an extension that
// generates pages, say), not an edit, so it doesn't start yet another build.
const changedInBuilds = new Map<string, number>();

// Build what a changed file can affect: its own project, incrementally (Sphinx works
// out what's outdated, including included files and images). Python files and data
// files are extension code and inputs Sphinx can't track, so those builds start
// afresh, and a shared one outside every project affects them all.
function buildFor(p: ProjectInfo, rel: string, external: boolean) {
  const owner = projectFor(p.projects, rel);
  const name = rel.split('/').pop()!;
  const fresh = isBuildInput(name);
  const managers = owner ? [sphinx.get(owner.id)!].filter(Boolean) : fresh || /\.(html|jinja2?)$/.test(name) ? [...sphinx.values()] : [];
  if (external) {
    if (managers.some((m) => m.busy())) {
      const n = (changedInBuilds.get(rel) ?? 0) + 1;
      changedInBuilds.set(rel, n);
      if (n >= 2) return;
    } else changedInBuilds.delete(rel);
  }
  managers.forEach((m) => m.requestBuild({ fresh }));
}

// A file's content as a fingerprint; size and time for large files. Null if it's gone,
// 'dir' for a directory.
async function fingerprint(path: string): Promise<string | null> {
  try {
    const st = await fs.stat(path);
    if (st.isDirectory()) return 'dir';
    if (st.size > 4 * 1024 * 1024) return `${st.size}:${st.mtimeMs}`;
    return fingerprintText(await fs.readFile(path));
  } catch {
    return null;
  }
}

function startWatching(p: ProjectInfo) {
  watcher?.close();
  changedInBuilds.clear();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let flushing = Promise.resolve();
  const flush = async () => {
    if (project !== p) return;
    const batch = [...pending];
    pending.clear();
    const changed: string[] = []; // files whose content is new
    let relist = false; // a folder appeared or went: list the pages again
    for (const rel of batch) {
      const fp = await fingerprint(join(p.root, rel));
      if (fp === 'dir') {
        relist = true;
        continue;
      }
      if (fp === null) {
        if (p.files.some((f) => f.startsWith(rel + '/'))) relist = true;
        if (fingerprints.delete(rel) || p.files.includes(rel)) changed.push(rel);
        continue;
      }
      if (fingerprints.get(rel) === fp) continue;
      fingerprints.set(rel, fp);
      changed.push(rel);
    }
    if (project !== p || (!changed.length && !relist)) return;

    // Pages: only re-read what changed, which matters in a folder of thousands.
    const before = new Set(p.files);
    let files = relist ? [...new Set([...(await listDocuments(p.root)), ...(await existing(p.root, builtPages))])] : [...p.files];
    if (!relist) {
      for (const rel of changed.filter((r) => r.endsWith('.md'))) {
        const exists = fingerprints.has(rel);
        if (exists && !before.has(rel)) files.push(rel);
        if (!exists) files = files.filter((f) => f !== rel);
      }
      files.sort((a, b) => a.localeCompare(b));
    }
    const titles = Object.fromEntries(Object.entries(p.titles).filter(([f]) => files.includes(f)));
    const reread = new Set([...changed.filter((r) => r.endsWith('.md')), ...files.filter((f) => !before.has(f))]);
    for (const rel of reread) {
      if (!files.includes(rel)) continue;
      const title = await readTitle(join(p.root, rel));
      if (title) titles[rel] = title;
      else delete titles[rel];
    }
    if (project !== p) return;
    Object.assign(p, { files, titles });
    const pages = changed.filter((r) => r.endsWith('.md') && files.includes(r));
    win?.webContents.send('files-changed', { files, titles, changed: pages });
    refreshGit();
    // Our own saves request builds directly; these are changes made outside the app.
    if (changed.some((rel) => isBuildInput(rel.split('/').pop()!))) p.buildInputs = await buildInputsOf(p.root);
    for (const rel of changed) if (!rel.endsWith(SETTINGS_FILE)) buildFor(p, rel, true);
    // conf.py, editor settings and capabilities files change how pages are read.
    const settings = (rel: string) => /(^|\/)(conf\.py|\.mysteditor\.toml)$/.test(rel) || (rel.endsWith('.json') && isBuildInput(rel.split('/').pop()!));
    if (changed.some(settings)) await refreshProject(p);
  };
  const w = new FolderWatcher(p.root, unwatchedDir, (rel) => {
    // Hidden files are ignored, except the editor's own settings.
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if ((name.startsWith('.') && name !== SETTINGS_FILE) || UNWATCHED_DIRS.has(name)) return;
    pending.add(rel);
    clearTimeout(timer);
    // One flush at a time, so a slow one can't overlap the next.
    timer = setTimeout(() => (flushing = flushing.then(flush, flush)), 300);
  });
  watcher = w;
  w.start().catch((e) => console.warn('File watching unavailable:', e));
}

// The project folder from the command line (`mysteditor ./docs`), if given.
function folderFromArgs(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  for (const a of args) {
    try {
      if (statSync(a).isDirectory()) return a;
    } catch {
      // not a folder
    }
  }
  return process.env.MYSTEDITOR_PROJECT ?? null;
}

function registerIpc() {
  const requireProject = () => {
    if (!project) throw new Error('No project is open');
    return project;
  };
  ipcMain.handle('initial-project', async () => {
    const folder = folderFromArgs() ?? (await loadSettings()).lastProject;
    if (!folder) return null;
    try {
      return await useProject(folder);
    } catch {
      return null;
    }
  });
  ipcMain.handle('choose-project', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open documentation folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : useProject(result.filePaths[0]);
  });
  ipcMain.handle('open-project', (_e, folder: string) => useProject(folder));
  // Recent folders that are still there, for the welcome screen.
  ipcMain.on('set-emacs-keys', (_e, on: boolean) => {
    if (emacsKeys === !!on) return;
    emacsKeys = !!on;
    buildMenu();
  });
  ipcMain.handle('recent-folders', async () => {
    const out: string[] = [];
    for (const folder of (await loadSettings()).recent ?? []) {
      try {
        if ((await fs.stat(folder)).isDirectory()) out.push(folder);
      } catch {
        // gone (or on a drive that isn't there now)
      }
    }
    return out;
  });
  // Images pasted or dropped into a page: a file on disk (referenced where it is if
  // it's in the folder, else copied in), or bytes (a pasted screenshot).
  ipcMain.handle('add-image-file', (_e, page: string, path: string) => {
    if (!IMAGE_EXTENSIONS.includes(path.split('.').pop()?.toLowerCase() ?? '')) throw new Error(`Not an image file: ${path}`);
    return placeImage(requireProject().root, page, path);
  });
  ipcMain.handle('add-image-data', (_e, page: string, name: string, bytes: Uint8Array) => saveImage(requireProject().root, page, name, bytes));
  ipcMain.handle('vale-lint', (_e, rel: string) => lintWithVale(resolveInside(requireProject().root, rel)));
  ipcMain.handle('vale-accept', (_e, rel: string, word: string) => acceptWithVale(resolveInside(requireProject().root, rel), String(word)));
  ipcMain.handle('about', () => ({
    version: appVersion,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    system: `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${release()} (${process.arch})`,
  }));
  ipcMain.handle('search-pages', (_e, query: string, caseSensitive: boolean) => {
    const p = requireProject();
    return searchPages(p.root, p.files, String(query), !!caseSensitive);
  });
  ipcMain.handle('choose-image', async (_e, page: string) => {
    const p = requireProject();
    const pagePath = resolveInside(p.root, page);
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose an image',
      defaultPath: dirname(pagePath),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    });
    return result.canceled ? null : placeImage(p.root, page, result.filePaths[0]);
  });
  ipcMain.handle('read-file', (_e, rel: string) => readDocument(requireProject(), rel));
  ipcMain.handle('write-file', async (_e, rel: string, text: string) => {
    // The page as it was, as an earlier version (see history.ts).
    const before = await readDocument(requireProject(), rel).catch(() => null);
    if (before !== null && before !== text) await snapshots.keep(requireProject().root, rel, before).catch(() => {});
    fingerprints.set(rel, fingerprintText(text));
    await writeDocument(requireProject(), rel, text);
    // A changed heading is a new title for the sidebar and dialogs.
    const p = requireProject();
    const title = firstHeading(text);
    if ((title ?? undefined) !== p.titles[rel]) {
      p.titles = { ...p.titles };
      if (title) p.titles[rel] = title;
      else delete p.titles[rel];
      win?.webContents.send('files-changed', { files: p.files, titles: p.titles, changed: [] });
    }
    buildFor(p, rel, false);
    refreshGit();
  });
  // A new page; refuses to replace a file that exists.
  ipcMain.handle('create-page', async (_e, rel: string, text: string) => {
    const p = requireProject();
    if (!rel.endsWith('.md')) throw new Error('Pages are Markdown files ending in .md');
    const path = resolveInside(p.root, rel);
    await fs.mkdir(dirname(path), { recursive: true });
    try {
      await fs.writeFile(path, text, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`There’s already a file called ${rel}`);
      throw e;
    }
    fingerprints.set(rel, fingerprintText(text));
    await pagesChanged(p, [...p.files, rel], rel);
    buildFor(p, rel, false);
  });
  // Rename or move a page's file (its references are the window's job). Refuses to
  // replace another file.
  ipcMain.handle('rename-page', async (_e, from: string, to: string) => {
    const p = requireProject();
    if (!to.endsWith('.md')) throw new Error('Pages are Markdown files ending in .md');
    const source = resolveInside(p.root, from);
    const target = resolveInside(p.root, to);
    if (source === target) return;
    // On Windows and macOS a change of case alone is the same file: allow that.
    if (existsSync(target) && source.toLowerCase() !== target.toLowerCase()) throw new Error(`There’s already a file called ${to}`);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.rename(source, target);
    const fp = fingerprints.get(from);
    fingerprints.delete(from);
    if (fp) fingerprints.set(to, fp);
    if (builtPages.delete(from)) builtPages.add(to);
    await snapshots.rename(p.root, from, to).catch(() => {});
    await pagesChanged(p, [...p.files.filter((f) => f !== from), to], to);
    buildFor(p, from, false);
    buildFor(p, to, false);
  });
  // Delete a page: to the trash, or for good (when the trash isn't available).
  ipcMain.handle('delete-page', async (_e, rel: string, permanently: boolean) => {
    const p = requireProject();
    const path = resolveInside(p.root, rel);
    if (permanently) await fs.rm(path);
    // MYSTEDITOR_TRASH=none: act as if there's no trash (tests, which shouldn't fill
    // the desktop's).
    else if (process.env.MYSTEDITOR_TRASH === 'none') return { trashed: false };
    else {
      try {
        await shell.trashItem(path);
      } catch {
        return { trashed: false };
      }
    }
    fingerprints.delete(rel);
    builtPages.delete(rel);
    await pagesChanged(p, p.files.filter((f) => f !== rel));
    buildFor(p, rel, false);
    return { trashed: true };
  });
  // A page's earlier versions: the app's snapshots and its commits, newest first.
  ipcMain.handle('page-history', async (_e, rel: string): Promise<PageVersion[]> => {
    const p = requireProject();
    const saved: PageVersion[] = (await snapshots.list(p.root, rel)).map((s) => ({ kind: 'saved', id: s.id, date: s.date }));
    const repo = await git.repoRoot(p.root);
    const commits: PageVersion[] = repo
      ? (await git.fileHistory(repo, relative(repo, join(p.root, rel)).split(sep).join('/'))).map((c) => ({
          kind: 'commit',
          id: c.commit,
          date: c.date,
          author: c.author,
          message: c.message,
          body: c.body,
          path: c.path,
        }))
      : [];
    return [...saved, ...commits].sort((a, b) => b.date.localeCompare(a.date));
  });
  ipcMain.handle('page-version', async (_e, rel: string, version: PageVersion): Promise<string | null> => {
    const p = requireProject();
    if (version.kind === 'saved') return snapshots.read(p.root, rel, version.id);
    const repo = await git.repoRoot(p.root);
    return repo && version.path ? git.fileAt(repo, version.id, version.path) : null;
  });
  // Keep the page as it is now before replacing it with an older version.
  ipcMain.handle('snapshot-page', async (_e, rel: string) => {
    const p = requireProject();
    await snapshots.keep(p.root, rel, await readDocument(p, rel), { force: true });
  });
  ipcMain.handle('git-info', () => gitInfo());
  ipcMain.handle('choose-folder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('default-clone-folder', () => app.getPath('documents'));
  ipcMain.handle('git-clone', (_e, url: string, parent: string) =>
    plain(() => git.clone(url, parent, (line) => win?.webContents.send('git-progress', line))),
  );
  ipcMain.handle('git-commit', (_e, paths: string[], message: string, push: boolean) =>
    plain(() =>
      gitAction(async (root) => {
        await git.commit(root, paths, message);
        if (push) await git.push(root);
      }),
    ),
  );
  ipcMain.handle('git-branches', () => plain(async () => git.branches(await requireRepo())));
  // Switching branch changes the files under the app: the page list and the projects'
  // settings are read again before answering, so the window has them when it reopens
  // a page.
  const afterCheckout = async () => {
    const p = requireProject();
    await pagesChanged(p, [...(await listDocuments(p.root)), ...(await existing(p.root, builtPages))]);
    await refreshProject(p);
  };
  ipcMain.handle('git-switch', (_e, branch: string, leave: boolean) =>
    plain(() =>
      gitAction(async (root) => {
        finishing = await git.switchTo(root, branch, leave);
        await afterCheckout();
        return finishing;
      }),
    ),
  );
  ipcMain.handle('git-create-branch', (_e, name: string, base: string | null) =>
    plain(() =>
      gitAction(async (root) => {
        await git.createBranch(root, name, base);
        await afterCheckout();
      }),
    ),
  );
  // Check the server now (the Changes panel was opened).
  ipcMain.handle('git-check', () => checkServer());
  ipcMain.handle('git-push', () => plain(() => gitAction((root) => git.push(root))));
  // Get the latest: rebase onto the server, setting uncommitted edits aside meanwhile.
  ipcMain.handle('git-get-latest', () => plain(() => gitAction(async (root) => (finishing = await git.getLatest(root)))));
  ipcMain.handle('git-conflicts', () =>
    plain(async (): Promise<ConflictFile[]> => {
      const root = await requireRepo();
      const status = await git.status(root);
      const files: ConflictFile[] = [];
      for (const c of status.changes.filter((x) => x.kind === 'conflict')) {
        const text = await fs.readFile(join(root, c.path), 'utf8').catch(() => null);
        // Only text git marked up can be settled spot by spot.
        files.push({ path: c.path, text: text !== null && !text.includes('\0') && text.includes('<<<<<<<') ? text : null });
      }
      return files;
    }),
  );
  ipcMain.handle('git-resolve', (_e, path: string, text: string | null) => plain(() => gitAction((root) => git.resolve(root, path, text))));
  ipcMain.handle('git-take-side', (_e, path: string, side: 'server' | 'yours') => plain(() => gitAction(async (root) => git.takeSide(root, path, side, (await git.operation(root)) ?? finishing))));
  ipcMain.handle('git-continue', () => plain(() => gitAction(async (root) => (finishing = await git.continue(root, finishing)))));
  ipcMain.handle('git-abort', () =>
    plain(() =>
      gitAction(async (root) => {
        await git.abort(root);
        finishing = null;
      }),
    ),
  );
  // Throw away a file's uncommitted changes; a page's text is kept in its history first.
  ipcMain.handle('git-discard', (_e, path: string) =>
    plain(() =>
      gitAction(async (root) => {
        const p = requireProject();
        const rel = relative(p.root, join(root, path)).split(sep).join('/');
        if (!rel.startsWith('..') && rel.endsWith('.md')) {
          const now = await readDocument(p, rel).catch(() => null);
          if (now !== null) await snapshots.keep(p.root, rel, now, { force: true });
        }
        await git.discard(root, path);
      }),
    ),
  );
  // A file as last committed (relative to the repository root), to show what changed.
  ipcMain.handle('git-committed', async (_e, path: string) => {
    const root = await requireRepo();
    return git.fileAt(root, 'HEAD', path);
  });
  ipcMain.handle('git-set-identity', (_e, name: string, email: string, global: boolean) =>
    plain(async () => git.setIdentity(await requireRepo(), name, email, global).finally(refreshGit)),
  );
  ipcMain.on('askpass-answer', (_e, id: number, answer: string | null) => {
    pendingQuestions.get(id)?.(typeof answer === 'string' ? answer : null);
    pendingQuestions.delete(id);
  });
  ipcMain.handle('sphinx-state', () => Object.fromEntries([...sphinx].map(([id, m]) => [id, m.getState()])));
  ipcMain.handle('sphinx-use', async (_e, choice: EnvironmentChoice) => {
    const root = requireProject().root;
    await updateSettings((s) => ({
      ...s,
      trusted: [...new Set([...(s.trusted ?? []), root])],
      environments: { ...s.environments, [root]: choice },
    }));
    sphinx.forEach((m) => m.use(choice));
  });
  // All managers of a folder search the same places, so any one can answer.
  ipcMain.handle('sphinx-candidates', () => [...sphinx.values()][0]?.candidates() ?? []);
  ipcMain.handle('sphinx-browse-python', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose the Python to build the documentation with',
      defaultPath: requireProject().root,
      properties: ['openFile', 'showHiddenFiles'],
    });
    return result.canceled ? null : probePython(result.filePaths[0], 'Chosen');
  });
  ipcMain.handle('sphinx-decline', () => sphinx.forEach((m) => m.decline()));
  ipcMain.handle('sphinx-env', (_e, id: string) => ({ project: requireProject().projects.find((x) => x.id === id)?.config.editor.sphinxEnv ?? {}, yours: userEnv }));
  ipcMain.handle('sphinx-set-env', async (_e, vars: Record<string, string>) => {
    const root = requireProject().root;
    const clean = Object.fromEntries(Object.entries(vars).filter(([name, value]) => ENV_NAME.test(name) && typeof value === 'string'));
    await updateSettings((s) => ({ ...s, sphinxEnv: { ...s.sphinxEnv, [root]: clean } }));
    userEnv = clean;
    sphinx.forEach((m) => m.requestBuild({ fresh: true }));
  });
  ipcMain.handle('sphinx-rebuild', (_e, id: string) => sphinx.get(id)?.requestBuild({ fresh: true }));
  ipcMain.handle('sphinx-log', (_e, id: string) => sphinx.get(id)?.getLog() ?? '');
  ipcMain.on('set-unsaved', (_e, value: boolean) => {
    unsaved = value;
  });
  ipcMain.on('close-window', () => {
    closing = true;
    win?.close();
  });
}

function serveFrom(base: (url: URL) => string | null) {
  return async (request: Request) => {
    const dir = base(new URL(request.url));
    if (!dir) return new Response('Not available', { status: 404 });
    try {
      let rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      return await net.fetch(pathToFileURL(resolveInside(dir, rel)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}

function registerProtocols() {
  // myst-asset://project/<path relative to the project root>: images in pages
  protocol.handle(ASSET_SCHEME, serveFrom(() => project?.root ?? null));
  // myst-build://<project id>/<path in its HTML output>: the Sphinx preview, one
  // origin per project; _mysteditor/fragment.html previews a single block. Pages get
  // a script that follows the editor's scrolling.
  const files = serveFrom((url) => sphinx.get(url.hostname)?.outputDir ?? null);
  protocol.handle(BUILD_SCHEME, async (request) => {
    const url = new URL(request.url);
    const outputDir = sphinx.get(url.hostname)?.outputDir;
    if (outputDir && url.pathname === '/_mysteditor/fragment.html') {
      const q = url.searchParams;
      return fragmentPage(outputDir, q.get('doc') ?? '', Number(q.get('from')), Number(q.get('to')));
    }
    if (outputDir) {
      let rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const page = await builtPage(outputDir, rel);
      if (page) return page;
    }
    return files(request);
  });
}

function send(cmd: MenuCommand) {
  win?.webContents.send('menu', cmd);
}

// ---- the title bar ----------------------------------------------------------------
// With the app's own title bar the menus are drawn by the page (TitleBar.tsx) from
// the application menu, which stays set so its shortcuts keep working; the system
// draws only the window buttons, in the colours of the bar.
let customTitleBar = false; // decided at start
let systemTitleBarChosen = false; // Settings.titleBar, which may differ until a restart
const TITLE_BAR_HEIGHT = 34;
const titleBarColors = () => (nativeTheme.shouldUseDarkColors ? { color: '#1b1d22', symbolColor: '#e6e8eb' } : { color: '#f3f4f6', symbolColor: '#1d2129' });

// Shortcuts as the menu shows them: role items carry none of their own.
const ROLE_KEYS: Record<string, string> = {
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', pasteandmatchstyle: 'Ctrl+Shift+V', selectall: 'Ctrl+A', quit: 'Ctrl+Q',
  zoomin: 'Ctrl++', zoomout: 'Ctrl+-', resetzoom: 'Ctrl+0', togglefullscreen: 'F11', reload: 'Ctrl+R', toggledevtools: 'Ctrl+Shift+I',
};
const keyText = (accelerator: string) => accelerator.replace(/Cmd(Or|or)Ctrl|Command(Or|or)Control/g, 'Ctrl').replace(/Plus/g, '+');

function menuModel(items: Electron.MenuItem[] = Menu.getApplicationMenu()?.items ?? []): AppMenuItem[] {
  return items
    .filter((i) => i.visible)
    .map((i): AppMenuItem => {
      if (i.type === 'separator') return { type: 'separator', label: '', enabled: false };
      // Emacs keys are written into labels after four spaces ("Cut    C-w").
      const [label, emacs] = i.label.split(/ {4,}/);
      const shortcut = emacs ?? (i.accelerator ? keyText(String(i.accelerator)) : i.role ? ROLE_KEYS[i.role.toLowerCase()] : undefined);
      return {
        type: i.submenu ? 'submenu' : i.type === 'checkbox' || i.type === 'radio' ? i.type : 'normal',
        label,
        enabled: i.enabled,
        ...(shortcut ? { shortcut } : {}),
        ...(i.type === 'checkbox' || i.type === 'radio' ? { checked: i.checked } : {}),
        ...(i.submenu ? { submenu: menuModel(i.submenu.items) } : {}),
      };
    });
}

function sendMenu() {
  if (customTitleBar) win?.webContents.send('app-menu', menuModel());
}

function setWindowTitle(title: string) {
  win?.setTitle(title);
  win?.webContents.send('window-title', title);
}

async function useSystemTitleBar(system: boolean) {
  await updateSettings((s) => ({ ...s, titleBar: system ? 'system' : 'custom' }));
  buildMenu();
  const { response } = await dialog.showMessageBox(win!, {
    type: 'info',
    message: system ? 'The system’s title bar is used from the next start.' : 'The app’s own title bar is used from the next start.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    app.relaunch();
    win?.close(); // asks about unsaved changes first
  }
}

function buildMenu(theme: Theme = nativeTheme.themeSource) {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: withKeys('Open Folder…', 'C-x C-f'), ...keys('CmdOrCtrl+O', 'C-x C-f'), click: () => send('open-folder') },
        {
          label: 'Open Recent',
          submenu: recentFolders.length
            ? recentFolders.map((folder) => ({ label: folder, click: () => win?.webContents.send('open-folder-path', folder) }))
            : [{ label: 'No folders yet', enabled: false }],
        },
        { label: 'Clone Repository…', click: () => send('clone') },
        { type: 'separator' },
        { id: 'go-to-page', label: withKeys('Go to Page…', 'C-x b'), ...keys('CmdOrCtrl+P', 'C-x b'), click: () => send('go-to-page') },
        { type: 'separator' },
        { label: 'New Page…', ...keys('CmdOrCtrl+N', null), click: () => send('new-page') },
        { label: 'Delete Page…', click: () => send('delete-page') },
        { id: 'page-history', label: 'Page History…', click: () => send('page-history') },
        { id: 'rename-page', label: 'Rename Page…', click: () => send('rename-page') },
        { type: 'separator' },
        { id: 'switch-branch', label: 'Switch Branch…', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('switch-branch') },
        { label: withKeys('Save', 'C-x C-s'), ...keys('CmdOrCtrl+S', 'C-x C-s'), click: () => send('save') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // Undo/redo belong to the editor, so they are handled by its keymap, not here.
      label: 'Edit',
      submenu: [
        // With Emacs keys, C-x and C-c start chords, C-v moves down and C-a goes to the
        // start of the line: these items keep their roles but not those keys.
        { role: 'cut', ...(emacsKeys ? { label: 'Cut    C-w', registerAccelerator: false } : {}) },
        { role: 'copy', ...(emacsKeys ? { label: 'Copy    M-w', registerAccelerator: false } : {}) },
        { role: 'paste', ...(emacsKeys ? { label: 'Paste    C-y', registerAccelerator: false } : {}) },
        { role: 'pasteAndMatchStyle', ...(emacsKeys ? { registerAccelerator: false } : {}) },
        { role: 'selectAll', ...(emacsKeys ? { label: 'Select All    C-x h', registerAccelerator: false } : {}) },
        { type: 'separator' },
        // The page handles Ctrl+F itself: the Markdown view has its own search.
        { id: 'find', label: withKeys('Find…', 'C-s'), accelerator: emacsKeys ? undefined : 'CmdOrCtrl+F', registerAccelerator: false, click: () => send('find') },
        { id: 'search-pages', label: 'Search All Pages…', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('search-pages') },
        { type: 'separator' },
        // The window keeps the choice and tells the menu (see set-emacs-keys).
        { id: 'emacs-keys', label: 'Emacs Keys', type: 'checkbox', checked: emacsKeys, click: () => send('toggle-emacs') },
      ],
    },
    {
      label: 'View',
      submenu: [
        // The page handles Ctrl+/ itself (so it also works over the source editor);
        // the menu only shows the shortcut.
        { label: withKeys('Markdown View', 'C-c m'), accelerator: emacsKeys ? undefined : 'CmdOrCtrl+/', registerAccelerator: false, click: () => send('toggle-source') },
        { id: 'outline', label: 'Outline', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('toggle-outline') },
        {
          label: 'Appearance',
          submenu: (
            [
              ['system', 'Same as the System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as const
          ).map(([value, label]) => ({ id: `theme-${value}`, label, type: 'radio' as const, checked: theme === value, click: () => void setTheme(value) })),
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ id: 'system-title-bar', label: 'Use System Title Bar', type: 'checkbox' as const, checked: systemTitleBarChosen, click: (item: Electron.MenuItem) => void useSystemTitleBar(item.checked) }]),
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Help',
      submenu: [{ id: 'about', label: 'About MyST Editor', click: () => send('about') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  sendMenu();
}

// The right-click menu for a place in the page: editing commands where text can be
// typed, Copy where text is selected. Null where there's nothing to offer.
export function contextMenu(params: Electron.ContextMenuParams, page: Electron.WebContents): Menu | null {
  const { isEditable, editFlags, selectionText } = params;
  // Each acts on the app's page itself (a role would act on whichever window has focus).
  const item = (id: string, label: string, accelerator: string, enabled: boolean, act: () => void): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    registerAccelerator: false,
    enabled,
    click: act,
  });
  const items: MenuItemConstructorOptions[] = [];
  if (isEditable) {
    items.push(
      item('cut', 'Cut', 'CmdOrCtrl+X', editFlags.canCut && !!selectionText, () => page.cut()),
      item('copy', 'Copy', 'CmdOrCtrl+C', editFlags.canCopy && !!selectionText, () => page.copy()),
      item('paste', 'Paste', 'CmdOrCtrl+V', editFlags.canPaste, () => page.paste()),
      { type: 'separator' },
      item('selectall', 'Select All', 'CmdOrCtrl+A', editFlags.canSelectAll, () => page.selectAll()),
    );
  } else if (selectionText.trim()) items.push(item('copy', 'Copy', 'CmdOrCtrl+C', true, () => page.copy()));
  if (!items.length) return null;
  const menu = Menu.buildFromTemplate(items);
  // For the tests, which can't open a native menu.
  (globalThis as { lastContextMenu?: Menu }).lastContextMenu = menu;
  return menu;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: 'MyST Editor',
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(customTitleBar ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...titleBarColors(), height: TITLE_BAR_HEIGHT } } : {}),
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('focus', checkOnFocus);

  // Right-click: cut, copy and paste, as far as they apply where it was clicked.
  win.webContents.on('context-menu', (_e, params) => {
    const menu = win && contextMenu(params, win.webContents);
    if (menu) menu.popup({ window: win! });
  });

  // Links open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });

  win.on('close', (e) => {
    if (unsaved && !closing) {
      e.preventDefault();
      win?.webContents.send('close-requested');
    }
  });
  win.on('closed', () => {
    win = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  snapshots = new Snapshots(join(app.getPath('userData'), 'history'));
  askpass = new AskPass(app.getPath('userData'), askWriter);
  await askpass.start().catch((e) => {
    console.warn('Git prompts unavailable:', e);
    askpass = null;
  });
  registerIpc();
  registerProtocols();
  recentFolders = (await loadSettings()).recent ?? [];
  systemTitleBarChosen = (await loadSettings()).titleBar === 'system';
  customTitleBar = process.platform !== 'darwin' && !systemTitleBarChosen && !process.env.MYSTEDITOR_SYSTEM_TITLE_BAR;
  await setTheme((await loadSettings()).theme ?? 'system', false);
  // The window is told whether it's dark: on Linux, pages don't see the system's (or
  // the chosen) scheme through prefers-color-scheme.
  nativeTheme.on('updated', () => {
    win?.setBackgroundColor(windowBackground());
    if (customTitleBar) win?.setTitleBarOverlay({ ...titleBarColors(), height: TITLE_BAR_HEIGHT });
    win?.webContents.send('dark-changed', nativeTheme.shouldUseDarkColors);
  });
  ipcMain.handle('is-dark', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('app-menu', () => (customTitleBar ? { menu: menuModel(), title: win?.getTitle() ?? 'MyST Editor' } : null));
  // A click in the title bar's menus: the item at that path in the application menu.
  ipcMain.on('app-menu-click', (_e, path: number[]) => {
    let items = Menu.getApplicationMenu()?.items.filter((i) => i.visible) ?? [];
    let item: Electron.MenuItem | undefined;
    for (const i of path) {
      item = items[i];
      items = item?.submenu?.items.filter((x) => x.visible) ?? [];
    }
    if (item && item.enabled && !item.submenu && win) (item.click as (e: unknown, w: BrowserWindow, c: Electron.WebContents) => void)(undefined, win, win.webContents);
  });
  createWindow();
});

app.on('window-all-closed', () => {
  askpass?.stop();
  watcher?.close();
  sphinx.forEach((m) => m.dispose());
  app.quit();
});

