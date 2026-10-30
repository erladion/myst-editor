// An Antora navigation file, as read (by parseAsciidoc): lists of xrefs to pages,
// nested as the navigation is, with items of plain text heading the pages under them,
// and a title over a list (.Title) heading its items.
//
// The build (for the contents it shows) and the editor (to change them) both read it
// so, and name its headings the same way: `<file's name>#<n>` for the nth plain item,
// `<file's name>#list-<n>` for the nth list's title.
import type { Node as PMNode } from 'prosemirror-model';

export interface NavItem {
  target: string | null; // the xref's, for a page
  text: string; // its own text: the xref's, or the heading's
  heading: number | null; // for a plain item: which one (from 1)
  children: NavItem[];
  pos: number; // the list item's, in the document
  node: PMNode;
}

export interface NavList {
  title: string | null;
  index: number; // which list (from 1)
  items: NavItem[];
  pos: number;
  node: PMNode;
}

// "Text <target>" or "target".
export function splitXref(value: string): { text: string | null; target: string } {
  const m = /^([\s\S]*?)\s*<([^<>]+)>$/.exec(value);
  return m && m[1] ? { text: m[1], target: m[2] } : { text: null, target: value };
}

export function readNav(doc: PMNode): NavList[] {
  const lists: NavList[] = [];
  let headings = 0;
  const items = (list: PMNode, at: number): NavItem[] => {
    const out: NavItem[] = [];
    list.forEach((item, offset) => {
      if (item.type.name !== 'list_item') return;
      const pos = at + 1 + offset;
      const first = item.firstChild;
      let target: string | null = null;
      let text = '';
      if (first?.isTextblock) {
        const roles: PMNode[] = [];
        let other = false;
        first.forEach((n) => {
          if (n.type.name === 'role' && n.attrs.name === 'xref') roles.push(n);
          else if (!n.isText || n.text!.trim()) other = true;
        });
        if (roles.length === 1 && !other) {
          const x = splitXref(roles[0].attrs.value as string);
          target = x.target;
          text = x.text ?? '';
        } else text = first.textContent.trim();
      }
      const entry: NavItem = { target, text, heading: target === null ? ++headings : null, children: [], pos, node: item };
      item.forEach((child, childOffset) => {
        if (child.type.name === 'bullet_list') entry.children.push(...items(child, pos + 1 + childOffset));
      });
      out.push(entry);
    });
    return out;
  };
  let title: string | null = null;
  doc.forEach((node, pos) => {
    if (node.type.name === 'raw_block' && node.attrs.kind === 'block-attributes') {
      const line = (node.attrs.source as string).split('\n').find((l) => /^\.[^.\s]/.test(l));
      title = line ? line.slice(1).trim() : title;
      return;
    }
    if (node.type.name === 'bullet_list') lists.push({ title, index: lists.length + 1, items: items(node, pos), pos, node });
    title = null;
  });
  return lists;
}

// The names of a navigation file's headings (see above).
export const headingName = (navName: string, heading: number) => `${navName}#${heading}`;
export const listName = (navName: string, index: number) => `${navName}#list-${index}`;
