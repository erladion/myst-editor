// AsciiDoc tables (|===) ↔ the editor's tables: cells of text (over lines, in
// paragraphs) or of blocks (style a), merged cells, alignment, a header row, the
// cells' and columns' styles. Others (CSV, literal and verse cells, duplicated
// cells) stay as written.
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema.js';
import type { SourceMap } from '../sourcemap.js';
import { parseInline, serializeInline, Unsupported } from './inline.js';
import type { BlockHeader } from './parse.js';
import type { RowCondition } from '../schema.js';
import { readCondition } from './conditions.js';

// Numbers the groups of rows inside a condition.
let rowGroups = 0;

type Align = 'left' | 'center' | 'right' | null;
interface Cell {
  text: string; // as written, between its separators (over lines, if it goes on)
  line: number; // which of the table's lines it starts on
  end: number; // and ends on
  conds: RowCondition[]; // the conditions around it (outermost first)
  colspan: number;
  rowspan: number;
  align: Align;
  style: string | null; // its spec's vertical alignment and style, as written (".^a")
  col: number; // its column
}

// Styles the editor's cells can have: AsciiDoc (blocks), literal (text as written,
// spaces and lines), and text styled as a whole.
const STYLES = new Set(['a', 'd', 'e', 'h', 'l', 'm', 's', 'v']);
// A cell's spec, before its bar: duplication, span, alignments, style.
const SPEC = /(^|[ \t])((\d+)\*)?((?:(\d+)(?:\.(\d+))?|\.(\d+))\+)?([<^>])?(\.[<^>])?([a-z])?$/;

const ALIGNS: Record<string, Align> = { '<': 'left', '^': 'center', '>': 'right' };
const ALIGN_MARKS: Record<string, string> = { left: '<', center: '^', right: '>' };
// Table options the editor's tables can carry (as written, in their header).
const OPTIONS = new Set(['header', 'noheader', 'autowidth', 'rotate', 'breakable', 'unbreakable']);
const NAMED = new Set(['cols', 'options', 'opts', 'frame', 'grid', 'stripes', 'width', 'float', 'align', 'caption', 'title', 'id', 'role']);

// The columns `cols` says ("3", "1,2,1", "2*,1", "1,2a"): how many, and each one's
// style. Null if the editor can't keep one.
function columnsOf(cols: string): { count: number; styles: (string | null)[] } | null {
  const specs = cols.includes(',') || cols.includes(';') ? cols.split(/[,;]/) : /^\d+$/.test(cols.trim()) ? Array(Number(cols.trim())).fill('1') : [cols];
  const styles: (string | null)[] = [];
  for (const spec of specs) {
    const m = /^\s*(?:(\d+)\*)?([<^>])?(?:\.[<^>])?(\d+%?|~)?([a-z])?\s*$/.exec(spec);
    if (!m || (m[4] && !STYLES.has(m[4]))) return null;
    for (let k = 0; k < (m[1] ? Number(m[1]) : 1); k++) styles.push(m[4] ?? null);
  }
  return { count: styles.length, styles };
}

// A line's cells: the text between separators and the spec in front of each; and
// `lead`, the text before the first, going on from the cell on the lines above.
function cellsOf(line: string): { lead: string; cells: { spec: string; text: string }[] } {
  const bars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') i++;
    else if (line[i] === '|') bars.push(i);
  }
  if (!bars.length) return { lead: line, cells: [] };
  const pieces = [line.slice(0, bars[0]), ...bars.map((b, k) => line.slice(b + 1, k + 1 < bars.length ? bars[k + 1] : line.length))];
  const specs: string[] = [];
  // A spec is at the end of the text before a bar, after a space.
  for (let k = 0; k < pieces.length - 1; k++) {
    const m = SPEC.exec(pieces[k]);
    if (m && m[0].trim()) {
      specs.push(m[0].trim());
      pieces[k] = pieces[k].slice(0, pieces[k].length - m[0].length + m[1].length);
    } else specs.push('');
  }
  return { lead: pieces[0], cells: pieces.slice(1).map((text, k) => ({ spec: specs[k], text })) };
}

// What a cell's spec says; Unsupported for what the editor can't keep.
function specOf(spec: string): Pick<Cell, 'colspan' | 'rowspan' | 'align' | 'style'> {
  const m = SPEC.exec(spec)!;
  if (m[2]) throw new Unsupported('duplicated cell');
  if (m[10] && !STYLES.has(m[10])) throw new Unsupported('cell style');
  const style = (m[9] ?? '') + (m[10] ?? '');
  return { colspan: m[5] ? Number(m[5]) : 1, rowspan: Number(m[6] ?? m[7] ?? 1), align: m[8] ? ALIGNS[m[8]] : null, style: style || null };
}

// A cell's style letter: its own, or its column's.
const letterOf = (style: string | null, column: string | null) => (style ?? '').replace(/^\.[<^>]/, '') || column;

// The text of a cell of style a, as the blocks in it: from the cell's text, and the
// line (of the table's) it starts on.
export type ReadBlocks = (text: string, line: number) => PMNode[];

// The rows of the table in `lines` (between its delimiters), with `header` read from
// the lines before it.
export function tableRows(header: BlockHeader, lines: string[], map: SourceMap, conditions: boolean, readBlocks: ReadBlocks): PMNode[] {
  const { attrs } = header;
  const named = new Map(attrs.named);
  if (attrs.style || attrs.positional.length || attrs.named.some(([k]) => !NAMED.has(k))) throw new Unsupported('table attributes');
  const opts = [...attrs.opts, ...[named.get('options'), named.get('opts')].flatMap((v) => v?.split(',').map((o) => o.trim()) ?? [])];
  if (opts.some((o) => !OPTIONS.has(o))) throw new Unsupported('table options');
  const cells: Cell[] = [];
  let firstLine = -1;
  let firstCount = 0;
  let blankAfterFirst = false;
  let cell: Cell | null = null; // the one the lines go on with
  let marked = false; // a condition's marker (or a comment) since its last line
  const comments: number[] = []; // the comment lines
  // Conditions between rows (ifdef::[] lines): each row knows those it's in.
  const open: RowCondition[] = [];
  lines.forEach((line, k) => {
    const marker = conditions ? readCondition(line) : null;
    if (marker) marked = true;
    if (marker?.kind === 'start') return void open.push({ id: `a${++rowGroups}`, start: line, end: '' });
    if (marker?.kind === 'end') {
      const group = open.pop();
      if (!group) throw new Unsupported('condition end without a start');
      group.end = line;
      return;
    }
    if (!line.trim()) {
      if (firstLine >= 0 && k === firstLine + 1) blankAfterFirst = true;
      if (cell) cell.text += '\n';
      return;
    }
    // A comment line: Asciidoctor leaves it out. Between rows it stays where it is.
    if (/^\/\/(?!\/\/)/.test(line)) {
      if (firstLine < 0) throw new Unsupported('comment before the first row');
      comments.push(k);
      marked = true;
      return;
    }
    const { lead, cells: own } = cellsOf(line);
    if (lead.trim()) {
      // Text going on from the cell above (not over a condition's marker).
      if (!cell || marked) throw new Unsupported('table line');
      cell.text += `\n${lead}`;
      cell.end = k;
    }
    if (!own.length) return;
    if (firstLine < 0) {
      firstLine = k;
      firstCount = own.length;
    }
    for (const c of own) {
      cell = { text: c.text, line: k, end: k, conds: [...open], ...specOf(c.spec), col: 0 };
      cells.push(cell);
    }
    marked = false;
  });
  if (open.length) throw new Unsupported('condition without an end');
  const columns = named.has('cols') ? columnsOf(named.get('cols')!) : { count: firstCount, styles: [] };
  const ncols = columns?.count;
  if (!ncols || !cells.length) throw new Unsupported('table columns');
  // Rows: cells fill the columns left free by cells merged from rows above.
  const rows: Cell[][] = [];
  const taken: number[][] = [];
  let row: Cell[] = [];
  let col = 0;
  let r = 0;
  const busy = (rr: number, c: number) => taken[rr]?.includes(c);
  for (const cell of cells) {
    while (col < ncols && busy(r, col)) col++;
    if (col + cell.colspan > ncols) throw new Unsupported('cell past the last column');
    for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) (taken[r + dr] ??= []).push(col + dc);
    cell.col = col;
    row.push(cell);
    col += cell.colspan;
    while (col < ncols && busy(r, col)) col++;
    if (col >= ncols) {
      rows.push(row);
      row = [];
      col = 0;
      r++;
    }
  }
  if (row.length || taken.length > rows.length) throw new Unsupported('incomplete row');
  // A row is in one set of conditions; the header row in none.
  if (rows.some((r) => r.some((c) => c.conds.length !== r[0].conds.length || c.conds.some((g, i) => g !== r[0].conds[i])))) throw new Unsupported('condition inside a row');
  // The first row is the header: by its options, or by being alone on the first line
  // with a blank line after it.
  // Comments only between rows (where they're kept as written).
  for (const row of rows) if (comments.some((l) => l > row[0].line && l < row[row.length - 1].end)) throw new Unsupported('comment inside a row');
  const headerRow =
    !opts.includes('noheader') &&
    (opts.includes('header') || (firstLine === 0 && blankAfterFirst && firstCount === rows[0].length && rows[0].every((c) => c.colspan === 1 && c.rowspan === 1 && c.end === c.line) && rows.length > 1));
  let end = -1; // the last line of the row before
  return rows.map((cells, k) => {
    if (k === 0 && headerRow && cells[0].conds.length) throw new Unsupported('header row in a condition');
    const row = schema.node(
      'table_row',
      cells[0].conds.length ? { conds: cells[0].conds } : null,
      cells.map((c) => {
        const head = k === 0 && headerRow;
        const type = head ? 'table_header' : 'table_cell';
        const raw = c.text.trimEnd();
        const text = raw.trim().replace(/\\\|/g, '|');
        let content: PMNode[];
        // Of style a (the header row's cells are text whatever their column's style):
        // the blocks in it, read as the page's are. On the lines below its bar, from the
        // first that has something, indentation and all.
        const letter = head ? null : letterOf(c.style, columns!.styles[c.col] ?? null);
        if (letter === 'l') {
          // Literal: its lines as they are, from the first that has something.
          const lines = raw.replace(/^(?:[ \t]*\n)*/, '').replace(/^[ \t]+(?=\S)/, (sp) => (/^[ \t]*\S/.test(raw) ? '' : sp)).replace(/\\\|/g, '|').split('\n');
          const inline: PMNode[] = [];
          lines.forEach((l, i) => {
            if (i > 0) inline.push(schema.node('soft_break'));
            if (l) inline.push(schema.text(l));
          });
          content = [schema.node('paragraph', null, inline)];
        } else if (letter === 'a') {
          const lead = /^[ \t]*\S/.test(raw) ? /^[ \t]*/.exec(raw)![0] : /^(?:[ \t]*\n)*/.exec(raw)![0];
          const at = c.line + (lead.match(/\n/g)?.length ?? 0);
          const body = raw.slice(lead.length).replace(/\\\|/g, '|');
          const blocks = body ? readBlocks(body, at) : [];
          content = [schema.node('cell_blocks', null, blocks.length ? blocks : [schema.node('paragraph')])];
        } else {
          // Its paragraphs, blank lines between them; lines going on, without their indentation.
          const paras = text ? text.split(/\n[ \t]*\n/).map((p) => p.trim().replace(/\n[ \t]+/g, '\n')) : [''];
          content = paras.map((p) => schema.node('paragraph', null, parseInline(p)));
        }
        // (Its a is what it holds: blocks.)
        const style = letter === 'a' ? (c.style ?? '').replace(/a$/, '') || null : c.style;
        const node = schema.node(type, { colspan: c.colspan, rowspan: c.rowspan, align: c.align, style }, content);
        map.recordCell(node, raw);
        return node;
      }),
    );
    // The row's lines as written, when it has them to itself, and the lines before it.
    const first = cells[0].line;
    const last = cells[cells.length - 1].end;
    if (first > end && !cells.some((c) => c.line < first)) {
      // Between each cell and the one before: a space, or the line breaks (and blank lines).
      const breaks = cells.map((c, n) => (n === 0 || c.line === cells[n - 1].end ? ' ' : '\n'.repeat(c.line - cells[n - 1].end)));
      const between = (from: number, to: number) => lines.slice(from, to).filter((l) => !(conditions && readCondition(l))).map((l) => `${l}\n`).join('');
      const trailing = k === rows.length - 1 ? between(last + 1, lines.length) : '';
      written.set(row, { text: lines.slice(first, last + 1).join('\n'), gap: between(end + 1, first), trail: trailing, breaks });
    }
    end = last;
    return row;
  });
}

// Rows as they were written, and the lines between each and the row before it (blank
// lines, or none): untouched rows are written so again.
// `trail`: for the last, the lines after it.
// `breaks`: what's before each of its cells: a space, or line breaks.
const written = new WeakMap<PMNode, { text: string; gap: string; trail: string; breaks: string[] }>();

// Whether a cell holds blocks (it's written as one of style a).
const holdsBlocks = (cell: PMNode) => {
  let blocks = false;
  cell.forEach((c) => (blocks ||= c.type.name === 'cell_blocks'));
  return blocks;
};

// Each cell's column, by the cells' places in their rows (and those merged from above).
function columnsOfCells(node: PMNode): Map<PMNode, number> {
  const out = new Map<PMNode, number>();
  const taken: number[][] = [];
  node.forEach((row, _o, r) => {
    let col = 0;
    row.forEach((cell) => {
      while (taken[r]?.includes(col)) col++;
      out.set(cell, col);
      for (let dr = 0; dr < cell.attrs.rowspan; dr++) for (let dc = 0; dc < cell.attrs.colspan; dc++) (taken[r + dr] ??= []).push(col + dc);
      col += cell.attrs.colspan;
    });
  });
  return out;
}

// A table as AsciiDoc. Rows untouched since reading are written as they were; an
// edited one as the row it replaced was (one cell a line, or the row on one), with
// the lines between rows as they were. `original`: the table as read, if it was.
// `writeBlocks`: the blocks of a cell that holds them, as the page's are written.
export function writeTable(node: PMNode, map: SourceMap | null, original: PMNode | undefined, writeBlocks: (cell: PMNode) => string): string {
  let ncols = 0;
  node.firstChild?.forEach((c) => (ncols += c.attrs.colspan));
  const header = headerWithColumns(node.attrs.header as string | null, ncols);
  const colsOf = /\bcols=(?:"([^"]*)"|'([^']*)'|([^,\]\s]*))/.exec(header ?? '');
  const columnStyles = (colsOf && columnsOf(colsOf[1] ?? colsOf[2] ?? colsOf[3] ?? '')?.styles) || [];
  const cellColumns = columnsOfCells(node);
  const before = (k: number) => (map && original && k < original.childCount ? written.get(original.child(k)) : undefined);
  const firstWritten = before(0)?.text ?? (original ? undefined : '| ');
  const spaced = firstWritten === undefined || /\|\s/.test(firstWritten);
  // A cell's text as written (with the spaces after its bar), or written anew: spaced
  // like the cell it replaced, or the table's first.
  const cellText = (cell: PMNode, k: number, n: number) => {
    const kept = map?.cellSource(cell);
    if (kept !== undefined) return kept;
    // Blocks: as on the page, on the line of the cell's spec if the cell they replaced
    // was written so (and they don't start indented), else under it.
    if (holdsBlocks(cell)) {
      const body = writeBlocks(cell).replace(/(?<!\\)\|/g, '\\|');
      const replaced = map && original && k < original.childCount && n < original.child(k).childCount ? map.cellSource(original.child(k).child(n)) : undefined;
      const onLine = replaced !== undefined && /^[ \t]*\S/.test(replaced) && !/^\s/.test(body);
      return onLine ? /^[ \t]*/.exec(replaced!)![0] + body : `\n${body}`;
    }
    // Literal: its text as it is, a line for each line.
    const column = cell.type.name === 'table_header' ? null : (columnStyles[cellColumns.get(cell) ?? -1] ?? null);
    if (letterOf((cell.attrs.style as string | null) ?? null, column) === 'l') {
      const lines: string[] = [];
      cell.forEach((p, _o, i) => {
        let text = i > 0 ? '\n' : '';
        p.forEach((n) => (text += n.isText ? n.text! : n.type.name === 'soft_break' || n.type.name === 'hard_break' ? '\n' : n.textContent));
        lines.push(text);
      });
      const text = lines.join('\n').replace(/(?<!\\)\|/g, '\\|');
      const replaced = map && original && k < original.childCount && n < original.child(k).childCount ? map.cellSource(original.child(k).child(n)) : undefined;
      const lead = replaced !== undefined && /^[ \t]*\S/.test(replaced) && !/^\s/.test(text) ? /^[ \t]*/.exec(replaced)![0] : text.includes('\n') || /^\s/.test(text) ? '\n' : spaced ? ' ' : '';
      return text ? lead + text : '';
    }
    // Text: its paragraphs, a blank line between them.
    const parts: string[] = [];
    // (Its lines as the cell it replaced had them, where they say the same.)
    const was = map && original && k < original.childCount && n < original.child(k).childCount ? map.cellSource(original.child(k).child(n))?.trim().replace(/\\\|/g, '|') : undefined;
    cell.forEach((p) => parts.push(serializeInline(p, { inCell: true, was }).trim()));
    const text = parts.filter(Boolean).join('\n\n').replace(/(?<!\\)\|/g, '\\|');
    const replaced = map && original && k < original.childCount && n < original.child(k).childCount ? map.cellSource(original.child(k).child(n)) : undefined;
    const pad = replaced !== undefined ? /^\s*/.exec(replaced)![0] : spaced ? ' ' : '';
    return text ? pad + text : '';
  };
  const spec = (cell: PMNode) => {
    const { colspan, rowspan, align } = cell.attrs as { colspan: number; rowspan: number; align: string | null };
    const span = colspan > 1 || rowspan > 1 ? `${colspan > 1 ? colspan : ''}${rowspan > 1 ? `.${rowspan}` : ''}+` : '';
    // Its style: a when it holds blocks (unless its column has it); text in a column
    // of style a, d.
    let style = (cell.attrs.style as string | null) ?? '';
    const column = cell.type.name === 'table_header' ? null : (columnStyles[cellColumns.get(cell) ?? -1] ?? null);
    const letter = letterOf(style || null, null);
    if (holdsBlocks(cell) && column !== 'a') style = style.replace(/[a-z]$/, '') + 'a';
    else if (!holdsBlocks(cell) && column === 'a' && !letter) style += 'd';
    return span + (align ? ALIGN_MARKS[align] : '') + style;
  };
  const cellOut = (cell: PMNode, k: number, n: number) => `${spec(cell)}|${cellText(cell, k, n)}`;
  const explicit = /%header|options=["']?[^"'\]]*\bheader/.test(header ?? '');
  const parts: { gap: string; text: string; header: boolean }[] = [];
  let firstOverLines = false;
  let headerOverLines = false;
  node.forEach((row, _o, k) => {
    const isHeader = k === 0 && row.firstChild?.type.name === 'table_header';
    const own = map ? written.get(row) : undefined;
    const was = own ?? before(k);
    let gap = was?.gap ?? '';
    // A header row written as one: the first line, a blank line after it.
    if (isHeader && !explicit) gap = '';
    if (k === 1 && parts[0].header && !gap) gap = '\n';
    let text = own?.text;
    if (text === undefined) {
      const cells: string[] = [];
      const anew: boolean[] = [];
      row.forEach((c, _p, n) => {
        cells.push(cellOut(c, k, n));
        anew.push(map?.cellSource(c) === undefined);
      });
      // On lines as the row it replaced had them (a new row: as the last one; a
      // header written as one: on one).
      const pattern = was ?? (map && original?.lastChild ? written.get(original.lastChild) : undefined);
      const breaks = pattern && (!isHeader || explicit) ? pattern.breaks : [];
      // Around a cell of blocks written anew, line breaks; after text over lines in a
      // row written anew, too.
      // Without cols, the first line's cells are the columns: the first row on it.
      const firstRow = k === 0 && !colsOf;
      if (firstRow && cells.slice(0, -1).some((c) => c.includes('\n'))) firstOverLines = true;
      text = cells
        .map((c, n) => {
          if (n === 0) return c;
          if (firstRow) return ' ' + c;
          const before = breaks[n] ?? breaks[breaks.length - 1] ?? ' ';
          const own = (anew[n - 1] && holdsBlocks(row.child(n - 1))) || (anew[n] && holdsBlocks(row.child(n))) || (!pattern && cells[n - 1].includes('\n'));
          return (before === ' ' && own ? '\n' : before) + c;
        })
        .join('');
    }
    // A header row over lines isn't read as one unless the table says so.
    if (isHeader && !explicit && text.includes('\n')) headerOverLines = true;
    parts.push({ gap, text, header: isHeader });
  });
  // A first row that isn't the header, on a line of its own with a blank line after
  // it, would be read as one: a blank line before it says it isn't.
  const [first, second] = parts;
  if (first && !first.header && !first.gap && second?.gap && !first.text.includes('\n')) first.gap = '\n';
  // Rows in conditions go between their markers: a group's start before its first
  // row, its end after its last (inner groups inside outer ones).
  // A first row going over lines (without cols, its first line would say how many
  // columns there are): cols says.
  let head = header;
  const more = [headerOverLines ? '%header' : '', firstOverLines ? `cols="${ncols}*"` : ''].filter(Boolean);
  if (more.length) head = `${header ? `${header}\n` : ''}[${more.join(',')}]`;
  let out = `${head ? `${head}\n` : ''}|===\n`;
  let open: RowCondition[] = [];
  const markers = (conds: RowCondition[]) => {
    let keep = 0;
    while (keep < open.length && keep < conds.length && open[keep].id === conds[keep].id) keep++;
    const lines = [...open.slice(keep).reverse().map((c) => c.end), ...conds.slice(keep).map((c) => c.start)];
    open = conds;
    return lines.map((l) => `${l}\n`).join('');
  };
  parts.forEach((p, k) => {
    out += `${p.gap}${markers(node.child(k).attrs.conds)}${p.text}\n`;
  });
  out += markers([]);
  // The lines after the last row, as they were.
  const last = node.childCount - 1;
  const trail = (map ? written.get(node.child(last)) : undefined)?.trail ?? before(original ? original.childCount - 1 : -1)?.trail ?? '';
  return `${out}${trail}|===`;
}

// The header, its `cols` as many as the table's columns now are.
function headerWithColumns(header: string | null, ncols: number): string | null {
  if (!header) return header;
  return header.replace(/(\bcols=)(?:"([^"]*)"|'([^']*)'|([^,\]\s]*))/, (all, key: string, dq?: string, sq?: string, bare?: string) => {
    const cols = dq ?? sq ?? bare ?? '';
    if (columnsOf(cols)?.count === ncols) return all;
    const specs = cols.includes(',') ? cols.split(',') : Array(columnsOf(cols)?.count ?? 0).fill('1');
    const next = Array.from({ length: ncols }, (_, k) => specs[k]?.trim() || '1');
    return `${key}"${next.join(',')}"`;
  });
}
