// Project Settings: the window's view of a project's .mysteditor.toml, and its
// changes to it (written into the file's text, see core/project-settings.ts).
import { dialog, ipcMain } from 'electron';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { capabilityNames, loadEditorConfig, SETTINGS_FILE, type SettingsSource } from '../core/editor-config.js';
import { editConditions, editPdf, type ConditionsPatch, type PdfPatch } from '../core/project-settings.js';
import { tomlAt } from '../core/toml-edit.js';
import type { PdfFonts, ProjectInfo, ProjectSettingsInfo } from '../shared/api.js';
import { isInside, resolveForReading, resolveInside, settingsSources } from './project.js';
import { current, requireProject } from './state.js';
import { refreshProject } from './workspace.js';
import { fontInfo, installedFonts } from './pdf/fonts.js';

const slashes = (p: string) => p.split(sep).join('/');
const plain = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The settings file a project's changes go to: the innermost one with conditional
// content or PDF settings, else the innermost there is, else a new one next to its
// conf.py (the opened folder's, for pages outside every project).
function settingsFor(p: ProjectInfo, projectId: string | null) {
  const dir = p.projects.find((x) => x.id === projectId)?.sourceDir ?? p.root;
  const sources = settingsSources(p.root, dir);
  const has = (s: SettingsSource) => {
    try {
      return tomlAt(s.text, ['conditions']) !== undefined || tomlAt(s.text, ['pdf']) !== undefined;
    } catch {
      return false;
    }
  };
  let index = sources.length - 1;
  while (index > 0 && !has(sources[index])) index--;
  if (index >= 0 && !has(sources[index])) index = sources.length - 1;
  const rel = index >= 0 ? sources[index].file : slashes(relative(p.root, join(dir, SETTINGS_FILE)));
  return { sources, index, rel, path: join(p.root, rel) };
}

export function registerProjectSettingsIpc() {
  ipcMain.handle('project-settings', (_e, projectId: string | null): ProjectSettingsInfo => {
    const p = requireProject();
    const { sources, rel } = settingsFor(p, projectId);
    const config = loadEditorConfig(sources);
    return { file: rel, exists: existsSync(join(p.root, rel)), conditions: config.conditionSettings, enabled: config.conditions !== null, pdf: config.pdf, problems: config.problems };
  });

  ipcMain.handle('save-project-settings', async (_e, projectId: string | null, patch: { conditions?: ConditionsPatch; pdf?: PdfPatch }) => {
    const p = requireProject();
    const { sources, index, rel } = settingsFor(p, projectId);
    try {
      const text = index >= 0 ? sources[index].text : '';
      const outer = loadEditorConfig(index >= 0 ? sources.slice(0, index) : sources);
      let next = patch.conditions ? editConditions(text, patch.conditions, outer.conditionSettings !== null && outer.conditions === null) : text;
      if (patch.pdf) next = editPdf(next, patch.pdf);
      if (next !== text) await fs.writeFile(resolveInside(p.root, rel), next);
      // Without waiting for the folder watcher.
      await refreshProject(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `Couldn’t change ${rel}: ${plain(e)}. Change it in a text editor instead.` };
    }
  });

  // A file the settings name (a capabilities file, chosen or new, or a logo), as
  // the settings file would name it.
  ipcMain.handle('choose-settings-file', async (_e, projectId: string | null, kind: 'capabilities' | 'new-capabilities' | 'image' | 'font' | 'css') => {
    const p = requireProject();
    const { path } = settingsFor(p, projectId);
    const create = kind === 'new-capabilities';
    const filters =
      kind === 'image'
        ? [{ name: 'Images', extensions: ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : kind === 'font'
          ? [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
          : kind === 'css'
            ? [{ name: 'Stylesheets', extensions: ['css'] }]
            : [{ name: 'JSON', extensions: ['json'] }];
    const result = create
      ? await dialog.showSaveDialog(current.win!, { title: 'New capabilities file', defaultPath: join(dirname(path), 'capabilities.json'), filters })
      : await dialog.showOpenDialog(current.win!, { title: kind === 'image' ? 'Choose an image' : kind === 'font' ? 'Choose a font file' : kind === 'css' ? 'Choose the PDF stylesheet' : 'Choose the capabilities file', defaultPath: dirname(path), properties: ['openFile'], filters });
    const file = 'filePaths' in result ? result.filePaths[0] : result.filePath;
    if (result.canceled || !file) return null;
    // In the folder as the dialog gives it (through the folder's symlinks too, for files
    // read), or as the disk spells it (Windows dialogs may give C:\PROGRA~1\… names).
    const real = (f: string) => join(realpathSync.native(dirname(f)), basename(f));
    let chosen: string | null = !create && isInside(p.root, file) ? file : null;
    try {
      if (!chosen && isInside(realpathSync.native(p.root), real(file))) chosen = real(file);
      if (create) resolveInside(p.root, relative(p.root, file));
    } catch {
      chosen = null;
    }
    if (!chosen) return { error: 'Choose a file in the opened folder, so everyone working on the project has it.' };
    if (create && !existsSync(chosen)) await fs.writeFile(chosen, '{\n  "capabilities": []\n}\n');
    return { path: slashes(relative(realpathSync.native(dirname(path)), chosen)) };
  });

  // Font files (relative to the settings file): what each is.
  ipcMain.handle('pdf-fonts', async (_e, projectId: string | null, files: string[]): Promise<PdfFonts> => {
    const p = requireProject();
    const { path } = settingsFor(p, projectId);
    const described = await Promise.all(
      files.map(async (file) => {
        try {
          const target = resolveForReading(p.root, relative(p.root, resolve(dirname(path), String(file))));
          return { file, ...fontInfo(await fs.readFile(target), target) };
        } catch {
          return { file, error: 'There’s no such font file.' };
        }
      }),
    );
    return { files: described };
  });
  // The fonts on this computer: apart, as finding them can take a while (PowerShell, on
  // Windows), and the font files' descriptions shouldn't wait for it.
  ipcMain.handle('installed-fonts', () => installedFonts());

  // The capabilities a file lists (`file` relative to the settings file), for the
  // window to show before it's saved.
  ipcMain.handle('read-capabilities', async (_e, projectId: string | null, file: string, key: string | null) => {
    const p = requireProject();
    const { path } = settingsFor(p, projectId);
    try {
      const target = isAbsolute(file) ? file : resolve(dirname(path), file);
      const names = capabilityNames(JSON.parse(await fs.readFile(resolveForReading(p.root, relative(p.root, target)), 'utf8')), key || null);
      return names ? { names } : { error: `There’s no list of capabilities in it${key ? ` under “${key}”` : ''}.` };
    } catch (e) {
      return { error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'There’s no such file.' : plain(e) };
    }
  });
}
