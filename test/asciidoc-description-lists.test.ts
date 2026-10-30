// AsciiDoc description lists whose description is a list under its term.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { ASCIIDOC_CONFIG } from '../src/core/asciidoc/config.js';
import { schema } from '../src/core/schema.js';

const load = (text: string) => loadDocument(text, ASCIIDOC_CONFIG);

function typedAfter(text: string, word: string, typed: string): string {
  const { doc, map } = load(text);
  let at = -1;
  doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(word)) at = pos + n.text!.indexOf(word) + word.length;
    return at < 0;
  });
  const tr = EditorState.create({ doc, schema }).tr.insertText(typed, at);
  const saved = saveDocument(tr.doc, map, ASCIIDOC_CONFIG);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

describe('a description that is a list under its term', () => {
  const page = 'Dairy::\n* Milk\n* Eggs\nBakery::\n  * Bread\n\nProduce::\n* Bananas\n';
  it('is the item’s description, written as it was', () => {
    const { doc, map } = load(page);
    const list = doc.firstChild!;
    expect(list.type.name).toBe('definition_list');
    expect(list.childCount).toBe(3);
    const desc = list.child(0).lastChild!;
    expect(desc.type.name).toBe('definition_desc');
    expect(desc.firstChild!.type.name).toBe('bullet_list');
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG).text).toBe(page);
  });

  it('edited, under its term still, without a +', () => {
    expect(typedAfter(page, 'Eggs', ' and cheese')).toBe(page.replace('* Eggs', '* Eggs and cheese'));
    expect(typedAfter(page, 'Dairy', ' and more')).toBe(page.replace('Dairy::', 'Dairy and more::'));
    // (An indented list's edited item: its line, without the indentation.)
    expect(typedAfter(page, 'Bread', '!')).toBe(page.replace('  * Bread', '* Bread!'));
  });

  it('with a + before it, written with it', () => {
    const plus = 'Fixed::\n+\n* one\n* two\n';
    expect(typedAfter(plus, 'Fixed', ' things')).toBe(plus.replace('Fixed::', 'Fixed things::'));
  });

  it('with a block attached to the list: as written', () => {
    expect(load('Term::\n* one\n+\n----\ncode\n----\n').doc.firstChild!.type.name).toBe('raw_block');
  });
});
