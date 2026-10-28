// The formats' readers and writers (see format.ts), and which one a page uses.
import type { ConfigOf, Format, FormatId, PageConfig } from './format.js';
import { myst } from './myst/format.js';
import { asciidoc } from './asciidoc/format.js';

const FORMATS: { [F in FormatId]: Format<ConfigOf<F>> } = { myst, asciidoc };

// The one a page's settings say; it gets settings of its own kind.
export function formatOf(config: PageConfig): Format {
  return FORMATS[config.format] as Format;
}
