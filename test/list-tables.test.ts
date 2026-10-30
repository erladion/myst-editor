// {list-table}: edited as a table, its cells holding the page's own blocks; rows and
// cells nobody touched written as they were.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';
import { TextSelection } from 'prosemirror-state';
import { addColumnAfter } from 'prosemirror-tables';

const { nodes } = schema;
const TABLE = '```{list-table} Plans\n:header-rows: 1\n:widths: 1 2\n\n* - Plan\n  - Notes\n* - Basic\n  - Free.\n\n    With a second paragraph.\n* - Pro\n  - - one\n    - two\n```\n';

function typed(text: string, after: string, typedText: string): string {
  const { doc, map } = loadDocument(text, DEFAULT_CONFIG);
  let at = -1;
  doc.descendants((n, p) => void (at < 0 && n.isText && n.text === after && (at = p + after.length)));
  const saved = saveDocument(EditorState.create({ doc, schema }).tr.insertText(typedText, at).doc, map, DEFAULT_CONFIG);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

describe('a list table', () => {
  it('is a table: a header row, cells of text or of blocks', () => {
    const { doc, map } = loadDocument(TABLE, DEFAULT_CONFIG);
    const table = doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.child(0).child(0).type.name).toBe('table_header');
    expect(table.child(1).child(1).firstChild!.type.name).toBe('cell_blocks');
    expect(table.child(2).child(1).firstChild!.firstChild!.type.name).toBe('bullet_list');
    expect(saveDocument(doc, map, DEFAULT_CONFIG).text).toBe(TABLE);
  });

  it('typed in: that cell’s line only', () => {
    expect(typed(TABLE, 'Free.', ' Always.')).toBe(TABLE.replace('Free.', 'Free. Always.'));
    expect(typed(TABLE, 'two', ' three')).toBe(TABLE.replace('- two', '- two three'));
  });

  it('a new row, and a new column with its width', () => {
    const { doc, map } = loadDocument(TABLE, DEFAULT_CONFIG);
    const row = nodes.table_row.create(null, [nodes.table_cell.create(null, nodes.paragraph.create(null, schema.text('Max'))), nodes.table_cell.create(null, nodes.paragraph.create(null, schema.text('All of it.')))]);
    const added = saveDocument(EditorState.create({ doc, schema }).tr.insert(doc.firstChild!.nodeSize - 1, row).doc, map, DEFAULT_CONFIG);
    expect(added.text).toBe(TABLE.replace('    - two\n', '    - two\n* - Max\n  - All of it.\n'));
  });

  it('a column added: in every row, its widths one more', () => {
    const { doc, map } = loadDocument(TABLE, DEFAULT_CONFIG);
    let at = -1;
    doc.descendants((n, p) => void (at < 0 && n.isText && n.text === 'Pro' && (at = p + 1)));
    let state = EditorState.create({ doc, schema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    addColumnAfter(state, (tr) => (state = state.apply(tr)));
    const out = saveDocument(state.doc, map, DEFAULT_CONFIG);
    expect(out.problem).toBeUndefined();
    expect(out.text).toContain(':widths: 1 2 1\n');
    expect(out.text).toContain('* - Plan\n  -\n  - Notes\n');
  });

  it('with an option the editor can’t keep: as written', () => {
    expect(loadDocument('```{list-table}\n:stub-columns: 1\n\n* - a\n  - b\n```\n', DEFAULT_CONFIG).doc.firstChild!.type.name).toBe('opaque_directive');
  });
});
