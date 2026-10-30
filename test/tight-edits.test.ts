// An edit rewrites only the lines it's on: the paragraph's other lines, a table's
// other rows, as they were written.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';

// `text` with `typed` typed after the first `after`.
function typed(text: string, after: string, typedText = 'X'): string {
  const { doc, map } = loadDocument(text, DEFAULT_CONFIG);
  let at = -1;
  doc.descendants((n, p) => {
    if (at < 0 && n.isText && n.text!.includes(after)) at = p + n.text!.indexOf(after) + after.length;
    return at < 0;
  });
  const saved = saveDocument(EditorState.create({ doc, schema }).tr.insertText(typedText, at).doc, map, DEFAULT_CONFIG);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

describe('an edit', () => {
  it('keeps the paragraph’s other lines as written', () => {
    const text = 'Use ``code`` here,\nsee [black](https://example.org/black)\nand \\n escapes, *em* too.\n\n[black-link]: https://example.org/black\n';
    expect(typed(text, 'here')).toBe(text.replace('here,', 'hereX,'));
    expect(typed(text, 'escapes')).toBe(text.replace('escapes', 'escapesX'));
  });

  it('keeps indented lines going on in a paragraph', () => {
    const text = 'One line\n    <tag_name> with indentation\n    and more.\n';
    expect(typed(text, 'One')).toBe(text.replace('One', 'OneX'));
  });

  it('keeps a heading’s title as written', () => {
    expect(typed('# A ``code`` title\n\nText.\n', 'Text')).toBe('# A ``code`` title\n\nTextX.\n');
    expect(typed('# A ``code`` title #\n', 'title')).toBe('# A `code` titleX\n');
  });

  it('in a table: its row only, in the table’s style', () => {
    const compact = 'a | b\n--|--\n1 | 22\n3 | 4\n';
    expect(typed(compact, '22')).toBe('a | b\n--|--\n1 | 22X\n3 | 4\n');
    const padded = '| Plan  | Price |\n| ----- | ----- |\n| Basic | Free  |\n| Pro   | 10    |\n';
    expect(typed(padded, 'Fre')).toBe(padded.replace('| Free  |', '| FreXe |'));
    // Too wide for its column: padded anew, all of it.
    expect(typed(padded, 'Basic', 'ally')).toBe('| Plan      | Price |\n| --------- | ----- |\n| Basically | Free  |\n| Pro       | 10    |\n');
  });

  it('in a definition list: its line only', () => {
    const text = '``alt``\n: The *text*.\n\n``width``\n: How wide.\n';
    expect(typed(text, 'wide')).toBe(text.replace('wide', 'wideX'));
  });
});
