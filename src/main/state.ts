// What the main process's parts share: the window, and the folder open in it.
import type { BrowserWindow } from 'electron';
import type { ProjectInfo } from '../shared/api.js';

export const current: { win: BrowserWindow | null; project: ProjectInfo | null } = { win: null, project: null };

// A message to the window, if there is one.
export function toWindow(channel: string, ...args: unknown[]) {
  current.win?.webContents.send(channel, ...args);
}

export function requireProject(): ProjectInfo {
  if (!current.project) throw new Error('No project is open');
  return current.project;
}
