// The formats' readers and writers (see format.ts), and which one a page uses.
import type { Format, PageConfig } from './format.js';
import { myst } from './myst/format.js';

const FORMATS: Record<PageConfig['format'], Format> = { myst };

export function formatOf(config: PageConfig): Format {
  return FORMATS[config.format];
}
