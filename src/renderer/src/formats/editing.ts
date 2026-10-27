// What the editor offers for a page's format (see core/format.ts): what can be
// inserted, the callouts, and how its blocks are presented. MyST's are in myst/.
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Rename } from '../../../core/rename';
import type { PageConfig } from '../../../core/format';
import type { EditorConfig } from '../../../core/editor-config';
import type { EditorContext } from '../editor/context';
import type { DirectiveInfo } from '../editor/tones';
import { mystEditing } from './myst';

export type InsertGroup = 'Callouts' | 'Version notes' | 'Blocks' | 'Text' | 'Structure' | 'This project' | 'Inline';

export interface InsertItem {
  // The same thing has the same id in every format: a note, a figure, a table of contents.
  id: string;
  group: InsertGroup;
  label: string; // in the Insert menu
  palette?: string; // its name in the command palette, if it's offered there
  keys?: string; // the name of its shortcut (see shortcuts.ts)
  // Inserting it: a command (the palette offers it only where it can go), or something
  // that asks first. `state` is the page's, when there's one.
  command?: Command;
  ask?: (run: (cmd: Command) => void, state: EditorState | undefined) => void;
}

export interface Callouts {
  names: string[]; // offered when changing a callout's type, in order
  is(name: string): boolean;
  label(name: string): string;
  // The attributes that change when a callout's type does.
  change(from: string, to: string, args: string): Record<string, unknown>;
}

// A page renamed or moved, as seen from a page that may refer to it.
export interface ReferenceRename {
  folder: { before: string; after: string }; // the referring page's folder, before and after (it moves if it's the page itself)
  page: Rename; // the page's name (its path without the extension), in its project
  file: Rename; // its file's path, in its project
  moved: boolean; // the referring page is the one renamed: its own relative paths follow it
}

export interface EditingFormat {
  inserts(ctx: EditorContext): InsertItem[];
  // A page's references to a renamed or moved page, changed to match.
  renameReferences(state: EditorState, rename: ReferenceRename): Transaction;
  callouts: Callouts;
  // How a block is presented: the project's settings first, then the format's own.
  block(name: string, editor?: EditorConfig): DirectiveInfo;
}

const FORMATS: Record<PageConfig['format'], EditingFormat> = { myst: mystEditing };

export const editingFor = (config: PageConfig): EditingFormat => FORMATS[config.format];

// One of the page's format's insert items, if it has it.
export function insertItem(ctx: EditorContext, id: string): InsertItem | undefined {
  return editingFor(ctx.config)
    .inserts(ctx)
    .find((i) => i.id === id);
}

// Insert it: its command, or what it asks first.
export function runInsert(item: InsertItem, run: (cmd: Command) => void, state: EditorState | undefined) {
  if (item.command) run(item.command);
  else item.ask?.(run, state);
}
