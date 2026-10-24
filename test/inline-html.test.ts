import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import { loadDocument } from '../src/core/document.js';
import { schema } from '../src/core/schema.js';
import { inlineHtmlPlugin } from '../src/renderer/src/editor/html.js';

const SRC = [
  'One <b>bold</b> and <i>slanted</i> words.',
  'A line<br>and another<br>',
  '<ul><li>first</li><li>second</li></ul>',
  'Plain paragraph without tags.',
  'Ends <span>in</span> <a href="x">a link</a>.',
].join('\n\n') + '\n';

// The decorations as comparable values.
const shape = (set: DecorationSet | undefined) =>
  (set?.find() ?? []).map((d) => JSON.stringify([d.from, d.to, (d as unknown as { type: { attrs: unknown } }).type.attrs, d.spec])).sort();

describe('inline HTML decorations', () => {
  it('stay what a full recompute gives, edit after edit', () => {
    const plugin = inlineHtmlPlugin();
    let state = EditorState.create({ doc: loadDocument(SRC).doc, plugins: [plugin] });
    const edits: ((s: EditorState) => Transaction)[] = [
      (s) => s.tr.insertText('x', 3), // inside a paragraph with tags
      (s) => s.tr.insertText('more ', s.doc.content.size - 3), // in the last one
      (s) => s.tr.delete(5, 9), // across a tag
      (s) => s.tr.insert(2, schema.nodes.html_inline.create({ value: '<b>' })), // a new tag
      (s) => s.tr.split(6), // a paragraph split in two
      (s) => s.tr.setSelection(TextSelection.create(s.doc, 1)).deleteRange(1, Math.min(40, s.doc.content.size - 1)), // across paragraphs
      (s) => {
        // Two paragraphs joined: the first pair there is.
        let at = 0;
        for (let i = 0; i + 1 < s.doc.childCount; i++) {
          if (s.doc.child(i).type === schema.nodes.paragraph && s.doc.child(i + 1).type === schema.nodes.paragraph) return s.tr.join(at + s.doc.child(i).nodeSize);
          at += s.doc.child(i).nodeSize;
        }
        throw new Error('no two paragraphs in a row');
      },
    ];
    for (const [i, edit] of edits.entries()) {
      try {
        state = state.apply(edit(state));
      } catch (e) {
        throw new Error(`edit ${i}: ${e}`);
      }
      const fresh = EditorState.create({ doc: state.doc, plugins: [inlineHtmlPlugin()] });
      expect(shape(plugin.getState(state))).toEqual(shape(fresh.plugins[0].getState(fresh)));
    }
  });
});
