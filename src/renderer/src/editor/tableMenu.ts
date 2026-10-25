// Right-click in a table: rows, columns, merging and deleting, at the top of the
// window's context menu (window.ts builds it; the table's part is told to it here,
// before it's built, and what's chosen comes back to tableMenuCommand).
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, splitCell } from 'prosemirror-tables';
import { TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { TableMenuItem } from '../../../shared/api';
import type { EditorContext } from './context';

const COMMANDS: Record<string, [string, Command]> = {
  'row-above': ['Insert Row Above', addRowBefore],
  'row-below': ['Insert Row Below', addRowAfter],
  'column-left': ['Insert Column Left', addColumnBefore],
  'column-right': ['Insert Column Right', addColumnAfter],
  'merge-cells': ['Merge Cells', mergeCells],
  'split-cell': ['Split Cell', splitCell],
  'delete-row': ['Delete Row', deleteRow],
  'delete-column': ['Delete Column', deleteColumn],
  'delete-table': ['Delete Table', deleteTable],
};
const GROUPS = [['row-above', 'row-below', 'column-left', 'column-right'], ['merge-cells', 'split-cell'], ['delete-row', 'delete-column', 'delete-table']];

// The table's items for a right-click at `e`, with the cursor put in the clicked cell
// first (unless it's in a selection of cells already). Empty outside tables.
export function tableMenuItems(view: EditorView, ctx: EditorContext, e: MouseEvent): TableMenuItem[] {
  const cell = (e.target as HTMLElement).closest?.('td, th');
  if (!cell || !view.dom.contains(cell)) return [];
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
  const { selection } = view.state;
  if (at && (at.pos < selection.from || at.pos > selection.to)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
  }
  const state = view.state;
  if (!isInTable(state)) return [];
  const spans = !!(ctx.config.editor.tables.colspan || ctx.config.editor.tables.rowspan);
  const items: TableMenuItem[] = [];
  for (const group of GROUPS) {
    if (group.includes('merge-cells') && !spans) continue;
    if (items.length) items.push({ id: '-', label: '', enabled: false });
    for (const id of group) items.push({ id, label: COMMANDS[id][0], enabled: COMMANDS[id][1](state) });
  }
  return items;
}

export function tableMenuCommand(view: EditorView, id: string) {
  const command = COMMANDS[id]?.[1];
  if (!command) return;
  command(view.state, view.dispatch, view);
  view.focus();
}
