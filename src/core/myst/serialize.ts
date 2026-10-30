// ProseMirror document -> MyST source.
//
// Blocks that are unchanged since parsing are written back as their original text,
// and original gaps between untouched neighbours are kept. Only edited blocks are
// serialized, and their header/marker/fence style is carried over from the original.
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { MarkdownSerializerState, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { schema, type RowCondition } from '../schema.js';
import { SourceMap, type ContainerEntry, type InlineStyle } from '../sourcemap.js';
import { headerKey, renderHeader, fenceFor } from '../directive.js';
import { hardBreakStyle, parseMyst } from './parse.js';

export interface SerializeOptions {
  // Ignore the source map and serialize everything (used to test the serializer).
  fresh?: boolean;
  // Roles for merged table cells, e.g. { colspan: 'colspan' } → {colspan}`2`.
  tableSpans?: { colspan?: string; rowspan?: string };
}

export function serializeMyst(doc: PMNode, map: SourceMap, opts: SerializeOptions = {}): string {
  return new Writer(map, !!opts.fresh, opts.tableSpans ?? {}).container(doc, opts.fresh ? undefined : map.root);
}

const ALIGN_RULE = { left: (w: number) => `:${'-'.repeat(w - 1)}`, center: (w: number) => `:${'-'.repeat(w - 2)}:`, right: (w: number) => `${'-'.repeat(w - 1)}:` };

class Writer {
  constructor(
    private map: SourceMap,
    private fresh: boolean,
    private tableSpans: { colspan?: string; rowspan?: string },
  ) {}

  private unchanged(node: PMNode): string | undefined {
    return this.fresh ? undefined : this.map.unchanged(node);
  }

  private originalGap(a: PMNode, b: PMNode): string | undefined {
    return this.fresh ? undefined : this.map.gapBetween(a, b);
  }

  private containerEntry(node: PMNode): ContainerEntry | undefined {
    return this.fresh ? undefined : this.map.get(node.attrs.sid)?.container;
  }

  container(node: PMNode, entry: ContainerEntry | undefined, tight = false): string {
    let out = '';
    let prev: PMNode | null = null;
    let prevText = '';
    node.forEach((child) => {
      let text = this.block(child);
      if (text === '' && child.type.name === 'paragraph') return; // empty paragraphs vanish anyway
      // Two lists of a kind, one after the other, with the same marker would be read
      // back as one: the second gets the other marker (- and *, 1. and 1)).
      if (prev && prev.type === child.type && /^(bullet|ordered)_list$/.test(child.type.name) && listMarker(prevText) === listMarker(text)) text = this.list(child, true);
      if (prev) out += this.gap(prev, child, tight);
      out += text;
      prev = child;
      prevText = text;
    });
    if (!entry) return out;
    return entry.lead + out + (node.childCount ? entry.trail : '');
  }

  private gap(a: PMNode, b: PMNode, tight: boolean): string {
    const original = this.originalGap(a, b);
    if (original !== undefined) return original;
    if (a.type.name === 'target') return '\n';
    // Inside a tight list item only a paragraph followed by a nested list may be
    // joined; anything after a nested list would become a lazy continuation.
    if (tight && a.type.name === 'paragraph' && /^(bullet|ordered)_list$/.test(b.type.name)) return '\n';
    // HTML comments (e.g. condition markers) may interrupt a paragraph, and one ends at
    // its own line, so they can sit next to text without making a tight list loose.
    const comment = (n: PMNode) => n.type.name === 'raw_block' && /^(condition-|html$)/.test(n.attrs.kind) && /^<!--[\s\S]*-->$/.test(n.attrs.source.trim());
    if (tight && (comment(a) || comment(b))) return '\n';
    return '\n\n';
  }

  block(node: PMNode): string {
    const original = this.unchanged(node);
    if (original !== undefined) return original;
    const inner = () => this.container(node, this.containerEntry(node));

    switch (node.type.name) {
      case 'paragraph': {
        // Line breaks written like the paragraph's own were, else like the page's; its
        // lines as they were, where they say the same.
        const was = this.fresh ? undefined : this.map.get(node.attrs.sid)?.text;
        const own = was === undefined ? null : hardBreakStyle(was);
        const text = inlineMarkdown(node, own ? { ...this.map.style, hardBreak: own } : this.map.style);
        return was === undefined ? text : keepLines(text, was, this.map.style);
      }

      case 'heading': {
        // Its title as written while it says the same.
        const was = this.fresh || node.attrs.setext ? undefined : /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(this.map.get(node.attrs.sid)?.text ?? '')?.[1];
        const fresh = inlineMarkdown(node, this.map.style);
        const text = was !== undefined && !fresh.includes('\n') && sameLine(fresh, was, definitions(this.map.style)) ? was : fresh;
        if (node.attrs.setext && node.attrs.level <= 2) {
          const last = text.split('\n').pop()!;
          return `${text}\n${(node.attrs.level === 1 ? '=' : '-').repeat(Math.max(3, last.length))}`;
        }
        return `${'#'.repeat(node.attrs.level)} ${text}`;
      }

      case 'thematic_break':
        return node.attrs.markup;

      case 'blockquote':
        return prefixLines(inner(), '> ', '>');

      case 'footnote_def': {
        const [first, ...rest] = inner().split('\n');
        const pad = ' '.repeat(node.attrs.indent || 4);
        return [`[^${node.attrs.label}]:${first ? ` ${first}` : ''}`, ...rest.map((l) => (l ? pad + l : l))].join('\n');
      }

      case 'bullet_list':
      case 'ordered_list':
        return this.list(node);

      case 'code_block': {
        const text = node.textContent;
        if (node.attrs.directive) return this.directive(node, text);
        if (node.attrs.indented) return prefixLines(text, '    ', '');
        const fence = fenceFor(node.attrs.fence, text);
        return `${fence}${node.attrs.lang}\n${text}\n${fence.trimStart()}`;
      }

      case 'math_block': {
        if (node.attrs.directive) return this.directive(node, node.textContent);
        // An amsmath environment: as it is.
        if (node.attrs.fence === '\\begin' && /^\\begin\{/.test(node.textContent)) return node.textContent;
        return `$$\n${node.textContent}\n$$${node.attrs.label ? ` (${node.attrs.label})` : ''}`;
      }

      case 'md_directive':
        return this.directive(node, inner());

      case 'opaque_directive':
      case 'raw_block':
        return node.attrs.source;

      case 'target':
        return `(${node.attrs.label})=`;

      case 'table':
        return this.table(node);

      case 'definition_list': {
        // Its lines as they were, where they say the same.
        const text = this.definitionList(node);
        const was = this.fresh ? undefined : this.map.get(node.attrs.sid)?.text;
        return was === undefined ? text : keepLines(text, was, this.map.style);
      }

      default:
        throw new Error(`Cannot serialize block node ${node.type.name}`);
    }
  }

  private directive(node: PMNode, body: string): string {
    const { name, args, options } = node.attrs;
    let fence: string = node.attrs.fence;
    const needed = fenceFor(fence, body);
    let header: string;
    if (node.attrs.header !== null && needed === fence && node.attrs.headerKey === headerKey(name, args, options, fence)) {
      header = node.attrs.header;
    } else {
      fence = needed;
      header = renderHeader(fence, name, args, options);
      // (Nothing under the options: no blank line before the closing fence.)
      if (body === '' && node.type.name === 'md_directive') header = header.replace(/\n$/, '');
    }
    const parts = [header];
    if (body !== '' || node.type.name !== 'md_directive') parts.push(body);
    parts.push(fence.trimStart());
    return parts.join('\n');
  }

  // A GFM table. Merged cells are written with the span roles, and the cells they
  // cover as empty cells; padded columns if the table had them.
  private table(node: PMNode): string {
    const grid: ({ cell: PMNode; start: boolean } | undefined)[][] = [];
    node.forEach((row, _o, r) => {
      grid[r] ??= [];
      let c = 0;
      row.forEach((cell) => {
        while (grid[r][c]) c++;
        for (let dr = 0; dr < cell.attrs.rowspan; dr++) {
          for (let dc = 0; dc < cell.attrs.colspan; dc++) (grid[r + dr] ??= [])[c + dc] = { cell, start: !dr && !dc };
        }
        c += cell.attrs.colspan;
      });
    });
    const ncols = Math.max(1, ...grid.map((row) => row.length));
    const role = (name: string | undefined, n: number) => (name && n > 1 ? `{${name}}\`${n}\`` : '');
    const text = (cell: PMNode) => {
      // Untouched since parsing: as it was written.
      const written = this.fresh ? undefined : this.map.cellSource(cell);
      if (written !== undefined) return written;
      const parts: string[] = [];
      // Its paragraphs (and the text of blocks pasted in from another format's cell).
      cell.descendants((p) => {
        if (p.isTextblock) parts.push(inlineMarkdown(p, this.map.style, true).replace(/\n/g, ' '));
        return !p.isTextblock;
      });
      const content = parts.filter(Boolean).join(' ').replace(/\|/g, '\\|');
      return [role(this.tableSpans.colspan, cell.attrs.colspan), role(this.tableSpans.rowspan, cell.attrs.rowspan), content].filter(Boolean).join(' ');
    };
    const rows = grid.map((row) => Array.from({ length: ncols }, (_, c) => (row[c]?.start ? text(row[c]!.cell) : '')));
    const aligns = Array.from({ length: ncols }, (_, c) => grid[0]?.[c]?.cell.attrs.align as keyof typeof ALIGN_RULE | null);
    const { pretty, ruleSpaces } = node.attrs as { pretty: boolean; ruleSpaces: boolean };
    // Padded tables: each column as wide as its widest cell. The delimiter row either
    // has spaces like the cells (`| --- |`) or fills the whole cell (`|-----|`).
    const content = aligns.map((_, c) => Math.max(...rows.map((row) => row[c].length)));
    const textWidth = content.map((w) => (pretty ? (ruleSpaces ? Math.max(3, w) : Math.max(1, w)) : 0));
    const ruleWidth = textWidth.map((w) => (pretty ? (ruleSpaces ? w : w + 2) : 3));
    const rule = aligns.map((a, c) => (a ? ALIGN_RULE[a](ruleWidth[c]) : '-'.repeat(ruleWidth[c])));
    const padded = (cells: string[]) => `| ${cells.map((t, c) => t.padEnd(textWidth[c])).join(' | ')} |`;
    const freshRule = ruleSpaces ? padded(rule) : `|${rule.join('|')}|`;
    // Rows in conditions go between their markers: a group's start before its first
    // row, its end after its last (inner groups inside outer ones).
    const write = (line: (cells: string[], r: number) => string, ruleLine: string) => {
      const out = [line(rows[0], 0), ruleLine];
      let open: RowCondition[] = [];
      rows.slice(1).forEach((cells, i) => {
        const conds: RowCondition[] = node.child(i + 1).attrs.conds;
        let keep = 0;
        while (keep < open.length && keep < conds.length && open[keep].id === conds[keep].id) keep++;
        for (let g = open.length - 1; g >= keep; g--) out.push(open[g].end);
        for (let g = keep; g < conds.length; g++) out.push(conds[g].start);
        open = conds;
        out.push(line(cells, i + 1));
      });
      for (let g = open.length - 1; g >= 0; g--) out.push(open[g].end);
      return out;
    };
    // An edited table of the same columns: the rows nobody touched as they were, and
    // edited ones in their style (their pipes, their padding). A padded table whose
    // edited text no longer fits its column is padded anew, all of it.
    const was = this.fresh ? undefined : this.map.get(node.attrs.sid);
    if (was && was.node.type === node.type) {
      const markers = new Set<string>();
      node.forEach((row) => (row.attrs.conds as RowCondition[]).forEach((c) => (markers.add(c.start), markers.add(c.end))));
      const lines = was.text.split('\n').filter((l) => l.trim() && !markers.has(l));
      const wasAligns: (string | null)[] = [];
      let wasCols = 0;
      was.node.firstChild?.forEach((c) => {
        wasCols += c.attrs.colspan;
        wasAligns.push(c.attrs.align);
      });
      if (lines.length >= 2 && wasCols === ncols && wasAligns.length === ncols && JSON.stringify(wasAligns) === JSON.stringify(aligns)) {
        let fits = true;
        const out = write((cells, r) => {
          const own = this.map.rowSource(node.child(r));
          if (own !== undefined) return own;
          const model = lines[r === 0 ? 0 : Math.min(r + 1, lines.length - 1)];
          const styled = restyle(model, cells, pretty);
          if (styled === null || (pretty && styled.trimEnd().length !== model.trimEnd().length)) fits = false;
          return styled ?? padded(cells);
        }, lines[1]);
        if (fits) return out.join('\n');
      }
    }
    return write(padded, freshRule).join('\n');
  }

  // Term lines, then ": description" lines, a blank line between items.
  private definitionList(node: PMNode): string {
    const items: string[] = [];
    node.forEach((item) => {
      const lines: string[] = [];
      item.forEach((part) => {
        if (part.type.name === 'definition_term') lines.push(inlineMarkdown(part, this.map.style).replace(/\n/g, ' '));
        else {
          const text = part.childCount === 1 && part.firstChild!.type.name === 'paragraph' ? inlineMarkdown(part.firstChild!, this.map.style) : this.container(part, undefined);
          lines.push(text.split('\n').map((l, k) => (k ? `  ${l}` : `: ${l}`)).join('\n'));
        }
      });
      items.push(lines.join('\n'));
    });
    return items.join('\n\n');
  }

  // `swap`: with the other marker than the list's own (see container).
  private list(node: PMNode, swap = false): string {
    const ordered = node.type.name === 'ordered_list';
    const tight: boolean = node.attrs.tight;
    const own = (node.firstChild?.attrs.marker as string | null) ?? (ordered ? `1${node.attrs.delim}` : node.attrs.bullet);
    const bullet = swap && !ordered ? (own.trim() === '-' ? '*' : '-') : null;
    // (Another format's callouts, pasted in: numbered.)
    const delim = swap && ordered ? (own.trim().endsWith(')') ? '.' : ')') : node.attrs.delim === ')' ? ')' : '.';
    let out = '';
    let number = ordered ? node.attrs.start - 1 : 0;
    node.forEach((item, _off, i) => {
      if (i > 0) out += this.originalGap(node.child(i - 1), item) ?? (tight ? '\n' : '\n\n');
      let marker: string = bullet ?? item.attrs.marker ?? (ordered ? '' : node.attrs.bullet);
      if (ordered && node.attrs.repeat) {
        // "1. 1. 1." style: every item uses the same number.
        marker = swap ? `${node.attrs.start}${delim}` : (item.attrs.marker ?? `${node.attrs.start}${delim}`);
      } else if (ordered) {
        const n = parseInt(marker, 10);
        number = Number.isNaN(n) || n <= number ? number + 1 : n;
        if (Number.isNaN(n) || n !== number || swap) marker = `${number}${delim}`;
      }
      const original = this.unchanged(item);
      if (original !== undefined) {
        // As written, but for its marker when that's swapped (the same length).
        out += swap ? original.replace(/^(\s*)([-*+]|\d+[.)])/, `$1${marker}`) : original;
        return;
      }
      const body = this.container(item, this.containerEntry(item), tight);
      const space = ' '.repeat(item.attrs.pad);
      const indent = ' '.repeat(marker.length + item.attrs.pad);
      const lines = body.split('\n');
      out += [lines[0] ? marker + space + lines[0] : marker, ...lines.slice(1).map((l) => (l ? indent + l : l))].join('\n');
    });
    return out;
  }
}

// A list's marker as written: its first item's bullet, or its numbers' delimiter.
function listMarker(text: string): string {
  const m = /^\s*(?:([-*+])|\d+([.)]))/.exec(text);
  return m ? (m[1] ?? m[2]) : '';
}

function prefixLines(text: string, prefix: string, emptyPrefix: string): string {
  return text
    .split('\n')
    .map((l) => (l ? prefix + l : emptyPrefix))
    .join('\n');
}

// ---- inline content -------------------------------------------------------

const tick = (value: string) => {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((s) => s.length));
  return '`'.repeat(longest + 1);
};

// Serializer state that also escapes text starting a line after a soft break, and
// MyST's own line-start syntax (comments, colon fences, block breaks, targets).
class MystInlineState extends MarkdownSerializerState {
  // In a table cell nothing starts a line, so line-start syntax needs no escaping.
  inCell = false;

  esc(str: string, startOfLine = false): string {
    if (this.inCell) startOfLine = false;
    let out = super.esc(str, startOfLine);
    if (startOfLine) out = out.replace(/^(%|\+\+\+|:::|\(.*\)=\s*$)/, '\\$&');
    return out;
  }
}

// Where a line break ends its line, until the lines are trimmed: then the style's
// backslash or two spaces.
const HARD_BREAK = '\u0001';

type State = MystInlineState & { atBlockStart: boolean; out: string; inAutolink?: boolean };
type NodeFn = (state: State, node: PMNode, parent: PMNode, index: number) => void;

const nodes: Record<string, NodeFn> = {
  paragraph: (state, node) => state.renderInline(node, !state.inCell),
  text: (state, node) => {
    // At the start of a line (after a soft break, or at the very start) the text
    // gets line-start escaping, and loses leading spaces, which Markdown would strip
    // or, with four of them, turn into a code block.
    const atLineStart = !state.inCell && (state.out === '' || state.out.endsWith('\n'));
    if (atLineStart) state.atBlockStart = true;
    const text = atLineStart ? node.text!.replace(/^[ \t]+/, '') : node.text!;
    if (text) state.text(text);
  },
  soft_break: (state) => state.write('\n'),
  // A trailing hard break would serialize as a literal backslash.
  hard_break: (state, _node, parent, index) => {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (!['soft_break', 'hard_break'].includes(parent.child(i).type.name)) return state.write(`${HARD_BREAK}\n`);
    }
  },
  role: (state, node) => {
    if (node.attrs.name === 'substitution') return void state.write(`{{${node.attrs.value}}}`);
    const t = tick(node.attrs.value);
    state.write(`{${node.attrs.name}}${t}${node.attrs.value}${t}`);
  },
  inline_math: (state, node) => state.write(`$${node.attrs.value}$`),
  html_inline: (state, node) => state.write(node.attrs.value),
  footnote_ref: (state, node) => state.write(`[^${node.attrs.label}]`),
  ref_link: (state, node) => state.write(`[](${linkDestination(node.attrs.href, node.attrs.title)})`),
  image: (state, node) =>
    state.write(`![${state.esc(node.attrs.alt || '')}](${linkDestination(node.attrs.src, node.attrs.title)})${attrsOf(node.attrs.extra)}`),
};

// <scheme:...> autolinks, including MyST custom schemes like <gh-user:name>. Only used
// when the document already writes this URL that way.
function isAutolink(style: InlineStyle, mark: Mark, parent: PMNode, index: number): boolean {
  const href: string = mark.attrs.href;
  if (mark.attrs.title || !style.autolinks.has(href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== href || content.marks[content.marks.length - 1] !== mark) return false;
  return index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks);
}

// Plain text covered by `mark` starting at child `index`.
function markedText(mark: Mark, parent: PMNode, index: number): string {
  let text = '';
  for (let i = index; i < parent.childCount && mark.isInSet(parent.child(i).marks); i++) text += parent.child(i).textContent;
  return text;
}

function linkDestination(href: string, title: string | null): string {
  // CommonMark allows balanced parentheses in a bare destination; otherwise use <...>.
  let depth = 0;
  const balanced = [...href].every((c) => (depth += c === '(' ? 1 : c === ')' ? -1 : 0) >= 0) && depth === 0;
  const dest = /[\s<>]/.test(href) || !balanced ? `<${href.replace(/[<>]/g, '\\$&')}>` : href;
  return title ? `${dest} "${title.replace(/"/g, '\\"')}"` : dest;
}

type MarkSerializerSpec = (typeof defaultMarkdownSerializer.marks)[string];
type LinkState = State & { linkClose?: string[] };

// What a mark or node writes after itself: its attribute list ({#id .class}), the
// MyST way of keeping it.
const attrsOf = (value: unknown) => (typeof value === 'string' && /^\{.*\}$/.test(value) ? value : '');
// A link's, after it.
const close0 = (mark: Mark) => attrsOf(mark.attrs.extra) || null;

const marksFor = (style: InlineStyle): Record<string, MarkSerializerSpec> => ({
  em: { open: style.em, close: style.em, mixable: true, expelEnclosingWhitespace: true },
  strong: { open: style.strong, close: style.strong, mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  link: {
    // Decide the link's closing syntax when it opens: autolink, reference or inline.
    open(state, mark, parent, index) {
      const s = state as LinkState;
      const stack = (s.linkClose ??= []);
      if (isAutolink(style, mark, parent, index)) {
        stack.push('>');
        return '<';
      }
      const ref = style.refs.get(mark.attrs.href);
      if (ref && ref.title === (mark.attrs.title ?? null)) {
        const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
        stack.push(norm(markedText(mark, parent, index)) === norm(ref.label) ? ']' : `][${ref.label}]`);
      } else {
        stack.push(`](${linkDestination(mark.attrs.href, mark.attrs.title)})`);
      }
      return '[';
    },
    close(state, mark, parent, index) {
      const close = (state as LinkState).linkClose!.pop()! + (close0(mark) ?? '');
      // A shortcut reference directly followed by `(` or `[` would parse differently.
      const next = index < parent.childCount ? parent.child(index) : null;
      if (close === ']' && next?.isText && /^[([]/.test(next.text!)) return `][${style.refs.get(mark.attrs.href)!.label}]`;
      return close;
    },
    mixable: true,
  },
  // Inline code, with its attributes ({.py}) if it has them.
  code: {
    ...defaultMarkdownSerializer.marks.code,
    close: (state, mark, parent, index) => {
      const base = defaultMarkdownSerializer.marks.code.close;
      return (typeof base === 'function' ? base(state, mark, parent, index) : base) + attrsOf(mark.attrs.role);
    },
  },
  // Not MyST's (it has no such styles): its text, as it is.
  // A span with attributes: [text]{.class}. (Other spans, another format's, are text.)
  span: { open: (_s, mark) => (attrsOf(mark.attrs.role) ? '[' : ''), close: (_s, mark) => (attrsOf(mark.attrs.role) ? `]${mark.attrs.role}` : ''), mixable: true },
});

const inlineOptions = {
  // `$` starts inline math; `<` and `&` could start HTML or an entity.
  escapeExtraCharacters: /\$|<(?=[A-Za-z/!?])|&(?=#?\w+;)/g,
};

// A table row written like `model` (another row of the table, as written): its
// indentation and outer pipes, each cell's spaces; in a padded table, padded to the
// cell's width where it fits. Null if `model` doesn't have as many cells.
function restyle(model: string, cells: string[], padded: boolean): string | null {
  const m = /^(\s*)(\|?)(.*?)((?<!\\)\|?)\s*$/.exec(model);
  if (!m) return null;
  const [, indent, lead, body, trail] = m;
  const segments = body.split(/(?<!\\)\|/);
  if (segments.length !== cells.length) return null;
  const out = cells.map((text, i) => {
    const seg = segments[i];
    const left = /^\s*/.exec(seg)![0] || (lead || i > 0 ? ' ' : '');
    const last = i === cells.length - 1 && !trail;
    const written = left + text;
    if (last) return written;
    // (Its space after the text: as the cell it replaces had, or one.)
    if (padded) return written.length < seg.length ? written.padEnd(seg.length) : `${written} `;
    return `${written}${/\s*$/.exec(seg)![0] || ' '}`;
  });
  return `${indent}${lead}${out.join('|')}${trail}`;
}

// The page's link definitions, for reading a line of it on its own.
const definitions = (style: InlineStyle) => [...style.refs].map(([url, r]) => `[${r.label}]: <${url}>${r.title ? ` "${r.title.replace(/"/g, '\\"')}"` : ''}`).join('\n');

const withoutSids = (json: unknown): unknown => JSON.parse(JSON.stringify(json, (k, v) => (k === 'sid' ? undefined : v)));

// A line's inline content, read as a line in the middle of a paragraph (its
// indentation and what would start a block there mean nothing); null if it can't be.
function lineForm(line: string, defs: string): string | null {
  try {
    const { doc } = parseMyst(`x ${line.trimStart()}${defs ? `\n\n${defs}` : ''}`);
    const first = doc.firstChild;
    if (first?.type.name !== 'paragraph') return null;
    return JSON.stringify(first.content.toJSON());
  } catch {
    return null;
  }
}

const sameLine = (a: string, b: string, defs = '') => {
  const f = lineForm(a, defs);
  return f !== null && f === lineForm(b, defs);
};

// `line` (written anew, reading as `form`) with each piece where it differs from
// `was` (the line it replaces) put back as `was` had it, where the line still reads
// the same: ``code`` stays ``code``, and only what was typed changes.
function respell(line: string, was: string, form: string, defs: string): string {
  const hunks = charDiff(was, line);
  const changes = hunks.filter((h) => h.kind === 'change').length;
  if (!changes || changes > 8) return line;
  const build = (useOld: Set<number>) => hunks.map((h, i) => (h.kind === 'same' ? h.text : useOld.has(i) ? h.old : h.new)).join('');
  const changed = hunks.flatMap((h, i) => (h.kind === 'change' ? [i] : []));
  // Usually one piece was typed: all the others as they were.
  for (const typed of changed) {
    const candidate = build(new Set(changed.filter((i) => i !== typed)));
    if (lineForm(candidate, defs) === form) return candidate;
  }
  // Else piece by piece.
  const useOld = new Set<number>();
  hunks.forEach((h, i) => {
    if (h.kind !== 'change') return;
    useOld.add(i);
    if (lineForm(build(useOld), defs) !== form) useOld.delete(i);
  });
  return build(useOld);
}

type Hunk = { kind: 'same'; text: string } | { kind: 'change'; old: string; new: string };

// The pieces two short strings share, and those they don't (a longest common
// subsequence, by characters).
function charDiff(a: string, b: string): Hunk[] {
  if (a.length * b.length > 250_000) return [{ kind: 'change', old: a, new: b }];
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Hunk[] = [];
  const push = (kind: 'same' | 'old' | 'new', ch: string) => {
    const last = out[out.length - 1];
    if (kind === 'same') {
      if (last?.kind === 'same') last.text += ch;
      else out.push({ kind: 'same', text: ch });
      return;
    }
    if (last?.kind !== 'change') out.push({ kind: 'change', old: '', new: '' });
    const h = out[out.length - 1] as { kind: 'change'; old: string; new: string };
    if (kind === 'old') h.old += ch;
    else h.new += ch;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) push('new', b[j++]);
    else push('old', a[i++]);
  }
  return out;
}

// `text` (a block written anew) with its lines as `was` had them, in order, where one
// there says the same: an edit rewrites only the lines it's on. Kept only if the
// block still reads as `text` does.
function keepLines(text: string, was: string, style: InlineStyle): string {
  const defs = definitions(style);
  const old = was.split('\n');
  const forms = old.map((l) => lineForm(l, defs));
  let from = 0;
  const kept = text
    .split('\n')
    .map((line) => {
      if (old[from] === line) return old[from++];
      const f = lineForm(line, defs);
      const at = f === null ? -1 : forms.indexOf(f, from);
      if (at >= 0) {
        from = at + 1;
        return old[at];
      }
      // The edited line: as the line it replaces was spelled, but for the edit.
      if (f !== null && from < old.length && (forms.indexOf(f, from) < 0)) {
        const revised = respell(line, old[from], f, defs);
        if (revised !== line) {
          from++;
          return revised;
        }
      }
      return line;
    })
    .join('\n');
  if (kept === text) return text;
  const whole = (t: string) => {
    const { doc } = parseMyst(`${t}${defs ? `\n\n${defs}` : ''}`);
    return JSON.stringify(withoutSids(doc.firstChild?.toJSON()));
  };
  return whole(kept) === whole(text) ? kept : text;
}

function inlineMarkdown(textblock: PMNode, style: InlineStyle, inCell = false): string {
  const para = schema.node('doc', null, [schema.node('paragraph', null, textblock.content)]);
  // The state constructor and `out` are public at runtime but marked internal in the typings.
  const Ctor = MystInlineState as unknown as new (n: object, m: object, o: object) => MystInlineState & { out: string };
  const state = new Ctor(nodes, marksFor(style), inlineOptions);
  state.inCell = inCell;
  state.renderContent(para);
  // Whitespace at line edges is insignificant in Markdown, except that trailing double
  // spaces make a hard break; an empty line would split the paragraph.
  const breakMark = inCell ? '\\' : style.hardBreak;
  return state.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => (line.endsWith(HARD_BREAK) ? line.slice(0, -1).trimEnd() + breakMark : line))
    .join('\n');
}
