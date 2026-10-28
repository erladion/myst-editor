// The editor's side of AsciiDoc (see formats/editing.ts).
import type { EditingFormat } from '../editing';
import { splitRoleValue } from '../myst/directives';
import { ADMONITIONS, CALLOUT_CHOICES, blockInfo } from './blocks';
import { asciidocCards } from './cards';
import { asciidocInserts } from './inserts';
import { renameAsciidocReferences } from './rename';
import { asciidocSource } from './source';

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
  },
};
