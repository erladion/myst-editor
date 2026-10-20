// Adding and removing pages, including their entries in tables of contents.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { ProjectInfo, SphinxProject } from '../../shared/api';
import type { SphinxInfo } from '../../shared/sphinx';
import { addTocEntry, entryFor, globIncludes, insertTocEntry, removeTocEntries, retarget, takeTocEntry } from '../../core/toctree';
import { loadDocument } from '../../core/document';
import { configFor } from '../../shared/projects';
import { dirname } from './paths';
import type { Workspace } from './workspace';

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

// A page's Sphinx name: its path in the project's source directory, without .md.
export function docnameOf(project: SphinxProject | null, path: string): string {
  const rel = project?.dir && path.startsWith(project.dir + '/') ? path.slice(project.dir.length + 1) : path;
  return rel.replace(/\.md$/, '');
}

function toctrees(doc: PMNode): { node: PMNode; pos: number }[] {
  const found: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'opaque_directive' && node.attrs.name === 'toctree') found.push({ node, pos });
    return !node.isTextblock;
  });
  return found;
}

const hasToctree = (text: string) => /^\s*(`{3,}|~{3,}|:{3,})\{toctree\}/m.test(text);

// Pages that could list a new page in their contents: those with a toctree, from the
// last build, or (without one) by reading the likely ones: index pages and `extra`.
export async function contentsPages(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, extra: (string | null)[]): Promise<string[]> {
  const files = ws.project.files.filter((f) => !project?.dir || f.startsWith(project.dir + '/'));
  const built = info ? Object.values(info.docs).filter((d) => d.children.length).map((d) => d.source) : [];
  const likely = [...new Set([...built, ...extra.filter((e): e is string => !!e), ...files.filter((f) => /(^|\/)index\.md$/.test(f))])].filter((f) => files.includes(f));
  const out: string[] = [];
  for (const f of likely) {
    if (built.includes(f)) out.push(f);
    else if (hasToctree(await ws.api.readFile(f).catch(() => ''))) out.push(f);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// The page with `docname` added to the end of its first table of contents. Null if
// a :glob: pattern there already takes it in (or there's no toctree).
function withEntry(state: EditorState, project: SphinxProject | null, tocPage: string, docname: string) {
  const fromDir = dirname(docnameOf(project, tocPage));
  const [toc] = toctrees(state.doc);
  if (!toc || globIncludes(toc.node.attrs.source, docname, fromDir)) return null;
  return state.tr.setNodeMarkup(toc.pos, null, { ...toc.node.attrs, source: addTocEntry(toc.node.attrs.source, entryFor(docname, fromDir)) });
}

export function addToContents(ws: Workspace, project: SphinxProject | null, tocPage: string, page: string): Promise<boolean> {
  return ws.edit(tocPage, (state) => withEntry(state, project, tocPage, docnameOf(project, page)));
}

// Pages whose tables of contents list `page`: its parents in the last build, or
// (without one) every page of the project with a toctree.
export async function listingPages(ws: Workspace, project: SphinxProject | null, info: SphinxInfo | null, page: string): Promise<string[]> {
  const docname = docnameOf(project, page);
  if (info) {
    return Object.values(info.docs)
      .filter((d) => d.children.includes(docname))
      .map((d) => d.source)
      .filter((s) => ws.project.files.includes(s));
  }
  const files = ws.project.files.filter((f) => f !== page && (!project?.dir || f.startsWith(project.dir + '/')));
  const out: string[] = [];
  for (const f of files) if (hasToctree(await ws.api.readFile(f).catch(() => ''))) out.push(f);
  return out;
}

// Take `page` out of the tables of contents on `pages`.
export async function removeFromContents(ws: Workspace, project: SphinxProject | null, pages: string[], page: string): Promise<string[]> {
  const docname = new Set([docnameOf(project, page)]);
  const failed: string[] = [];
  for (const tocPage of pages) {
    const fromDir = dirname(docnameOf(project, tocPage));
    const ok = await ws.edit(tocPage, (state) => {
      let tr = state.tr;
      for (const { node, pos } of toctrees(state.doc)) {
        const next = removeTocEntries(node.attrs.source, docname, fromDir);
        if (next !== null) tr = tr.setNodeMarkup(pos, null, { ...node.attrs, source: next });
      }
      return tr;
    });
    if (!ok) failed.push(tocPage);
  }
  return failed;
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
    const index = d ? `${d}/index.md` : 'index.md';
    if (pages.includes(index)) return index;
    if (!d) return null;
  }
}

// Moving a page in the contents: out of one page's table of contents (if it was in
// one) and into another's, before a given page or at the end. The page's file stays
// where it is.
export interface ContentsMove {
  page: string; // the page moved
  from: string | null; // the page whose contents list it; null if none does
  to: string; // the page whose contents get it
  before: string | null; // the page it goes in front of; null: at the end
}

export async function moveInContents(ws: Workspace, project: SphinxProject | null, move: ContentsMove): Promise<string | null> {
  const doc = docnameOf(project, move.page);
  const before = move.before && docnameOf(project, move.before);
  const dirOf = (page: string) => dirname(docnameOf(project, page));
  const toDir = dirOf(move.to);
  const title = (p: string) => ws.project.titles[p] ?? p;

  // The entry as written where it is now, to keep its "Title <path>" form.
  let text: string | null = null;
  if (move.from) {
    const fromDir = dirOf(move.from);
    for (const { node } of toctrees((await ws.stateOf(move.from)).doc)) {
      text ??= takeTocEntry(node.attrs.source, doc, fromDir)?.text ?? null;
    }
    if (text === null) return `“${title(move.page)}” is listed in “${title(move.from)}” by a pattern (:glob:), so its place there follows the pattern. Change it in the Markdown view.`;
  }
  const entry = text !== null ? retarget(text, doc, toDir) : entryFor(doc, toDir);

  // Into the new place first, so a failure can't lose the page from the contents.
  const into = (state: EditorState) => {
    let tr = state.tr;
    // Moving within one page: out of where it is (and remember which toctree that was).
    // Toctrees are atoms, so changing one leaves the others' positions as they were.
    let home: number | null = null;
    if (move.from === move.to) {
      for (const { node, pos } of toctrees(tr.doc)) {
        const taken = takeTocEntry(node.attrs.source, doc, toDir);
        if (!taken) continue;
        tr = tr.setNodeMarkup(pos, null, { ...node.attrs, source: taken.source });
        home ??= pos;
      }
    }
    const now = toctrees(tr.doc);
    if (!now.length) {
      // A page with no table of contents gets one, at its end.
      const { doc: snippet, map } = loadDocument('```{toctree}\n' + entry.trim() + '\n```\n', configFor(ws.project, move.to));
      ws.absorbInto(move.to, map);
      return tr.insert(tr.doc.content.size, snippet.content);
    }
    for (const { node, pos } of now) {
      const next = before ? insertTocEntry(node.attrs.source, entry, before, toDir) : null;
      if (next !== null) return tr.setNodeMarkup(pos, null, { ...node.attrs, source: next });
    }
    // At the end: of the toctree it was in (moving within a page), else the last one.
    const target = now.find((t) => t.pos === home) ?? now[now.length - 1];
    return tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, source: addTocEntry(target.node.attrs.source, entry.trim()) });
  };
  if (!(await ws.edit(move.to, into))) return `“${title(move.to)}” is open in the Markdown view or couldn’t be saved.`;
  if (move.from && move.from !== move.to) {
    const fromDir = dirOf(move.from);
    const out = await ws.edit(move.from, (state) => {
      let tr = state.tr;
      for (const { node, pos } of toctrees(state.doc)) {
        const taken = takeTocEntry(node.attrs.source, doc, fromDir);
        if (taken) tr = tr.setNodeMarkup(pos, null, { ...node.attrs, source: taken.source });
      }
      return tr;
    });
    if (!out) return `It’s now also in “${title(move.to)}”, but couldn’t be taken out of “${title(move.from)}”, which is open in the Markdown view or couldn’t be saved.`;
  }
  return null;
}

// Pages matching what was typed in Go to page, best first: every word must appear in
// the title or the path; titles starting with the text come first, then titles
// containing it, then the rest, each group with recently opened pages first. With
// nothing typed: the recent pages, then the others by title.
export function rankPages(query: string, files: string[], titles: Record<string, string>, recent: string[], limit = 50): string[] {
  const title = (f: string) => titles[f] ?? f.split('/').pop()!.replace(/\.md$/, '');
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
