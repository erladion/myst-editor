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

// Lets tests (and portable setups) keep settings out of the real profile.
if (process.env.MYSTEDITOR_USER_DATA) app.setPath('userData', process.env.MYSTEDITOR_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: BUILD_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let project: ProjectInfo | null = null;
let watcher: FSWatcher | null = null;
let sphinx: SphinxManager | null = null;
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

async function startSphinx(p: ProjectInfo) {
  sphinx?.dispose();
  const settings = await loadSettings();
  sphinx = new SphinxManager(p, {
    // Tests share one data dir so Python and packages are only downloaded once.
    dataDir: process.env.MYSTEDITOR_SPHINX_DATA ?? join(app.getPath('userData'), 'sphinx'),
    // out/main/index.js → the repository, where resources/ lives in development.
    appRoot: join(import.meta.dirname, '..', '..'),
    resourcesPath: app.isPackaged ? process.resourcesPath : null,
    trusted: !!settings.trusted?.includes(p.root),
    environment: settings.environments?.[p.root] ?? null,
    emit: (state: SphinxState) => win?.webContents.send('sphinx-state', state),
  });
  sphinx.start();
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
    p.files = await listDocuments(p.sourceDir);
    p.titles = await readTitles(p.sourceDir, p.files);
    win?.webContents.send('files-changed', { files: p.files, titles: p.titles, changed });
    // Our own saves request builds directly; here it's changes made outside the app.
    // Configuration, extensions and templates can affect every page.
    const config = others.some((rel) => /\.(py|html|jinja2?|toml|ya?ml|txt|json)$/.test(rel));
    if (changed.length || others.length) sphinx?.requestBuild({ fresh: config });
  };
  try {
    watcher = watch(p.sourceDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split(sep).join('/');
      if (rel.split('/').some((part) => part.startsWith('.') || part === '_build')) return;
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
    sphinx?.requestBuild();
  });
  ipcMain.handle('sphinx-state', () => sphinx?.getState() ?? { status: { kind: 'off' }, info: null });
  ipcMain.handle('sphinx-use', async (_e, choice: EnvironmentChoice) => {
    const root = requireProject().root;
    await updateSettings((s) => ({
      ...s,
      trusted: [...new Set([...(s.trusted ?? []), root])],
      environments: { ...s.environments, [root]: choice },
    }));
    sphinx?.use(choice);
  });
  ipcMain.handle('sphinx-candidates', () => sphinx?.candidates() ?? []);
  ipcMain.handle('sphinx-browse-python', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose the Python to build the documentation with',
      defaultPath: requireProject().root,
      properties: ['openFile', 'showHiddenFiles'],
    });
    return result.canceled ? null : probePython(result.filePaths[0], 'Chosen');
  });
  ipcMain.handle('sphinx-decline', () => sphinx?.decline());
  ipcMain.handle('sphinx-rebuild', () => sphinx?.requestBuild({ fresh: true }));
  ipcMain.handle('sphinx-log', () => sphinx?.getLog() ?? '');
  ipcMain.on('set-unsaved', (_e, value: boolean) => {
    unsaved = value;
  });
  ipcMain.on('close-window', () => {
    closing = true;
    win?.close();
  });
}

function serveFrom(base: () => string | null) {
  return async (request: Request) => {
    const dir = base();
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
  // myst-build://project/<path in the HTML output>: the Sphinx preview
  protocol.handle(BUILD_SCHEME, serveFrom(() => sphinx?.outputDir ?? null));
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
        { label: 'Show Markdown Source', accelerator: 'CmdOrCtrl+/', click: () => send('toggle-source') },
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
  sphinx?.dispose();
  app.quit();
});

