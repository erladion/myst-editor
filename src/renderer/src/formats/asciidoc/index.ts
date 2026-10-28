// The editor's side of AsciiDoc (see formats/editing.ts).
import type { EditingFormat } from '../editing';
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
  cards: asciidocCards,
  roles: {
    references: { ref: 'Anchor', xref: 'Cross-reference' },
    split: splitRoleValue,
    page: (name, target) => (name === 'xref' || name === 'ref' ? pageOf(target) : null),
    shown: (name, value, config) => (name === 'attribute' ? attributeShown(value, config) : null),
  },
};
