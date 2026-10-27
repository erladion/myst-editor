// Adding and removing pages, including their entries in tables of contents (see
// builders/contents.ts), and their references when they're renamed or moved.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { ProjectInfo, SphinxProject } from '../../shared/api';
import type { SphinxInfo } from '../../shared/sphinx';
import type { Rename } from '../../core/rename';
import { configFor } from '../../shared/projects';
import { isIndexPage, pageStem } from '../../core/format';
import { contentsFor, type ContentsMove } from './builders/contents';
import { editingFor } from './formats/editing';
import { dirname } from './paths';
import type { Workspace } from './workspace';

export type { ContentsMove } from './builders/contents';

// A file name from a title: "Installing on RHEL 9" → "installing-on-rhel-9".
export function pageSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-') || 'page'
  );
}

// A page's Sphinx name: its path in the project's source directory, without its extension.
export function docnameOf(project: SphinxProject | null, path: string): string {
  const rel = project?.dir && path.startsWith(project.dir + '/') ? path.slice(project.dir.length + 1) : path;
  return pageStem(rel);
}

export function contentsPages(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, extra: (string | null)[]): Promise<string[]> {
  return contentsFor(project).pages(ws, project, info, extra);
}

export function addToContents(ws: Workspace, project: SphinxProject | null, tocPage: string, page: string): Promise<boolean> {
  return contentsFor(project).add(ws, project, tocPage, page);
}

export function listingPages(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, page: string): Promise<string[]> {
  return contentsFor(project).listing(ws, project, info, page);
}

export function removeFromContents(ws: Workspace, project: SphinxProject | null, pages: string[], page: string): Promise<string[]> {
  return contentsFor(project).remove(ws, project, pages, page);
}

// Where a new page goes by default: the current page's folder.
export function folderOf(path: string | null, project: SphinxProject | null): string {
  if (path) return dirname(path);
  return project?.dir ?? '';
}

// Folders a page can go in: every folder holding pages, and the folders above them.
export function pageFolders(project: ProjectInfo): string[] {
  const folders = new Set<string>(['']);
  for (const f of project.files) for (let d = dirname(f); d; d = dirname(d)) folders.add(d);
  return [...folders].sort((a, b) => a.localeCompare(b));
}

// The table of contents a page in `folder` most likely belongs in: the nearest
// index page at or above it that has one.
export function defaultContents(project: ProjectInfo, folder: string, pages: string[]): string | null {
  for (let d = folder; ; d = dirname(d)) {
    const index = pages.find((p) => dirname(p) === d && isIndexPage(p));
    if (index) return index;
    if (!d) return null;
  }
}

export function moveInContents(ws: Workspace, project: SphinxProject | null, move: ContentsMove): Promise<string | null> {
  return contentsFor(project).move(ws, project, move);
}

// Pages matching what was typed in Go to page, best first: every word must appear in
// the title or the path; titles starting with the text come first, then titles
// containing it, then the rest, each group with recently opened pages first. With
// nothing typed: the recent pages, then the others by title.
export function rankPages(query: string, files: string[], titles: Record<string, string>, recent: string[], limit = 50): string[] {
  const title = (f: string) => titles[f] ?? pageStem(f.split('/').pop()!);
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const recency = (f: string) => {
    const i = recent.indexOf(f);
    return i < 0 ? recent.length : i;
  };
  const scored = files
    .filter((f) => words.every((w) => `${title(f)} ${f}`.toLowerCase().includes(w)))
    .map((f) => {
      const t = title(f).toLowerCase();
      const group = !q ? (recent.includes(f) ? 0 : 1) : t.startsWith(q) ? 0 : t.includes(q) ? 1 : words.every((w) => t.includes(w)) ? 2 : 3;
      return { f, group, recency: recency(f), t };
    });
  scored.sort((a, b) => a.group - b.group || a.recency - b.recency || a.t.localeCompare(b.t));
  return scored.slice(0, limit).map((s) => s.f);
}

// ---- renaming and moving ----------------------------------------------------------

// The page's first heading (its title) set to `title`.
export function retitle(state: EditorState, title: string) {
  let found: { node: PMNode; pos: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'heading') found = { node, pos };
    return !node.isTextblock;
  });
  if (!found) return null;
  const { node, pos } = found as { node: PMNode; pos: number };
  if (node.textContent === title) return null;
  return state.tr.insertText(title, pos + 1, pos + node.nodeSize - 1);
}

// Every reference to a renamed or moved page, in the pages that may have one (those
// mentioning its old file name), and the moved page's own relative references when
// it changed folder. Returns the pages that couldn't be updated.
export async function renameReferences(ws: Workspace, project: SphinxProject | null, oldPath: string, newPath: string): Promise<string[]> {
  const inProject = (p: string) => (project?.dir && p.startsWith(project.dir + '/') ? p.slice(project.dir.length + 1) : p);
  const docRename: Rename = { from: pageStem(inProject(oldPath)), to: pageStem(inProject(newPath)) };
  const fileRename: Rename = { from: inProject(oldPath), to: inProject(newPath) };
  const stem = pageStem(oldPath.split('/').pop()!);
  const files = ws.project.files.filter((f) => !project?.dir || f.startsWith(project.dir + '/'));
  const pages: string[] = [newPath];
  for (const f of files) if (f !== newPath && (await ws.api.readFile(f).catch(() => '')).includes(stem)) pages.push(f);

  const failed: string[] = [];
  for (const page of pages) {
    const moved = page === newPath;
    const folder = moved ? { before: dirname(inProject(oldPath)), after: dirname(inProject(newPath)) } : { before: dirname(inProject(page)), after: dirname(inProject(page)) };
    const ok = await ws.edit(page, (state) => editingFor(configFor(ws.project, page)).renameReferences(state, { folder, page: docRename, file: fileRename, moved }));
    if (!ok) failed.push(page);
  }
  return failed;
}
