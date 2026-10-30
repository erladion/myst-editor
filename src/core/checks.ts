// Checks for mistakes readers notice, and that screen readers trip over: images
// without a description, headings that skip a level or come twice as a title, links
// that only say "here", tables with an empty header row, and sections with nothing
// in them. Each finding says where it is, and how it can be fixed, if it can.
import type { Node as PMNode } from 'prosemirror-model';

export type Fix =
  | { kind: 'describe-image'; pos: number } // the image node
  | { kind: 'describe-figure'; pos: number } // the figure directive
  | { kind: 'heading-level'; pos: number; level: number }
  | { kind: 'link-text'; from: number; to: number };

export interface Finding {
  kind: 'image-alt' | 'figure-alt' | 'heading-skip' | 'two-titles' | 'link-text' | 'table-header' | 'empty-section';
  from: number;
  to: number;
  message: string;
  fix?: Fix;
}

export const HEADING_NAMES = ['', 'Title', 'Heading', 'Subheading', 'Small heading', 'Level 5 heading', 'Level 6 heading'];

// Link texts that say nothing about where they go.
const VAGUE = new Set(['here', 'click here', 'this', 'this page', 'link', 'read more', 'more', 'see here', 'go']);

export function checkDoc(doc: PMNode): Finding[] {
  const out: Finding[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'md_directive' && (node.attrs.name === 'figure' || node.attrs.name === 'image') && !(node.attrs.options as [string, string][]).some(([k, v]) => k === 'alt' && v.trim())) {
      out.push({ kind: 'figure-alt', from: pos, to: pos + node.nodeSize, message: `This ${node.attrs.name} has no description (alt), for screen readers and for when it can’t be shown.`, fix: { kind: 'describe-figure', pos } });
    }
    if (node.type.name === 'table') {
      const header = node.firstChild;
      if (header && header.childCount && header.textContent.trim() === '') {
        out.push({ kind: 'table-header', from: pos, to: pos + node.nodeSize, message: 'This table’s header row is empty: say what each column holds.' });
      }
    }
    if (node.isTextblock) {
      // Links: the stretch of text each one covers.
      let link: { href: unknown; from: number; text: string } | null = null;
      const close = (end: number) => {
        if (link && VAGUE.has(link.text.trim().toLowerCase().replace(/[.!:]+$/, ''))) {
          out.push({ kind: 'link-text', from: link.from, to: end, message: `The link says only “${link.text.trim()}”: words saying where it goes help everyone, and screen readers list links by their text.`, fix: { kind: 'link-text', from: link.from, to: end } });
        }
        link = null;
      };
      node.forEach((child, offset) => {
        const at = pos + 1 + offset;
        if (child.type.name === 'image' && !String(child.attrs.alt).trim()) {
          out.push({ kind: 'image-alt', from: at, to: at + child.nodeSize, message: 'This image has no description, for screen readers and for when it can’t be shown.', fix: { kind: 'describe-image', pos: at } });
        }
        const mark = child.marks.find((m) => m.type.name === 'link');
        if (link && (!mark || mark.attrs.href !== link.href)) close(at);
        if (mark && child.isText) {
          if (!link) link = { href: mark.attrs.href, from: at, text: '' };
          link.text += child.text;
        }
      });
      close(pos + node.nodeSize - 1);
      return false;
    }
    return true;
  });

  // Headings, in the page's own order (those at its top level make its sections).
  let previous = 0;
  let titles = 0;
  const top: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, offset) => top.push({ node, pos: offset }));
  top.forEach(({ node, pos }, i) => {
    if (node.type.name !== 'heading') return;
    const level: number = node.attrs.level;
    const text = node.textContent.trim() || 'A heading';
    const end = pos + node.nodeSize;
    if (level === 1 && ++titles > 1) {
      out.push({ kind: 'two-titles', from: pos, to: end, message: `“${text}” is a second title on the page: the page’s other sections should be headings.`, fix: { kind: 'heading-level', pos, level: 2 } });
    } else if (previous && level > previous + 1) {
      out.push({
        kind: 'heading-skip',
        from: pos,
        to: end,
        message: `“${text}” skips a level: a ${HEADING_NAMES[level].toLowerCase()} after a ${HEADING_NAMES[previous].toLowerCase()}.`,
        fix: { kind: 'heading-level', pos, level: previous + 1 },
      });
    }
    // Nothing under it before the next heading of its level or above (or the end).
    const next = top[i + 1]?.node;
    if (!next || (next.type.name === 'heading' && next.attrs.level <= level)) {
      out.push({ kind: 'empty-section', from: pos, to: end, message: `“${text}” has nothing under it.` });
    }
    previous = level;
  });

  return out.sort((a, b) => a.from - b.from);
}
