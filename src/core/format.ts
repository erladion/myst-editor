// The formats pages can be written in: MyST Markdown, for now.
//
// A format has two halves. This one says which files are its pages and what a page's
// title is; it's light, for the main process too. The other, formats.ts, reads pages
// into the editor's document and writes them back.
import type { Node as PMNode } from 'prosemirror-model';
import type { MystConfig } from './project-config.js';
import type { SourceMap } from './sourcemap.js';
import { mystPages } from './myst/pages.js';

export type FormatId = 'myst';

// How a project's pages are read: the format and its settings. One kind for now.
export type PageConfig = MystConfig;

export interface PageFormat {
  id: FormatId;
  name: string; // for the writer, e.g. "MyST Markdown"
  extension: string; // of its pages (and new ones), e.g. ".md"
  // A page's title: its first heading, as plain text.
  title(text: string): string | null;
}

export interface LoadedDocument {
  doc: PMNode;
  map: SourceMap;
}

// Reading a page into the editor's document, and writing it back: blocks that are
// unchanged since reading as they were written.
export interface Format extends PageFormat {
  load(text: string, config: PageConfig): LoadedDocument;
  save(doc: PMNode, map: SourceMap, config: PageConfig): string;
}

export const PAGE_FORMATS: PageFormat[] = [mystPages];

// The format of the page at `path`, by its extension; null if it isn't a page.
export function pageFormat(path: string): PageFormat | null {
  return PAGE_FORMATS.find((f) => path.endsWith(f.extension)) ?? null;
}

export const isPage = (path: string) => pageFormat(path) !== null;

// A page's path without its extension: "guide/index.md" → "guide/index".
export function pageStem(path: string): string {
  const format = pageFormat(path);
  return format ? path.slice(0, -format.extension.length) : path;
}

// Whether it's a folder's index page (its landing page).
export const isIndexPage = (path: string) => isPage(path) && /(^|\/)index$/.test(pageStem(path));

export const pageExtensions = () => PAGE_FORMATS.map((f) => f.extension);

// The pages of a project with these settings.
export const pagesOf = (config: PageConfig): PageFormat => PAGE_FORMATS.find((f) => f.id === config.format)!;
