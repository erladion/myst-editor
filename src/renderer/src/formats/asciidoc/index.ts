// The editor's side of AsciiDoc (see formats/editing.ts).
import type { EditingFormat, Images } from '../editing';
import { dirname, join } from '../../paths';
import { relativePath } from '../../../../core/rename';
import type { PageConfig } from '../../../../core/format';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { splitRoleValue } from '../myst/directives';
import { ADMONITIONS, CALLOUT_CHOICES, blockInfo } from './blocks';
import { asciidocCards } from './cards';
import { asciidocInserts } from './inserts';
import { renameAsciidocReferences } from './rename';
import { asciidocSource } from './source';

// Asciidoctor's own attributes for characters, as they show.
const BUILT_IN: Record<string, string> = {
  empty: '', blank: '', sp: ' ', nbsp: '\u00a0', zwsp: '\u200b', wj: '\u2060', apos: '\'', quot: '"', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  deg: '°', plus: '+', brvbar: '¦', vbar: '|', amp: '&', lt: '<', gt: '>', startsb: '[', endsb: ']', caret: '^', asterisk: '*', tilde: '~', backslash: '\\', backtick: '`',
  'two-colons': '::', 'two-semicolons': ';;', cpp: 'C++', pp: '++',
};

// An attribute reference: its value, from the main document's header (or Asciidoctor's own).
function attributeShown(name: string, config: PageConfig) {
  const own = config.format === 'asciidoc' ? (config as AsciidocConfig).attributes[name] : undefined;
  if (own !== undefined) return { text: own || `{${name}}`, title: `{${name}}: set in the main document${own ? '' : ', to nothing'}` };
  if (name in BUILT_IN) return { text: BUILT_IN[name], title: `{${name}}` };
  return { text: `{${name}}`, title: `{${name}} isn’t set in the main document’s header`, missing: true };
}

// Where pictures are found from: in a book, the main document's folder; and :imagesdir:.
function imagesRoot(config: PageConfig, page: string): string | null {
  const c = config as AsciidocConfig;
  const imagesdir = c.attributes?.imagesdir ?? '';
  if (/^([a-z][\w+.-]*:|\/)/i.test(imagesdir)) return null;
  return join(c.base ?? dirname(page), imagesdir);
}

const ABSOLUTE = /^([a-z][\w+.-]*:|\/)/i;

// An image's width: its first positional attribute after the description, or width=.
function entries(extra: string | null): { positional: string[]; named: string[] } {
  const all = (extra ?? '').split(',').map((e) => e.trim());
  if (all.length === 1 && !all[0]) return { positional: [], named: [] };
  return { positional: all.filter((e) => !e.includes('=')), named: all.filter((e) => e.includes('=')) };
}

const images: Images = {
  fromPage(ref, config, page) {
    const root = imagesRoot(config, page);
    if (ABSOLUTE.test(ref) || root === null) return ref;
    const target = join(root, ref);
    return target === null ? ref : relativePath(dirname(page), target);
  },
  toRef(path, config, page) {
    const root = imagesRoot(config, page);
    const target = join(dirname(page), path);
    return root === null || target === null ? path : relativePath(root, target);
  },
  width(attrs) {
    const { positional, named } = entries(attrs.extra as string | null);
    return named.find((n) => /^width\s*=/.test(n))?.replace(/^width\s*=\s*/, '') || positional[0] || null;
  },
  withWidth(attrs, width) {
    const { positional, named } = entries(attrs.extra as string | null);
    const rest = named.filter((n) => !/^width\s*=/.test(n));
    const pos = [width ?? '', ...positional.slice(1)];
    while (pos.length && !pos[pos.length - 1]) pos.pop();
    const extra = [...pos, ...rest].join(',');
    return { ...attrs, extra: extra || null };
  },
};

// The page a cross-reference's target is on: page.adoc#anchor → page.adoc.
const pageOf = (target: string) => (/\.adoc(#|$)/.test(target) ? target.replace(/#.*$/, '') : null);

export const asciidocEditing: EditingFormat = {
  inserts: asciidocInserts,
  renameReferences: renameAsciidocReferences,
  callouts: {
    names: CALLOUT_CHOICES,
    is: (name) => !!ADMONITIONS[name],
    label: (name) => ADMONITIONS[name]?.label ?? name,
    change: (_from, to) => ({ name: to }),
  },
  block: (name) => blockInfo(name),
  dialect: () => ({ label: 'AsciiDoc', detail: 'Read as Asciidoctor reads AsciiDoc' }),
  source: asciidocSource,
  images,
  nameOption: 'id',
  cards: asciidocCards,
  roles: {
    references: { ref: 'Anchor', xref: 'Cross-reference' },
    split: splitRoleValue,
    page: (name, target) => (name === 'xref' || name === 'ref' ? pageOf(target) : null),
    shown: (name, value, config) => (name === 'attribute' ? attributeShown(value, config) : null),
  },
};
