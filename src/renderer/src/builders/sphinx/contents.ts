// Sphinx's tables of contents: toctree directives in the pages.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { Project } from '../../../../shared/api';
import { addTocEntry, entryFor, globIncludes, insertTocEntry, removeTocEntries, retarget, takeTocEntry } from '../../../../core/toctree';
import { loadDocument } from '../../../../core/document';
import { configFor } from '../../../../shared/projects';
import { isIndexPage } from '../../../../core/format';
import { dirname } from '../../paths';
import { docnameOf } from '../../pages';
import type { Contents } from '../contents';

function toctrees(doc: PMNode): { node: PMNode; pos: number }[] {
  const found: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'opaque_directive' && node.attrs.name === 'toctree') found.push({ node, pos });
    return !node.isTextblock;
  });
  return found;
}

const hasToctree = (text: string) => /^\s*(`{3,}|~{3,}|:{3,})\{toctree\}/m.test(text);

// The page with `docname` added to the end of its first table of contents. Null if
// a :glob: pattern there already takes it in (or there's no toctree).
function withEntry(state: EditorState, project: Project | null, tocPage: string, docname: string) {
  const fromDir = dirname(docnameOf(project, tocPage));
  const [toc] = toctrees(state.doc);
  if (!toc || globIncludes(toc.node.attrs.source, docname, fromDir)) return null;
  return state.tr.setNodeMarkup(toc.pos, null, { ...toc.node.attrs, source: addTocEntry(toc.node.attrs.source, entryFor(docname, fromDir)) });
}

export const sphinxContents: Contents = {
  // Those with a toctree: from the last build, or (without one) reading index pages and `extra`.
  async pages(ws, project, info, extra) {
    const files = ws.project.files.filter((f) => !project?.dir || f.startsWith(project.dir + '/'));
    const built = info ? Object.values(info.docs).filter((d) => d.children.length).map((d) => d.source) : [];
    const likely = [...new Set([...built, ...extra.filter((e): e is string => !!e), ...files.filter(isIndexPage)])].filter((f) => files.includes(f));
    const out: string[] = [];
    for (const f of likely) {
      if (built.includes(f)) out.push(f);
      else if (hasToctree(await ws.api.readFile(f).catch(() => ''))) out.push(f);
    }
    return out.sort((a, b) => a.localeCompare(b));
  },

  add(ws, project, tocPage, page) {
    return ws.edit(tocPage, (state) => withEntry(state, project, tocPage, docnameOf(project, page)));
  },

  // Its parents in the last build, or (without one) every page of the project with a toctree.
  async listing(ws, project, info, page) {
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
  },

  async remove(ws, project, pages, page) {
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
  },

  async move(ws, project, move) {
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
  },
};
