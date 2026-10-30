// The app's settings folder is named after it: under an earlier name, the folder of
// that name is moved to the app's the first time it starts. A link is left where it
// was, since Python environments set up there keep absolute paths to it; without one
// they're set up again when next needed.
import { cpSync, existsSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT } from '../shared/product.js';

// `appData`: where apps' folders are; `now`: the app's own.
export function adoptPreviousSettings(appData: string, now: string): void {
  if (existsSync(now)) return;
  for (const previous of PRODUCT.previous) {
    const was = join(appData, previous.name);
    if (!existsSync(was)) continue;
    try {
      try {
        renameSync(was, now);
      } catch {
        cpSync(was, now, { recursive: true });
        rmSync(was, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`Couldn’t move the settings from ${was}:`, e);
      return;
    }
    try {
      symlinkSync(now, was, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // Set up again when next needed.
      rmSync(join(now, 'sphinx'), { recursive: true, force: true });
    }
    return;
  }
}
