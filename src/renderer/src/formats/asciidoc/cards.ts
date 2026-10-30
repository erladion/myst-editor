// AsciiDoc blocks the editor keeps as written, shown as cards: their names, and how
// they look as Asciidoctor renders them.
import { safeHtml } from '../../editor/html';
import { blockAttributesForm, blockAttributesPreview, entriesForm, entriesPreview } from './attributes';
import { BLOCK_MACRO, isTitleLine, parseAttrlist } from '../../../../core/asciidoc/syntax';
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

// A preprocessor line: ifdef::a,b[], ifndef::a+b[], ifeval::[expression], endif::[],
// or ifdef::a[text] on one line.
const DIRECTIVE = /^(ifdef|ifndef|ifeval|endif)::([^[]*)\[(.*)\][ \t]*$/;

function describeLine(source: string): string {
  const m = DIRECTIVE.exec(source.trim());
  if (!m) return source;
  const [, kind, target, text] = m;
  if (kind === 'endif') return 'End of the condition';
  if (kind === 'ifeval') return `Only when ${text}`;
  const names = target.split(/[,+]/);
  const all = target.includes('+');
  const list = names.join(all ? ' and ' : ' or ');
  let when: string;
  if (names.length === 1) when = `Only when ${list} ${kind === 'ifdef' ? 'is' : 'isn’t'} set`;
  else if (kind === 'ifdef') when = `Only when ${list} ${all ? 'are' : 'is'} set`;
  else when = all ? `Only when ${list} aren’t all set` : `Only when none of ${names.join(', ')} is set`;
  return text ? `${when}: ${text}` : when;
}

function preprocessorForm(source: string) {
  const m = DIRECTIVE.exec(source.trim());
  if (!m || m[1] === 'endif') return null;
  const [, kind, target, text] = m;
  if (kind === 'ifeval') {
    return {
      title: 'Condition',
      fields: [{ key: 'expr', label: 'Expression', value: text, placeholder: '{sectnumlevels} == 3', help: 'Asciidoctor evaluates it: attributes, numbers or text, compared with ==, !=, <, <=, > or >=.' }],
      source: (v: Record<string, string>) => `ifeval::[${v.expr.trim()}]`,
    };
  }
  return {
    title: 'Condition',
    fields: [
      { key: 'kind', label: 'Shown', value: kind, choices: [{ value: 'ifdef', label: 'When the attributes are set' }, { value: 'ifndef', label: 'When they aren’t' }] },
      { key: 'names', label: 'Attributes', value: target, placeholder: 'cloud,desktop', help: 'Separated by , for any of them, or + for all of them.' },
      ...(text ? [{ key: 'text', label: 'Text', value: text }] : []),
    ],
    source: (v: Record<string, string>) => `${v.kind === 'ifndef' ? 'ifndef' : 'ifdef'}::${v.names.replace(/\s+/g, '')}[${v.text ?? ''}]`,
  };
}

const SITES: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', wistia: 'Wistia' };

export const asciidocCards: Cards = {
  // video::file.mp4[], video::id[youtube], audio::file.wav[]; a .Title above.
  media(name, _args, source) {
    if (name !== 'video' && name !== 'audio') return null;
    const lines = source.split('\n');
    const m = BLOCK_MACRO.exec(lines[lines.length - 1]);
    if (!m) return null;
    const title = lines.find(isTitleLine)?.slice(1).trim() ?? null;
    const site = SITES[(parseAttrlist(m[3])?.style ?? '').toLowerCase()];
    if (site) return { kind: 'video', title, site, id: m[2] };
    return /^[a-z][\w+.-]*:/i.test(m[2]) ? { kind: name, title, site: /^[a-z][\w+.-]*:\/\/([^/]+)/i.exec(m[2])?.[1] ?? 'the web', id: m[2] } : { kind: name, title, src: m[2] };
  },
  label: (kind) => LABELS[kind] ?? 'AsciiDoc',
  editTitle: (name) => `Edit ${name}:: block`,
  comment: (source) => source.replace(/^\/{4,}[ \t]*$/gm, '').replace(/^\/\/ ?/gm, '').trim(),
  form(kind, source) {
    if (kind === 'preprocessor' && !source.includes('\n')) return preprocessorForm(source);
    if (kind === 'header' || kind === 'attributes') return entriesForm(source, kind === 'header');
    if (kind === 'block-attributes') return blockAttributesForm(source);
    return null;
  },
  preview(kind, source, assetUrl) {
    if (kind === 'header' || kind === 'attributes') return entriesPreview(source, kind === 'header');
    if (kind === 'block-attributes') return blockAttributesPreview(source);
    // A condition: what it says, readably.
    if (kind === 'preprocessor') {
      const fragment = document.createDocumentFragment();
      for (const line of source.split('\n')) fragment.append(Object.assign(document.createElement('div'), { className: 'card-condition', textContent: describeLine(line) }));
      return fragment;
    }
    // Raw HTML shows as it looks.
    if (kind === 'passthrough') return safeHtml(source.replace(/^\+{4,}[ \t]*$/gm, ''), assetUrl);
    return RENDERED.has(kind) ? render(source, assetUrl) : null;
  },
};
