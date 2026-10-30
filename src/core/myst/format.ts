// MyST Markdown, as Sphinx's MyST-Parser reads it.
import type { Format } from '../format.js';
import { parseMyst } from './parse.js';
import { serializeMyst } from './serialize.js';
import { parserExtensions, type MystConfig } from '../project-config.js';
import { mystPages } from './pages.js';

export const myst: Format<MystConfig> = {
  ...mystPages,
  load(text, config) {
    const { directives, conditions, tables } = config.editor;
    return parseMyst(text, {
      extensions: parserExtensions(config),
      substitutions: config.extensions.includes('substitution'),
      directives: Object.fromEntries(Object.entries(directives).map(([name, d]) => [name, d.body])),
      conditionKeywords: conditions?.block,
      tableSpans: tables,
    });
  },
  save: (doc, map, config) => serializeMyst(doc, map, { tableSpans: config.editor.tables }),
};
