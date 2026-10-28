// A renamed or moved page's references in an AsciiDoc page: cross-references to it,
// includes of it, links to its file, and (on the moved page itself) its relative
// paths: images, includes.
import type { EditorState, Transaction } from 'prosemirror-state';
import { rewriteRef, rewriteTitled } from '../../../../core/rename';
import type { ReferenceRename } from '../editing';

// Block macros whose target is a path relative to the page.
const PATH_MACROS = new Set(['image', 'include', 'video', 'audio']);

export function renameAsciidocReferences(state: EditorState, { folder, file, moved }: ReferenceRename): Transaction {
  // Cross-references and links to pages are to their files (page.adoc#anchor).
  const toFile = (t: string) => (/\.adoc(#|$)/.test(t) ? rewriteRef(t, folder, file) : moved && !t.startsWith('#') && /[./]/.test(t) ? rewriteRef(t, folder, null) : null);
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    const attrs = node.attrs;
    if (node.type.name === 'role' && (attrs.name === 'xref' || attrs.name === 'ref')) {
      const value = rewriteTitled(attrs.value, (t) => (/\.adoc(#|$)/.test(t) ? rewriteRef(t, folder, file) : null));
      if (value !== null) tr.setNodeMarkup(pos, null, { ...attrs, value });
    } else if (node.type.name === 'image' && moved) {
      const src = rewriteRef(attrs.src, folder, null);
      if (src !== null) tr.setNodeMarkup(pos, null, { ...attrs, src });
    } else if (node.type.name === 'opaque_directive' && PATH_MACROS.has(attrs.name) && attrs.args) {
      // An include of the renamed page (a chapter in the book), or, on the moved page,
      // any path relative to it.
      const args = rewriteRef(attrs.args, folder, attrs.name === 'include' ? file : null);
      if (args !== null) {
        const source = (attrs.source as string).replace(/^([A-Za-z][\w-]*::)\S*?(\[)/m, `$1${args}$2`);
        tr.setNodeMarkup(pos, null, { ...attrs, args, source });
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
