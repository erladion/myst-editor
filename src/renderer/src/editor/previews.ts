// Sphinx-rendered previews for cards (custom directives, tables, ...): which part of
// the built page each card corresponds to.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseSaved } from '../../../core/document';
import { positionOfPath } from '../../../core/lines';
import type { MystConfig } from '../../../core/project-config';

export const previewsKey = new PluginKey<DecorationSet>('previews');

export const previewsPlugin = new Plugin<DecorationSet>({
  key: previewsKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => tr.getMeta(previewsKey) ?? set.map(tr.mapping, tr.doc),
  },
  props: { decorations: (state) => previewsKey.getState(state) },
});

// Raw blocks worth previewing: not front matter, comments, cell breaks or markers.
const PREVIEWED_RAW = /^(table|definitionList|footnote|html|orphan|unknown)$/;

export interface PreviewBuild {
  url: (from: number, to: number) => string; // preview page for saved-file lines [from, to]
}

// Decorations carrying each card's preview URL (in the decoration's spec), located
// through the saved text like warnings are (see problems.ts).
export function locatePreviews(doc: PMNode, savedText: string, config: MystConfig, build: PreviewBuild | null): DecorationSet {
  if (!build) return DecorationSet.empty;
  const saved = parseSaved(savedText, config);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const card = node.type.name === 'opaque_directive' || (node.type.name === 'raw_block' && PREVIEWED_RAW.test(node.attrs.kind));
    if (!card) return !node.isTextblock;
    const $pos = doc.resolve(pos);
    const path = Array.from({ length: $pos.depth + 1 }, (_, d) => $pos.index(d));
    const there = positionOfPath(saved.doc, path)?.node;
    const entry = there && there.type === node.type ? saved.map.get(there.attrs.sid) : undefined;
    if (entry) {
      const to = entry.line + entry.text.split('\n').length - 1;
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { previewUrl: build.url(entry.line, to) }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export function setPreviews(tr: Transaction, set: DecorationSet): Transaction {
  return tr.setMeta(previewsKey, set).setMeta('addToHistory', false);
}
