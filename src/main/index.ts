// Electron main process: window, menu, project file access and change watching.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import { watch, promises as fs, statSync, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openProject, listDocuments, readDocument, readTitles, resolveInside, writeDocument } from './project.js';
import { ASSET_SCHEME, type MenuCommand, type ProjectInfo } from '../shared/api.js';

// Lets tests (and portable setups) keep settings out of the real profile.
if (process.env.MYSTEDITOR_USER_DATA) app.setPath('userData', process.env.MYSTEDITOR_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let project: ProjectInfo | null = null;
let watcher: FSWatcher | null = null;
let unsaved = false;
let closing = false;
// What we last wrote to each file, so our own saves aren't reported as external changes.
const written = new Map<string, string>();

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

async function loadSettings(): Promise<{ lastProject?: string }> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function saveSettings(settings: { lastProject?: string }) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

async function useProject(folder: string): Promise<ProjectInfo> {
  project = await openProject(folder);
  written.clear();
  startWatching(project);
  win?.setTitle(`${project.name} — MyST Editor`);
  await saveSettings({ lastProject: project.root });
  return project;
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
    pending.clear();
    p.files = await listDocuments(p.sourceDir);
    p.titles = await readTitles(p.sourceDir, p.files);
    win?.webContents.send('files-changed', { files: p.files, titles: p.titles, changed });
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
  });
  ipcMain.on('set-unsaved', (_e, value: boolean) => {
    unsaved = value;
  });
  ipcMain.on('close-window', () => {
    closing = true;
    win?.close();
  });
}

function registerAssetProtocol() {
  // myst-asset://project/<path relative to the project root>
  protocol.handle(ASSET_SCHEME, async (request) => {
    if (!project) return new Response('No project', { status: 404 });
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      return net.fetch(pathToFileURL(resolveInside(project.root, rel)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
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
  registerAssetProtocol();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  watcher?.close();
  app.quit();
});

