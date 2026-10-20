// Electron main process: window, menu, project file access and change watching.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildInputsOf, isBuildInput, listDocuments, openProject, readDocument, readTitle, resolveInside, UNWATCHED_DIRS, unwatchedDir, writeDocument } from './project.js';
import { FolderWatcher } from './watch.js';
import { SphinxManager } from './sphinx/manager.js';
import { ASSET_SCHEME, BUILD_SCHEME, type MenuCommand, type ProjectInfo } from '../shared/api.js';
import type { EnvironmentChoice, SphinxState } from '../shared/sphinx.js';
import { probePython } from './sphinx/pythons.js';
import { fragmentPage } from './sphinx/fragments.js';
import { Git, GitError } from './git/git.js';
import { AskPass } from './git/askpass.js';
import type { GitInfo } from '../shared/git.js';
import { projectFor } from '../shared/projects.js';
import { SETTINGS_FILE } from '../core/editor-config.js';

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
  if (!project || !repoRoot) return { available, repoRoot: null, prefix: '', status: null, identity: null };
  const [status, identity] = await Promise.all([git.status(repoRoot).catch(() => null), git.identity(repoRoot)]);
  const prefix = relative(repoRoot, project.root).split(sep).join('/');
  return { available, repoRoot, prefix, status, identity };
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
  // Projects the writer allowed to run Sphinx (which executes their conf.py).
  trusted?: string[];
  // Per project root: where its builds get Python from.
  environments?: Record<string, EnvironmentChoice>;
}

async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function updateSettings(patch: (s: Settings) => Settings) {
  const next = patch(await loadSettings());
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
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
  startWatching(project);
  win?.setTitle(`${project.name} — MyST Editor`);
  await updateSettings((s) => ({ ...s, lastProject: project!.root }));
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
      environment: settings.environments?.[p.root] ?? null,
      emit: (state: SphinxState) => win?.webContents.send('sphinx-state', { project: sp.id, state }),
    });
    sphinx.set(sp.id, manager);
    manager.start();
  }
}

// Re-read the folder's projects and settings, and tell the renderer if they changed.
// The same projects keep their build managers; new or removed ones restart them all.
async function refreshProject(p: ProjectInfo) {
  const next = await openProject(p.root);
  if (project !== p) return;
  const same = (a: ProjectInfo, b: ProjectInfo) => JSON.stringify([a.projects, a.defaultConfig]) === JSON.stringify([b.projects, b.defaultConfig]);
  if (same(next, p)) return;
  const restart = JSON.stringify(next.projects.map((x) => x.id)) !== JSON.stringify(p.projects.map((x) => x.id));
  Object.assign(p, { projects: next.projects, defaultConfig: next.defaultConfig, buildInputs: next.buildInputs });
  win?.webContents.send('project-changed', { project: p });
  if (restart) await startSphinx(p);
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
    let files = relist ? await listDocuments(p.root) : [...p.files];
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
  ipcMain.handle('read-file', (_e, rel: string) => readDocument(requireProject(), rel));
  ipcMain.handle('write-file', async (_e, rel: string, text: string) => {
    fingerprints.set(rel, fingerprintText(text));
    await writeDocument(requireProject(), rel, text);
    buildFor(requireProject(), rel, false);
    refreshGit();
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
    plain(async () => {
      const root = await requireRepo();
      try {
        await git.commit(root, paths, message);
        if (push) await git.push(root);
      } finally {
        refreshGit();
      }
    }),
  );
  ipcMain.handle('git-push', () => plain(async () => git.push(await requireRepo()).finally(refreshGit)));
  ipcMain.handle('git-pull', () => plain(async () => git.pull(await requireRepo()).finally(refreshGit)));
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
  // origin per project; _mysteditor/fragment.html previews a single block.
  const files = serveFrom((url) => sphinx.get(url.hostname)?.outputDir ?? null);
  protocol.handle(BUILD_SCHEME, async (request) => {
    const url = new URL(request.url);
    const outputDir = sphinx.get(url.hostname)?.outputDir;
    if (outputDir && url.pathname === '/_mysteditor/fragment.html') {
      const q = url.searchParams;
      return fragmentPage(outputDir, q.get('doc') ?? '', Number(q.get('from')), Number(q.get('to')));
    }
    return files(request);
  });
}

function send(cmd: MenuCommand) {
  win?.webContents.send('menu', cmd);
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { label: 'Clone Repository…', click: () => send('clone') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // Undo/redo belong to the editor, so they are handled by its keymap, not here.
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        // The page handles Ctrl+/ itself (so it also works over the source editor);
        // the menu only shows the shortcut.
        { label: 'Markdown View', accelerator: 'CmdOrCtrl+/', registerAccelerator: false, click: () => send('toggle-source') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: 'MyST Editor',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());

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
  askpass = new AskPass(app.getPath('userData'), askWriter);
  await askpass.start().catch((e) => {
    console.warn('Git prompts unavailable:', e);
    askpass = null;
  });
  registerIpc();
  registerProtocols();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  askpass?.stop();
  watcher?.close();
  sphinx.forEach((m) => m.dispose());
  app.quit();
});

