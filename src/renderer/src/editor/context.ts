// What node views and commands need from the surrounding app.
import type { MystConfig } from '../../../core/project-config';
import type { SourceMap } from '../../../core/sourcemap';

export interface Field {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  help?: string;
  choices?: { value: string; label: string }[];
}

export interface EditorUi {
  editSource(opts: { title: string; source: string; help?: string }): Promise<string | null>;
  editFields(opts: { title: string; fields: Field[]; submit?: string }): Promise<Record<string, string> | null>;
  editOptions(opts: { title: string; options: [string, string][] }): Promise<[string, string][] | null>;
  notify(message: string): void;
}

export interface EditorContext {
  ui: EditorUi;
  config: MystConfig;
  // The open page, relative to the Sphinx source directory.
  filePath: string | null;
  // URL for an image referenced from the open page.
  assetUrl(ref: string): string;
  // Open the page a {doc} role or toctree entry points at.
  openDocument(ref: string): void;
  // That page's title, if known.
  pageTitle(ref: string): string | null;
  // Merge source entries from a fragment the writer re-parsed (see SourceMap.merge).
  absorb(map: SourceMap): void;
}
