// MyST's {image} directive, a picture of its own, and footnote definitions: edited
// as what they are, written back with only what changed.
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';
import { checkDoc } from '../src/core/checks.js';

const config = DEFAULT_CONFIG;
const load = (text: string) => loadDocument(text, config);

function edited(text: string, fn: (state: EditorState) => Transaction): string {
  const { doc, map } = load(text);
  const saved = saveDocument(fn(EditorState.create({ doc, schema })).doc, map, config);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

const find = (doc: PMNode, test: (n: PMNode) => boolean) => {
  let at = -1;
  doc.descendants((n, p) => {
    if (at < 0 && test(n)) at = p;
    return at < 0;
  });
  return at;
};

describe('an {image}', () => {
  const PAGE = '# Page\n\n```{image} images/a.png\n:alt: A thing\n:width: 200px\n```\n\nText.\n';

  it('is a picture: its file and options, nothing under it', () => {
    const image = load(PAGE).doc.child(1);
    expect(image.type.name).toBe('md_directive');
    expect(image.attrs).toMatchObject({ name: 'image', args: 'images/a.png', options: [['alt', 'A thing'], ['width', '200px']] });
    expect(image.childCount).toBe(0);
  });

  it('options changed: its lines, and only those', () => {
    const out = edited(PAGE, (s) => s.tr.setNodeMarkup(1 + s.doc.child(0).nodeSize - 1, null, { ...s.doc.child(1).attrs, options: [['alt', 'A thing'], ['width', '50%']] }));
    expect(out).toBe(PAGE.replace('200px', '50%'));
    const moved = edited(PAGE, (s) => s.tr.setNodeMarkup(s.doc.child(0).nodeSize, null, { ...s.doc.child(1).attrs, args: 'images/b.png' }));
    expect(moved).toBe(PAGE.replace('a.png', 'b.png'));
  });

  it('without a description: a check says so', () => {
    const { doc } = load('```{image} a.png\n```\n');
    expect(checkDoc(doc).map((p) => p.kind)).toContain('figure-alt');
  });

  it('with content (not a picture Sphinx reads): as written', () => {
    expect(load('```{image} a.png\nText.\n```\n').doc.firstChild!.type.name).toBe('opaque_directive');
  });
});

describe('a footnote', () => {
  const PAGE = 'A note[^1] and [^long].\n\n[^1]: The note.\n\n[^long]: A longer note,\n    on two lines.\n\n    With a second paragraph.\n\nAfter.\n';

  it('is its text, edited like the page’s', () => {
    const { doc } = load(PAGE);
    expect(doc.content.content.map((n) => n.type.name)).toEqual(['paragraph', 'footnote_def', 'footnote_def', 'paragraph']);
    expect(doc.child(2).attrs.label).toBe('long');
    expect(doc.child(2).childCount).toBe(2);
    const at = (s: EditorState, text: string) => {
      const p = find(s.doc, (n) => n.isText && n.text!.includes(text));
      return p + s.doc.nodeAt(p)!.text!.indexOf(text) + text.length;
    };
    expect(edited(PAGE, (s) => s.tr.insertText(' Yes.', at(s, 'second paragraph.')))).toBe(PAGE.replace('second paragraph.', 'second paragraph. Yes.'));
    expect(edited(PAGE, (s) => s.tr.insertText('!', at(s, 'The note.')))).toBe(PAGE.replace('The note.', 'The note.!'));
  });

  it('written anew: [^label]: and its lines indented as they were', () => {
    const text = 'See[^n].\n\n[^n]: First\n  under it.\n';
    const { doc } = load(text);
    expect(doc.child(1).attrs).toMatchObject({ label: 'n', indent: 2 });
    const node = schema.nodes.footnote_def.create({ label: '2' }, [schema.nodes.paragraph.create(null, schema.text('One.')), schema.nodes.paragraph.create(null, schema.text('Two.'))]);
    const fresh = saveDocument(schema.nodes.doc.create(null, [node]), load('').map, config).text;
    expect(fresh).toBe('[^2]: One.\n\n    Two.');
  });
});
