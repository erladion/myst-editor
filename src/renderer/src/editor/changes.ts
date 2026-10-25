// Changes since the last commit, marked in the page (see core/changes.ts): added text
// green, removed text struck through where it was, new and changed blocks with a bar.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { diffDocs, type Change } from '../../../core/changes';

interface State {
  base: PMNode | null; // the page as committed; null: not shown
  changes: Change[];
  decorations: DecorationSet;
}

export const changesKey = new PluginKey<State>('changes');

function removed(text: string, block: boolean): HTMLElement {
  const el = document.createElement(block ? 'div' : 'span');
  el.className = block ? 'chg-del-block' : 'chg-del';
  el.textContent = text;
  el.title = 'Removed since the last commit';
  el.setAttribute('aria-label', `Removed: ${text}`);
  return el;
}

function build(state: EditorState, base: PMNode | null): State {
  if (!base) return { base, changes: [], decorations: DecorationSet.empty };
  const changes = diffDocs(base, state.doc);
  const decorations = changes.flatMap((c): Decoration[] => {
    switch (c.kind) {
      case 'added-block':
        return [Decoration.node(c.from, c.to, { class: 'chg-added', title: 'New since the last commit' })];
      case 'changed-block':
        return [Decoration.node(c.from, c.to, { class: 'chg-changed', title: 'Changed since the last commit' })];
      case 'added-text':
        return [Decoration.inline(c.from, c.to, { class: 'chg-ins' })];
      case 'removed-text':
        return [Decoration.widget(c.at, () => removed(c.text, false), { side: -1, marks: [], key: `del:${c.at}:${c.text}` })];
      case 'removed-block':
        // Not between a table's rows, where only rows can go.
        return c.inTable || !c.text.trim() ? [] : [Decoration.widget(c.at, () => removed(c.text, true), { side: -1, key: `delblock:${c.at}:${c.text}` })];
    }
  });
  return { base, changes, decorations: DecorationSet.create(state.doc, decorations) };
}

export const changesPlugin = new Plugin<State>({
  key: changesKey,
  state: {
    init: () => ({ base: null, changes: [], decorations: DecorationSet.empty }),
    apply(tr, old, _before, state) {
      const meta = tr.getMeta(changesKey) as { base: PMNode | null } | undefined;
      if (meta) return build(state, meta.base);
      return tr.docChanged && old.base ? build(state, old.base) : old;
    },
  },
  props: {
    decorations: (state) => changesKey.getState(state)?.decorations,
  },
});

// Shows the changes since `base` (the page as committed), or stops showing them (null).
export const setChangesBase = (tr: Transaction, base: PMNode | null) => tr.setMeta(changesKey, { base }).setMeta('addToHistory', false);

export const changesOf = (state: EditorState): Change[] => changesKey.getState(state)?.changes ?? [];
