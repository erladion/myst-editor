import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import { loadDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG, type MystConfig } from '../src/core/project-config.js';
import { loadEditorConfig } from '../src/core/editor-config.js';
import { schema } from '../src/core/schema.js';
import { conditionsKey, conditionsPlugin, setConditionView } from '../src/renderer/src/editor/conditions.js';

const editor = loadEditorConfig([{ file: '.mysteditor.toml', text: '[conditions]\ncapabilities = "caps.json"\n', readCapabilities: () => '["CapabilityX", "CapabilityY"]' }]);
const config: MystConfig = { ...DEFAULT_CONFIG, editor };
const settings = editor.conditions!;

const SRC = `Everyone sees this.

<!-- if: CapabilityX -->
Only for X.

And more for X.
<!-- endif -->

The <!-- if-inline: CapabilityY -->fast<!-- endif-inline --> path.
`;

const shape = (set: DecorationSet | undefined) =>
  (set?.find() ?? []).map((d) => JSON.stringify([d.from, d.to, (d as unknown as { type: { attrs: unknown } }).type.attrs])).sort();

// Where `text` starts in the document (its first occurrence).
function at(state: EditorState, text: string): number {
  let found = -1;
  state.doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(text)) found = pos + n.text!.indexOf(text);
  });
  if (found < 0) throw new Error(`no “${text}”`);
  return found;
}

describe('the conditions plugin', () => {
  it('keeps what a full recompute gives, edit after edit', () => {
    let state = EditorState.create({ doc: loadDocument(SRC, config).doc, plugins: [conditionsPlugin] });
    state = state.apply(setConditionView(state.tr, settings, null));
    const edits: [string, (s: EditorState) => Transaction][] = [
      ['typing in a block inside a condition', (s) => s.tr.insertText('really ', at(s, 'Only'))],
      ['typing right after an inline start marker', (s) => s.tr.insertText('very ', at(s, 'fast'))],
      ['typing right before an inline end marker', (s) => s.tr.insertText('er', at(s, 'fast') + 4)],
      ['deleting text', (s) => s.tr.delete(at(s, 'more'), at(s, 'more') + 5)],
      ['making text bold', (s) => s.tr.addMark(at(s, 'Everyone'), at(s, 'Everyone') + 8, schema.marks.strong.create())],
      ['splitting a paragraph inside a condition', (s) => s.tr.split(at(s, 'for X.'))],
      ['deleting an inline marker', (s) => s.tr.delete(at(s, 'very') - 1, at(s, 'very'))],
    ];
    for (const [what, edit] of edits) {
      state = state.apply(edit(state));
      let fresh = EditorState.create({ doc: state.doc, plugins: [conditionsPlugin] });
      fresh = fresh.apply(setConditionView(fresh.tr, settings, null));
      expect(shape(conditionsKey.getState(state)?.decorations), what).toEqual(shape(conditionsKey.getState(fresh)?.decorations));
    }
  });
});
