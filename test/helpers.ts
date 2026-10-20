import type { Node as PMNode } from 'prosemirror-model';

// Document JSON without the bookkeeping attributes that legitimately differ
// between a parse of the original and a parse of freshly serialized text.
const BOOKKEEPING = new Set(['sid', 'header', 'headerKey']);

export function normalized(doc: PMNode): unknown {
  return JSON.parse(
    JSON.stringify(doc.toJSON(), (key, value) => (BOOKKEEPING.has(key) ? undefined : value)),
  );
}
