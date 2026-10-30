import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { readConfPy, parserExtensions, newDirectiveFence } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';

describe('readConfPy', () => {
  it('reads list, tuple and incremental forms', () => {
    const conf = `
project = "x"
myst_enable_extensions = [
    "colon_fence",
    'deflist',  # comment
]
myst_enable_extensions.append("dollarmath")
myst_enable_extensions += ["tasklist"]
`;
    expect(readConfPy(conf).extensions.sort()).toEqual(['colon_fence', 'deflist', 'dollarmath', 'tasklist']);
    expect(readConfPy('myst_enable_extensions = ("substitution",)').extensions).toEqual(['substitution']);
    expect(readConfPy('extensions = ["myst_parser"]').extensions).toEqual([]);
  });

  it('drives the parser dialect', () => {
    const plain = readConfPy('extensions = ["myst_parser"]');
    expect(parserExtensions(plain)).toMatchObject({ colonFences: false, math: false });
    expect(newDirectiveFence(plain)).toBe('```');
    // Without colon_fence, ":::" is just text, as in Sphinx.
    const { doc } = loadDocument(':::{note}\nHi\n:::\n', plain);
    expect(doc.firstChild!.type.name).toBe('paragraph');
    const colon = readConfPy('myst_enable_extensions = ["colon_fence"]');
    expect(loadDocument(':::{note}\nHi\n:::\n', colon).doc.firstChild!.type.name).toBe('md_directive');
    expect(newDirectiveFence(colon)).toBe(':::');
  });
});

describe('saveDocument', () => {
  const type = (src: string, text: string, at = 1) => {
    const { doc, map } = loadDocument(src);
    const state = EditorState.create({ doc });
    return saveDocument(state.apply(state.tr.insertText(text, at)).doc, map);
  };

  it('verifies a normal edit', () => {
    const r = type('Hello world\n', 'Oh, ');
    expect(r).toEqual({ text: 'Oh, Hello world\n', verified: true });
  });

  it('strips whitespace a writer typed at the start of a paragraph instead of making a code block', () => {
    const r = type('Hello\n', '      ');
    expect(r.text).toBe('Hello\n');
    expect(r.verified).toBe(true);
  });

  it('does not turn trailing spaces before a soft break into a hard break', () => {
    const r = type('one\ntwo\n', '  ', 4);
    expect(r.text).toBe('one\ntwo\n');
    expect(r.verified).toBe(true);
  });

  it('keeps the space after inline code at the start of a line', () => {
    const r = type('About the\n`--strip all` option.\n', 'Q', 3);
    expect(r).toEqual({ text: 'AbQout the\n`--strip all` option.\n', verified: true });
  });

  it('lengthens the fence of a callout when a directive is put inside it', () => {
    const { doc, map } = loadDocument(':::{note}\nHi\n:::\n');
    const state = EditorState.create({ doc });
    const contents = schema.nodes.opaque_directive.create({ name: 'contents', args: 'Later', source: ':::{contents} Later\n:::' });
    const r = saveDocument(state.apply(state.tr.insert(5, contents)).doc, map);
    expect(r).toEqual({ text: '::::{note}\nHi\n\n:::{contents} Later\n:::\n::::\n', verified: true });
  });

  it('drops a trailing hard break and empty paragraphs', () => {
    const { doc, map } = loadDocument('Text\n');
    const state = EditorState.create({ doc });
    const tr = state.tr
      .insert(5, schema.nodes.hard_break.create())
      .insert(state.doc.content.size + 1, schema.nodes.paragraph.create());
    const r = saveDocument(state.apply(tr).doc, map);
    expect(r.text).toBe('Text\n');
    expect(r.verified).toBe(true);
  });

  it('flags output that would not read back the same', () => {
    // A heading node can't contain a soft break in Markdown.
    const { doc, map } = loadDocument('# Title\n');
    const state = EditorState.create({ doc });
    const r = saveDocument(state.apply(state.tr.insert(3, schema.nodes.soft_break.create())).doc, map);
    expect(r.verified).toBe(false);
    expect(r.problem).toMatch(/heading/);
  });
});
