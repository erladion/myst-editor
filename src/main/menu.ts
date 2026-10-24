// The application menu: File, Edit, View and Help, with their shortcuts (or the Emacs
// ones), and the same menus for the title bar the page draws (see window.ts).
import { app, dialog, ipcMain, Menu, nativeTheme, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { AppMenuItem, MenuCommand } from '../shared/api.js';
import { current, toWindow } from './state.js';
import { updateSettings, type Theme } from './settings.js';
import { titleBar } from './window.js';

// Settings.recent, for the File → Open Recent menu.
let recentFolders: string[] = [];
// Emacs keys (set from the window): the menu then leaves the keys Emacs uses alone.
let emacsKeys = false;

export function setRecentFolders(folders: string[]) {
  recentFolders = folders;
  buildMenu();
}

// A menu item's shortcut, unless Emacs keys are on: then the window handles the keys,
// and the label shows the Emacs ones (see withKeys; Electron can't show a chord).
function keys(accelerator: string, _emacs: string | null): Partial<MenuItemConstructorOptions> {
  return emacsKeys ? { registerAccelerator: false } : { accelerator };
}
const withKeys = (label: string, emacs: string | null) => (emacsKeys && emacs ? `${label}    ${emacs}` : label);

function send(cmd: MenuCommand) {
  toWindow('menu', cmd);
}

// Electron applies the choice everywhere: the app's own styles, and built pages whose
// Sphinx theme follows the system's (Furo, PyData, Book theme).
export async function setTheme(theme: Theme, save = true) {
  nativeTheme.themeSource = theme;
  if (save) await updateSettings((s) => ({ ...s, theme }));
  buildMenu(theme);
}

async function useSystemTitleBar(system: boolean) {
  await updateSettings((s) => ({ ...s, titleBar: system ? 'system' : 'custom' }));
  buildMenu();
  const { response } = await dialog.showMessageBox(current.win!, {
    type: 'info',
    message: system ? 'The system’s title bar is used from the next start.' : 'The app’s own title bar is used from the next start.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    app.relaunch();
    current.win?.close(); // asks about unsaved changes first
  }
}

// Shortcuts as the menu shows them: role items carry none of their own.
const ROLE_KEYS: Record<string, string> = {
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', pasteandmatchstyle: 'Ctrl+Shift+V', selectall: 'Ctrl+A', quit: 'Ctrl+Q',
  zoomin: 'Ctrl++', zoomout: 'Ctrl+-', resetzoom: 'Ctrl+0', togglefullscreen: 'F11', reload: 'Ctrl+R', toggledevtools: 'Ctrl+Shift+I',
};
const keyText = (accelerator: string) => accelerator.replace(/Cmd(Or|or)Ctrl|Command(Or|or)Control/g, 'Ctrl').replace(/Plus/g, '+');

// The menu as the title bar shows it.
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

export function buildMenu(theme: Theme = nativeTheme.themeSource) {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: withKeys('Open Folder…', 'C-x C-f'), ...keys('CmdOrCtrl+O', 'C-x C-f'), click: () => send('open-folder') },
        {
          label: 'Open Recent',
          submenu: recentFolders.length
            ? recentFolders.map((folder) => ({ label: folder, click: () => toWindow('open-folder-path', folder) }))
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
        { id: 'export-pdf', label: 'Export PDF…', click: () => send('export-pdf') },
        { id: 'project-settings', label: 'Project Settings…', click: () => send('project-settings') },
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
          : [{ id: 'system-title-bar', label: 'Use System Title Bar', type: 'checkbox' as const, checked: titleBar.systemChosen, click: (item: Electron.MenuItem) => void useSystemTitleBar(item.checked) }]),
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
  if (titleBar.custom) toWindow('app-menu', menuModel());
}

export function registerMenuIpc() {
  ipcMain.on('set-emacs-keys', (_e, on: boolean) => {
    if (emacsKeys === !!on) return;
    emacsKeys = !!on;
    buildMenu();
  });
  ipcMain.handle('app-menu', () => (titleBar.custom ? { menu: menuModel(), title: current.win?.getTitle() ?? 'MyST Editor' } : null));
  // A click in the title bar's menus: the item at that path in the application menu.
  ipcMain.on('app-menu-click', (_e, path: number[]) => {
    const { win } = current;
    let items = Menu.getApplicationMenu()?.items.filter((i) => i.visible) ?? [];
    let item: Electron.MenuItem | undefined;
    for (const i of path) {
      item = items[i];
      items = item?.submenu?.items.filter((x) => x.visible) ?? [];
    }
    if (item && item.enabled && !item.submenu && win) (item.click as (e: unknown, w: BrowserWindow, c: Electron.WebContents) => void)(undefined, win, win.webContents);
  });
}
