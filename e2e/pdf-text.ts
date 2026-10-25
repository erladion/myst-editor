// The text on each page of a PDF, for tests (pdf.js, as Firefox reads PDFs).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: true }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? ' ' : '') : '')).join('').replace(/\s+/g, ' ').trim());
  }
  await doc.destroy();
  return texts;
}

// The fonts a PDF embeds (their names, without the subset prefix).
export async function fontNames(pdf: Uint8Array): Promise<string[]> {
  const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdf);
  const names = new Set<string>();
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'));
    if (!(fonts instanceof PDFDict)) continue;
    for (const ref of fonts.values()) {
      const font = doc.context.lookup(ref);
      const base = font instanceof PDFDict ? font.lookup(PDFName.of('BaseFont')) : null;
      if (base instanceof PDFName) names.add(base.decodeText().replace(/^[A-Z]{6}\+/, ''));
    }
  }
  return [...names].sort();
}

// The text on a page with where it is: mm from the page's top-left corner (to the
// text's baseline), and its size in points.
export async function textPlaces(pdf: Uint8Array, page: number): Promise<{ str: string; x: number; y: number; size: number }[]> {
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: true }).promise;
  const p = await doc.getPage(page + 1);
  const height = p.view[3];
  const mm = (pt: number) => (pt * 25.4) / 72;
  const items = (await p.getTextContent()).items.flatMap((item) =>
    'str' in item && item.str.trim() ? [{ str: item.str, x: mm(item.transform[4]), y: mm(height - item.transform[5]), size: Math.hypot(item.transform[2], item.transform[3]) }] : [],
  );
  await doc.destroy();
  return items;
}
