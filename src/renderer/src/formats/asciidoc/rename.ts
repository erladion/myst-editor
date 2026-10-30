// A renamed or moved page's references in an AsciiDoc page: cross-references to it,
// includes of it, links to its file, and (on the moved page itself) its relative
// paths: images, includes. In an Antora component, references are resource IDs (see
// core/asciidoc/antora.ts): what each names is worked out from where the page was,
// and written again from where it is.
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { rewriteRef, rewriteTitled } from '../../../../core/rename';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { parseResourceId, resolveResource, resourceIdFor, specStyle, type Antora, type Family } from '../../../../core/asciidoc/antora';
import type { ReferenceRename } from '../editing';

// Block macros whose target is a path relative to the page.
const PATH_MACROS = new Set(['image', 'include', 'video', 'audio']);

export function renameAsciidocReferences(state: EditorState, rename: ReferenceRename): Transaction {
  const antora = rename.config.format === 'asciidoc' ? (rename.config as AsciidocConfig).antora : null;
  return antora ? renameAntora(state, rename, antora) : renamePlain(state, rename);
}

// A block picture (a figure) or another path macro: its target, and the node with a new one.
function pathOf(node: PMNode): { name: string; target: string; with(target: string): Record<string, unknown> } | null {
  const attrs = node.attrs;
  if (node.type.name === 'md_directive' && attrs.name === 'figure' && attrs.args) return { name: 'image', target: attrs.args, with: (args) => ({ ...attrs, args }) };
  if (node.type.name === 'opaque_directive' && PATH_MACROS.has(attrs.name) && attrs.args) {
    return {
      name: attrs.name,
      target: attrs.args,
      with: (args) => ({ ...attrs, args, source: (attrs.source as string).replace(/^([A-Za-z][\w-]*::)\S*?(\[)/m, `$1${args}$2`) }),
    };
  }
  return null;
}

function renamePlain(state: EditorState, { folder, file, moved }: ReferenceRename): Transaction {
  // Cross-references and links to pages are to their files (page.adoc#anchor).
  const toFile = (t: string) => (/\.adoc(#|$)/.test(t) ? rewriteRef(t, folder, file) : moved && !t.startsWith('#') && /[./]/.test(t) ? rewriteRef(t, folder, null) : null);
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    const attrs = node.attrs;
    const path = pathOf(node);
    if (node.type.name === 'role' && (attrs.name === 'xref' || attrs.name === 'ref')) {
      const value = rewriteTitled(attrs.value, (t) => (/\.adoc(#|$)/.test(t) ? rewriteRef(t, folder, file) : null));
      if (value !== null) tr.setNodeMarkup(pos, null, { ...attrs, value });
    } else if (node.type.name === 'image' && moved) {
      const src = rewriteRef(attrs.src, folder, null);
      if (src !== null) tr.setNodeMarkup(pos, null, { ...attrs, src });
    } else if (path) {
      // An include of the renamed page (a chapter in the book), or, on the moved page,
      // any path relative to it.
      const args = rewriteRef(path.target, folder, path.name === 'include' ? file : null);
      if (args !== null) tr.setNodeMarkup(pos, null, path.with(args));
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

function renameAntora(state: EditorState, { folder, file, moved }: ReferenceRename, antora: Antora): Transaction {
  // The page, where it was and where it is (only its folder matters).
  const before = `${folder.before ? `${folder.before}/` : ''}_.adoc`;
  const after = `${folder.after ? `${folder.after}/` : ''}_.adoc`;
  // A resource ID written again, if what it names moved or the page did.
  const again = (spec: string, family: Family, implied: Family): string | null => {
    const found = resolveResource(antora, before, spec, family);
    if (!found) return null;
    const now = found.file === file.from ? file.to : found.file;
    if (now === found.file && !moved) return null;
    const id = parseResourceId(spec);
    const written = resourceIdFor(after, now, id?.family ?? family, { ...specStyle(spec), implied });
    if (!written) return null;
    const next = `${written}${found.fragment ? `#${found.fragment}` : ''}`;
    return next === spec ? null : next;
  };
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    const attrs = node.attrs;
    const path = pathOf(node);
    if (node.type.name === 'role' && attrs.name === 'xref') {
      const value = rewriteTitled(attrs.value, (t) => again(t, 'page', 'page'));
      if (value !== null) tr.setNodeMarkup(pos, null, { ...attrs, value });
    } else if (node.type.name === 'image') {
      const src = again(attrs.src, 'image', 'image');
      if (src !== null) tr.setNodeMarkup(pos, null, { ...attrs, src });
    } else if (path?.name === 'image') {
      const src = again(path.target, 'image', 'image');
      if (src !== null) tr.setNodeMarkup(pos, null, path.with(src));
    } else if (path?.name === 'include') {
      // partial$ and example$ resources; other includes are paths from the page.
      const args = parseResourceId(path.target)?.family ? again(path.target, 'partial', 'page') : rewriteRef(path.target, folder, file);
      if (args !== null) tr.setNodeMarkup(pos, null, path.with(args));
    }
    return true;
  });
  return tr;
}
