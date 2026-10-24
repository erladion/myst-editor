// The app's own settings (settings.json in its data folder), as opposed to a project's.
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentChoice } from '../shared/sphinx.js';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
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
  // Per Sphinx project (its source directory): where its PDF was last exported.
  pdfPaths?: Record<string, string>;
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

export async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

// One change at a time (each reads what the last wrote), and written whole: to a
// temporary file first, so the file is never seen half-written, even after a crash.
let settingsWrite: Promise<void> = Promise.resolve();
export function updateSettings(patch: (s: Settings) => Settings): Promise<void> {
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
