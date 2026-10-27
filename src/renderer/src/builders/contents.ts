// A project's tables of contents: which pages list which, and changing that when
// pages are added, removed or moved. Where they're kept is the builder's business
// (Sphinx: toctree directives in the pages), so each builder has its own.
import type { SphinxProject } from '../../../shared/api';
import type { SphinxInfo } from '../../../shared/sphinx';
import type { Workspace } from '../workspace';
import { sphinxContents } from './sphinx/contents';

// Moving a page in the contents: out of one page's table of contents (if it was in
// one) and into another's, before a given page or at the end. The page's file stays
// where it is.
export interface ContentsMove {
  page: string; // the page moved
  from: string | null; // the page whose contents list it; null if none does
  to: string; // the page whose contents get it
  before: string | null; // the page it goes in front of; null: at the end
}

export interface Contents {
  // Pages that could list a new page in their contents: from the last build, or
  // (without one) by reading the likely ones, and `extra`.
  pages(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, extra: (string | null)[]): Promise<string[]>;
  // `page` added to the end of `tocPage`'s contents. False if it couldn't be.
  add(ws: Workspace, project: SphinxProject | null, tocPage: string, page: string): Promise<boolean>;
  // Pages whose contents list `page`.
  listing(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, page: string): Promise<string[]>;
  // `page` taken out of the contents on `pages`; the pages that couldn't be changed.
  remove(ws: Workspace, project: SphinxProject | null, pages: string[], page: string): Promise<string[]>;
  // Null when done, else what went wrong, for the writer.
  move(ws: Workspace, project: SphinxProject | null, move: ContentsMove): Promise<string | null>;
}

export const contentsFor = (_project: SphinxProject | null): Contents => sphinxContents;
