// Find (and replace) in the formatted view: every match highlighted, one of them the
// current one. Searches text the writer edits as text, within one paragraph (heading,
// list item, table cell…) at a time; blocks shown as cards are Markdown source,
// searched in the Markdown view instead.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface Match {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  current: number; // index into matches, -1 for none
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>('find');

// Where `query` appears in the document. Atoms (roles, pictures, inline HTML) end a
// run of text, so a match never spans one.
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const starts: number[] = []; // document position of each character in `text`
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) starts.push(pos + 1 + offset + i);
        text += child.text!;
      } else {
        starts.push(-1);
        text += '￼';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const from = starts[i];
      const last = starts[i + needle.length - 1];
      if (from >= 0 && last >= 0) out.push({ from, to: last + 1 });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode, query: string, caseSensitive: boolean, near: number | null): FindState {
  const matches = findMatches(doc, query, caseSensitive);
  // The current match: the first at or after `near` (where the cursor was), else the first.
  let current = -1;
  if (matches.length) {
    current = near === null ? 0 : matches.findIndex((m) => m.from >= near);
    if (current < 0) current = 0;
  }
  return { query, caseSensitive, matches, current, decorations: decorate(doc, matches, current) };
}

function decorate(doc: PMNode, matches: Match[], current: number) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-match find-current' : 'find-match' })),
  );
}

type Action = { query: string; caseSensitive: boolean } | { move: 1 | -1 } | { close: true };

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', caseSensitive: false, matches: [], current: -1, decorations: DecorationSet.empty }),
    apply(tr, prev, _old, state) {
      const action = tr.getMeta(findKey) as Action | undefined;
      if (action && 'close' in action) return { query: '', caseSensitive: prev.caseSensitive, matches: [], current: -1, decorations: DecorationSet.empty };
      if (action && 'query' in action) return build(state.doc, action.query, action.caseSensitive, state.selection.from);
      if (action && 'move' in action && prev.matches.length) {
        const current = (prev.current + action.move + prev.matches.length) % prev.matches.length;
        return { ...prev, current, decorations: decorate(state.doc, prev.matches, current) };
      }
      if (tr.docChanged && prev.query) {
        // Text changed (typing, or a replace): find again, keeping the place.
        const at = prev.matches[prev.current];
        return build(state.doc, prev.query, prev.caseSensitive, at ? tr.mapping.map(at.from) : null);
      }
      return prev;
    },
  },
  props: {
    decorations(state) {
      return findKey.getState(state)?.decorations;
    },
  },
});

export function search(state: EditorState, query: string, caseSensitive: boolean): Transaction {
  const tr = state.tr.setMeta(findKey, { query, caseSensitive });
  return withSelection(state, tr);
}

export function move(state: EditorState, step: 1 | -1): Transaction {
  return withSelection(state, state.tr.setMeta(findKey, { move: step }));
}

export function closeFind(state: EditorState): Transaction {
  return state.tr.setMeta(findKey, { close: true });
}

// The transaction, also selecting the match that will be current after it.
function withSelection(state: EditorState, tr: Transaction): Transaction {
  const next = findKey.getState(state.apply(tr));
  const m = next?.matches[next.current];
  return m ? tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView() : tr;
}

// Replace the current match, or all of them (from the end, so earlier positions hold).
export function replace(state: EditorState, replacement: string, all: boolean): Transaction | null {
  const s = findKey.getState(state);
  if (!s?.matches.length) return null;
  const targets = all ? [...s.matches].reverse() : [s.matches[s.current]];
  let tr = state.tr;
  for (const m of targets) tr = replacement ? tr.insertText(replacement, m.from, m.to) : tr.delete(m.from, m.to);
  return tr.scrollIntoView();
}
