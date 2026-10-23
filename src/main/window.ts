// The window: creating it, its title bar, its right-click menu, closing it with unsaved
// changes, and what the window asks about the app itself.
import { BrowserWindow, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { release } from 'node:os';
import { join } from 'node:path';
// The version being built (app.getVersion() is Electron's own when run from out/).
import { version as appVersion } from '../../package.json';
// The window's icon, for Linux taskbars and docks (Windows and macOS take the
// executable's).
import icon from '../../build/icon.png?asset';
import { checkOnFocus } from './git/service.js';
import { current, toWindow } from './state.js';
import type { Settings } from './settings.js';

// The window's colour before the page has drawn, matching the theme (no white flash).
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#17191d' : '#ffffff');

// ---- the title bar ----------------------------------------------------------------
// With the app's own title bar the menus are drawn by the page (TitleBar.tsx) from
// the application menu, which stays set so its shortcuts keep working; the system
// draws only the window buttons, in the colours of the bar.
export const titleBar = {
  custom: false, // decided at start
  systemChosen: false, // Settings.titleBar, which may differ until a restart
};
const TITLE_BAR_HEIGHT = 34;
const titleBarColors = () => (nativeTheme.shouldUseDarkColors ? { color: '#1b1d22', symbolColor: '#e6e8eb' } : { color: '#f3f4f6', symbolColor: '#1d2129' });

export function decideTitleBar(settings: Settings) {
  titleBar.systemChosen = settings.titleBar === 'system';
  titleBar.custom = process.platform !== 'darwin' && !titleBar.systemChosen && !process.env.MYSTEDITOR_SYSTEM_TITLE_BAR;
}

export function setWindowTitle(title: string) {
  current.win?.setTitle(title);
  toWindow('window-title', title);
}

// The window is told whether it's dark: on Linux, pages don't see the system's (or the
// chosen) scheme through prefers-color-scheme.
export function followTheme() {
  nativeTheme.on('updated', () => {
    current.win?.setBackgroundColor(windowBackground());
    if (titleBar.custom) current.win?.setTitleBarOverlay({ ...titleBarColors(), height: TITLE_BAR_HEIGHT });
    toWindow('dark-changed', nativeTheme.shouldUseDarkColors);
  });
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

// Unsaved changes, as the window says: closing then asks first (the window does).
let unsaved = false;
let closing = false;

export function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: 'MyST Editor',
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(titleBar.custom ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...titleBarColors(), height: TITLE_BAR_HEIGHT } } : {}),
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  current.win = win;
  win.once('ready-to-show', () => win.show());
  win.on('focus', checkOnFocus);

  // Right-click: cut, copy and paste, as far as they apply where it was clicked.
  win.webContents.on('context-menu', (_e, params) => {
    const menu = contextMenu(params, win.webContents);
    if (menu) menu.popup({ window: win });
  });

  // Links open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  win.on('close', (e) => {
    if (unsaved && !closing) {
      e.preventDefault();
      win.webContents.send('close-requested');
    }
  });
  win.on('closed', () => {
    if (current.win === win) current.win = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

export function registerWindowIpc() {
  ipcMain.on('set-unsaved', (_e, value: boolean) => {
    unsaved = value;
  });
  ipcMain.on('close-window', () => {
    closing = true;
    current.win?.close();
  });
  ipcMain.handle('is-dark', () => nativeTheme.shouldUseDarkColors);
  ipcMain.handle('about', () => ({
    version: appVersion,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    system: `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${release()} (${process.arch})`,
  }));
}
