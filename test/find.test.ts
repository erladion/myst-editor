import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { findKey, findMatches, findPlugin, move, replace, search } from '../src/renderer/src/editor/find.js';

const text = '# Widget docs\n\nA **widget** is a small Widget.\n\n:::{note}\nWidgets nest.\n:::\n\n{doc}`widget` is a role, not text.\n';

function load() {
  const { doc, map } = loadDocument(text, DEFAULT_CONFIG);
  return { state: EditorState.create({ doc, plugins: [findPlugin] }), map };
}

describe('find', () => {
  it('finds text across formatting, in nested blocks, ignoring case unless asked', () => {
    const { state } = load();
    const words = (q: string, cs = false) => findMatches(state.doc, q, cs).map((m) => state.doc.textBetween(m.from, m.to));
    expect(words('widget')).toEqual(['Widget', 'widget', 'Widget', 'Widget']); // heading, bold, text, note; not the role
    expect(words('Widget', true)).toEqual(['Widget', 'Widget', 'Widget']);
    expect(words('small widget')).toEqual(['small Widget']);
    expect(words('')).toEqual([]);
  });

  it('moves between matches, selecting each, and replaces one or all', () => {
    let { state, map } = load();
    state = state.apply(search(state, 'widget', false));
    expect(findKey.getState(state)!.current).toBe(0);
    state = state.apply(move(state, 1));
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe('widget');
    state = state.apply(replace(state, 'gadget', false)!);
    expect(findKey.getState(state)!.matches).toHaveLength(3); // found again after the change
    state = state.apply(replace(state, 'Gizmo', true)!);
    expect(saveDocument(state.doc, map, DEFAULT_CONFIG).text).toBe('# Gizmo docs\n\nA **gadget** is a small Gizmo.\n\n:::{note}\nGizmos nest.\n:::\n\n{doc}`widget` is a role, not text.\n');
  });
});
