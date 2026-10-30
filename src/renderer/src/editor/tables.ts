// Editing tables: cell navigation, keeping cells in the shape the page's format can
// store (Markdown's: a line each, aligned as their column), and the commands behind
// the table toolbar.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import {
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  mergeCells,
  selectedRect,
  splitCell,
  tableEditing,
} from 'prosemirror-tables';
import { schema } from '../../../core/schema';

const { nodes } = schema;

export { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, splitCell };

// Whether the selection is among a cell's blocks (where keys do what they do outside
// tables).
const inCellBlocks = (state: EditorState) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === nodes.cell_blocks) return true;
  return false;
};

// Enter: to the same column in the next row, adding a row at the bottom.
const nextRow: Command = (state, dispatch) => {
  if (!isInTable(state) || inCellBlocks(state)) return false;
  const rect = selectedRect(state);
  let tr = state.tr;
  if (rect.bottom >= rect.map.height) addRowAfter(state, (t) => (tr = t));
  const table = tr.doc.nodeAt(rect.tableStart - 1)!;
  const map = TableMap.get(table);
  const cellPos = rect.tableStart + map.positionAt(Math.min(rect.bottom, map.height - 1), rect.left, table);
  const cell = tr.doc.nodeAt(cellPos)!;
  dispatch?.(tr.setSelection(TextSelection.create(tr.doc, cellPos + cell.nodeSize - 2)).scrollIntoView());
  return true;
};

// A line break can't be written inside a Markdown table cell.
const noBreakInCell: Command = (state) => isInTable(state) && !inCellBlocks(state);

export const tableKeys = keymap({
  Tab: goToNextCell(1),
  'Shift-Tab': goToNextCell(-1),
  Enter: nextRow,
  'Shift-Enter': noBreakInCell,
});

// Cells as Markdown stores them: one line each, aligned like their column's header.
// Applied to tables a transaction touched (merging cells, splitting, pasting, ...).
const normalizeCells = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((t) => t.docChanged)) return null;
    const touched = changedRanges(transactions, state);
    let tr: Transaction | null = null;
    state.doc.descendants((node, pos) => {
      if (node.type !== nodes.table) return !node.isTextblock;
      if (!touched.some(([from, to]) => from <= pos + node.nodeSize && to >= pos)) return false;
      tr = normalizeTable(tr ?? state.tr, node, pos);
      return false;
    });
    return tr;
  },
});

function changedRanges(transactions: readonly Transaction[], state: EditorState): [number, number][] {
  const ranges: [number, number][] = [];
  transactions.forEach((t, i) => {
    t.mapping.maps.forEach((map, j) => {
      map.forEach((_a, _b, from, to) => {
        // Map through the rest of this transaction and the later ones.
        let f = from;
        let e = to;
        for (let k = j + 1; k < t.mapping.maps.length; k++) {
          f = t.mapping.maps[k].map(f, -1);
          e = t.mapping.maps[k].map(e, 1);
        }
        for (const later of transactions.slice(i + 1)) {
          f = later.mapping.map(f, -1);
          e = later.mapping.map(e, 1);
        }
        ranges.push([f, Math.min(e, state.doc.content.size)]);
      });
    });
  });
  return ranges;
}

function normalizeTable(tr: Transaction, table: PMNode, tablePos: number): Transaction {
  const map = TableMap.get(table);
  const start = tablePos + 1;
  const headerAlign = (col: number) => table.nodeAt(map.map[col])?.attrs.align ?? null;
  // Positions from the end, so earlier changes don't shift later ones.
  const cells = [...new Set(map.map)].sort((a, b) => b - a);
  for (const rel of cells) {
    const pos = tr.mapping.map(start + rel);
    const cell = tr.doc.nodeAt(pos);
    if (!cell) continue;
    const col = map.colCount(rel);
    const align = headerAlign(col);
    if (cell.attrs.align !== align) tr = tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
    if (cell.childCount > 1) {
      const inline: PMNode[] = [];
      cell.forEach((p) => {
        if (!p.content.size) return;
        if (inline.length) inline.push(schema.text(' '));
        p.content.forEach((n) => inline.push(n));
      });
      tr = tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, nodes.paragraph.create(null, inline));
    }
  }
  return tr;
}

// How a format's cells are: a line each, aligned as their column (Markdown's); or
// paragraphs, or blocks, aligned on their own.
export type CellKind = 'line' | 'blocks';

export const tablePlugins = (cells: CellKind = 'line') => [tableEditing(), tableKeys, ...(cells === 'line' ? [normalizeCells] : [])];

// The cell the selection is in, if it's one: its position and node.
function cellAt(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === nodes.table_cell || node.type === nodes.table_header) return { pos: $from.before(d), node };
  }
  return null;
}

// Whether the cell the selection is in holds blocks.
export function holdsBlocks(state: EditorState): boolean {
  return !!cellAt(state)?.node.firstChild && cellAt(state)!.node.firstChild!.type === nodes.cell_blocks;
}

// A cell holding blocks (lists, code, notes), or only text again: its paragraphs go
// in, or come out when they're all it has.
export const toggleCellBlocks: Command = (state, dispatch) => {
  const cell = cellAt(state);
  if (!cell) return false;
  const inner: PMNode[] = [];
  cell.node.forEach((c) => (c.type === nodes.cell_blocks ? c.forEach((b) => inner.push(b)) : inner.push(c)));
  const blocks = cell.node.firstChild?.type === nodes.cell_blocks;
  if (blocks && inner.some((b) => b.type !== nodes.paragraph)) return false;
  if (!dispatch) return true;
  const content = blocks ? inner : [nodes.cell_blocks.create(null, inner)];
  const tr = state.tr.replaceWith(cell.pos + 1, cell.pos + cell.node.nodeSize - 1, content);
  dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(cell.pos + 2))).scrollIntoView());
  return true;
};

// Set the alignment of the column the selection is in.
export function alignColumn(align: 'left' | 'center' | 'right' | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    let tr = state.tr;
    for (let col = rect.left; col < rect.right; col++) {
      for (let row = 0; row < rect.map.height; row++) {
        const rel = rect.map.map[row * rect.map.width + col];
        const pos = rect.tableStart + rel;
        const cell = tr.doc.nodeAt(pos)!;
        if (cell.attrs.align !== align) tr = tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
      }
    }
    dispatch?.(tr);
    return true;
  };
}

export function columnAlign(state: EditorState): string | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return rect.table.nodeAt(rect.map.map[rect.left])?.attrs.align ?? null;
}

// A new table of `rows` rows (the first one its headings) and `columns` columns.
export function tableOf(rows: number, columns: number): Command {
  return (state, dispatch) => {
    const cell = (type: typeof nodes.table_cell, text = '') => type.create(null, nodes.paragraph.create(null, text ? schema.text(text) : undefined));
    const headings = nodes.table_row.create(
      null,
      Array.from({ length: columns }, (_, c) => cell(nodes.table_header, `Column ${c + 1}`)),
    );
    const body = Array.from({ length: Math.max(0, rows - 1) }, () => nodes.table_row.create(null, Array.from({ length: columns }, () => cell(nodes.table_cell))));
    const table = nodes.table.create({ pretty: true, ruleSpaces: true }, [headings, ...body]);
    const { $from } = state.selection;
    const at = $from.depth > 0 ? $from.after(1) : state.selection.to;
    if (!dispatch) return true;
    const tr = state.tr.insert(at, table);
    // Select the first heading's placeholder, so typing replaces it.
    const start = at + 4; // table, row, header cell, paragraph
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start, start + 'Column 1'.length)).scrollIntoView());
    return true;
  };
}

// The usual new table: a header row and two rows, three columns.
export const insertTable: Command = tableOf(3, 3);
