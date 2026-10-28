// A project's tables of contents: which pages list which, and changing that when
// pages are added, removed or moved. Where they're kept is the builder's business
// (Sphinx: toctree directives in the pages), so each builder has its own.
import type { Project } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/build';
import type { Workspace } from '../workspace';
import { builderFor } from './builder';

// Moving a page in the contents: out of one page's table of contents (if it was in
// one) and into another's, before a given page or at the end. The page's file stays
// where it is.
export interface ContentsMove {
  page: string; // the page moved
  from: string | null; // the page whose contents list it; null if none does
  to: string; // the page whose contents get it
  before: string | null; // the page it goes in front of; null: at the end
  // The entries it moves out of and into, by their names in the build, for contents
  // whose entries aren't all pages (a heading over some pages, say).
  entries?: { from: string | null; to: string };
}

export interface Contents {
  // Pages that could list a new page in their contents: from the last build, or
  // (without one) by reading the likely ones, and `extra`.
  pages(ws: Workspace, project: Project | null, info: BuildInfo | null, extra: (string | null)[]): Promise<string[]>;
  // `page` added to the end of `tocPage`'s contents. False if it couldn't be.
  add(ws: Workspace, project: Project | null, tocPage: string, page: string): Promise<boolean>;
  // Pages whose contents list `page`.
  listing(ws: Workspace, project: Project | null, info: BuildInfo | null, page: string): Promise<string[]>;
  // `page` taken out of the contents on `pages`; the pages that couldn't be changed.
  remove(ws: Workspace, project: Project | null, pages: string[], page: string): Promise<string[]>;
  // Null when done, else what went wrong, for the writer.
  move(ws: Workspace, project: Project | null, move: ContentsMove): Promise<string | null>;
  // Of `pages`, the one a new page in `folder` most likely goes in, when it isn't the
  // nearest index page (see pages.ts).
  likely?(project: Project | null, folder: string, pages: string[]): string | null;
}

export const contentsFor = (project: Project | null): Contents => builderFor(project).contents;
