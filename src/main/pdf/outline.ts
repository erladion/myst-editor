// Which page each heading of a printed PDF is on, from its outline (Chromium makes an
// entry per heading), for the contents' page numbers.
import { diffArrays } from 'diff';
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

// Compared without spaces or case: where a heading wraps onto a second line, Chromium's
// title leaves the space out ("farlonger").
const bare = (s: string) => s.replace(/\s+/g, '').toLowerCase();

// The page of each heading (0 when not found). Chromium makes an outline entry per
// heading, in order, so the two are lined up: by their texts where they're the same
// (or, Chromium on Windows, the title has the heading's text in it, such as
// "TitleTitle" when the page's header shows the chapter's title too), and between
// those, one for one where there are as many of each (an image's alt text is in the
// title, maths isn't).
export function headingPages(headings: string[], entries: { title: string; page: number }[]): number[] {
  const out = headings.map(() => 0);
  const parts = diffArrays(
    headings.map(bare),
    entries.map((e) => bare(e.title)),
    { comparator: (heading, title) => heading === title || (heading !== '' && title.includes(heading)) },
  );
  let i = 0; // in headings
  let j = 0; // in entries
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const n = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      for (let k = 0; k < n; k++) out[i + k] = entries[j + k].page;
      i += n;
      j += n;
      continue;
    }
    // Headings without a title of their own, and titles without a heading, together.
    const next = parts[p + 1];
    const other = next && (part.removed ? next.added : next.removed) ? next : null;
    const m = other ? (other.count ?? other.value.length) : 0;
    const removed = part.removed ? n : m;
    const added = part.added ? n : m;
    if (removed === added) for (let k = 0; k < removed; k++) out[i + k] = entries[j + k].page;
    i += removed;
    j += added;
    if (other) p++;
  }
  return out;
}
