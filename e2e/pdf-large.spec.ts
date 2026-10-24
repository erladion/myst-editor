// A manual of a few hundred pages, exported as a PDF: the page count stays in
// proportion to the content (no blank or runaway pages), and it's done in a few
// minutes. Slow, so only when asked: PDF_LARGE=1 npx playwright test pdf-large
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFRawStream, PDFArray, PDFName, decodePDFRawStream } from 'pdf-lib';
import { outlineOf } from '../src/main/pdf/outline';
import { launch, type App } from './helpers';

let ctx: App;

test.skip(!process.env.PDF_LARGE, 'a large manual; set PDF_LARGE=1');
test.setTimeout(900_000);

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const PARTS = 12;
const CHAPTERS = 8;
const words = 'the service reads its settings from the file and starts each worker in turn while the gateway waits for every health check to pass before traffic is moved'.split(' ');
const sentence = (n: number) => {
  const w = Array.from({ length: 12 + (n % 9) }, (_, i) => words[(n * 7 + i * 3) % words.length]);
  return w.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
};
const paragraph = (n: number) => Array.from({ length: 4 + (n % 3) }, (_, i) => sentence(n + i)).join(' ');

function chapter(part: number, ch: number): string {
  const n = part * 100 + ch;
  const rows = (count: number, cols: number) =>
    [`| ${Array.from({ length: cols }, (_, c) => `Column ${c + 1}`).join(' | ')} |`, `|${'---|'.repeat(cols)}`, ...Array.from({ length: count }, (_, r) => `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `row-${r + 1}` : words[(r + c) % words.length])).join(' | ')} |`)].join('\n');
  return [
    `(part${part}-ch${ch})=`,
    `# Chapter ${part}.${ch}: ${words[n % words.length]} ${words[(n + 5) % words.length]}`,
    paragraph(n),
    `## Before you start`,
    paragraph(n + 1),
    ...Array.from({ length: 6 }, (_, i) => `- ${sentence(n + i)}`),
    `:::{note}\n${paragraph(n + 2)}\n:::`,
    `## Settings`,
    paragraph(n + 3),
    rows(6, 8),
    `## Commands`,
    '```bash\n' + Array.from({ length: 14 }, (_, i) => `harbor deploy --service orders-${i} --region eu-north --replicas ${i + 2} --env PRODUCT=enterprise --env FEATURE_FLAGS=alpha,beta,gamma,delta --wait --timeout 600s`).join('\n') + '\n```',
    paragraph(n + 4),
    `## Reference`,
    paragraph(n + 5),
    rows(45, 4),
    `:::{warning}\n${paragraph(n + 6)}\n:::`,
    `## Troubleshooting`,
    ...Array.from({ length: 4 }, (_, i) => paragraph(n + 7 + i)),
    `See {ref}\`the next chapter <part${part}-ch${(ch % CHAPTERS) + 1}>\`.`,
  ].join('\n\n');
}

function generate(project: string) {
  const docs = join(project, 'docs');
  const parts = Array.from({ length: PARTS }, (_, p) => p + 1);
  writeFileSync(join(docs, 'index.md'), `# Large manual\n\n${paragraph(1)}\n\n\`\`\`{toctree}\n${parts.map((p) => `part${p}/index`).join('\n')}\n\`\`\`\n`);
  for (const p of parts) {
    mkdirSync(join(docs, `part${p}`), { recursive: true });
    const chapters = Array.from({ length: CHAPTERS }, (_, c) => c + 1);
    writeFileSync(join(docs, `part${p}`, 'index.md'), `# Part ${p}\n\n${paragraph(p)}\n\n\`\`\`{toctree}\n${chapters.map((c) => `chapter${c}`).join('\n')}\n\`\`\`\n`);
    for (const c of chapters) writeFileSync(join(docs, `part${p}`, `chapter${c}.md`), chapter(p, c) + '\n');
  }
}

// Pages with nothing on them but the page number.
async function blankPages(pdf: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const blank: number[] = [];
  // Not the cover: it has only the title and the date on it.
  doc.getPages().forEach((page, i) => {
    if (i === 0) return;
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const text = streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n');
    // Glyph runs (Tj/TJ), and images (Do): a footer only has one or two runs.
    const runs = (text.match(/\b(Tj|TJ)\b/g) ?? []).length + (text.match(/\bDo\b/g) ?? []).length;
    if (runs <= 2) blank.push(i + 1);
  });
  return blank;
}

test('a few hundred pages, without blank or runaway pages', async () => {
  ctx = await launch({ fixture: 'fixture-pdf-large', folder: 'large-manual', prepare: generate });
  const { page, app } = ctx;
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 600_000 });
  const pdfPath = join(ctx.project, '..', 'large.pdf');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, pdfPath);

  const started = Date.now();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('export-pdf')!.click());
  await expect(page.getByRole('dialog', { name: 'Export PDF' }).getByRole('status')).toContainText(/Saved \d+ pages/, { timeout: 840_000 });
  const seconds = (Date.now() - started) / 1000;

  const pdf = readFileSync(pdfPath);
  writeFileSync(test.info().outputPath('large.pdf'), pdf);
  const { entries, pageCount } = await outlineOf(pdf);
  const blank = await blankPages(pdf);
  console.log(`${pageCount} pages in ${seconds.toFixed(0)} s; ${entries.length} outline entries; blank pages: ${blank.join(', ') || 'none'}`);
  expect(blank).toEqual([]);
  // About three pages a chapter, plus a page per part and the front matter.
  expect(pageCount).toBeGreaterThan(PARTS * CHAPTERS * 2);
  expect(pageCount).toBeLessThan(PARTS * CHAPTERS * 6);
  expect(entries.filter((e) => e.page === 0)).toEqual([]);
});
