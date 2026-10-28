// What node views and commands need from the surrounding app.
import type { PageConfig } from '../../../core/format';
import type { ConditionsDef, OptionDef } from '../../../core/editor-config';
import type { SourceMap } from '../../../core/sourcemap';
import type { Resolution, Suggestion } from '../build';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

export interface Field {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  help?: string;
  choices?: { value: string; label: string }[];
  // Autocomplete; a function gets the form's current values (e.g. to depend on a choice).
  suggestions?: Suggestion[] | ((values: Record<string, string>) => Suggestion[]);
  // A "Choose…" button next to the field, filling it in (null: cancelled).
  browse?: () => Promise<string | null>;
}

export interface EditorUi {
  editSource(opts: { title: string; source: string; help?: string }): Promise<string | null>;
  editFields(opts: { title: string; fields: Field[]; submit?: string }): Promise<Record<string, string> | null>;
  editOptions(opts: { title: string; options: [string, string][]; schema?: Record<string, OptionDef> }): Promise<[string, string][] | null>;
  // Edit a condition's expression; `remove` when the writer removes the condition.
  editCondition(opts: { expr: string; settings: ConditionsDef; allowRemove: boolean }): Promise<{ expr: string } | { remove: true } | null>;
  notify(message: string): void;
}

export interface EditorContext {
  ui: EditorUi;
  config: PageConfig;
  // The open page, relative to the Sphinx source directory.
  filePath: string | null;
  // Pick an image file for the open page (see MystApi.chooseImage).
  chooseImage(): Promise<string | null>;
  // An image pasted or dropped into the open page, as the path to write in it.
  addImage(file: File): Promise<string>;
  // URL for an image referenced from the open page.
  assetUrl(ref: string): string;
  // Open the page a {doc} role or toctree entry points at.
  openDocument(ref: string): void;
  // That page's title, if known.
  pageTitle(ref: string): string | null;
  // Merge source entries from a fragment the writer re-parsed (see SourceMap.merge).
  absorb(map: SourceMap): void;
  // Cross-references, from the latest Sphinx build.
  resolveRole(role: string, target: string): Resolution;
  resolveLink(href: string): Resolution;
  suggest(role: string): Suggestion[];
  // The open page's project's other pages as they are now (open ones with their
  // edits), for referring to what's on them.
  otherPages(): Promise<{ path: string; title: string; doc: PMNode }[]>;
  // Change another page and save it; false if it's open as Markdown or couldn't be saved.
  editPage(path: string, change: (state: EditorState) => Transaction | null): Promise<boolean>;
  // Called whenever build results change, so node views can refresh.
  subscribe(listener: () => void): () => void;
}
