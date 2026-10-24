// Sphinx warnings shown on the blocks they refer to.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseSaved } from '../../../core/document';
import { blockPathAtLine, positionOfPath } from '../../../core/lines';
import type { MystConfig } from '../../../core/project-config';
import type { SphinxWarning } from '../../../shared/sphinx';

export const problemsKey = new PluginKey<DecorationSet>('problems');

export const problemsPlugin = new Plugin<DecorationSet>({
  key: problemsKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => tr.getMeta(problemsKey) ?? set.map(tr.mapping, tr.doc),
  },
  props: {
    decorations: (state) => problemsKey.getState(state),
  },
});

// Where in `doc` each warning belongs. Warning lines refer to the file as last
// saved, which may differ from what was loaded, so the saved text is parsed and the
// block found there is located in `doc` by its position in the tree. Edits made since
// the save can shift things slightly; the next build corrects it.
export function locateProblems(doc: PMNode, savedText: string, config: MystConfig, warnings: SphinxWarning[]) {
  if (!warnings.length) return [];
  const saved = parseSaved(savedText, config);
  const located: { pos: number; node: PMNode; warnings: SphinxWarning[] }[] = [];
  for (const w of warnings) {
    const path = w.line ? blockPathAtLine(saved.doc, saved.map, w.line) : null;
    const hit = path && positionOfPath(doc, path);
    if (!hit) continue;
    const existing = located.find((l) => l.pos === hit.pos);
    if (existing) existing.warnings.push(w);
    else located.push({ ...hit, warnings: [w] });
  }
  return located;
}

export function setProblems(tr: Transaction, located: ReturnType<typeof locateProblems>): Transaction {
  const decorations = located.map(({ pos, node, warnings }) =>
    Decoration.node(pos, pos + node.nodeSize, {
      class: `has-problem${warnings.some((w) => w.level !== 'warning') ? ' is-error' : ''}`,
      title: warnings.map((w) => w.message).join('\n'),
    }),
  );
  return tr.setMeta(problemsKey, DecorationSet.create(tr.doc, decorations)).setMeta('addToHistory', false);
}
