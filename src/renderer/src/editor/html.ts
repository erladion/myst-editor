// Showing HTML written in pages the way it looks, safely. Pages are often written
// with a little HTML, such as `<br>` or a `<ul>` list inside a table cell. The source
// is never changed; this only decides how it's displayed.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { schema } from '../../../core/schema';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Elements shown as themselves. Anything else is unwrapped (its text kept), and
// DROPPED ones are removed with their content.
const ALLOWED = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p',
  'pre', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'video', 'audio', 'source',
]);
const DROPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math']);
const ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan', 'align'],
  th: ['colspan', 'rowspan', 'align'],
  ol: ['start', 'type'],
  li: ['value'],
  abbr: ['title'],
  details: ['open'],
  // Players, with their controls; never playing by themselves.
  video: ['src', 'poster', 'width', 'height'],
  audio: ['src'],
  source: ['src', 'type'],
};

// `html` as DOM nodes holding only allowed elements and attributes: no scripts,
// styles, event handlers or javascript: links. Images go through `assetUrl`, so
// relative paths resolve against the page. Built node by node rather than through
// innerHTML, so nothing from the page is ever parsed as live markup.
export function safeHtml(html: string, assetUrl: (src: string) => string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  const out = document.createDocumentFragment();
  const copy = (from: Node, to: Node) => {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue; // comments
      const name = (child as Element).localName;
      if (DROPPED.has(name)) continue;
      if (!ALLOWED.has(name)) {
        copy(child, to);
        continue;
      }
      const el = document.createElement(name);
      for (const attr of ATTRIBUTES[name] ?? []) {
        const value = (child as Element).getAttribute(attr);
        if (value === null) continue;
        if (attr === 'href') {
          // Shown as links, not followed: the editor isn't a browser.
          if (/^(https?:|mailto:|#|[\w./-]+$)/i.test(value.trim())) el.setAttribute('title', value);
          continue;
        }
        el.setAttribute(attr, attr === 'src' || attr === 'poster' ? assetUrl(value) : value);
      }
      if (name === 'video' || name === 'audio') {
        el.setAttribute('controls', '');
        el.setAttribute('preload', 'metadata');
      }
      if (name === 'a') el.className = 'html-link';
      copy(child, el);
      to.appendChild(el);
    }
  };
  copy(parsed, out);
  return out;
}

// One inline HTML token from a paragraph, such as `<br>`, `<b>` or `</li>`.
export interface InlineTag {
  name: string; // lower case
  kind: 'open' | 'close' | 'void';
  attrs: boolean; // has attributes (shown as written: they may matter)
}

const VOID = new Set(['br', 'wbr', 'img', 'hr']);

export function inlineTag(value: string): InlineTag | null {
  const m = /^<(\/?)([a-zA-Z][\w-]*)(\s[^>]*?)?\s*(\/?)>$/.exec(value.trim());
  if (!m) return null;
  const name = m[2].toLowerCase();
  const attrs = !!m[3]?.trim();
  if (m[1]) return { name, kind: 'close', attrs: false };
  return { name, kind: m[4] || VOID.has(name) ? 'void' : 'open', attrs };
}

// Inline tags whose text in between is shown formatted, and how.
export const FORMATTING: Record<string, string> = {
  b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', ins: 'u', s: 's', del: 's', strike: 's',
  sub: 'sub', sup: 'sup', code: 'code', kbd: 'kbd', mark: 'mark', small: 'small', var: 'var', samp: 'samp',
};

// Tags that start a new line inside a paragraph or table cell.
export const LINE_BREAKS = new Set(['br', 'p', 'div', 'ul', 'ol', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'dt', 'dd']);

// ---- inline HTML in the editor ----------------------------------------------------


// How a tag that starts a line shows: whether it breaks the line (not at the start
// of a paragraph or cell, or right after another break), and for a list item its
// bullet or number and how deep its list is.
export interface LineTag {
  lineBreak: boolean;
  marker?: string;
  depth?: number;
}

// Formats the text between inline tags (`<b>…</b>` shows bold) and lays out tags that
// start lines, paragraph by paragraph (or table cell by cell).
function decorateBlock(block: PMNode, blockPos: number, decorations: Decoration[]) {
  {
    const open: { name: string; end: number }[] = [];
    const lists: { ordered: boolean; n: number }[] = [];
    const children: { child: PMNode; offset: number; tag: InlineTag | null }[] = [];
    block.forEach((child, offset) => children.push({ child, offset, tag: child.type.name === 'html_inline' ? inlineTag(child.attrs.value) : null }));
    // Whether anything visible follows each child: a break with nothing after it
    // would only add an empty line.
    const shows = ({ child, tag }: (typeof children)[number]) => (tag ? tag.name === 'li' && tag.kind === 'open' : child.isText ? !!child.text!.trim() : true);
    const later: boolean[] = [];
    for (let i = children.length - 1, seen = false; i >= 0; i--) {
      later[i] = seen;
      seen ||= shows(children[i]);
    }
    let lineStart = true; // nothing shown yet on the current line
    children.forEach(({ child, offset, tag }, index) => {
      if (!tag) {
        if (shows(children[index])) lineStart = false;
        return;
      }
      const pos = blockPos + 1 + offset;
      const line = (spec: LineTag) => decorations.push(Decoration.node(pos, pos + child.nodeSize, {}, { htmlLine: spec }));
      const styled = tag.name in FORMATTING || tag.name === 'a' || tag.name === 'span';
      if (tag.kind === 'open' && styled) open.push({ name: tag.name, end: pos + child.nodeSize });
      else if (tag.kind === 'close' && styled) {
        const i = open.map((o) => o.name).lastIndexOf(tag.name);
        if (i < 0) return;
        const start = open[i].end;
        open.length = i;
        if (start >= pos || tag.name === 'span') return;
        decorations.push(Decoration.inline(start, pos, tag.name === 'a' ? { class: 'html-link' } : { nodeName: FORMATTING[tag.name] }));
      } else if (tag.name === 'br') {
        lineStart = true;
      } else if (tag.name === 'li' && tag.kind === 'open') {
        const list = lists.at(-1);
        line({ lineBreak: !lineStart, marker: list?.ordered ? `${++list.n}.` : '•', depth: Math.max(lists.length, 1) });
        lineStart = false;
      } else if (LINE_BREAKS.has(tag.name) && !(tag.name === 'li' && tag.kind === 'close')) {
        if (tag.name === 'ul' || tag.name === 'ol') {
          if (tag.kind === 'open') lists.push({ ordered: tag.name === 'ol', n: 0 });
          else lists.pop();
        }
        line({ lineBreak: !lineStart && later[index] });
        lineStart = true;
      } else if (tag.kind !== 'close') lineStart = false;
    });
  }
}

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true;
    decorateBlock(block, pos, decorations);
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

// After a change: only the paragraphs (or cells) it touched are looked at again, the
// rest keep theirs, so typing on a long page doesn't go through all of it.
function redecorate(tr: Transaction, set: DecorationSet): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  const touched: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => touched.push([rest.map(newStart, -1), rest.map(newEnd, 1)]));
  });
  const size = tr.doc.content.size;
  for (const [from, to] of touched) {
    tr.doc.nodesBetween(Math.max(0, from), Math.min(size, to), (block, pos) => {
      if (!block.isTextblock) return true;
      const decorations: Decoration[] = [];
      decorateBlock(block, pos, decorations);
      next = next.remove(next.find(pos + 1, pos + block.nodeSize - 1)).add(tr.doc, decorations);
      return false;
    });
  }
  return next;
}

export function inlineHtmlPlugin(): Plugin {
  return new Plugin({
    state: {
      init: (_config, state) => decorate(state.doc),
      apply: (tr, set) => (tr.docChanged ? redecorate(tr, set) : set),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

export function lineTagOf(decorations: readonly Decoration[]): LineTag | null {
  for (const d of decorations) {
    const spec = (d as Decoration & { spec: { htmlLine?: LineTag } }).spec;
    if (spec.htmlLine) return spec.htmlLine;
  }
  return null;
}

// ---- editing HTML lists written in a paragraph or a table cell (<ul><li>…</li></ul>) ----

const tag = (value: string) => schema.nodes.html_inline.create({ value });
const tagOf = (n: PMNode | null | undefined) => (n?.type.name === 'html_inline' ? inlineTag(n.attrs.value) : null);

// Whether the cursor is inside an HTML list's item (in its paragraph).
function inHtmlItem(state: EditorState): boolean {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  let open = 0;
  $from.parent.forEach((child, offset) => {
    if (offset + child.nodeSize > $from.parentOffset) return;
    const t = tagOf(child);
    if (t?.name === 'li') open += t.kind === 'open' ? 1 : t.kind === 'close' ? -1 : 0;
  });
  return open > 0;
}

// Enter in an item: a new item after it, the text after the cursor in it. (In an
// empty item: nothing, so Enter does what it would.)
export const splitHtmlItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  let at = $from.pos;
  if (!inHtmlItem(state)) {
    // Just after an item's end (</li></ul> show as nothing): at its end.
    let index = $from.index();
    let pos = $from.pos;
    let end: number | null = null;
    while (index > 0) {
      const t = tagOf($from.parent.child(index - 1));
      if (t?.kind !== 'close' || !['li', 'ul', 'ol'].includes(t.name)) break;
      pos -= $from.parent.child(index - 1).nodeSize;
      index--;
      if (t.name === 'li') end = pos;
    }
    if (end === null) return false;
    at = end;
  } else if (tagOf($from.nodeBefore)?.name === 'li' && tagOf($from.nodeAfter)?.kind === 'close') return false;
  if (dispatch) {
    const tr = state.tr.insert(at, [tag('</li>'), tag('<li>')]);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
  }
  return true;
};

// Backspace at the start of an item (not the first): it joins the one before.
export const joinHtmlItems: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const before = $from.nodeBefore;
  const index = $from.index();
  const prev = index >= 2 ? $from.parent.child(index - 2) : null;
  if (tagOf(before)?.name !== 'li' || tagOf(before)?.kind !== 'open' || tagOf(prev)?.name !== 'li' || tagOf(prev)?.kind !== 'close') return false;
  dispatch?.(state.tr.delete($from.pos - 2, $from.pos).scrollIntoView());
  return true;
};

// A list in a table cell that can't hold one (a Markdown table's): its text made an
// HTML list (<ul><li>…</li></ul>), each line an item; or, in one, back to its text.
export function toggleHtmlList(ordered: boolean): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const cellDepth = [...Array($from.depth + 1).keys()].reverse().find((d) => /^table_(cell|header)$/.test($from.node(d).type.name));
    if (cellDepth === undefined || !$from.parent.isTextblock) return false;
    const para = $from.parent;
    const start = $from.start();
    const list = ordered ? 'ol' : 'ul';
    let has = false;
    para.forEach((c) => (has ||= ['ul', 'ol'].includes(tagOf(c)?.name ?? '')));
    if (!dispatch) return true;
    let tr = state.tr;
    if (has) {
      // Back to its text: items become lines (<br>).
      const steps: { from: number; to: number; with: PMNode[] }[] = [];
      let first = true;
      para.forEach((c, offset) => {
        const t = tagOf(c);
        if (!t || !['ul', 'ol', 'li'].includes(t.name)) return;
        const at = start + offset;
        const opensItem = t.name === 'li' && t.kind === 'open';
        steps.push({ from: at, to: at + c.nodeSize, with: opensItem && !first ? [tag('<br>')] : [] });
        if (opensItem) first = false;
      });
      for (const s of steps.reverse()) tr = tr.replaceWith(s.from, s.to, s.with);
    } else {
      // Each line (<br>) an item.
      const end = start + para.content.size;
      tr = tr.insert(end, [tag('</li>'), tag(`</${list}>`)]);
      para.forEach((c, offset) => {
        if (tagOf(c)?.name === 'br') tr = tr.replaceWith(tr.mapping.map(start + offset), tr.mapping.map(start + offset + c.nodeSize), [tag('</li>'), tag('<li>')]);
      });
      tr = tr.insert(start, [tag(`<${list}>`), tag('<li>')]);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
