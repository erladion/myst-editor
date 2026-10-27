// A renamed or moved page's references in a MyST page: {doc} roles, links to the
// page's file, toctree entries, and (on the moved page itself) its relative paths.
import type { EditorState, Transaction } from 'prosemirror-state';
import { rewriteRef, rewriteTitled } from '../../../../core/rename';
import type { ReferenceRename } from '../editing';

// Directives whose argument is a path relative to the page.
const PATH_DIRECTIVES = new Set(['figure', 'image', 'include', 'literalinclude']);

export function renameMystReferences(state: EditorState, { folder, page, file, moved }: ReferenceRename): Transaction {
  const toPage = (t: string) => (t.trim() === 'self' || /[*?[]/.test(t) ? null : rewriteRef(t, folder, page));
  // Links to files: only to .md pages (a bare word can be a label to MyST); the moved
  // page's other relative paths (pictures, includes) follow it too.
  const toFile = (href: string) => (/\.md(#|$)/.test(href) ? rewriteRef(href, folder, file) : moved ? rewriteRef(href, folder, null) : null);
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    const attrs = node.attrs;
    if (node.type.name === 'role' && attrs.name === 'doc') {
      const value = rewriteTitled(attrs.value, toPage);
      if (value !== null) tr.setNodeMarkup(pos, null, { ...attrs, value });
    } else if (node.type.name === 'ref_link') {
      const href = toFile(attrs.href);
      if (href !== null) tr.setNodeMarkup(pos, null, { ...attrs, href });
    } else if (node.type.name === 'image' && moved) {
      const src = rewriteRef(attrs.src, folder, null);
      if (src !== null) tr.setNodeMarkup(pos, null, { ...attrs, src });
    } else if (node.type.name === 'raw_block' && attrs.kind === 'image' && moved) {
      // A picture on its own line is kept as written: change the path in its source.
      const m = /^(\s*!\[[^\]]*\]\(\s*<?)([^)\s>]+)(.*)$/s.exec(attrs.source);
      const src = m && rewriteRef(m[2], folder, null);
      if (m && src !== null) tr.setNodeMarkup(pos, null, { ...attrs, source: m[1] + src + m[3] });
    } else if (node.type.name === 'opaque_directive' && attrs.name === 'toctree') {
      const lines = (attrs.source as string).split('\n');
      let changed = false;
      for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i];
        if (!line.trim() || /^\s*:[\w-]+:/.test(line)) continue;
        const next = rewriteTitled(line.trim(), toPage);
        if (next === null) continue;
        lines[i] = /^\s*/.exec(line)![0] + next;
        changed = true;
      }
      if (changed) tr.setNodeMarkup(pos, null, { ...attrs, source: lines.join('\n') });
    } else if (moved && PATH_DIRECTIVES.has(attrs.name) && attrs.args) {
      const args = rewriteRef(attrs.args, folder, null);
      if (args !== null) {
        // An opaque directive is written from its source: change the argument there too.
        const source = typeof attrs.source === 'string' && attrs.source ? attrs.source.replace(/^(\s*\S+\{[^}]+\}[ \t]*).*$/m, `$1${args}`) : attrs.source;
        tr.setNodeMarkup(pos, null, { ...attrs, args, ...(source !== undefined ? { source } : {}) });
      }
    }
    if (node.isText) {
      for (const mark of node.marks) {
        if (mark.type.name !== 'link') continue;
        const href = toFile(mark.attrs.href);
        if (href === null) continue;
        tr.removeMark(pos, pos + node.nodeSize, mark).addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, href }));
      }
    }
    return true;
  });
  return tr;
}
