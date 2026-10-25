// Electron main process: starting up and shutting down. The parts:
//   state.ts       the window and the open folder, which the others share
//   settings.ts    the app's own settings
//   window.ts      the window, its title bar and right-click menu
//   menu.ts        the application menu (and the title bar's copy of it)
//   workspace.ts   the open folder: opening it, watching it, its page list
//   files.ts       reading, saving, creating, renaming and deleting pages, and so on
//   git/           git: service.ts (what requests share), ipc.ts (the requests)
//   sphinx/        builds: service.ts (managers and requests), manager.ts, …
//   protocols.ts   the URL schemes for images and built pages
import { app } from 'electron';
import { registerSchemes, registerProtocols } from './protocols.js';
import { loadSettings } from './settings.js';
import { createWindow, decideTitleBar, followTheme, registerWindowIpc } from './window.js';
import { registerMenuIpc, setRecentFolders, setTheme } from './menu.js';
import { registerWorkspaceIpc, stopWatching } from './workspace.js';
import { registerFileIpc } from './files.js';
import { registerProjectSettingsIpc } from './project-settings.js';
import { registerPdfIpc } from './pdf/export.js';
import { registerNewProjectIpc } from './new-project.js';
import { registerGitIpc } from './git/ipc.js';
import { startAskPass, stopAskPass } from './git/service.js';
import { registerSphinxIpc, stopSphinx } from './sphinx/service.js';

// Lets tests (and portable setups) keep settings out of the real profile.
if (process.env.MYSTEDITOR_USER_DATA) app.setPath('userData', process.env.MYSTEDITOR_USER_DATA);

registerSchemes();

app.whenReady().then(async () => {
  await startAskPass();
  registerWorkspaceIpc();
  registerFileIpc();
  registerProjectSettingsIpc();
  registerPdfIpc();
  registerNewProjectIpc();
  registerGitIpc();
  registerSphinxIpc();
  registerWindowIpc();
  registerMenuIpc();
  registerProtocols();
  const settings = await loadSettings();
  decideTitleBar(settings);
  setRecentFolders(settings.recent ?? []);
  await setTheme(settings.theme ?? 'system', false);
  followTheme();
  createWindow();
});

app.on('window-all-closed', () => {
  stopAskPass();
  stopWatching();
  stopSphinx();
  app.quit();
});
