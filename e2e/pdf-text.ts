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
