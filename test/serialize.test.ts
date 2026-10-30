import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { schema } from '../src/core/schema.js';

const { nodes } = schema;
const item = (t: string) => nodes.list_item.create(null, nodes.paragraph.create(null, schema.text(t)));

describe('lists one after the other', () => {
  it('get different markers, so they stay apart', () => {
    // New lists (made in the editor), side by side.
    const { map } = loadDocument('');
    const doc = nodes.doc.create(null, [
      nodes.bullet_list.create(null, [item('a')]),
      nodes.bullet_list.create(null, [item('b')]),
      nodes.bullet_list.create(null, [item('c')]),
      nodes.ordered_list.create(null, [item('one')]),
      nodes.ordered_list.create(null, [item('two')]),
    ]);
    const saved = saveDocument(doc, map);
    expect(saved.text).toBe('- a\n\n* b\n\n- c\n\n1. one\n\n1) two');
    expect(saved.verified).toBe(true);
  });

  it('keep a written list as it was, but for its marker once it follows another', () => {
    const { doc, map } = loadDocument('- first\n\nText between.\n\n- second\n  more\n');
    // The paragraph between them deleted.
    const without = doc.copy(Fragment.from([doc.child(0), doc.child(2)]));
    const saved = saveDocument(without, map);
    expect(saved.text).toBe('- first\n\n* second\n  more\n');
    expect(saved.verified).toBe(true);
  });
});

describe('an image on a line of its own', () => {
  it('is a paragraph with the image in it, and is written back as it was', () => {
    const text = 'Before.\n\n(img-a)=\n![The settings dialog](images/settings.png "Its title")\n\nAfter.\n';
    const { doc, map } = loadDocument(text);
    expect(doc.child(2).type.name).toBe('paragraph');
    expect(doc.child(2).firstChild?.type.name).toBe('image');
    expect(saveDocument(doc, map)).toEqual({ text, verified: true });
  });

  it('can be saved when made in the editor', () => {
    const { map } = loadDocument('');
    const doc = nodes.doc.create(null, [nodes.paragraph.create(null, nodes.image.create({ src: 'images/x.png', alt: 'An image' }))]);
    expect(saveDocument(doc, map)).toEqual({ text: '![An image](images/x.png)', verified: true });
  });
});

describe('line breaks in an edited paragraph', () => {
  // The paragraph's first text with a word added at its end.
  const edited = (text: string, at = 0) => {
    const { doc, map } = loadDocument(text);
    const para = doc.child(at);
    const changed = para.copy(para.content.append(Fragment.from(schema.text(' more'))));
    return saveDocument(doc.replace(doc.resolve(0).posAtIndex(at), doc.resolve(0).posAtIndex(at + 1), new Slice(Fragment.from(changed), 0, 0)), map);
  };

  it('keep the two spaces they were written with', () => {
    expect(edited('One  \ntwo  \nthree\n')).toEqual({ text: 'One  \ntwo  \nthree more\n', verified: true });
  });

  it('keep a backslash', () => {
    expect(edited('One\\\ntwo\n')).toEqual({ text: 'One\\\ntwo more\n', verified: true });
  });

  it('new in a paragraph without any: like the page writes them', () => {
    const { doc, map } = loadDocument('First  \nline.\n\nSecond.\n');
    const para = nodes.paragraph.create(null, [schema.text('a'), nodes.hard_break.create(), schema.text('b')]);
    const next = doc.replace(doc.child(0).nodeSize, doc.content.size, new Slice(Fragment.from(para), 0, 0));
    expect(saveDocument(next, map)).toEqual({ text: 'First  \nline.\n\na  \nb\n', verified: true });
  });
});

describe('definition lists', () => {
  const text = 'Term one\n: The *first* term.\n\nTerm two\n: Second.\n: Another meaning.\n';

  it('are read as terms and descriptions, and written back as they were', () => {
    const { doc, map } = loadDocument(text);
    const list = doc.firstChild!;
    expect(list.type.name).toBe('definition_list');
    expect(list.childCount).toBe(2);
    expect(list.child(1).childCount).toBe(3); // a term, two descriptions
    expect(saveDocument(doc, map)).toEqual({ text, verified: true });
  });

  it('edited, are written as definition lists', () => {
    const { doc, map } = loadDocument(text);
    let at = 0;
    doc.descendants((n, pos) => {
      if (!at && n.type.name === 'definition_term') at = pos + n.nodeSize - 1;
    });
    const next = doc.replace(at, at, new Slice(Fragment.from(schema.text(' (edited)')), 0, 0));
    expect(saveDocument(next, map)).toEqual({ text: 'Term one (edited)\n: The *first* term.\n\nTerm two\n: Second.\n: Another meaning.\n', verified: true });
  });

  it('made in the editor (pasted, say), are written so', () => {
    const { map } = loadDocument('');
    const item = nodes.definition_item.create(null, [nodes.definition_term.create(null, schema.text('API')), nodes.definition_desc.create(null, nodes.paragraph.create(null, schema.text('How programs talk.')))]);
    expect(saveDocument(nodes.doc.create(null, nodes.definition_list.create(null, item)), map)).toEqual({ text: 'API\n: How programs talk.', verified: true });
  });

  it('with descriptions of several blocks: blocks, edited like a list item’s', () => {
    const loose = 'Term\n\n: First paragraph.\n\n  - one\n  - two\n\n  ```py\n  x = 1\n  ```\n\nOther\n  ~ Plain.\n';
    const { doc, map } = loadDocument(loose);
    const list = doc.firstChild!;
    expect(list.type.name).toBe('definition_list');
    const desc = list.child(0).child(1);
    expect(desc.attrs).toMatchObject({ marker: null, loose: true });
    expect([0, 1, 2].map((i) => desc.child(i).type.name)).toEqual(['paragraph', 'bullet_list', 'code_block']);
    expect(list.child(1).child(1).attrs).toMatchObject({ marker: '  ~ ', loose: false });
    expect(saveDocument(doc, map).text).toBe(loose);
    // Typing in one of its blocks: that line, the rest as it was.
    let pos = -1;
    doc.descendants((n, p) => void (n.isText && n.text === 'two' && (pos = p)));
    const edited = doc.replace(pos + 3, pos + 3, new Slice(Fragment.from(schema.text('!')), 0, 0));
    expect(saveDocument(edited, map)).toEqual({ text: loose.replace('- two', '- two!'), verified: true });
    const plain = doc.replace(doc.content.size - 5, doc.content.size - 5, new Slice(Fragment.from(schema.text('!')), 0, 0));
    expect(saveDocument(plain, map).text).toBe(loose.replace('Plain.', 'Plain!.'));
  });

  it('with lines that aren’t its parts’ (lazy ones): kept as written', () => {
    expect(loadDocument('Term\n: First.\n\n  - one\nlazy\n').doc.firstChild!.type.name).toBe('raw_block');
  });
});
