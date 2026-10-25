// The command palette's own commands (Ctrl+Shift+P): editing the page, beside the
// menus' items (which come from the main process, see CommandPalette).
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../../../core/schema';
import {
  editLink, heading, insertCaptionedTable, insertCard, insertCodeBlock, insertDirective, insertDivider, insertFigure, insertImage, insertMath, insertReference, insertTarget,
  paragraph, toggleCode, toggleEm, toggleList, toggleQuote, toggleStrike, toggleStrong,
} from '../editor/commands';
import type { EditorContext } from '../editor/context';
import { ADMONITIONS, CALLOUT_CHOICES } from '../editor/directives';
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

  for (const n of CALLOUT_CHOICES) {
    const label = n === 'admonition' ? 'Callout with title' : `${ADMONITIONS[n].label} callout`;
    cmd('Insert', label, insertDirective(ctx, n, n === 'admonition' ? 'Title' : ''), n === 'note' ? keysFor('Callout (note)') : '');
  }
  add('Insert', 'Figure…', () => void insertFigure(ctx, run), keysFor('Figure'));
  add('Insert', 'Image…', () => void insertImage(ctx, run), '');
  add('Insert', 'Table…', () => window.dispatchEvent(new CustomEvent('mysteditor-table-picker')), keysFor('Table'));
  cmd('Insert', 'Table with caption', insertCaptionedTable(ctx));
  cmd('Insert', 'Code block', insertCodeBlock());
  cmd('Insert', 'Equation', insertMath(ctx), '');
  cmd('Insert', 'Dropdown', insertDirective(ctx, 'dropdown', 'Click to expand'), '');
  cmd('Insert', 'Divider', insertDivider, '');
  cmd('Insert', 'Table of contents', insertCard(ctx, 'toctree', '', [['maxdepth', '2']]), '');
  add('Insert', 'Cross-reference…', () => void insertReference(ctx, run, view.state), keysFor('Cross-reference'));
  add('Insert', 'Link target…', () => void insertTarget(ctx, view.state, run), '');

  if (isInTable(view.state)) for (const [label, command] of Object.values(TABLE_COMMANDS)) if (can(command)) add('Table', label, () => run(command), '');
  return out;
}
