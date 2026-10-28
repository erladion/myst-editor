// Edits to AsciiDoc pages the way the editor makes them: each saves what changed, in
// the page's style, and reads back as edited.
import { describe, expect, it } from 'vitest';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { addColumnAfter, addRowAfter, CellSelection, mergeCells } from 'prosemirror-tables';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { ASCIIDOC_CONFIG } from '../src/core/asciidoc/config.js';
import { schema } from '../src/core/schema.js';
import * as conditions from '../src/core/conditions.js';

const { nodes } = schema;
const load = (text: string) => loadDocument(text, ASCIIDOC_CONFIG);

// `text` edited by `fn`; what's saved, checked to read back as edited.
function edited(text: string, fn: (state: EditorState) => Transaction | PMNode): string {
  const { doc, map } = load(text);
  const state = EditorState.create({ doc, schema });
  const out = fn(state);
  const next = 'steps' in out ? out.doc : out;
  const saved = saveDocument(next, map, ASCIIDOC_CONFIG);
  expect(saved.problem).toBeUndefined();
  expect(saved.verified).toBe(true);
  return saved.text;
}

// The position of the first node of `type` (and where its content starts).
function find(doc: PMNode, test: (n: PMNode) => boolean): number {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at < 0 && test(n)) at = pos;
    return at < 0;
  });
  return at;
}

describe('callouts', () => {
  it('change type, written as they were', () => {
    const text = 'Before.\n\nNOTE: Check this.\n\n[TIP]\n====\nA tip.\n====\n';
    const out = edited(text, (s) => {
      const note = find(s.doc, (n) => n.attrs.name === 'note');
      const tip = find(s.doc, (n) => n.attrs.name === 'tip');
      return s.tr.setNodeMarkup(note, null, { ...s.doc.nodeAt(note)!.attrs, name: 'warning' }).setNodeMarkup(tip, null, { ...s.doc.nodeAt(tip)!.attrs, name: 'caution' });
    });
    expect(out).toBe('Before.\n\nWARNING: Check this.\n\n[CAUTION]\n====\nA tip.\n====\n');
  });

  it('get delimiters once a note written as a paragraph has more than one', () => {
    const out = edited('NOTE: First.\n', (s) => {
      const note = s.doc.firstChild!;
      return s.tr.insert(note.nodeSize - 1, nodes.paragraph.create(null, schema.text('Second.')));
    });
    expect(out).toBe('[NOTE]\n====\nFirst.\n\nSecond.\n====\n');
  });

  it('keep their title', () => {
    const out = edited('.Careful\nWARNING: Hot.\n', (s) => s.tr.insertText(' Very.', s.doc.firstChild!.nodeSize - 2));
    expect(out).toBe('.Careful\nWARNING: Hot. Very.\n');
  });
});

describe('lists', () => {
  it('get items like their others', () => {
    const out = edited('* one\n* two\n** two a\n\nAfter.\n', (s) => {
      const list = s.doc.firstChild!;
      const item = nodes.list_item.create(null, nodes.paragraph.create(null, schema.text('three')));
      return s.tr.insert(list.nodeSize - 1, item);
    });
    expect(out).toBe('* one\n* two\n** two a\n* three\n\nAfter.\n');
  });

  it('nested in another list: with markers its ancestors don’t use', () => {
    const doc = nodes.doc.create(null, [
      nodes.bullet_list.create(null, [nodes.list_item.create(null, [nodes.paragraph.create(null, schema.text('a')), nodes.bullet_list.create(null, [nodes.list_item.create(null, nodes.paragraph.create(null, schema.text('b')))])])]),
    ]);
    expect(edited('', () => doc)).toBe('* a\n** b');
  });

  it('attach other blocks with +', () => {
    const out = edited('* one\n* two\n', (s) => {
      const second = find(s.doc, (n) => n.type === nodes.list_item && n.textContent === 'two');
      const item = s.doc.nodeAt(second)!;
      return s.tr.insert(second + item.nodeSize - 1, nodes.code_block.create({ name: 'source', lang: 'sh', fence: '----' }, schema.text('ls')));
    });
    expect(out).toBe('* one\n* two\n+\n[source,sh]\n----\nls\n----\n');
  });
});

describe('tables', () => {
  const TABLE = '[cols="1,2"]\n|===\n| Name | Value\n\n| a | 1\n| b | 2\n|===\n';
  const cell = (s: EditorState, text: string) => find(s.doc, (n) => (n.type === nodes.table_cell || n.type === nodes.table_header) && n.textContent === text);

  it('written as they were but for the cell typed in', () => {
    const out = edited(TABLE, (s) => s.tr.insertText('!', cell(s, '1') + s.doc.nodeAt(cell(s, '1'))!.nodeSize - 2));
    expect(out).toBe('[cols="1,2"]\n|===\n| Name | Value\n\n| a | 1!\n| b | 2\n|===\n');
  });

  it('get rows, and columns (their widths too)', () => {
    let out = edited(TABLE, (s) => {
      const state = s.apply(s.tr.setSelection(CellSelection.create(s.doc, cell(s, 'b'))));
      let tr: Transaction | null = null;
      addRowAfter(state, (t) => (tr = t));
      return tr!;
    });
    expect(out).toBe('[cols="1,2"]\n|===\n| Name | Value\n\n| a | 1\n| b | 2\n| |\n|===\n');
    out = edited(TABLE, (s) => {
      const state = s.apply(s.tr.setSelection(CellSelection.create(s.doc, cell(s, 'Value'))));
      let tr: Transaction | null = null;
      addColumnAfter(state, (t) => (tr = t));
      return tr!;
    });
    expect(out).toBe('[cols="1,2,1"]\n|===\n| Name | Value |\n\n| a | 1 |\n| b | 2 |\n|===\n');
  });

  it('merge cells', () => {
    const out = edited(TABLE, (s) => {
      const state = s.apply(s.tr.setSelection(CellSelection.create(s.doc, cell(s, 'a'), cell(s, '1'))));
      let tr: Transaction | null = null;
      mergeCells(state, (t) => (tr = t));
      return tr!;
    });
    expect(out).toBe('[cols="1,2"]\n|===\n| Name | Value\n\n2+| a 1\n| b | 2\n|===\n');
  });

  it('made in the editor: a header row, cells on a line', () => {
    const row = (type: typeof nodes.table_cell, a: string, b: string) => nodes.table_row.create(null, [a, b].map((t) => type.create(null, nodes.paragraph.create(null, t ? schema.text(t) : undefined))));
    const doc = nodes.doc.create(null, [nodes.table.create(null, [row(nodes.table_header, 'A', 'B'), row(nodes.table_cell, '1', '2')])]);
    expect(edited('', () => doc)).toBe('|===\n| A | B\n\n| 1 | 2\n|===');
  });
});

describe('new blocks', () => {
  it('are written in AsciiDoc', () => {
    const doc = nodes.doc.create(null, [
      nodes.heading.create({ level: 2 }, schema.text('Title')),
      nodes.md_directive.create({ name: 'note', fence: '' }, nodes.paragraph.create(null, schema.text('A note.'))),
      nodes.code_block.create({ name: 'source', lang: 'python', fence: '----' }, schema.text('print(1)')),
      nodes.math_block.create({ directive: true, name: 'latexmath', fence: '++++' }, schema.text('x^2')),
      nodes.md_directive.create({ name: 'example', fence: '====', args: 'Click to expand', options: [['options', 'collapsible']] }, nodes.paragraph.create(null, schema.text('Hidden.'))),
      nodes.thematic_break.create({ markup: "'''" }),
      nodes.paragraph.create(null, [schema.text('A '), schema.text('bold', [schema.marks.strong.create()]), schema.text(' word and '), nodes.image.create({ src: 'a.png', alt: 'A' })]),
    ]);
    const out = edited('', () => doc);
    expect(out).toBe(
      "== Title\n\nNOTE: A note.\n\n[source,python]\n----\nprint(1)\n----\n\n[latexmath]\n++++\nx^2\n++++\n\n.Click to expand\n[%collapsible]\n====\nHidden.\n====\n\n'''\n\nA *bold* word and image:a.png[A]",
    );
    expect(Fragment.from(load(out).doc.content).childCount).toBe(7);
  });
});

describe('conditions', () => {
  const settings = { block: ['if', 'endif'] as [string, string], inline: ['if-inline', 'endif-inline'] as [string, string], caseSensitive: true, capabilities: ['Cloud', 'Desktop'], capabilitiesFile: null, capabilitiesPath: null, capabilitiesKey: null, colors: {}, markers: 'ifdef' as const };
  const config = { ...ASCIIDOC_CONFIG, editor: { ...ASCIIDOC_CONFIG.editor, conditions: settings } };

  it('are ifdef lines, read as markers', () => {
    const text = 'Always.\n\nifdef::Cloud,Desktop[]\nCloud or desktop.\nendif::[]\n\nifndef::Cloud[]\nNot cloud.\nendif::[]\n';
    const { doc } = loadDocument(text, config);
    const kinds = Array.from({ length: doc.childCount }, (_, i) => doc.child(i)).filter((n) => n.type === nodes.raw_block).map((n) => n.attrs.kind);
    expect(kinds).toEqual(['condition-start', 'condition-end', 'condition-start', 'condition-end']);
    const { markersOf } = conditions;
    expect(markersOf(settings).block.read('ifdef::Cloud,Desktop[]')).toEqual({ kind: 'start', expr: 'Cloud or Desktop' });
    expect(markersOf(settings).block.read('ifndef::Cloud+Desktop[]')).toEqual({ kind: 'start', expr: 'not (Cloud and Desktop)' });
    expect(markersOf(settings).block.start('not (Cloud or Desktop)')).toBe('ifndef::Cloud,Desktop[]');
    // What ifdef can't say is refused, with why.
    expect(conditions.parseFor(settings, 'Cloud and not Desktop')).toMatchObject({ ok: false, error: expect.stringMatching(/can’t write/) });
    const loaded = loadDocument(text, config);
    expect(saveDocument(loaded.doc, loaded.map, config).text).toBe(text);
  });

  it('go around table rows', () => {
    const text = '|===\n| Name | Where\n\n| a | everywhere\nifdef::Cloud[]\n| b | cloud\nendif::[]\n|===\n';
    const { doc, map } = loadDocument(text, config);
    const table = doc.firstChild!;
    expect(table.type).toBe(nodes.table);
    expect(table.child(2).attrs.conds.map((c: { start: string }) => c.start)).toEqual(['ifdef::Cloud[]']);
    // The first row joins the condition: its marker moves up.
    const tr = EditorState.create({ doc, schema }).tr;
    const first = table.child(1);
    tr.setNodeMarkup(1 + table.child(0).nodeSize, null, { ...first.attrs, conds: table.child(2).attrs.conds });
    const saved = saveDocument(tr.doc, map, config);
    expect(saved.verified).toBe(true);
    expect(saved.text).toBe('|===\n| Name | Where\n\nifdef::Cloud[]\n| a | everywhere\n| b | cloud\nendif::[]\n|===\n');
  });
});

describe('a renamed chapter', () => {
  it('is included, and referred to, under its new name', async () => {
    const { renameAsciidocReferences } = await import('../src/renderer/src/formats/asciidoc/rename.js');
    const text = '= Book\n\ninclude::chapters/one.adoc[leveloffset=+1]\n\nSee xref:chapters/one.adoc#intro[the intro].\n';
    const { doc, map } = load(text);
    const state = EditorState.create({ doc, schema });
    const tr = renameAsciidocReferences(state, { folder: { before: '', after: '' }, page: { from: 'chapters/one', to: 'chapters/first' }, file: { from: 'chapters/one.adoc', to: 'chapters/first.adoc' }, moved: false, config: ASCIIDOC_CONFIG });
    expect(saveDocument(tr.doc, map, ASCIIDOC_CONFIG).text).toBe('= Book\n\ninclude::chapters/first.adoc[leveloffset=+1]\n\nSee xref:chapters/first.adoc#intro[the intro].\n');
  });
});

describe('a table with a caption, new', () => {
  it('is written with its caption above it', () => {
    const cell = (type: typeof nodes.table_cell, text = '') => type.create(null, nodes.paragraph.create(null, text ? schema.text(text) : undefined));
    const doc = nodes.doc.create(null, [nodes.table.create({ header: '.Regions' }, [nodes.table_row.create(null, [cell(nodes.table_header, 'Name'), cell(nodes.table_header, 'Where')]), nodes.table_row.create(null, [cell(nodes.table_cell, 'eu'), cell(nodes.table_cell, 'Europe')])])]);
    expect(edited('', () => doc)).toBe('.Regions\n|===\n| Name | Where\n\n| eu | Europe\n|===');
  });
});

describe('definition lists', () => {
  const text = 'CPU:: Any 64-bit processor\nMemory::\n  4 GB, or more\n  for the examples.\nDisk::\nStorage:: 2 GB\n+\n----\ndf -h\n----\n\nAfter.\n';

  it('are terms and descriptions, written back as they were', () => {
    const { doc, map } = load(text);
    const list = doc.firstChild!;
    expect(list.type).toBe(nodes.definition_list);
    expect(list.childCount).toBe(3);
    expect(list.child(2).childCount).toBe(3); // two terms, a description
    expect(list.child(2).lastChild!.lastChild!.type).toBe(nodes.code_block);
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG)).toEqual({ text, verified: true });
  });

  it('edited, change only what was edited', () => {
    const out = edited(text, (s) => {
      let at = 0;
      s.doc.descendants((n, pos) => {
        if (!at && n.type === nodes.paragraph && n.textContent.startsWith('4 GB')) at = pos + n.nodeSize - 1;
      });
      return s.tr.insertText(' Or 8.', at);
    });
    expect(out).toBe(text.replace('for the examples.', 'for the examples. Or 8.'));
  });

  it('made in the editor: term, marker, description', () => {
    const item = (term: string, desc: string) => nodes.definition_item.create(null, [nodes.definition_term.create(null, schema.text(term)), nodes.definition_desc.create(null, nodes.paragraph.create(null, schema.text(desc)))]);
    const doc = nodes.doc.create(null, nodes.definition_list.create(null, [item('API', 'How programs talk.'), item('SDK', 'Tools: lib:: and all.')]));
    expect(edited('', () => doc)).toBe('API:: How programs talk.\nSDK:: Tools: lib:: and all.');
  });
});

describe('pictures in an AsciiDoc page', async () => {
  const { asciidocEditing } = await import('../src/renderer/src/formats/asciidoc/index.js');
  const images = asciidocEditing.images!;
  const book = { ...ASCIIDOC_CONFIG, main: 'index.adoc', base: 'book', attributes: { imagesdir: 'images' } };

  it('are found under :imagesdir:, from the main document’s folder in a book', () => {
    expect(images.fromPage('diagram.png', book, 'book/chapters/one.adoc')).toBe('../images/diagram.png');
    expect(images.toRef('../images/sub/x.png', book, 'book/chapters/one.adoc')).toBe('sub/x.png');
    // A page standing on its own: from its folder.
    expect(images.fromPage('x.png', ASCIIDOC_CONFIG, 'notes/a.adoc')).toBe('x.png');
    expect(images.fromPage('https://example.org/x.png', book, 'book/index.adoc')).toBe('https://example.org/x.png');
  });

  it('have widths: read, and changed', () => {
    expect(images.width({ extra: '300' })).toBe('300');
    expect(images.width({ extra: 'role=r,width=50%' })).toBe('50%');
    expect(images.width({ extra: null })).toBeNull();
    expect(images.withWidth({ extra: '300,200' }, '400')).toMatchObject({ extra: '400,200' });
    expect(images.withWidth({ extra: '300' }, null)).toMatchObject({ extra: null });
    expect(images.withWidth({ extra: 'role=r' }, '120')).toMatchObject({ extra: '120,role=r' });
    // And written so: image:a.png[A,120,role=r].
    const para = nodes.paragraph.create(null, nodes.image.create({ src: 'a.png', alt: 'A', extra: '120,role=r' }));
    expect(edited('', () => nodes.doc.create(null, para))).toBe('image:a.png[A,120,role=r]');
  });
});

describe('figures', () => {
  const text = '[[arch]]\n.How it *fits* together\nimage::diagram.png[The parts,600,role=right]\n\nAfter.\n';

  it('are pictures with captions, written back as they were', () => {
    const { doc, map } = load(text);
    const figure = doc.firstChild!;
    expect(figure.type).toBe(nodes.md_directive);
    expect(figure.attrs).toMatchObject({ name: 'figure', args: 'diagram.png', options: [['id', 'arch'], ['role', 'right'], ['alt', 'The parts'], ['width', '600']] });
    expect(figure.textContent).toBe('How it fits together');
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG)).toEqual({ text, verified: true });
  });

  it('edited: the caption, the description, the picture', () => {
    let out = edited(text, (s) => s.tr.insertText(' well', s.doc.firstChild!.nodeSize - 2));
    expect(out).toBe(text.replace('together', 'together well'));
    out = edited(text, (s) => s.tr.setNodeMarkup(0, null, { ...s.doc.firstChild!.attrs, args: 'new.svg', options: [['id', 'arch'], ['role', 'right'], ['alt', 'The parts, all'], ['width', '600']] }));
    expect(out).toBe('[[arch]]\n[.right]\n.How it *fits* together\nimage::new.svg["The parts, all",600]\n\nAfter.\n');
  });

  it('without a caption or a description: just the picture', () => {
    const { doc } = load('image::a.png[]\n');
    expect(doc.firstChild!.attrs).toMatchObject({ name: 'figure', args: 'a.png', options: [] });
    expect(edited('', () => nodes.doc.create(null, nodes.md_directive.create({ name: 'figure', args: 'b.png', options: [['width', '50%']], fence: '' }, nodes.paragraph.create())))).toBe('image::b.png[,50%]');
  });
});

describe('attribute values', async () => {
  const { asciidocEditing } = await import('../src/renderer/src/formats/asciidoc/index.js');
  const shown = asciidocEditing.roles.shown!;
  it('are where they are set: the main document’s, then the page’s, above them', () => {
    const config = { ...ASCIIDOC_CONFIG, attributes: { product: 'Widget', edition: '1' } };
    const { doc } = loadDocument('= Chapter\n:edition: 2\n\nFirst {edition}.\n\n:product: Gadget\n\nThen {product}.\n\n:edition!:\n\nNow {edition}.\n', config);
    const at = (text: string) => {
      let pos = 0;
      doc.descendants((n, p) => {
        if (!pos && n.type.name === 'paragraph' && n.textContent.startsWith(text)) pos = p;
      });
      return pos;
    };
    expect(shown('attribute', 'edition', config, { doc, pos: at('First') })).toMatchObject({ text: '2' });
    expect(shown('attribute', 'product', config, { doc, pos: at('First') })).toMatchObject({ text: 'Widget' });
    expect(shown('attribute', 'product', config, { doc, pos: at('Then') })).toMatchObject({ text: 'Gadget' });
    expect(shown('attribute', 'edition', config, { doc, pos: at('Now') })).toMatchObject({ text: '{edition}', missing: true });
  });
});
