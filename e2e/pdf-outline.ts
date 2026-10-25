// Which page each heading of a PDF is on, from its outline (bookmarks), for the tests.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';

// The outline's entries in order (Chromium makes one per heading), with their pages.
export async function outlineOf(pdf: Uint8Array): Promise<{ entries: { title: string; page: number }[]; pageCount: number }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const pages = doc.getPages().map((p) => p.ref.toString());
  const named = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const pageOf = (dest: unknown): number => {
    if (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString) {
      const key = dest instanceof PDFName ? dest : PDFName.of(dest.decodeText());
      dest = named?.lookup(key);
      if (dest instanceof PDFDict) dest = dest.lookup(PDFName.of('D'));
    }
    const ref = dest instanceof PDFArray ? dest.get(0) : null;
    return ref instanceof PDFRef ? pages.indexOf(ref.toString()) + 1 : 0;
  };
  const entries: { title: string; page: number }[] = [];
  const visit = (first: PDFDict | undefined) => {
    for (let item = first; item; item = item.lookupMaybe(PDFName.of('Next'), PDFDict)) {
      const title = item.lookupMaybe(PDFName.of('Title'), PDFString, PDFHexString)?.decodeText() ?? '';
      const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
      entries.push({ title: title.replace(/\s+/g, ' ').trim(), page: pageOf(item.lookup(PDFName.of('Dest')) ?? action?.lookup(PDFName.of('D'))) });
      visit(item.lookupMaybe(PDFName.of('First'), PDFDict));
    }
  };
  visit(doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)?.lookupMaybe(PDFName.of('First'), PDFDict));
  return { entries, pageCount: pages.length };
}

// The page of each heading (0 when not found), matching the outline in order: the
// same title, or (Chromium on Windows) one with the heading's text in it, such as
// "TitleTitle" when the page's header shows the chapter's title too.
export function headingPages(headings: string[], entries: { title: string; page: number }[]): number[] {
  let next = 0;
  return headings.map((text) => {
    const window = entries.slice(next, next + 20);
    let k = window.findIndex((e) => e.title === text);
    if (k < 0) k = window.findIndex((e) => text !== '' && e.title.includes(text));
    if (k < 0) return 0;
    next += k + 1;
    return window[k].page;
  });
}
