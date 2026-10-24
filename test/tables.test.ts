// GFM tables: editable, with spans written the project's way ({colspan}`2`, covered
// cells empty), and kept as written when they can't be represented.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection, TableMap, addColumnAfter, addRowAfter, deleteColumn, mergeCells, splitCell } from 'prosemirror-tables';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG, type MystConfig } from '../src/core/project-config.js';
import { EMPTY_EDITOR_CONFIG } from '../src/core/editor-config.js';

const withSpans: MystConfig = { ...DEFAULT_CONFIG, editor: { ...EMPTY_EDITOR_CONFIG, tables: { colspan: 'colspan', rowspan: 'rowspan' } } };

const pretty = `| Plan  | Price | Notes |
|:------|------:|:-----:|
| Basic | Free  | x     |
| Pro   | 10    | y     |
`;

function load(src: string, config: MystConfig = withSpans) {
  const { doc, map } = loadDocument(src, config);
  return { state: EditorState.create({ doc }), map, config };
}

const save = (doc: PMNode, map: ReturnType<typeof load>['map'], config = withSpans) => saveDocument(doc, map, config);

function textPos(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(text)) found = pos + n.text!.indexOf(text);
  });
  return found;
}

// Select the cells from the one containing `a` to the one containing `b`.
function selectCells(state: EditorState, a: string, b: string): EditorState {
  const cellPos = (text: string) => state.doc.resolve(textPos(state.doc, text)).before(3);
  return state.apply(state.tr.setSelection(CellSelection.create(state.doc, cellPos(a), cellPos(b))));
}

describe('tables', () => {
  it('reads alignment, keeps an unedited table byte-for-byte', () => {
    const { state, map } = load(pretty);
    const table = state.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.attrs.pretty).toBe(true);
    expect(table.firstChild!.content.content.map((c) => [c.type.name, c.attrs.align, c.textContent])).toEqual([
      ['table_header', 'left', 'Plan'],
      ['table_header', 'right', 'Price'],
      ['table_header', 'center', 'Notes'],
    ]);
    expect(save(state.doc, map)).toEqual({ text: pretty, verified: true });
  });

  it('keeps padded columns and alignment when a cell is edited', () => {
    const { state, map } = load(pretty);
    const r = save(state.apply(state.tr.insertText('Business', textPos(state.doc, 'Pro'), textPos(state.doc, 'Pro') + 3)).doc, map);
    expect(r).toEqual({
      verified: true,
      text: `| Plan     | Price | Notes |
|:---------|------:|:-----:|
| Basic    | Free  | x     |
| Business | 10    | y     |
`,
    });
  });

  it('writes compact tables compactly, and escapes pipes typed into cells', () => {
    // Compact: the lines differ in length.
    const { state, map } = load('| a | b |\n|---|---|\n| 1 | 22 |\n');
    const r = save(state.apply(state.tr.insertText(' | 3', textPos(state.doc, '22') + 2)).doc, map);
    expect(r).toEqual({ verified: true, text: '| a | b |\n|---|---|\n| 1 | 22 \\| 3 |\n' });
  });

  it('doesn’t escape line-start syntax inside cells', () => {
    const { state, map } = load('| v | n |\n|---|---|\n| >=4.0 | # 1 |\n');
    const r = save(state.apply(state.tr.insertText('!', textPos(state.doc, '# 1') + 3)).doc, map);
    expect(r).toEqual({ verified: true, text: '| v | n |\n|---|---|\n| >=4.0 | # 1! |\n' });
  });

  it('reads spans in either order, with covered cells empty', () => {
    const src = '| A | B | C |\n|---|---|---|\n| {colspan}`2` wide | | x |\n| {rowspan}`2` {colspan}`1` tall | y | z |\n| | q | r |\n';
    const { state, map } = load(src);
    const cells: string[] = [];
    state.doc.firstChild!.forEach((row) => row.forEach((c) => cells.push(`${c.textContent}:${c.attrs.colspan}x${c.attrs.rowspan}`)));
    expect(cells).toEqual(['A:1x1', 'B:1x1', 'C:1x1', 'wide:2x1', 'x:1x1', 'tall:1x2', 'y:1x1', 'z:1x1', 'q:1x1', 'r:1x1']);
    expect(save(state.doc, map)).toEqual({ text: src, verified: true });
  });

  it('merges and splits cells, writing the extension’s syntax', () => {
    const { state, map } = load(pretty);
    let merged = selectCells(state, 'Free', 'x');
    mergeCells(merged, (tr) => (merged = merged.apply(tr)));
    const r = save(merged.doc, map);
    expect(r.verified).toBe(true);
    expect(r.text).toBe(`| Plan  | Price               | Notes |
|:------|--------------------:|:-----:|
| Basic | {colspan}\`2\` Free x |       |
| Pro   | 10                  | y     |
`);

    // Split it again: back to one cell per column (merged content stays in the first).
    let split = merged.apply(merged.tr.setSelection(TextSelection.create(merged.doc, textPos(merged.doc, 'Free'))));
    splitCell(split, (tr) => (split = split.apply(tr)));
    const back = save(split.doc, map);
    expect(back.verified).toBe(true);
    expect(back.text).toContain('| Basic | Free x |       |');
  });

  it('merges down into a rowspan', () => {
    const { state, map } = load(pretty);
    let merged = selectCells(state, 'Free', '10');
    mergeCells(merged, (tr) => (merged = merged.apply(tr)));
    const r = save(merged.doc, map);
    expect(r.verified).toBe(true);
    expect(r.text).toContain('| Basic | {rowspan}`2` Free 10 | x     |\n| Pro   |                      | y     |');
  });

  it('adds and removes rows and columns', () => {
    const { state, map } = load('| a | b |\n|---|---|\n| 1 | 2 |\n', withSpans);
    let s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, textPos(state.doc, '1'))));
    addRowAfter(s, (tr) => (s = s.apply(tr)));
    addColumnAfter(s, (tr) => (s = s.apply(tr)));
    expect(TableMap.get(s.doc.firstChild!)).toMatchObject({ width: 3, height: 3 });
    const r = save(s.doc, map);
    // The new column goes after the cursor's (between a and b), the new row at the end.
    expect(r).toEqual({ verified: true, text: '| a |   | b |\n|---|---|---|\n| 1 |   | 2 |\n|   |   |   |\n' });
    let d = s;
    deleteColumn(d, (tr) => (d = d.apply(tr)));
    expect(TableMap.get(d.doc.firstChild!).width).toBe(2);
  });

  it('keeps tables it can’t represent exactly as written', () => {
    for (const src of [
      '| a | b |\n|---|---|\n| {colspan}`2` x | not empty |\n', // covered cell has content
      '| a | b |\n|---|---|\n| {colspan}`3` x | |\n', // span past the edge
      '| a | b |\n|---|---|\n| 1 | 2 | 3 |\n', // more cells than the header: GFM drops them
    ]) {
      const { state, map } = load(src);
      expect(state.doc.firstChild!.type.name).toBe('raw_block');
      expect(save(state.doc, map).text).toBe(src);
    }
  });

  it('treats span roles as ordinary roles when the project doesn’t declare them', () => {
    const src = '| a | b |\n|---|---|\n| {colspan}`2` x | |\n';
    const { state, map } = load(src, DEFAULT_CONFIG);
    const cell = state.doc.firstChild!.child(1).child(0);
    expect([cell.attrs.colspan, cell.firstChild!.firstChild!.type.name]).toEqual([1, 'role']);
    expect(save(state.doc, map, DEFAULT_CONFIG).text).toBe(src);
  });
});

describe('editing a table', () => {
  it('writes the cells nobody touched as they were', async () => {
    const { EditorState } = await import('prosemirror-state');
    const { loadDocument, saveDocument } = await import('../src/core/document.js');
    const src = '| Item | Price | Note |\n|---|---|---|\n| Pro | $10 | _billed_ yearly |\n| Pipe | 0 | a \\| b |\n| Old | 5 | gone |\n';
    const { doc, map } = loadDocument(src);
    let at = -1;
    doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text === 'gone') at = pos;
    });
    const state = EditorState.create({ doc });
    const edited = state.apply(state.tr.insertText('kept', at, at + 4)).doc;
    const r = saveDocument(edited, map);
    expect(r.verified).toBe(true);
    // Only the edited cell is new; $10, _billed_ and the escaped pipe stay as written.
    expect(r.text).toBe(src.replace('| Old | 5 | gone |', '| Old | 5 | kept |'));
  });
});
