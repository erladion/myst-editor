// AsciiDoc, as Asciidoctor reads it.
import type { Format } from '../format.js';
import type { AsciidocConfig } from './config.js';
import { parseAsciidoc } from './parse.js';
import { serializeAsciidoc } from './serialize.js';
import { asciidocPages } from './pages.js';

export const asciidoc: Format<AsciidocConfig> = {
  ...asciidocPages,
  load: (text, config) => parseAsciidoc(text, { conditions: !!config.editor.conditions }),
  save: (doc, map) => serializeAsciidoc(doc, map),
};
