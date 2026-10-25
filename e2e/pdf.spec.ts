// File → Export PDF: the project as one PDF, with a title page, one table of
// contents and each chapter on a new page. Needs a Sphinx build (see sphinx.spec.ts).
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { headingPages, outlineOf } from './pdf-outline';
import { launch, type App } from './helpers';
import { fontNames, pageTexts } from './pdf-text';

let ctx: App;

// WeasyPrint needs the Pango library, which Windows only has if it's installed (MSYS2).
test.skip(process.platform === 'win32', 'WeasyPrint needs Pango');

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

// Build the sample project, export its PDF, and return the PDF.
async function exportPdf(settings?: string): Promise<Buffer> {
  ctx = await launch({ fixture: 'fixture-showcase', prepare: settings ? (dir) => writeFileSync(join(dir, 'docs', '.mysteditor.toml'), settings) : undefined });
  const { page, app } = ctx;
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 180_000 });
  const pdfPath = join(ctx.project, '..', 'Harbor.pdf');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, pdfPath);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('export-pdf')!.click());
  const dialog = page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog.getByRole('status')).toContainText(/Saved \d+ pages as/, { timeout: 180_000 });
  const pdf = readFileSync(pdfPath);
  writeFileSync(test.info().outputPath('Harbor.pdf'), pdf);
  return pdf;
}

test('exports the project as one PDF, with a contents and its page numbers', async () => {
  const pdf = await exportPdf();
  const { entries, pageCount } = await outlineOf(pdf);
  // Cover, contents, the root page's introduction, then a page per chapter.
  expect(pageCount).toBe(8);
  const text = await pageTexts(pdf);
  expect(text[0]).toMatch(/^Harbor documentation \w+ \d+, \d{4}$/);
  // Numbered from the first chapter, as the contents says; nothing in the margins of
  // the front pages.
  expect(text[1]).toContain('Install Harbor 1 Deploy your first service 2 Describe the service 2');
  expect(text[1]).toContain('Roll back a deploy 4 Secrets 5');
  expect(text[2]).toBe('Harbor deploys services from a folder with a harbor.toml in it.');
  // Chapters: the chapter's title at the top right, the page number at the foot
  // (after the page's text, as the PDF has them).
  expect(text[3]).toMatch(/^Install Harbor Download.* Install Harbor 1$/);
  expect(text[7]).toMatch(/^Secrets Keep.* Secrets 5$/);
  // The outline: chapters (not the manual's title), in order, on later and later pages.
  const chapters = ['Install Harbor', 'Deploy your first service', 'Configuration', 'Roll back a deploy', 'Secrets'];
  const pages = headingPages(chapters, entries);
  expect(pages.every((p) => p > 2)).toBe(true);
  expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  expect(new Set(pages).size).toBe(chapters.length);
});

test('uses the project’s cover, paper, headers and footers', async () => {
  const pdf = await exportPdf(`[pdf]
paper = "Letter"
logo = "_static/harbor-logo.svg"
title = "Harbor manual"
subtitle = "Version {version} · {date}"
note = "© Harbor Labs. For customers only."
header = ["{logo}", "", "{chapter}"]
footer = ["{title}", "", "Page {page} of {pages}"]
numbering = "cover"
toc_depth = 1
cover_background = "_static/cover.svg"
cover_color = "#ffffff"
cover_images = [
  { file = "_static/badge.svg", x = 150, y = 215, width = 40 },
]
font = "KaTeX_SansSerif"
code_font = "DejaVu Sans Mono"
fonts = ["_static/fonts/KaTeX_SansSerif-Regular.ttf", "_static/fonts/KaTeX_SansSerif-Bold.woff", "_static/fonts/KaTeX_SansSerif-Italic.woff2"]
`);
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  expect(doc.getPageCount()).toBe(8); // the full-page cover is one page
  const text = await pageTexts(pdf);
  // ("Harbor" first: the logo's text; then the title, subtitle and note, and the
  // badge's text.)
  expect(text[0]).toMatch(/^Harbor Harbor manual ?Version 2\.4\.0 · \w+ \d+, \d{4} ?© Harbor Labs\. For customers only\. ?CERTIFIED ?2026$/);
  // Numbered from the cover (which has no margins): the contents is page 2.
  // (Margins first, in no set order; the logo's text is "Harbor".)
  expect(text[1]).toContain('Contents Install Harbor 4 Deploy your first service 5 Configuration 6 Roll back a deploy 7 Secrets 8');
  expect(text[1]).toContain('Page 2 of 8');
  expect(text[1]).toContain('Harbor manual');
  expect(text[3]).toContain('Page 4 of 8');
  expect(text[3]).toMatch(/^Install Harbor Download.*Install Harbor/);
  // The text in the project's font (embedded from its files), the code in another.
  const fonts = await fontNames(pdf);
  expect(fonts.some((f) => /^KaTeX_SansSerif(-Regular)?$/.test(f))).toBe(true);
  expect(fonts).toContain('KaTeX_SansSerif-Bold'); // the headings
  expect(fonts.some((f) => /^(DejaVu-?Sans-?Mono|Consolas)/.test(f))).toBe(true); // as installed (Linux, Windows)
  // The logo (an SVG, drawn as shapes and its text "Harbor") in the headers.
  const logo = (t: string) => t.replace(/Harbor manual|Install Harbor/g, '').includes('Harbor');
  expect(logo(text[1])).toBe(true);
  expect(logo(text[3])).toBe(true);
});

test('headers and footers on every page, page numbers only where there are any', async () => {
  const pdf = await exportPdf(`[pdf]
logo = "_static/harbor-logo.svg"
header = ["{logo}", "", "{title}"]
footer = ["{date}", "", "Page {page} of {pages}"]
headers_on = "all"
`);
  const text = await pageTexts(pdf);
  const count = (t: string, s: string) => t.split(s).length - 1;
  // The cover: its title, and the header's; the date (the subtitle's and the footer's);
  // no page number. The contents and the introduction: the same, no page number.
  expect(count(text[0], 'Harbor documentation')).toBe(2);
  expect(text[0]).not.toContain('Page');
  for (const i of [1, 2]) {
    expect(text[i]).toContain('Harbor documentation');
    expect(text[i]).not.toContain('Page');
  }
  expect(text[1]).toContain('Install Harbor 1');
  // From the first chapter, numbered: 5 pages of chapters.
  expect(text[3]).toContain('Page 1 of 5');
  expect(text[7]).toContain('Page 5 of 5');
});

test('with the builder in the project, sphinx-build makes the same PDF', async () => {
  const fromApp = await exportPdf();
  const { app, page } = ctx;
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('project-settings')!.click());
  const settings = page.getByRole('dialog', { name: 'Project settings' });
  await settings.getByRole('tab', { name: 'Pages' }).click();
  await settings.getByRole('button', { name: 'Add the PDF builder to the project' }).click();
  const added = settings.getByRole('status');
  await expect(added).toContainText('Copied to docs/_ext/mysteditor_pdf.py');
  await expect(added).toContainText('extensions += ["mysteditor_pdf"]');
  await expect(added).toContainText('sphinx-build -b mysteditor-pdf docs _build/pdf');
  const docs = join(ctx.project, 'docs');
  expect(readFileSync(join(docs, '_ext', 'mysteditor_pdf.py'), 'utf8')).toBe(readFileSync(join(import.meta.dirname, '..', 'resources', 'sphinx', 'mysteditor_pdf.py'), 'utf8'));
  appendFileSync(join(docs, 'conf.py'), '\nimport os, sys\nsys.path.insert(0, os.path.abspath("_ext"))\nextensions += ["mysteditor_pdf"]\n');
  // Without the app: the Python the app set up for the project (it has WeasyPrint now).
  const envs = join(process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx'), 'envs');
  const env = readdirSync(envs).map((d) => join(envs, d)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const python = join(env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  execFileSync(python, ['-m', 'sphinx', '-q', '-b', 'mysteditor-pdf', 'docs', '_build/pdf', '-D', `mysteditor_pdf_date=${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`], { cwd: ctx.project });
  const headless = readFileSync(join(ctx.project, '_build', 'pdf', 'Harbor.pdf'));
  expect(await pageTexts(headless)).toEqual(await pageTexts(fromApp));
});
