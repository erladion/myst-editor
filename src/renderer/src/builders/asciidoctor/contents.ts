// An Asciidoctor project's contents: the include:: lines of its main document (and
// of the pages it includes that include others). A project without a main document
// has none: its pages stand on their own.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import { relativePath } from '../../../../core/rename';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { fromProject } from '../../../../shared/projects';
import type { Project } from '../../../../shared/api';
import { dirname, join } from '../../paths';
import type { Contents } from '../contents';

const mainOf = (project: Project | null) => {
  const main = project && (project.config as AsciidocConfig).main;
  return project && main ? fromProject(project, main) : null;
};

// The include blocks in a page, with the page each includes.
function includes(doc: PMNode, page: string): { node: PMNode; pos: number; target: string | null }[] {
  const out: { node: PMNode; pos: number; target: string | null }[] = [];
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.opaque_directive && node.attrs.name === 'include') out.push({ node, pos, target: join(dirname(page), node.attrs.args) });
    return !node.isTextblock;
  });
  return out;
}

const includeLine = (from: string, page: string) => `include::${relativePath(dirname(from), page)}[leveloffset=+1]`;
const includeNode = (source: string, args: string) => schema.nodes.opaque_directive.create({ name: 'include', args, options: [], source });

const hasIncludes = (text: string) => /^include::[^\s[]+\.adoc\[/m.test(text);

export const asciidoctorContents: Contents = {
  // The main document, and the pages that include others (from the build, or read).
  async pages(ws, project, info, extra) {
    const main = mainOf(project);
    if (!main) return [];
    const built = info ? Object.values(info.docs).filter((d) => d.children.length).map((d) => d.source) : [];
    const out = new Set([main, ...built]);
    for (const e of extra) if (e && e.endsWith('.adoc') && ws.project.files.includes(e) && hasIncludes(await ws.api.readFile(e).catch(() => ''))) out.add(e);
    return [...out].filter((f) => ws.project.files.includes(f)).sort((a, b) => a.localeCompare(b));
  },

  add(ws, _project, tocPage, page) {
    return ws.edit(tocPage, (state) => {
      const line = includeLine(tocPage, page);
      return state.tr.insert(state.doc.content.size, includeNode(line, relativePath(dirname(tocPage), page)));
    });
  },

  async listing(ws, project, info, page) {
    if (!mainOf(project)) return [];
    if (info) {
      const doc = Object.entries(info.docs).find(([, d]) => d.source === page)?.[0];
      return Object.values(info.docs)
        .filter((d) => doc && d.children.includes(doc))
        .map((d) => d.source);
    }
    const out: string[] = [];
    for (const f of ws.project.files.filter((f) => f.endsWith('.adoc') && f !== page)) {
      const text = await ws.api.readFile(f).catch(() => '');
      if (text.split('\n').some((l) => /^include::/.test(l) && join(dirname(f), /^include::([^\s[]+)\[/.exec(l)?.[1] ?? '') === page)) out.push(f);
    }
    return out;
  },

  async remove(ws, _project, pages, page) {
    const failed: string[] = [];
    for (const tocPage of pages) {
      const ok = await ws.edit(tocPage, (state) => {
        let tr = state.tr;
        for (const inc of includes(state.doc, tocPage).reverse()) if (inc.target === page) tr = tr.delete(inc.pos, inc.pos + inc.node.nodeSize);
        return tr;
      });
      if (!ok) failed.push(tocPage);
    }
    return failed;
  },

  async move(ws, project, move) {
    if (!mainOf(project)) return 'This project’s pages stand on their own: it has no main document to list them in.';
    const title = (p: string) => ws.project.titles[p] ?? p;
    // The include as written where it is now (its leveloffset, say).
    let line: string | null = null;
    if (move.from) {
      const found = includes((await ws.stateOf(move.from)).doc, move.from).find((i) => i.target === move.page);
      line = found?.node.attrs.source ?? null;
    }
    const args = relativePath(dirname(move.to), move.page);
    const source = line ? line.replace(/^(include::)[^\s[]+/, `$1${args}`) : includeLine(move.to, move.page);
    const into = (state: EditorState) => {
      let tr = state.tr;
      if (move.from === move.to) for (const inc of includes(tr.doc, move.to).reverse()) if (inc.target === move.page) tr = tr.delete(inc.pos, inc.pos + inc.node.nodeSize);
      const before = move.before ? includes(tr.doc, move.to).find((i) => i.target === move.before) : undefined;
      return tr.insert(before ? before.pos : tr.doc.content.size, includeNode(source, args));
    };
    if (!(await ws.edit(move.to, into))) return `“${title(move.to)}” is open in the source view or couldn’t be saved.`;
    if (move.from && move.from !== move.to) {
      const from = move.from;
      const out = await ws.edit(from, (state) => {
        let tr = state.tr;
        for (const inc of includes(state.doc, from).reverse()) if (inc.target === move.page) tr = tr.delete(inc.pos, inc.pos + inc.node.nodeSize);
        return tr;
      });
      if (!out) return `It’s now also in “${title(move.to)}”, but couldn’t be taken out of “${title(from)}”, which is open in the source view or couldn’t be saved.`;
    }
    return null;
  },
};
