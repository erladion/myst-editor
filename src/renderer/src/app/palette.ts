// The command palette's own commands (Ctrl+Shift+P): editing the page, beside the
// menus' items (which come from the main process, see CommandPalette).
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../../../core/schema';
import { editLink, heading, paragraph, toggleCode, toggleEm, toggleList, toggleQuote, toggleStrike, toggleStrong } from '../editor/commands';
import { editingFor, runInsert } from '../formats/editing';
import type { EditorContext } from '../editor/context';
import { isInTable } from '../editor/tables';
import { TABLE_COMMANDS } from '../editor/tableMenu';
import { keysFor } from '../shortcuts';

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  keys?: string;
  run: () => void;
}

export function editorCommands(ctx: EditorContext, view: EditorView | null): PaletteCommand[] {
  if (!view) return [];
  const run = (cmd: Command) => {
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  const can = (cmd: Command) => cmd(view.state);
  const out: PaletteCommand[] = [];
  const add = (group: string, label: string, action: () => void, keys = keysFor(label)) => out.push({ id: `${group}:${label}`, group, label, keys: keys || undefined, run: action });
  const cmd = (group: string, label: string, command: Command, keys?: string) => can(command) && add(group, label, () => run(command), keys);

  cmd('Format', 'Bold', toggleStrong);
  cmd('Format', 'Italic', toggleEm);
  cmd('Format', 'Code', toggleCode);
  cmd('Format', 'Strikethrough', toggleStrike);
  add('Format', 'Link…', () => void editLink(ctx, view.state, run), keysFor('Link'));
  cmd('Format', 'Normal text', paragraph);
  ['Title', 'Heading', 'Subheading', 'Small heading'].forEach((label, i) => cmd('Format', label, heading(i + 1)));
  cmd('Format', 'Bulleted list', toggleList(schema.nodes.bullet_list));
  cmd('Format', 'Numbered list', toggleList(schema.nodes.ordered_list));
  cmd('Format', 'Quote', toggleQuote);

  // The page's format's, those offered here.
  for (const item of editingFor(ctx.config).inserts(ctx)) {
    if (!item.palette) continue;
    const keys = item.keys ? keysFor(item.keys) : '';
    if (item.command) cmd('Insert', item.palette, item.command, keys);
    else add('Insert', item.palette, () => runInsert(item, run, view.state), keys);
  }

  if (isInTable(view.state)) for (const [label, command] of Object.values(TABLE_COMMANDS)) if (can(command)) add('Table', label, () => run(command), '');
  return out;
}
