// MyST source -> ProseMirror document, recording the exact source text of every block.
//
// The approach: myst-parser gives us block structure and line ranges. We cut each
// container's text into segments at block start lines, so concatenating
// lead + seg0 + gap0 + seg1 + ... + trail reproduces the container text exactly.
// Nested containers (directive bodies, list items, blockquotes) get their inner text
// extracted (fence/marker/`>` removed) and are parsed again recursively.
import { createTokenizer, tokensToMyst } from 'myst-parser';
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { schema, type RowCondition } from '../schema.js';
import { splitDirective, headerKey } from '../directive.js';
import { readMarker } from '../conditions.js';
import { SourceMap } from '../sourcemap.js';

type MdNode = { type: string; position?: { start: { line: number }; end: { line: number } }; [k: string]: any };

// Directives whose body is MyST markdown and that the editor renders as editable blocks.
export const MARKDOWN_DIRECTIVES = new Set([
  'admonition', 'note', 'warning', 'tip', 'important', 'hint', 'caution', 'attention', 'danger', 'error', 'seealso',
  'versionadded', 'versionchanged', 'deprecated', 'versionremoved',
  'figure', 'table', 'dropdown', 'topic', 'sidebar', 'margin', 'epigraph', 'pull-quote', 'highlights',
  'tab-set', 'tab-item', 'grid', 'grid-item', 'grid-item-card', 'card', 'div', 'container',
  // sphinx-togglebutton, sphinx-exercise, sphinx-design's buttons.
  'toggle', 'exercise', 'solution', 'button-ref', 'button-link',
]);

// What a {list-table} may say for the editor to edit it: other options (stub columns,
// say) keep it as written.
const LIST_TABLE_OPTIONS = new Set(['header-rows', 'widths', 'width', 'name', 'class', 'align', 'label']);

// Whether a table is a {list-table} (its header is the directive's).
export const isListTable = (node: { attrs: Record<string, unknown> }) => typeof node.attrs.header === 'string' && /^\s*(`{3,}|~{3,}|:{3,})\{list-table\}/.test(node.attrs.header);

// Directives with nothing in them, edited as blocks of their own: a picture, a
// rubric, sphinx-exercise's markers around an exercise or solution written as the
// page's own blocks.
export const NO_BODY_DIRECTIVES = new Set(['image', 'rubric', 'exercise-start', 'exercise-end', 'solution-start', 'solution-end']);

// A footnote definition's last line: it goes on over indented lines (blank lines
// between them), and lines going on from its paragraph that don't start a block.
function footnoteEnd(lines: string[], start: number, limit: number): number {
  let end = start;
  for (let k = start + 1; k <= limit; k++) {
    const line = lines[k];
    if (!line.trim()) continue;
    const indented = /^ {1,}\S/.test(line) || /^\t/.test(line);
    const lazy = end === k - 1 && !/^ {0,3}(```|~~~|:::|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\[\^[^\]]+\]:|<|\||\$\$|\{|\(.*\)=\s*$)/.test(line);
    if (indented || lazy) end = k;
    else break;
  }
  return end;
}

// Directives whose body is literal text, shown as an editable code block.
export const CODE_DIRECTIVES = new Set(['code-block', 'code', 'sourcecode', 'code-cell', 'eval-rst', 'raw', 'mermaid']);

// Parser extensions matching Sphinx's MyST-Parser. `@key` citations are a mystmd-only
// syntax and smart quotes would rewrite the source. TODO: derive the optional ones
// (colon_fence, dollarmath, deflist, tasklist, ...) from the project's conf.py.
const SPHINX_DIALECT = { smartquotes: false, citations: false, strikethrough: true };

export interface ParseOptions {
  extensions?: Record<string, boolean>;
  // Project-specific directives (from .wysie.toml), overriding the built-in lists.
  directives?: Record<string, 'markdown' | 'text' | 'none'>;
  // Keywords of block condition markers, e.g. ["if", "endif"].
  conditionKeywords?: [string, string];
  // Roles the project's extension uses for merged table cells.
  tableSpans?: { colspan?: string; rowspan?: string };
  // {{ name }} as a substitution (the substitution extension).
  substitutions?: boolean;
  // {#id .class key=value} after spans, code, links and pictures (attrs_inline), and
  // on a line before a block (attrs_block).
  attrsInline?: boolean;
  attrsBlock?: boolean;
  // :name: value lines as a field list (fieldlist).
  fieldList?: boolean;
}

// A field list: :name: value lines, values going on over indented lines.
export const FIELD = /^:([^:\s][^:]*?):(?:[ \t]+(.*))?$/;
export const isFieldList = (src: string) => {
  const lines = src.split('\n');
  return FIELD.test(lines[0]) && lines.every((l) => FIELD.test(l) || /^[ \t]+\S/.test(l));
};

// An attribute list: {#id .class key=value key="a value"}.
const ATTRS = /^\{\s*(?:(?:[#.][\w:.-]+|[\w-]+=(?:"[^"\n]*"|'[^'\n]*'|[^\s{}"']+)|%[\w-]+)\s*)+\}/;
export const isAttrsLine = (line: string) => {
  const m = ATTRS.exec(line.trim());
  return !!m && m[0].length === line.trim().length;
};

// The options of the parse under way, for reading inline text.
let reading: ParseOptions = {};

export interface ParseResult {
  doc: PMNode;
  map: SourceMap;
}

class Unsupported extends Error {}

export function parseMyst(source: string, opts: ParseOptions = {}): ParseResult {
  const was = reading;
  reading = opts;
  try {
    return parseWith(source, opts);
  } finally {
    reading = was;
  }
}

function parseWith(source: string, opts: ParseOptions): ParseResult {
  const map = new SourceMap();
  map.style = inferStyle(source);
  const ctx = new Context(source, map, opts);
  const { nodes, entry } = ctx.container(source, true);
  const doc = schema.node('doc', { sid: null }, nodes.length ? nodes : [schema.node('paragraph')]);
  map.root = entry;
  return { doc, map };
}

class Context {
  // Link reference and footnote definitions are document-global, but nested
  // containers are parsed on their own; append these so references still resolve.
  private suffix: string;

  constructor(
    source: string,
    private map: SourceMap,
    private opts: ParseOptions,
  ) {
    this.suffix = source
      .split('\n')
      .filter((l) => /^\s{0,3}\[[^\]]+\]:/.test(l))
      .join('\n');
  }

  private parse(text: string, isDoc: boolean): MdNode[] {
    const input = !isDoc && this.suffix ? `${text}\n\n${this.suffix}\n` : text;
    return parseMdast(input, { ...SPHINX_DIALECT, ...this.opts.extensions }).children;
  }

  // Parse `text` as a sequence of blocks. Returns PM nodes plus the source entry
  // holding lead/trail/gaps so the container can be reassembled.
  // Absolute (1-based) line where the block being converted starts.
  private line = 1;

  // `base` is the absolute line of the container text's first line.
  container(text: string, isDoc = false, base = 1) {
    const lines = text.split('\n');
    const lineStart: number[] = [];
    let off = 0;
    for (const l of lines) {
      lineStart.push(off);
      off += l.length + 1;
    }
    const lineEnd = (i: number) => lineStart[i] + lines[i].length; // exclusive, before '\n'

    // 1. Collect top-level blocks with 0-based [start, end] line ranges.
    type Block = { node: MdNode; start: number; end: number };
    const blocks: Block[] = [];
    const add = (node: MdNode, start: number, end: number) => {
      if (start < 0 || start >= lines.length) return; // came from the suffix
      blocks.push({ node, start, end: Math.min(Math.max(end, start), lines.length - 1) });
    };
    const visit = (node: MdNode) => {
      const pos = node.position;
      if (node.type === 'footnoteDefinition') {
        // myst-parser moves these to the end with a bogus position; find the real line.
        const re = new RegExp(`^\\s{0,3}\\[\\^${escapeRe(node.label)}\\]:`);
        const at = lines.findIndex((l) => re.test(l));
        if (at >= 0) add(node, at, at);
      } else if (node.type === 'block' && pos) {
        // `+++` block break: the marker line is its own block, children are siblings.
        add({ type: 'blockBreak' }, pos.start.line - 1, pos.start.line - 1);
        (node.children ?? []).forEach(visit);
      } else if (node.type === 'math' && pos && /^\s*\\begin\{/.test(lines[pos.start.line - 1] ?? '')) {
        // An amsmath environment: myst-parser ends it a line early.
        add(node, pos.start.line - 1, pos.start.line - 1 + String(node.value).split('\n').length - 1);
      } else if (pos) {
        add(node, pos.start.line - 1, pos.end.line - 1);
      }
    };
    this.parse(text, isDoc).forEach(visit);
    // Stable sort; on equal start the longer block wins and the other is dropped below.
    blocks.sort((a, b) => a.start - b.start || b.end - a.end);
    // A table whose rows have condition markers between them: Markdown ends the table
    // at the first marker, but it's one table.
    this.joinConditionalRows(blocks, lines);

    // 2. Clamp each block to end before the next one starts, and turn any non-blank
    //    lines not owned by a block (e.g. link reference definitions) into raw blocks.
    const segs: Block[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (segs.length && b.start <= segs[segs.length - 1].end) continue; // duplicate start
      const next = blocks.find((o, j) => j > i && o.start > b.start);
      const limit = next ? next.start - 1 : lines.length - 1;
      const end = b.node.type === 'footnoteDefinition' ? footnoteEnd(lines, b.start, limit) : Math.min(b.end, limit);
      // {#id .class} on its own line: the next block's attributes; what follows it in
      // the paragraph, a paragraph of its own. (Before a block read otherwise, such as
      // a definition list's term, the block stays as read.)
      const rest = this.opts.attrsBlock && b.node.type === 'paragraph' && isAttrsLine(lines[b.start]) && end > b.start ? this.parse(lines.slice(b.start + 1, end + 1).join('\n'), false) : null;
      if (this.opts.attrsBlock && b.node.type === 'paragraph' && isAttrsLine(lines[b.start]) && (end === b.start || (rest?.length === 1 && rest[0].type === 'paragraph'))) {
        segs.push({ node: { type: 'blockAttributes' }, start: b.start, end: b.start });
        if (rest) segs.push({ node: rest[0], start: b.start + 1, end });
      } else segs.push({ ...b, end });
      let j = end + 1;
      while (j <= limit) {
        if (lines[j].trim() === '') {
          j++;
          continue;
        }
        let k = j;
        while (k + 1 <= limit && lines[k + 1].trim() !== '') k++;
        segs.push({ node: { type: 'orphan' }, start: j, end: k });
        j = k + 1;
      }
    }
    // Leading orphan lines before the first block.
    if (blocks.length === 0 || blocks[0].start > 0) {
      const first = blocks.length ? blocks[0].start - 1 : lines.length - 1;
      const pre: Block[] = [];
      let j = 0;
      while (j <= first) {
        if (lines[j].trim() === '') {
          j++;
          continue;
        }
        let k = j;
        while (k + 1 <= first && lines[k + 1].trim() !== '') k++;
        pre.push({ node: { type: 'orphan' }, start: j, end: k });
        j = k + 1;
      }
      segs.unshift(...pre);
    }

    // 3. Cut the text. Each segment excludes its trailing blank lines.
    const pieces = segs.map((s) => {
      let e = s.end;
      while (e > s.start && lines[e].trim() === '') e--;
      return { ...s, from: lineStart[s.start], to: lineEnd(e) };
    });

    const entry = this.map.newContainer(
      pieces.length ? text.slice(0, pieces[0].from) : text,
      pieces.length ? text.slice(pieces[pieces.length - 1].to) : '',
    );
    const nodes: PMNode[] = [];
    let prevSid: string | null = null;
    pieces.forEach((p, i) => {
      const segText = text.slice(p.from, p.to);
      this.line = base + p.start;
      const node = this.block(p.node, segText, isDoc && i === 0);
      nodes.push(node);
      const sid = node.attrs.sid as string;
      if (prevSid) this.map.link(prevSid, sid, text.slice(pieces[i - 1].to, p.from));
      prevSid = sid;
    });
    return { nodes, entry };
  }

  // Convert one mdast block plus its exact source text into a PM node, and record it.
  private block(md: MdNode, src: string, isFirstInDoc: boolean): PMNode {
    let node: PMNode;
    try {
      node = this.convert(md, src, isFirstInDoc);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      node = this.raw(md.type, src);
    }
    return node;
  }

  private withSid(type: string, attrs: Record<string, any>, content: PMNode[] | null, src: string): PMNode {
    const sid = this.map.nextSid();
    const node = schema.node(type, { ...attrs, sid }, content ?? undefined);
    this.map.record(sid, node, src, undefined, this.line);
    return node;
  }

  private raw(kind: string, src: string): PMNode {
    return this.withSid('raw_block', { kind, source: src }, null, src);
  }

  private convert(md: MdNode, src: string, isFirstInDoc: boolean): PMNode {
    switch (md.type) {
      case 'paragraph':
        if (this.opts.fieldList && isFieldList(src)) return this.raw('fieldlist', src);
        return this.withSid('paragraph', {}, inline(md.children), src);

      // An image on a line of its own (MyST makes it a block): a paragraph with the
      // image in it, as Insert → Image makes one.
      case 'image':
        return this.withSid('paragraph', {}, inline([md]), src);

      case 'heading': {
        const setext = !/^\s{0,3}#/.test(src);
        return this.withSid('heading', { level: md.depth, setext }, inline(md.children), src);
      }

      case 'thematicBreak':
        return this.withSid('thematic_break', { markup: src.trim() }, null, src);

      case 'code': {
        if (isFirstInDoc && src.startsWith('---')) return this.raw('frontmatter', src);
        const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(src.split('\n')[0]);
        const attrs = m
          ? { lang: m[3].trim(), fence: m[1] + m[2], indented: false }
          : { lang: '', fence: '```', indented: true };
        return this.withSid('code_block', attrs, textContent(md.value), src);
      }

      case 'math': {
        // \begin{equation} … \end{equation} (amsmath): the environment, as written.
        if (/^\\begin\{([\w*]+)\}[\s\S]*\\end\{\1\}$/.test(src.trim())) return this.withSid('math_block', { label: '', fence: '\\begin' }, textContent(src.trim()), src);
        if (!src.trimStart().startsWith('$$')) throw new Unsupported();
        return this.withSid('math_block', { label: md.label ?? '' }, textContent(md.value), src);
      }

      case 'mystTarget':
        return this.withSid('target', { label: md.label }, null, src);

      case 'blockquote': {
        const inner = src
          .split('\n')
          .map((l) => l.replace(/^\s{0,3}> ?/, ''))
          .join('\n');
        return this.containerNode('blockquote', {}, inner, src);
      }

      case 'list':
        return this.list(md, src);

      case 'mystDirective':
        return this.directive(md, src);

      case 'html': {
        // Conditional-content markers keep their source as-is but get their own kind.
        const marker = this.opts.conditionKeywords && readMarker(src, this.opts.conditionKeywords);
        return this.raw(marker ? `condition-${marker.kind}` : 'html', src);
      }
      case 'comment':
        return this.raw('comment', src);
      case 'conditionalTable':
        return this.conditionalTable(src);
      case 'table':
        return this.table(md, src);
      case 'footnoteDefinition': {
        // Its text: after [^label]:, and the lines under it without their indentation.
        const lines = src.split('\n');
        const head = /^ {0,3}\[\^([^\]]+)\]:[ \t]?(.*)$/.exec(lines[0]);
        if (!head) throw new Unsupported();
        const indent = lines.slice(1).find((l) => l.trim())?.match(/^ */)![0].length || 4;
        const inner = [head[2], ...lines.slice(1).map((l) => l.replace(new RegExp(`^ {0,${indent}}`), ''))].join('\n');
        return this.containerNode('footnote_def', { label: head[1], indent: Math.min(indent, 4) }, inner, src);
      }
      case 'definitionList':
        return this.definitionList(md, src);
      case 'blockBreak':
        return this.raw('block-break', src);
      case 'blockAttributes':
        return this.raw('block-attributes', src);
      default:
        return this.raw(md.type, src);
    }
  }

  // A node whose children come from parsing `inner` as its own container.
  // `innerOffset`: lines between the node's first line and its inner text (e.g. a
  // directive's header).
  private containerNode(type: string, attrs: Record<string, any>, inner: string, src: string, innerOffset = 0): PMNode {
    const line = this.line;
    const { nodes, entry } = this.container(inner, false, line + innerOffset);
    this.line = line;
    const sid = this.map.nextSid();
    const content = nodes.length || type === 'md_directive' ? nodes : [schema.node('paragraph')];
    const node = schema.node(type, { ...attrs, sid }, content);
    node.check();
    this.map.record(sid, node, src, entry, line);
    return node;
  }

  // {list-table}: rows (* - cell), cells (  - cell) whose content is the page's own
  // Markdown. The directive's header as written; rows and cells nobody touched written
  // as they were (see serialize.ts).
  private listTable(d: ReturnType<typeof splitDirective> & object, src: string): PMNode {
    const options = new Map(d.options);
    if ([...options.keys()].some((k) => !LIST_TABLE_OPTIONS.has(k))) throw new Unsupported();
    const body = (d.body ?? '').split('\n');
    const bodyLine = this.line + d.header.split('\n').length;
    interface Cell {
      line: number; // where its text starts, in the body
      lines: string[]; // its text, without the marker and indentation
    }
    const rows: { start: number; end: number; cells: Cell[]; cellCol: number; textCol: number }[] = [];
    let rowIndent = 0;
    body.forEach((line, k) => {
      const cur = rows[rows.length - 1];
      const cell = cur && cur.cells[cur.cells.length - 1];
      // A row starts where the first did (a cell's own list starts further in).
      const row = /^( {0,3})([-*+])([ \t]+)([-*+])([ \t]+|$)(.*)$/.exec(line);
      if (row && (!cur || row[1].length === rowIndent)) {
        rowIndent = row[1].length;
        const cellCol = row[1].length + 1 + row[3].length;
        const textCol = cellCol + 1 + Math.max(1, row[5].length);
        rows.push({ start: k, end: k, cells: [{ line: k, lines: [row[6]] }], cellCol, textCol });
        return;
      }
      if (!cur) {
        if (line.trim()) throw new Unsupported();
        return;
      }
      const next = /^(\s*)([-*+])([ \t]+|$)(.*)$/.exec(line);
      if (next && next[1].length === cur.cellCol) {
        cur.cells.push({ line: k, lines: [next[4]] });
        cur.end = k;
      } else if (!line.trim()) cell.lines.push('');
      else if (line.length - line.trimStart().length >= cur.textCol) {
        cell.lines.push(line.slice(cur.textCol));
        cur.end = k;
      } else throw new Unsupported();
    });
    if (!rows.length || rows.some((r) => r.cells.length !== rows[0].cells.length)) throw new Unsupported();
    const headerRows = Number(options.get('header-rows') ?? 0);
    if (!Number.isInteger(headerRows) || headerRows < 0 || headerRows > rows.length) throw new Unsupported();
    const line = this.line;
    const pmRows = rows.map((r, n) => {
      const cells = r.cells.map((c) => {
        while (c.lines.length > 1 && !c.lines[c.lines.length - 1].trim()) c.lines.pop();
        const text = c.lines.join('\n');
        const { nodes } = this.container(text, false, bodyLine + c.line);
        const content = !nodes.length ? [schema.node('paragraph')] : nodes.length === 1 && nodes[0].type.name === 'paragraph' ? nodes : [schema.node('cell_blocks', null, nodes)];
        const node = schema.node(n < headerRows ? 'table_header' : 'table_cell', null, content);
        this.map.recordCell(node, text);
        return node;
      });
      const row = schema.node('table_row', null, cells);
      this.map.recordRow(row, body.slice(r.start, r.end + 1).join('\n'));
      return row;
    });
    this.line = line;
    return this.withSid('table', { header: d.header, pretty: false }, pmRows, src);
  }

  private directive(md: MdNode, src: string): PMNode {
    const d = splitDirective(src);
    if (!d) throw new Unsupported();
    const common = {
      name: d.name,
      args: d.args,
      options: d.options,
      header: d.header,
      headerKey: headerKey(d.name, d.args, d.options, d.fence),
    };
    const declared = this.opts.directives?.[d.name];
    const markdown = declared ? declared === 'markdown' : MARKDOWN_DIRECTIVES.has(d.name);
    const text = declared ? declared === 'text' : CODE_DIRECTIVES.has(d.name);
    if (markdown && d.closing) {
      return this.containerNode('md_directive', { ...common, fence: d.fence }, d.body ?? '', src, d.header.split('\n').length);
    }
    // A table written as a list of rows, each a list of cells.
    if (d.name === 'list-table' && !declared && d.closing) {
      try {
        return this.listTable(d, src);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
      }
    }
    // A picture, a rubric, a marker: a block of its own (one with content isn't one
    // Sphinx reads: as written).
    if (NO_BODY_DIRECTIVES.has(d.name) && !declared && d.closing && !(d.body ?? '').trim()) {
      return this.withSid('md_directive', { ...common, fence: d.fence }, [], src);
    }
    if (d.name === 'math' && d.closing && !declared) {
      const label = d.options.find(([k]) => k === 'label')?.[1] ?? '';
      return this.withSid('math_block', { ...common, label, directive: true, fence: d.fence }, textContent(d.body ?? ''), src);
    }
    if (text && d.closing) {
      return this.withSid(
        'code_block',
        { ...common, lang: d.args, fence: d.fence, directive: true },
        textContent(d.body ?? ''),
        src,
      );
    }
    return this.withSid('opaque_directive', { name: d.name, args: d.args, options: d.options, source: src }, null, src);
  }

  // A GFM table as an editable table. Leading span roles (e.g. {colspan}`2`) become
  // colspan/rowspan and the cells they cover must be empty; anything that can't be
  // represented exactly stays a raw block (the caller catches Unsupported).
  private table(md: MdNode, src: string): PMNode {
    const { rows, attrs } = this.tableParts(md, src);
    return this.withSid('table', attrs, rows, src);
  }

  // Joins a table and what follows it without a blank line, when that's condition
  // markers and rows of the table: rows the condition extension leaves out of the build
  // (it removes lines before Sphinx reads the page). Only when the markers pair up and
  // the rows have the table's number of cells; otherwise they stay as they are.
  private joinConditionalRows(blocks: { node: MdNode; start: number; end: number }[], lines: string[]) {
    const keywords = this.opts.conditionKeywords;
    if (!keywords) return;
    const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length;
    for (let i = 0; i < blocks.length; i++) {
      const table = blocks[i];
      if (table.node.type !== 'table') continue;
      const width = cells(lines[table.start]);
      let depth = 0;
      let markers = false;
      let last = -1;
      let end = table.end;
      for (let j = i + 1; j < blocks.length && blocks[j].start === end + 1; j++) {
        const b = blocks[j];
        const own = lines.slice(b.start, b.end + 1);
        const marker = b.node.type === 'html' && own.length === 1 ? readMarker(own[0], keywords) : null;
        if (marker?.kind === 'start') depth++;
        else if (marker?.kind === 'end') {
          if (!depth) break;
          depth--;
        } else if (b.node.type !== 'paragraph' || !own.every((l) => /^\s{0,3}\|.*\|\s*$/.test(l) && cells(l) === width)) break;
        markers ||= !!marker;
        end = b.end;
        if (!depth && markers) last = j;
      }
      if (last > i) blocks.splice(i, last - i + 1, { node: { type: 'conditionalTable' }, start: table.start, end: blocks[last].end });
    }
  }

  // A table with condition markers between its rows: the table as it is without them,
  // each row knowing which conditions it's in.
  private conditionalTable(src: string): PMNode {
    const keywords = this.opts.conditionKeywords!;
    const lines = src.split('\n');
    const plain = lines.filter((l) => !readMarker(l, keywords)).join('\n');
    const [md] = parseMdast(plain, { ...SPHINX_DIALECT, ...this.opts.extensions }).children;
    if (md?.type !== 'table') throw new Unsupported();
    const { rows, attrs } = this.tableParts(md, plain);
    const open: RowCondition[] = [];
    const conds: RowCondition[][] = [];
    let k = 0; // the table's own lines: header, delimiter, then a line per row
    for (const line of lines) {
      const marker = readMarker(line, keywords);
      if (marker?.kind === 'start') open.push({ id: `c${++rowGroups}`, start: line, end: '' });
      else if (marker?.kind === 'end') open.pop()!.end = line;
      else if (line.trim()) {
        if (k !== 1) conds[k === 0 ? 0 : k - 1] = [...open];
        k++;
      }
    }
    // Copied once every group's end marker is known.
    const withConds = rows.map((row, r) => {
      if (!conds[r]?.length) return row;
      const copy = row.type.create({ conds: conds[r].map((c) => ({ ...c })) }, row.content);
      const line = this.map.rowSource(row);
      if (line !== undefined) this.map.recordRow(copy, line);
      return copy;
    });
    return this.withSid('table', attrs, withConds, src);
  }

  private tableParts(md: MdNode, src: string): { rows: PMNode[]; attrs: { pretty: boolean; ruleSpaces: boolean } } {
    const spans = this.opts.tableSpans ?? {};
    // Each row's cells as written (the delimiter row is line 1).
    const written = src
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim()));
    const rows: MdNode[] = md.children ?? [];
    const ncols = rows[0]?.children?.length ?? 0;
    if (!ncols) throw new Unsupported();
    const covered = new Set<string>();
    const blank = (n: MdNode) => n.type === 'text' && !String(n.value).trim();
    const pmRows = rows.map((row, r) => {
      // GFM silently drops cells beyond the header's width; keep such tables as written.
      if ((row.children?.length ?? 0) > ncols) throw new Unsupported();
      const cells: PMNode[] = [];
      for (let c = 0; c < ncols; c++) {
        const cell: MdNode | undefined = row.children?.[c];
        const children: MdNode[] = [...(cell?.children ?? [])];
        if (covered.has(`${r},${c}`)) {
          if (!children.every(blank)) throw new Unsupported();
          continue;
        }
        let colspan = 1;
        let rowspan = 1;
        for (;;) {
          const first = children[0];
          const isSpan = first?.type === 'mystRole' && /^\d+$/.test(first.value) && (first.name === spans.colspan || first.name === spans.rowspan);
          if (!isSpan) break;
          if (first.name === spans.colspan) colspan = Number(first.value);
          else rowspan = Number(first.value);
          children.shift();
          if (children[0]?.type === 'text') {
            const rest = String(children[0].value).replace(/^\s+/, '');
            if (rest) children[0] = { ...children[0], value: rest };
            else children.shift();
          }
        }
        if (colspan < 1 || rowspan < 1 || c + colspan > ncols || r + rowspan > rows.length) throw new Unsupported();
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            if (!dr && !dc) continue;
            const key = `${r + dr},${c + dc}`;
            if (covered.has(key)) throw new Unsupported();
            covered.add(key);
          }
        }
        const align = cell?.align ?? rows[0].children[c]?.align ?? null;
        const node = schema.node(r === 0 ? 'table_header' : 'table_cell', { colspan, rowspan, align }, [schema.node('paragraph', null, inline(children))]);
        const asWritten = written[r === 0 ? 0 : r + 1]?.[c];
        if (asWritten !== undefined) this.map.recordCell(node, asWritten);
        cells.push(node);
      }
      return schema.node('table_row', null, cells);
    });
    const lines = src.split('\n').filter((l) => l.trim());
    pmRows.forEach((row, r) => {
      const line = lines[r === 0 ? 0 : r + 1];
      if (line !== undefined) this.map.recordRow(row, line);
    });
    // GFM drops cells beyond the header's width before we see them: count in the source.
    const cellCount = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length;
    if (lines.some((l) => cellCount(l) > cellCount(lines[0]))) throw new Unsupported();
    const pretty = lines.length > 1 && lines.every((l) => l.trimEnd().length === lines[0].trimEnd().length);
    const ruleSpaces = /\|\s+:?-/.test(lines[1] ?? '');
    return { rows: pmRows, attrs: { pretty, ruleSpaces } };
  }

  // Term, then ": description" lines. Each description one paragraph (a loose one,
  // of several blocks, stays as written).
  private definitionList(md: MdNode, src: string): PMNode {
    const items: PMNode[] = [];
    let terms: PMNode[] = [];
    let descs: PMNode[] = [];
    const flush = () => {
      if (terms.length) items.push(schema.node('definition_item', null, [...terms, ...descs]));
      terms = [];
      descs = [];
    };
    for (const child of md.children ?? []) {
      if (child.type === 'definitionTerm') {
        if (descs.length) flush();
        terms.push(schema.node('definition_term', null, inline(child.children)));
      } else if (child.type === 'definitionDescription') {
        if (!terms.length || (child.children ?? []).some((c: MdNode) => ['paragraph', 'list', 'code', 'blockquote', 'mystDirective', 'heading', 'table'].includes(c.type))) throw new Unsupported();
        descs.push(schema.node('definition_desc', null, [schema.node('paragraph', null, inline(child.children))]));
      } else throw new Unsupported();
    }
    flush();
    if (!items.length) throw new Unsupported();
    return this.withSid('definition_list', {}, items, src);
  }

  private list(md: MdNode, src: string): PMNode {
    const lines = src.split('\n');
    const base = md.position!.start.line;
    const items: { start: number; end: number }[] = md.children.map((it: MdNode, i: number) => {
      const start = it.position!.start.line - base;
      const next = i + 1 < md.children.length ? md.children[i + 1].position.start.line - base : lines.length;
      let end = next - 1;
      while (end > start && lines[end].trim() === '') end--;
      return { start, end };
    });

    const first = /^\s*([-*+]|\d+[.)])/.exec(lines[0]);
    const numbers = items.map(({ start }) => parseInt(lines[start].trim(), 10));
    const repeat = numbers.length > 1 && numbers.every((n) => n === numbers[0]);
    const listAttrs = md.ordered
      ? { start: md.start ?? 1, delim: first?.[1].slice(-1) ?? '.', tight: !md.spread, repeat }
      : { bullet: first?.[1] ?? '-', tight: !md.spread };

    const children: PMNode[] = [];
    let prevSid: string | null = null;
    let prevEnd = -1;
    const lineOffsets = offsets(lines);
    const listLine = this.line;
    for (const { start, end } of items) {
      this.line = listLine + start;
      const itemText = lines.slice(start, end + 1).join('\n');
      const m = /^(\s*)([-*+]|\d+[.)])([ \t]*)/.exec(itemText)!;
      const pad = m[3].length >= 1 && m[3].length <= 4 ? m[3].length : 1;
      const col = m[1].length + m[2].length + pad;
      const itemLines = itemText.split('\n');
      const inner = [itemLines[0].slice(Math.min(col, m[0].length)), ...itemLines.slice(1).map((l) => dedent(l, col))].join(
        '\n',
      );
      const item = this.containerNode('list_item', { marker: m[2], pad }, inner, itemText);
      children.push(item);
      const sid = item.attrs.sid as string;
      if (prevSid) {
        const gap = src.slice(lineOffsets[prevEnd] + lines[prevEnd].length, lineOffsets[start]);
        this.map.link(prevSid, sid, gap);
      }
      prevSid = sid;
      prevEnd = end;
    }
    this.line = listLine;
    return this.withSid(md.ordered ? 'ordered_list' : 'bullet_list', listAttrs, children, src);
  }
}

// ---- inline content -------------------------------------------------------

function inline(given: MdNode[] = [], marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  const children = reading.attrsInline ? withAttrs(given) : given;
  for (const c of children) {
    switch (c.type) {
      case 'text': {
        const parts = (c.value as string).split('\n');
        parts.forEach((part, i) => {
          if (i > 0) out.push(schema.node('soft_break', null, undefined, marks));
          if (!part) return;
          if (!reading.attrsInline) return void out.push(...plainText(part, marks));
          // [text]{.class}: a span, its attributes as written.
          let at = 0;
          for (const m of part.matchAll(/\[([^[\]\n]+)\](\{[^{}\n]*\})/g)) {
            if (!isAttrsLine(m[2])) continue;
            if (m.index! > at) out.push(...plainText(part.slice(at, m.index), marks));
            out.push(...plainText(m[1], schema.marks.span.create({ role: m[2] }).addToSet(marks)));
            at = m.index! + m[0].length;
          }
          if (at < part.length) out.push(...plainText(part.slice(at), marks));
        });
        break;
      }
      case 'emphasis':
        out.push(...inline(c.children, schema.marks.em.create().addToSet(marks)));
        break;
      case 'strong':
        out.push(...inline(c.children, schema.marks.strong.create().addToSet(marks)));
        break;
      case 'delete':
        out.push(...inline(c.children, schema.marks.strike.create().addToSet(marks)));
        break;
      case 'link':
        if (!c.children?.length) {
          if (c.attrs) throw new Unsupported();
          out.push(schema.node('ref_link', { href: c.url, title: c.title ?? null }, undefined, marks));
          break;
        }
        out.push(...inline(c.children, schema.marks.link.create({ href: c.url, title: c.title ?? null, extra: c.attrs ?? null }).addToSet(marks)));
        break;
      case 'inlineCode':
        if (c.value) out.push(schema.text(c.value, schema.marks.code.create({ role: c.attrs ?? null }).addToSet(marks)));
        else if (c.attrs) throw new Unsupported();
        break;
      case 'break':
        out.push(schema.node('hard_break', null, undefined, marks));
        break;
      case 'mystRole':
        out.push(schema.node('role', { name: c.name, value: c.value }, undefined, marks));
        break;
      case 'inlineMath':
        out.push(schema.node('inline_math', { value: c.value }, undefined, marks));
        break;
      case 'html':
        out.push(schema.node('html_inline', { value: c.value }, undefined, marks));
        break;
      case 'footnoteReference':
        out.push(schema.node('footnote_ref', { label: c.label ?? c.identifier }, undefined, marks));
        break;
      case 'image':
        out.push(schema.node('image', { src: c.url, alt: c.alt ?? '', title: c.title ?? null, extra: c.attrs ?? null }, undefined, marks));
        break;
      default:
        // Unknown inline syntax: keep the whole block as raw source.
        throw new Unsupported(c.type);
    }
  }
  return out;
}

const tokenizer = createTokenizer();

// Numbers the groups of table rows inside a condition (see conditionalTable).
let rowGroups = 0;

// What mystParse does, minus two things: it builds a new tokenizer every time (which
// compiles its link-detection patterns: slow, and a page is parsed in many pieces), and
// it runs directives' and roles' own processing, which the editor doesn't use (it
// reads their source). One tokenizer per set of extensions, then.
const tokenizers = new Map<string, ReturnType<typeof createTokenizer>>();
function parseMdast(input: string, extensions: Record<string, boolean>): MdNode {
  const key = JSON.stringify(extensions);
  let t = tokenizers.get(key);
  if (!t) tokenizers.set(key, (t = createTokenizer({ extensions })));
  return tokensToMyst(input, t.parse(input, {})) as unknown as MdNode;
}

function inferStyle(source: string): SourceMap['style'] {
  const count = (re: RegExp) => source.match(re)?.length ?? 0;
  // Reference definitions, keyed by the URL as the parser normalizes it.
  const refs = new Map<string, { label: string; title: string | null }>();
  const def = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/gm;
  for (const m of source.matchAll(def)) {
    const url = tokenizer.normalizeLink(m[2] ?? m[3]);
    if (!refs.has(url)) refs.set(url, { label: m[1], title: m[4] ?? m[5] ?? m[6] ?? null });
  }
  const autolinks = new Set([...source.matchAll(/<([a-zA-Z][\w+.-]{1,31}:[^\s<>]*)>/g)].map((m) => tokenizer.normalizeLink(m[1])));
  // Whether emphasis/strong are written with underscores or asterisks.
  const em = count(/(?<![\w\\_])_(?=[^\s_])[^_\n]*?[^\s_\\]_(?![\w_])/g) > count(/(?<![\w\\*])\*(?=[^\s*])[^*\n]*?[^\s*\\]\*(?![\w*])/g);
  const strong = count(/(?<![\w\\])__(?=\S)[^\n]*?\S__(?![\w])/g) > count(/(?<![\w\\])\*\*(?=\S)[^\n]*?\S\*\*/g);
  return { em: em ? '_' : '*', strong: strong ? '__' : '**', refs, autolinks, hardBreak: hardBreakStyle(source) ?? '\\' };
}

// How `source` ends lines that break: with a backslash or two spaces, whichever it
// does more. Null if it has neither.
export function hardBreakStyle(source: string): '\\' | '  ' | null {
  const backslash = source.match(/(?<!\\)\\\n(?=[ \t]*\S)/g)?.length ?? 0;
  const spaces = source.match(/\S {2,}\n(?=[ \t]*\S)/g)?.length ?? 0;
  return backslash || spaces ? (spaces > backslash ? '  ' : '\\') : null;
}

function textContent(value: string): PMNode[] {
  return value ? [schema.text(value)] : [];
}

function dedent(line: string, n: number): string {
  let i = 0;
  while (i < n && line[i] === ' ') i++;
  return line.slice(i);
}

function offsets(lines: string[]): number[] {
  const out: number[] = [];
  let off = 0;
  for (const l of lines) {
    out.push(off);
    off += l.length + 1;
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Text, with {{ name }} a substitution where the extension reads them so (its spaces
// as written).
function plainText(part: string, marks: readonly Mark[]): PMNode[] {
  if (!reading.substitutions) return part ? [schema.text(part, marks)] : [];
  const out: PMNode[] = [];
  let at = 0;
  for (const m of part.matchAll(/\{\{([^{}\n]+)\}\}/g)) {
    if (m.index! > at) out.push(schema.text(part.slice(at, m.index), marks));
    out.push(schema.node('role', { name: 'substitution', value: m[1] }, undefined, marks));
    at = m.index! + m[0].length;
  }
  if (at < part.length) out.push(schema.text(part.slice(at), marks));
  return out;
}

// Inline code, links and pictures with the attribute list right after them
// ({#id .class}) taken from the text that follows: as `attrs`.
function withAttrs(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    const next = children[i + 1];
    if (['inlineCode', 'link', 'image'].includes(c.type) && next?.type === 'text') {
      const m = ATTRS.exec(next.value as string);
      if (m) {
        out.push({ ...c, attrs: m[0] });
        const rest = (next.value as string).slice(m[0].length);
        if (rest) children[i + 1] = { ...next, value: rest };
        else i++;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}
