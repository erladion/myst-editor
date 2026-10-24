// ProseMirror schema for MyST documents.
//
// Every block node carries a `sid` attribute pointing into the SourceMap built at
// parse time. On save, a node that is still equal to its original is written back
// as its exact original source text; only edited nodes get re-serialized.
import { Schema, type NodeSpec, type MarkSpec, type TagParseRule, type Node as PMNode } from 'prosemirror-model';

const sid = { sid: { default: null } };

// Attributes shared by every directive-backed node. `header` is the exact original
// opening fence + options text; it is reused verbatim while `headerKey` still
// matches the current name/args/options.
export const directiveAttrs = {
  name: { default: 'note' },
  args: { default: '' },
  options: { default: [] as [string, string][] },
  fence: { default: ':::' },
  header: { default: null as string | null },
  headerKey: { default: null as string | null },
};

// ---- DOM representation ------------------------------------------------------
//
// Used for rendering nodes without a custom node view and for the clipboard. All
// attributes travel in `data-myst`, so copy/paste inside the editor keeps directive
// options, list styles and source identity; plain HTML from elsewhere maps onto the
// standard nodes through their usual tags.

const DATA = 'data-myst';

function dataAttrs(node: PMNode, extra: Record<string, string> = {}): Record<string, string> {
  return { [DATA]: JSON.stringify(node.attrs), 'data-pm': node.type.name, ...extra };
}

function fromData(dom: HTMLElement | string): Record<string, unknown> | false {
  if (typeof dom === 'string') return {};
  const raw = dom.getAttribute(DATA);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// parseDOM rule for nodes that only exist inside this editor.
const own = (name: string, extra: Partial<TagParseRule> = {}): TagParseRule => ({
  tag: `[data-pm="${name}"]`,
  getAttrs: (dom) => fromData(dom),
  priority: 60,
  ...extra,
});

function cellSpec(tag: 'td' | 'th', tableRole: string): NodeSpec {
  return {
    // Markdown table cells hold inline content only; several paragraphs (e.g. after
    // merging cells) are joined when written.
    content: 'paragraph+',
    tableRole,
    isolating: true,
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, align: { default: null } },
    parseDOM: [
      {
        tag,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const align = el.style.textAlign || el.getAttribute('align');
          return {
            colspan: Number(el.getAttribute('colspan') ?? 1) || 1,
            rowspan: Number(el.getAttribute('rowspan') ?? 1) || 1,
            align: ['left', 'center', 'right'].includes(align ?? '') ? align : null,
          };
        },
      },
    ],
    toDOM: (node) => {
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan > 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan > 1) attrs.rowspan = String(node.attrs.rowspan);
      if (node.attrs.align) attrs.style = `text-align: ${node.attrs.align}`;
      return [tag, attrs, 0];
    },
  };
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { ...sid },
    parseDOM: [{ tag: 'p', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['p', dataAttrs(node), 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { ...sid, level: { default: 1 }, setext: { default: false } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => ({ ...fromData(dom), level }),
    })),
    toDOM: (node) => [`h${node.attrs.level}`, dataAttrs(node), 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { ...sid },
    parseDOM: [{ tag: 'blockquote', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['blockquote', dataAttrs(node), 0],
  },

  bullet_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { ...sid, bullet: { default: '-' }, tight: { default: true } },
    parseDOM: [{ tag: 'ul', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['ul', dataAttrs(node), 0],
  },

  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { ...sid, start: { default: 1 }, delim: { default: '.' }, tight: { default: true }, repeat: { default: false } },
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const own = fromData(el);
          return el.hasAttribute(DATA) ? own : { start: Number(el.getAttribute('start') ?? 1) || 1 };
        },
      },
    ],
    toDOM: (node) => ['ol', dataAttrs(node, node.attrs.start === 1 ? {} : { start: String(node.attrs.start) }), 0],
  },

  // `marker` is the item's original marker ("-", "3.", ...) and `pad` the spaces
  // after it, kept so edited items don't change style.
  list_item: {
    content: 'block+',
    defining: true,
    attrs: { ...sid, marker: { default: null as string | null }, pad: { default: 1 } },
    parseDOM: [{ tag: 'li', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['li', dataAttrs(node), 0],
  },

  // Plain fenced/indented code and code-like directives (code-block, eval-rst, ...).
  // `directive` is false for plain fences; otherwise directiveAttrs apply.
  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: {
      ...sid,
      lang: { default: '' },
      fence: { default: '```' },
      indented: { default: false },
      directive: { default: false },
      ...withoutFence(directiveAttrs),
      name: { default: 'code-block' },
    },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['pre', dataAttrs(node), ['code', 0]],
  },

  // Display math: `$$ ... $$ (label)` or a {math} directive.
  math_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    attrs: {
      ...sid,
      label: { default: '' },
      directive: { default: false },
      ...withoutFence(directiveAttrs),
      name: { default: 'math' },
      fence: { default: '```' },
    },
    parseDOM: [own('math_block', { preserveWhitespace: 'full' })],
    toDOM: (node) => ['div', dataAttrs(node, { class: 'math-block' }), ['pre', 0]],
  },

  // A directive the editor understands whose body is MyST markdown
  // (admonitions, figure captions, dropdowns, ...).
  md_directive: {
    group: 'block',
    content: 'block*',
    defining: true,
    attrs: { ...sid, ...directiveAttrs },
    parseDOM: [own('md_directive')],
    toDOM: (node) => ['div', dataAttrs(node, { class: `directive directive-${node.attrs.name}` }), 0],
  },

  // A directive the editor doesn't understand: kept byte-for-byte.
  opaque_directive: {
    group: 'block',
    atom: true,
    attrs: { ...sid, name: { default: '' }, args: { default: '' }, options: { default: [] }, source: { default: '' } },
    parseDOM: [own('opaque_directive')],
    toDOM: (node) => ['div', dataAttrs(node, { class: 'opaque' }), node.attrs.source],
  },

  // `(label)=`
  target: {
    group: 'block',
    atom: true,
    attrs: { ...sid, label: { default: '' } },
    parseDOM: [own('target')],
    toDOM: (node) => ['div', dataAttrs(node, { class: 'target' }), `(${node.attrs.label})=`],
  },

  thematic_break: {
    group: 'block',
    attrs: { ...sid, markup: { default: '---' } },
    parseDOM: [{ tag: 'hr', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['hr', dataAttrs(node)],
  },

  // Anything else (front matter, HTML blocks, tables, comments, footnote definitions,
  // unrecognized syntax). `kind` is informational; `source` is written back as-is.
  raw_block: {
    group: 'block',
    atom: true,
    attrs: { ...sid, kind: { default: 'unknown' }, source: { default: '' } },
    parseDOM: [own('raw_block')],
    toDOM: (node) => ['div', dataAttrs(node, { class: 'raw' }), node.attrs.source],
  },

  // GFM tables. Shaped for prosemirror-tables (tableRole, colspan/rowspan/colwidth);
  // spans are written with the project's span roles (see editor-config). Alignment
  // lives on each cell so it survives adding and removing columns; the header row's
  // cells decide each column's alignment when written. `pretty` keeps padded columns.
  table: {
    group: 'block',
    content: 'table_row+',
    tableRole: 'table',
    isolating: true,
    // `ruleSpaces`: the delimiter row is written `| --- |` rather than `|-----|`.
    attrs: { ...sid, pretty: { default: true }, ruleSpaces: { default: true } },
    parseDOM: [{ tag: 'table', getAttrs: (dom) => fromData(dom as HTMLElement) }],
    toDOM: (node) => ['table', dataAttrs(node), ['tbody', 0]],
  },
  table_row: {
    content: '(table_cell | table_header)*',
    tableRole: 'row',
    // The conditions the row is in (outermost first), each with its marker lines as
    // written: rows can sit between condition markers. Rows of one group share its id,
    // and are written inside one pair of markers.
    attrs: { conds: { default: [] as RowCondition[] } },
    parseDOM: [{ tag: 'tr', getAttrs: (dom) => ({ conds: JSON.parse((dom as HTMLElement).getAttribute('data-conds') ?? '[]') }) }],
    toDOM: (node) => ['tr', node.attrs.conds.length ? { 'data-conds': JSON.stringify(node.attrs.conds) } : {}, 0],
  },
  table_cell: cellSpec('td', 'cell'),
  table_header: cellSpec('th', 'header_cell'),

  text: { group: 'inline' },

  // A line break inside a paragraph's source. Rendered as a space, written as "\n",
  // so a writer's edit doesn't re-wrap the paragraph.
  soft_break: {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    leafText: () => ' ',
    parseDOM: [own('soft_break')],
    toDOM: (node) => ['span', dataAttrs(node, { class: 'soft-break' }), ' '],
  },
  hard_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    leafText: () => '\n',
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  role: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { name: { default: 'ref' }, value: { default: '' } },
    leafText: (node) => node.attrs.value,
    parseDOM: [own('role')],
    toDOM: (node) => ['span', dataAttrs(node, { class: 'role' }), node.attrs.value],
  },
  inline_math: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { value: { default: '' } },
    leafText: (node) => node.attrs.value,
    parseDOM: [own('inline_math')],
    toDOM: (node) => ['span', dataAttrs(node, { class: 'inline-math' }), node.attrs.value],
  },
  html_inline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { value: { default: '' } },
    parseDOM: [own('html_inline')],
    toDOM: (node) => ['span', dataAttrs(node, { class: 'html-inline' }), node.attrs.value],
  },
  // `[](target)`: a link whose text Sphinx fills in from the target's title.
  ref_link: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { href: { default: '' }, title: { default: null } },
    leafText: (node) => node.attrs.href,
    parseDOM: [own('ref_link')],
    toDOM: (node) => ['span', dataAttrs(node, { class: 'ref-link' }), node.attrs.href],
  },
  footnote_ref: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { label: { default: '' } },
    parseDOM: [own('footnote_ref')],
    toDOM: (node) => ['sup', dataAttrs(node, { class: 'footnote-ref' }), node.attrs.label],
  },
  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { src: { default: '' }, alt: { default: '' }, title: { default: null } },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return el.hasAttribute(DATA)
            ? fromData(el)
            : { src: el.getAttribute('src'), alt: el.getAttribute('alt') ?? '', title: el.getAttribute('title') };
        },
      },
    ],
    toDOM: (node) => ['img', dataAttrs(node, { src: node.attrs.src, alt: node.attrs.alt })],
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }),
      },
    ],
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0],
  },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      // Google Docs wraps everything in <b style="font-weight:normal">.
      { tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
  // Not spellchecked: commands, file names and identifiers aren't words.
  code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', { spellcheck: 'false' }, 0] },
};

function withoutFence<T extends Record<string, unknown>>(attrs: T): Omit<T, 'fence'> {
  const { fence: _fence, ...rest } = attrs;
  return rest;
}

// A condition a table row is in: its start and end marker lines, and which group of
// consecutive rows it belongs to.
export interface RowCondition {
  id: string;
  start: string;
  end: string;
}

export const schema = new Schema({ nodes, marks });
