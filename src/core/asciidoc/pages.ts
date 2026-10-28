// AsciiDoc pages: which files they are, and their titles.
import type { PageFormat } from '../format.js';

export const asciidocPages: PageFormat = {
  id: 'asciidoc',
  name: 'AsciiDoc',
  extension: '.adoc',
  title: documentTitle,
  newPage: (title) => `= ${title}\n`,
};

// The document title (= Title, or # Title), else the first section's; as plain text.
export function documentTitle(text: string): string | null {
  let delimiter: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const d = /^(-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,}|--|[|!,:]={3,}|`{3,})[ \t]*$/.exec(line)?.[1] ?? /^(`{3,})/.exec(line)?.[1];
    if (d) {
      if (!delimiter) delimiter = d;
      else if (d === delimiter || (delimiter.startsWith('`') && d.startsWith(delimiter))) delimiter = null;
      continue;
    }
    if (delimiter) continue;
    const m = /^(?:={1,6}|#{1,6})[ \t]+(\S.*?)[ \t]*$/.exec(line);
    if (m) return plain(m[1]);
  }
  return null;
}

// Without inline markup: formatting marks, passthroughs, macros' brackets.
function plain(text: string): string {
  return text
    .replace(/\{[\w-]+\}/g, (m) => m)
    .replace(/(?:xref|link|https?):[^\s[]*\[([^\]]*)\]/g, '$1')
    .replace(/<<[^,>]+,\s*([^>]+)>>/g, '$1')
    .replace(/\+\+?([^+]+)\+\+?/g, '$1')
    .replace(/(\*\*|__|``|\*|_|`|#)(.+?)\1/g, '$2')
    .trim();
}
