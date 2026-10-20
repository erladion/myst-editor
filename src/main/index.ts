// Electron main process: window, menu, project file access and change watching.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import { watch, promises as fs, statSync, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openProject, listDocuments, readDocument, readTitles, resolveInside, writeDocument } from './project.js';
import { SphinxManager } from './sphinx/manager.js';
import { ASSET_SCHEME, BUILD_SCHEME, type MenuCommand, type ProjectInfo } from '../shared/api.js';
import type { EnvironmentChoice, SphinxState } from '../shared/sphinx.js';
import { probePython } from './sphinx/pythons.js';
import { fragmentPage } from './sphinx/fragments.js';
import { projectFor } from '../shared/projects.js';
import { SETTINGS_FILE } from '../core/editor-config.js';

// Not watched: changes in build output, dependencies and virtualenvs aren't edits.
const IGNORED_DIRS = new Set(['_build', 'build', 'node_modules', 'venv', 'env', '__pycache__', 'site-packages', 'dist']);

// Lets tests (and portable setups) keep settings out of the real profile.
if (process.env.MYSTEDITOR_USER_DATA) app.setPath('userData', process.env.MYSTEDITOR_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BUILD_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let project: ProjectInfo | null = null;
let watcher: FSWatcher | null = null;
// One build manager per Sphinx project, by project id.
const sphinx = new Map<string, SphinxManager>();
let unsaved = false;
let closing = false;
// What we last wrote to each file, so our own saves aren't reported as external changes.
const written = new Map<string, string>();

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

async function useProject(folder: string): Promise<ProjectInfo> {
  project = await openProject(folder);
  written.clear();
  startWatching(project);
  win?.setTitle(`${project.name} — MyST Editor`);
  await updateSettings((s) => ({ ...s, lastProject: project!.root }));
  await startSphinx(project);
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
  Object.assign(p, { projects: next.projects, defaultConfig: next.defaultConfig });
  win?.webContents.send('project-changed', { project: p });
  if (restart) await startSphinx(p);
}

// Build the project a changed file belongs to; files outside every project (say a
// shared extension module or requirements file) may affect them all.
function buildFor(p: ProjectInfo, rel: string, fresh: boolean) {
  const owner = projectFor(p.projects, rel);
  if (owner) sphinx.get(owner.id)?.requestBuild({ fresh });
  else if (fresh) sphinx.forEach((m) => m.requestBuild({ fresh }));
}

function startWatching(p: ProjectInfo) {
  watcher?.close();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const flush = async () => {
    if (project !== p) return;
    const changed: string[] = [];
    for (const rel of pending) {
      try {
        const text = await readDocument(p, rel);
        if (written.get(rel) !== text) changed.push(rel);
      } catch {
        // deleted or unreadable: the file list update covers it
      }
    }
    const others = [...pending].filter((rel) => !rel.endsWith('.md'));
    pending.clear();
    p.files = await listDocuments(p.root);
    p.titles = await readTitles(p.root, p.files);
    win?.webContents.send('files-changed', { files: p.files, titles: p.titles, changed });
    // Our own saves request builds directly; here it's changes made outside the app.
    // Configuration, extensions and templates can affect every page of a project.
    for (const rel of changed) buildFor(p, rel, false);
    for (const rel of others) buildFor(p, rel, /\.(py|html|jinja2?|toml|ya?ml|txt|json)$/.test(rel));
    // conf.py, editor settings and capabilities files change how pages are read.
    if (others.some((rel) => /(^|\/)(conf\.py|\.mysteditor\.toml)$|\.json$/.test(rel))) await refreshProject(p);
  };
  try {
    watcher = watch(p.root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split(sep).join('/');
      const parts = rel.split('/');
      // Hidden files are ignored, except the editor's own settings.
      const hidden = parts.some((part, i) => (part.startsWith('.') && !(i === parts.length - 1 && part === SETTINGS_FILE)) || IGNORED_DIRS.has(part));
      if (hidden) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    });
  } catch (e) {
    console.warn('File watching unavailable:', e);
  }
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
    written.set(rel, text);
    await writeDocument(requireProject(), rel, text);
    buildFor(requireProject(), rel, false);
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

app.whenReady().then(() => {
  registerIpc();
  registerProtocols();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  watcher?.close();
  sphinx.forEach((m) => m.dispose());
  app.quit();
});

