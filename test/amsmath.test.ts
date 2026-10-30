// amsmath environments (\begin{equation} … \end{equation}): math, written as written.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { readConfPy } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';

const conf = readConfPy('extensions = ["myst_parser"]\nmyst_enable_extensions = ["amsmath"]\n');
const PAGE = 'Before.\n\n\\begin{equation}\nx = 1\n\\end{equation}\n\nAfter.\n';

describe('an amsmath environment', () => {
  it('is a block of math, the whole environment', () => {
    const { doc, map } = loadDocument(PAGE, conf);
    expect(doc.content.content.map((n) => n.type.name)).toEqual(['paragraph', 'math_block', 'paragraph']);
    expect(doc.child(1).textContent).toBe('\\begin{equation}\nx = 1\n\\end{equation}');
    expect(saveDocument(doc, map, conf).text).toBe(PAGE);
  });

  it('edited: written as it is', () => {
    const { doc, map } = loadDocument(PAGE, conf);
    const at = doc.child(0).nodeSize + 1 + '\\begin{equation}\nx = 1'.length;
    expect(saveDocument(EditorState.create({ doc, schema }).tr.insertText(' + y', at).doc, map, conf).text).toBe(PAGE.replace('x = 1', 'x = 1 + y'));
  });
});
