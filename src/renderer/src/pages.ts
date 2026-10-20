// Adding and removing pages, including their entries in tables of contents.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { ProjectInfo, SphinxProject } from '../../shared/api';
import type { SphinxInfo } from '../../shared/sphinx';
import { addTocEntry, entryFor, globIncludes, removeTocEntries } from '../../core/toctree';
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
