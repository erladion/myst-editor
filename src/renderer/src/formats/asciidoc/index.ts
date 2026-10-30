// The editor's side of AsciiDoc (see formats/editing.ts).
import type { EditingFormat, Images } from '../editing';
import { dirname, join } from '../../paths';
import { relativePath } from '../../../../core/rename';
import type { PageConfig } from '../../../../core/format';
import type { Node as PMNode } from 'prosemirror-model';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { attributeValue, resolveResource, resourceIdFor } from '../../../../core/asciidoc/antora';
import { fromComponent, inComponent } from '../../builders/antora/references';
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

// The attributes set where `pos` is on the page: the main document's header's, then
// the page's own (its header, and entries above it), in order; :name!: unsets one.
function attributesAt(config: PageConfig, doc: PMNode, pos: number): Map<string, { value: string | null; here: boolean }> {
  const out = new Map<string, { value: string | null; here: boolean }>();
  for (const [k, v] of Object.entries(config.format === 'asciidoc' ? (config as AsciidocConfig).attributes : {})) out.set(k, { value: attributeValue(v), here: false });
  doc.descendants((node, at) => {
    if (at >= pos) return false;
    if (node.type.name !== 'raw_block' || !['attributes', 'header'].includes(node.attrs.kind)) return true;
    for (const line of (node.attrs.source as string).split('\n')) {
      const m = /^:(!?)([\w][\w-]*)(!?):(?:[ \t]+(.*))?$/.exec(line);
      if (m) out.set(m[2], { value: m[1] || m[3] ? null : (m[4] ?? '').trim(), here: true });
    }
    return false;
  });
  return out;
}

// An attribute reference: its value where it is (or Asciidoctor's own).
function attributeShown(name: string, config: PageConfig, where: { doc: PMNode; pos: number }) {
  const set = attributesAt(config, where.doc, where.pos).get(name);
  const own = set?.value ?? undefined;
  const antora = config.format === 'asciidoc' && !!(config as AsciidocConfig).antora;
  const from = set?.here ? 'on this page' : antora ? 'in antora.yml' : 'in the main document';
  if (set && set.value === null) return { text: `{${name}}`, title: `{${name}} is unset ${from}`, missing: true };
  if (own !== undefined) return { text: own || `{${name}}`, title: `{${name}}: set ${from}${own ? '' : ', to nothing'}` };
  if (name in BUILT_IN) return { text: BUILT_IN[name], title: `{${name}}` };
  return { text: `{${name}}`, title: antora ? `{${name}} isn’t set on this page or in antora.yml` : `{${name}} isn’t set in the main document’s header`, missing: true };
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

// In an Antora component: the module's images, by resource ID (logo.png, admin:logo.png).
const antoraImages = {
  fromPage(ref: string, config: AsciidocConfig, page: string): string {
    const antora = config.antora!;
    const found = resolveResource(antora, inComponent(antora, page), ref, 'image');
    return found ? relativePath(dirname(page), fromComponent(antora, found.file)) : ref;
  },
  toRef(path: string, config: AsciidocConfig, page: string): string {
    const antora = config.antora!;
    const target = join(dirname(page), path);
    return (target !== null && resourceIdFor(inComponent(antora, page), inComponent(antora, target), 'image')) || path;
  },
};

const images: Images = {
  fromPage(ref, config, page) {
    if ((config as AsciidocConfig).antora) return antoraImages.fromPage(ref, config as AsciidocConfig, page);
    const root = imagesRoot(config, page);
    if (ABSOLUTE.test(ref) || root === null) return ref;
    const target = join(root, ref);
    return target === null ? ref : relativePath(dirname(page), target);
  },
  toRef(path, config, page) {
    if ((config as AsciidocConfig).antora) return antoraImages.toRef(path, config as AsciidocConfig, page);
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
  cells: 'blocks',
  cards: asciidocCards,
  roles: {
    references: { ref: 'Anchor', xref: 'Cross-reference' },
    split: splitRoleValue,
    page: (name, target, from) => {
      if (name !== 'xref' && name !== 'ref') return null;
      // In an Antora component: by resource ID, from the project's folder.
      const antora = from?.config.format === 'asciidoc' ? (from.config as AsciidocConfig).antora : null;
      if (antora && from?.page) {
        const found = resolveResource(antora, inComponent(antora, from.page), target, 'page');
        return found ? `/${found.file}` : null;
      }
      return pageOf(target);
    },
    shown: (name, value, config, where) => (name === 'attribute' ? attributeShown(value, config, where) : null),
  },
};
