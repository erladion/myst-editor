// MyST's attributes (attrs_inline, attrs_block): on spans, code, links and pictures,
// and on a line before a block; kept as written, the block's id a target.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { readConfPy, type MystConfig } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';

const conf: MystConfig = readConfPy('extensions = ["myst_parser"]\nmyst_enable_extensions = ["attrs_inline", "attrs_block"]\n');
const PAGE = '{#intro .lead}\nA [highlighted]{.red #h} word, `print()`{.py}, [a link](https://x.org){.external} and ![pic](a.png){width=100px}.\n\n{#sec}\n# Heading\n';

describe('attributes', () => {
  it('are kept on what they follow, and on their own line before a block', () => {
    const { doc, map } = loadDocument(PAGE, conf);
    expect(doc.content.content.map((n) => n.type.name + (n.attrs.kind ? `:${n.attrs.kind}` : ''))).toEqual(['raw_block:block-attributes', 'paragraph', 'raw_block:block-attributes', 'heading']);
    const marked: string[] = [];
    doc.child(1).forEach((n) => n.marks.forEach((m) => marked.push(`${m.type.name} ${m.attrs.role ?? m.attrs.extra}`)));
    expect(marked).toEqual(['span {.red #h}', 'code {.py}', 'link {.external}']);
    expect(saveDocument(doc, map, conf).text).toBe(PAGE);
  });

  it('typing beside them: the line typed in, nothing else', () => {
    const { doc, map } = loadDocument(PAGE, conf);
    const saved = saveDocument(EditorState.create({ doc, schema }).tr.insertText('X', doc.child(0).nodeSize + 2).doc, map, conf);
    expect(saved.text).toBe(PAGE.replace('A [', 'AX ['));
  });

  it('written for new text too', () => {
    const { map } = loadDocument('', conf);
    const para = schema.nodes.paragraph.create(null, [schema.text('see '), schema.text('this', [schema.marks.span.create({ role: '{.note}' })]), schema.text(' and '), schema.text('x()', [schema.marks.code.create({ role: '{.py}' })])]);
    expect(saveDocument(schema.nodes.doc.create(null, [para]), map, conf).text).toBe('see [this]{.note} and `x()`{.py}');
  });

  it('without the extensions: text', () => {
    const plain: MystConfig = { ...conf, extensions: [] };
    const { doc } = loadDocument('{#a}\nText [b]{.c}.\n', plain);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.textContent).toContain('[b]{.c}');
  });
});
