// File → Export PDF: the project built as one page (see SphinxManager.buildOnePage),
// laid out for print (layout.ts) and printed by Chromium. Printed twice: the first
// print's outline says which page each heading is on, for the contents' numbers.
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { PdfDef } from '../../core/editor-config.js';
import type { PdfResult } from '../../shared/api.js';
import { current, requireProject, toWindow } from '../state.js';
import { loadSettings, updateSettings } from '../settings.js';
import { managerOf } from '../sphinx/service.js';
import { CODE_FONTS, layoutScript, PRINT_CSS, TEXT_FONTS, type LayoutOptions } from './layout.js';
import { cssString, fontFace, fontInfo } from './fonts.js';
import { resolveInside } from '../project.js';
import { headingPages, outlineOf } from './outline.js';

let running: AbortController | null = null;
// The last PDF made: the only file the window may ask to open.
let exported: string | null = null;

const PRINT: Electron.PrintToPDFOptions = {
  // Paper, margins, headers and footers are the page's CSS (layout.ts).
  preferCSSPageSize: true,
  printBackground: true,
  // Tagged (accessible) PDF; Chromium makes the outline from its headings.
  generateTaggedPDF: true,
  generateDocumentOutline: true,
};

const IMAGE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

// An image the settings name (relative to the opened folder), as a data: URL, and
// its width over its height.
async function imageData(root: string, path: string, what: string): Promise<{ url: string; ratio: number }> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`The ${what} must be an SVG, PNG, JPEG, GIF or WebP image: ${path}`);
  const bytes = await fs.readFile(resolveInside(root, path)).catch(() => {
    throw new Error(`There’s no ${what} at ${path}.`);
  });
  let ratio = 3;
  if (type === 'image/svg+xml') {
    const svg = bytes.toString('utf8');
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
    const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(svg);
    const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(svg);
    if (box && Number(box[2])) ratio = Number(box[1]) / Number(box[2]);
    else if (w && h && Number(h[1])) ratio = Number(w[1]) / Number(h[1]);
  } else {
    const size = nativeImage.createFromBuffer(bytes).getSize();
    if (size.height) ratio = size.width / size.height;
  }
  return { url: `data:${type};base64,${bytes.toString('base64')}`, ratio };
}

// The logo as data: URLs: as it is (the cover), and as an SVG of the margins' height
// (a margin box shows an image at its own size).
export async function logoImages(root: string, logo: string): Promise<{ cover: string; margin: string }> {
  const { url: cover, ratio } = await imageData(root, logo, 'logo');
  const height = 30; // px, about 8 mm
  const width = Math.round(height * ratio);
  const sized = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${cover}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return { cover, margin: `data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}` };
}

async function print(htmlFile: string, layout: Omit<LayoutOptions, 'rootDoc'>, signal: AbortSignal, step: (s: string) => void): Promise<{ pdf: Uint8Array; pages: number }> {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const cancel = () => win.destroy();
  signal.addEventListener('abort', cancel);
  try {
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(htmlFile);
    await win.webContents.insertCSS(PRINT_CSS);
    const { headings, firstChapter }: { headings: string[]; firstChapter: number } = await win.webContents.executeJavaScript(layoutScript({ ...layout, rootDoc: basename(htmlFile, '.html') }));
    step('Laying out the pages…');
    const first = await win.webContents.printToPDF(PRINT);
    const { entries, pageCount } = await outlineOf(first);
    const physical = headingPages(headings, entries);
    if (!physical.some(Boolean)) return { pdf: first, pages: pageCount };
    // Numbered from the first chapter: the pages before it (cover, contents, the
    // root page's own text) don't count.
    const front = firstChapter >= 0 && physical[firstChapter] ? physical[firstChapter] - 1 : 0;
    step('Numbering the contents…');
    await win.webContents.executeJavaScript(`window.__pdfNumber(${JSON.stringify(physical.map((p) => (p ? p - front : 0)))}); window.__pdfMargins(${pageCount - front})`);
    return { pdf: await win.webContents.printToPDF(PRINT), pages: pageCount };
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!win.isDestroyed()) win.destroy();
  }
}

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
    const step = (s: string) => toWindow('pdf-progress', s);
    try {
      step('Building the pages with Sphinx…');
      const html = await manager.buildOnePage(run.signal);
      if (run.signal.aborted) return null;
      const settings: PdfDef = project.config.editor.pdf;
      const logo = settings.logoPath ? await logoImages(p.root, settings.logoPath) : null;
      const background = settings.coverBackgroundPath ? (await imageData(p.root, settings.coverBackgroundPath, 'cover background')).url : null;
      // The project's font files, embedded: the PDF looks the same on every computer.
      const faces: string[] = [];
      for (const f of settings.fonts) {
        if (!f.path) throw new Error(`Font files must be in the opened folder: ${f.file}`);
        const bytes = await fs.readFile(resolveInside(p.root, f.path)).catch(() => {
          throw new Error(`There’s no font file at ${f.path}.`);
        });
        faces.push(fontFace(fontInfo(bytes, f.path), bytes, f.path));
      }
      const family = (name: string | null, fallback: string) => (name ? `${cssString(name)}, ${fallback}` : fallback);
      const fonts = {
        text: family(settings.font, TEXT_FONTS),
        heading: family(settings.headingFont ?? settings.font, TEXT_FONTS),
        code: family(settings.codeFont, CODE_FONTS),
        faces: faces.join('\n'),
      };
      const graphics = [];
      for (const img of settings.coverImages) {
        if (!img.path) throw new Error(`Graphics on the cover must be in the opened folder: ${img.file}`);
        graphics.push({ src: (await imageData(p.root, img.path, 'graphic')).url, x: img.x, y: img.y, width: img.width, height: img.height });
      }
      const layout = {
        paper: settings.paper,
        title: settings.title,
        subtitle: settings.subtitle,
        note: settings.note,
        coverLogo: logo?.cover ?? null,
        coverBackground: background,
        coverColor: settings.coverColor,
        coverImages: graphics,
        coverPlaces: settings.cover,
        marginLogo: logo?.margin ?? null,
        fonts,
        header: settings.header,
        footer: settings.footer,
        headersOn: settings.headersOn,
        numbering: settings.numbering,
        tocDepth: settings.tocDepth,
        date: new Date().toLocaleDateString(app.getLocale(), { year: 'numeric', month: 'long', day: 'numeric' }),
        project: project.name,
      };
      const { pdf, pages } = await print(html, layout, run.signal, step);
      await fs.writeFile(path, pdf);
      exported = path;
      return { ok: true, path, pages };
    } catch (e) {
      return run.signal.aborted ? null : { ok: false, message: plain(e) };
    } finally {
      if (running === run) running = null;
    }
  });
  ipcMain.handle('cancel-pdf', () => running?.abort());
  ipcMain.handle('open-pdf', async (_e, inFolder: boolean) => {
    if (!exported) return;
    if (inFolder) shell.showItemInFolder(exported);
    else await shell.openPath(exported);
  });
}
