// File → Export PDF: the project's PDF, made by Sphinx with mysteditor_pdf.py's builder
// (WeasyPrint; see SphinxManager.buildPdf), the same as `sphinx-build -b
// mysteditor-pdf` makes it without the app. Its layout is [pdf] in .mysteditor.toml.
import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { PdfBuilderAdded, PdfResult } from '../../shared/api.js';
import { current, requireProject, toWindow } from '../state.js';
import { loadSettings, updateSettings } from '../settings.js';
import { managerOf } from '../sphinx/service.js';

let running: AbortController | null = null;
// The last PDF made: the only file the window may ask to open.
let exported: string | null = null;

// The builder, as the app has it.
const builderSource = () =>
  app.isPackaged ? join(process.resourcesPath, 'sphinx', 'mysteditor_pdf.py') : join(import.meta.dirname, '..', '..', 'resources', 'sphinx', 'mysteditor_pdf.py');

export const CONF_PY_LINES = `import os, sys
sys.path.insert(0, os.path.abspath("_ext"))
extensions += ["mysteditor_pdf"]`;

const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, '');

export function registerPdfIpc() {
  ipcMain.handle('export-pdf', async (_e, projectId: string | null): Promise<PdfResult | null> => {
    const p = requireProject();
    const project = p.projects.find((x) => x.id === projectId) ?? p.projects[0];
    if (!project) return { ok: false, message: 'There’s no Sphinx project (conf.py) in this folder to make a PDF of.' };
    const manager = managerOf(project.id);
    if (!manager) return { ok: false, message: 'Sphinx isn’t running for this project.' };
    const saved = (await loadSettings()).pdfPaths?.[project.sourceDir];
    const chosen = await dialog.showSaveDialog(current.win!, {
      title: 'Export PDF',
      defaultPath: saved ?? join(app.getPath('documents'), `${project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'manual'}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    const path = chosen.filePath;
    await updateSettings((s) => ({ ...s, pdfPaths: { ...s.pdfPaths, [project.sourceDir]: path } }));

    running?.abort();
    const run = (running = new AbortController());
    try {
      const date = new Date().toLocaleDateString(app.getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
      const { pages } = await manager.buildPdf(path, date, run.signal, (s) => toWindow('pdf-progress', s));
      exported = path;
      return { ok: true, path, pages };
    } catch (e) {
      return run.signal.aborted ? null : { ok: false, message: plain(e) };
    } finally {
      if (running === run) running = null;
    }
  });
  // The builder into the project (_ext/ next to conf.py), for making the PDF without the
  // app: what conf.py still needs, and the command.
  ipcMain.handle('add-pdf-builder', async (_e, projectId: string | null): Promise<PdfBuilderAdded> => {
    const p = requireProject();
    const project = p.projects.find((x) => x.id === projectId) ?? p.projects[0];
    if (!project) return { ok: false, message: 'There’s no Sphinx project (conf.py) in this folder.' };
    try {
      const target = join(project.sourceDir, '_ext', 'mysteditor_pdf.py');
      const text = await fs.readFile(builderSource(), 'utf8');
      await fs.mkdir(join(project.sourceDir, '_ext'), { recursive: true });
      const same = existsSync(target) && (await fs.readFile(target, 'utf8')) === text;
      if (!same) await fs.writeFile(target, text);
      const confPy = await fs.readFile(join(project.sourceDir, 'conf.py'), 'utf8').catch(() => '');
      const rel = (path: string) => relative(p.root, path).split(sep).join('/') || '.';
      return {
        ok: true,
        file: rel(target),
        updated: !same,
        confPy: /\bmysteditor_pdf\b/.test(confPy) ? null : CONF_PY_LINES,
        command: `sphinx-build -b mysteditor-pdf ${rel(project.sourceDir)} _build/pdf`,
      };
    } catch (e) {
      return { ok: false, message: `Couldn’t add the builder: ${plain(e)}` };
    }
  });
  ipcMain.handle('cancel-pdf', () => running?.abort());
  ipcMain.handle('open-pdf', async (_e, inFolder: boolean) => {
    if (!exported) return;
    if (inFolder) shell.showItemInFolder(exported);
    else await shell.openPath(exported);
  });
}
