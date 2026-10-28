// AsciiDoc blocks the editor keeps as written, shown as cards: their names, and how
// they look as Asciidoctor renders them.
import { safeHtml } from '../../editor/html';
import type { Cards } from '../editing';

const LABELS: Record<string, string> = {
  header: 'Document header',
  attributes: 'Attributes',
  'block-attributes': 'Block attributes',
  comment: 'Comment',
  preprocessor: 'Condition',
  table: 'Table',
  definitionList: 'Definition list',
  callouts: 'Callouts',
  passthrough: 'HTML',
  'page-break': 'Page break',
  verse: 'Verse',
};

// Kinds shown as Asciidoctor renders them.
const RENDERED = new Set(['table', 'definitionList', 'callouts', 'verse', 'asciidoc']);

// Asciidoctor, loaded the first time a card needs it.
let asciidoctor: Promise<typeof import('@asciidoctor/core')> | null = null;

async function render(source: string, assetUrl: (src: string) => string): Promise<DocumentFragment> {
  asciidoctor ??= import('@asciidoctor/core');
  const { convert } = await asciidoctor;
  const html = (await convert(source, { safe: 'secure', attributes: { showtitle: '', 'attribute-missing': 'skip' } })) as string;
  return safeHtml(html, assetUrl);
}

export const asciidocCards: Cards = {
  label: (kind) => LABELS[kind] ?? 'AsciiDoc',
  editTitle: (name) => `Edit ${name}:: block`,
  comment: (source) => source.replace(/^\/{4,}[ \t]*$/gm, '').replace(/^\/\/ ?/gm, '').trim(),
  preview(kind, source, assetUrl) {
    // Raw HTML shows as it looks.
    if (kind === 'passthrough') return safeHtml(source.replace(/^\+{4,}[ \t]*$/gm, ''), assetUrl);
    return RENDERED.has(kind) ? render(source, assetUrl) : null;
  },
};
