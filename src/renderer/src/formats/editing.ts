// What the editor offers for a page's format (see core/format.ts): what can be
// inserted, the callouts, and how its blocks are presented. MyST's are in myst/.
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { Extension } from '@codemirror/state';
import type { Rename } from '../../../core/rename';
import type { PageConfig } from '../../../core/format';
import type { EditorConfig } from '../../../core/editor-config';
import type { EditorContext, Field } from '../editor/context';
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
  config: PageConfig; // the referring page's
}

// The page's source in the Markdown view.
export interface SourceSyntax {
  label: string; // what it's called: "Markdown"
  extensions(): Extension[]; // its highlighting
  image(path: string): string; // a picture added there
}

// A form a card is edited with, in place of its source: its fields, and the source they make.
export interface CardForm {
  title: string;
  fields: Field[];
  source(values: Record<string, string>): string;
}

export interface Media {
  kind: 'video' | 'audio';
  title: string | null;
  src?: string;
  site?: string;
  id?: string;
}

// Blocks kept as written, shown as cards.
export interface Cards {
  label(kind: string): string; // a kind of block kept as written, for the writer
  editTitle(name: string): string; // the edit dialog's, for a block the editor doesn't know
  comment(source: string): string; // a comment's text, without its markers
  // How a block of this kind looks, if the format can show it (now, or once it's made).
  preview(kind: string, source: string, assetUrl: (src: string) => string): DocumentFragment | Promise<DocumentFragment> | null;
  // A form to edit a block of this kind with, in place of its source.
  form?(kind: string, source: string): CardForm | null;
  // Links whose address a block's new source changes (a link target's, say): from, to.
  relink?(kind: string, before: string, after: string): [string, string][];
  // What a directive plays, if it's a video or a sound: a file of the project's (`src`,
  // as written), or one on a site (YouTube, say: `site`, and its id there).
  media?(name: string, args: string, source: string): Media | null;
  // One for a directive (a block the format has a name for) shown as a card.
  directiveForm?(name: string, source: string): CardForm | null;
}

// Inline roles that refer to something else.
export interface Roles {
  references: Record<string, string>; // which roles do, and what to call what they refer to
  split(value: string): { title: string | null; target: string }; // "Title <target>"
  // The page Ctrl+click opens, if any: relative to `from`'s page, or (with a leading /)
  // to its project's folder.
  page(name: string, target: string, from: { config: PageConfig; page: string | null }): string | null;
  // What a role of the format's own shows (and says when pointed at), if not the usual.
  // `where`: the page, and where in it (a value set above, say).
  shown?(name: string, value: string, config: PageConfig, where: { doc: PMNode; pos: number }): { text: string; title: string; missing?: boolean } | null;
}

// Pictures, where the format has more to say about them than a path from the page.
export interface Images {
  // Where a picture written as `ref` on `page` is, from the page (AsciiDoc's are under
  // :imagesdir:, from the main document's folder).
  fromPage(ref: string, config: PageConfig, page: string): string;
  // How a picture at `path` (from the page) is written in it.
  toRef(path: string, config: PageConfig, page: string): string;
  // An image's width as written ("300", "50%"), and its attributes with another.
  width(attrs: Record<string, unknown>): string | null;
  withWidth(attrs: Record<string, unknown>, width: string | null): Record<string, unknown>;
}

export interface EditingFormat {
  inserts(ctx: EditorContext): InsertItem[];
  // A page's references to a renamed or moved page, changed to match.
  renameReferences(state: EditorState, rename: ReferenceRename): Transaction;
  callouts: Callouts;
  // How a block is presented: the project's settings first, then the format's own.
  block(name: string, editor?: EditorConfig): DirectiveInfo;
  // What the status bar says the page is (`label`), and how it's read (`detail`).
  // `marker`: the file that makes the page's project one (its conf.py), if it has one.
  dialect(config: PageConfig, marker: string | null): { label: string; detail: string };
  source: SourceSyntax;
  cards: Cards;
  roles: Roles;
  images?: Images;
  // The option that names a figure or a table, for cross-references: "name" if not said.
  nameOption?: string;
  // How its table cells are: a line of text each, aligned as their column ('line',
  // Markdown's, if not said); or paragraphs, or blocks, aligned on their own.
  cells?: 'line' | 'blocks';
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
