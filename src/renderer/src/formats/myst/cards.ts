// MyST blocks the editor keeps as written, shown as cards: their names and previews.
import { createTokenizer } from 'myst-parser';
import { safeHtml } from '../../editor/html';
import type { Cards } from '../editing';
import { fieldsForm, fieldsPreview } from './fields';

const LABELS: Record<string, string> = {
  frontmatter: 'Page settings',
  table: 'Table',
  definitionList: 'Definition list',
  footnote: 'Footnote',
  html: 'HTML',
  comment: 'Comment',
  'block-break': 'Cell break',
  'block-attributes': 'Attributes',
  fieldlist: 'Fields',
};

let tokenizer: ReturnType<typeof createTokenizer> | null = null;
// A Markdown block (a table, say) rendered for a card, with the HTML in it shown
// as it looks (see html.ts for what's allowed).
function markdownPreview(source: string, assetUrl: (src: string) => string): DocumentFragment {
  tokenizer ??= createTokenizer({ markdownit: { html: true } });
  try {
    return safeHtml(tokenizer.render(source), assetUrl);
  } catch {
    return document.createDocumentFragment();
  }
}

export const mystCards: Cards = {
  label: (kind) => LABELS[kind] ?? 'Markdown',
  editTitle: (name) => `Edit {${name}} block`,
  comment: (source) => source.replace(/^%\s?/gm, ''),
  preview: (kind, source, assetUrl) => (kind === 'fieldlist' ? fieldsPreview(source) : kind === 'table' || kind === 'definitionList' || kind === 'footnote' ? markdownPreview(source, assetUrl) : null),
  form: (kind, source) => (kind === 'fieldlist' ? fieldsForm(source) : null),
};
