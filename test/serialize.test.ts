import { describe, expect, it } from 'vitest';
import { Fragment } from 'prosemirror-model';
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
