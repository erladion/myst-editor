// AsciiDoc tables (|===) ↔ the editor's tables: cells of inline text, merged cells,
// alignment, a header row. Others (cells of blocks, CSV, styled columns) stay as
// written.
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema.js';
import type { SourceMap } from '../sourcemap.js';
import { parseInline, serializeInline, Unsupported } from './inline.js';
import type { BlockHeader } from './parse.js';

type Align = 'left' | 'center' | 'right' | null;
interface Cell {
  text: string; // as written, between its separators
  line: number; // which of the table's lines it's on
  colspan: number;
  rowspan: number;
  align: Align;
}

const ALIGNS: Record<string, Align> = { '<': 'left', '^': 'center', '>': 'right' };
const ALIGN_MARKS: Record<string, string> = { left: '<', center: '^', right: '>' };
// Table options the editor's tables can carry (as written, in their header).
const OPTIONS = new Set(['header', 'noheader', 'autowidth', 'rotate', 'breakable', 'unbreakable']);
const NAMED = new Set(['cols', 'options', 'opts', 'frame', 'grid', 'stripes', 'width', 'float', 'align', 'caption', 'title', 'id', 'role']);

// The columns `cols` says: "3", "1,2,1", "2*,1"; null if a column is styled.
function columnsOf(cols: string): number | null {
  const specs = cols.includes(',') || cols.includes(';') ? cols.split(/[,;]/) : /^\d+$/.test(cols.trim()) ? Array(Number(cols.trim())).fill('1') : [cols];
  let n = 0;
  for (const spec of specs) {
    const m = /^\s*(?:(\d+)\*)?([<^>])?(?:\.[<^>])?(\d+%?|~)?([a-z])?\s*$/.exec(spec);
    if (!m || (m[4] && m[4] !== 'd')) return null;
    n += m[1] ? Number(m[1]) : 1;
  }
  return n;
}

// A line's cells: the text between separators, and the spec in front of each (2+,
// .2+, ^). Null if a spec is one the editor can't keep (a style, a duplication).
function cellsOf(line: string): Omit<Cell, 'line'>[] | null {
  const bars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') i++;
    else if (line[i] === '|') bars.push(i);
  }
  if (!bars.length) return null;
  const pieces = bars.map((b, k) => line.slice(b + 1, k + 1 < bars.length ? bars[k + 1] : line.length));
  const specs = [line.slice(0, bars[0]), ...pieces.slice(0, -1).map(() => '')];
  // A spec is at the end of the text before a bar, after a space.
  const SPEC = /(^|[ \t])((?:(\d+)(?:\.(\d+))?|\.(\d+))\+)?([<^>])?(\.[<^>])?([a-z])?(\d+\*)?$/;
  for (let k = 0; k < pieces.length - 1; k++) {
    const m = SPEC.exec(pieces[k]);
    if (m && m[0].trim()) {
      specs[k + 1] = m[0].trim();
      pieces[k] = pieces[k].slice(0, pieces[k].length - m[0].length + m[1].length);
    }
  }
  if (specs[0].trim() && !SPEC.test(specs[0].trim())) return null;
  return pieces.map((text, k): Omit<Cell, 'line'> => {
    const m = SPEC.exec(specs[k].trim())!;
    if (m[7] || m[8] || m[9]) throw new Unsupported('cell style');
    return { text: text.trimEnd(), colspan: m[3] ? Number(m[3]) : 1, rowspan: Number(m[4] ?? m[5] ?? 1), align: m[6] ? ALIGNS[m[6]] : null };
  });
}

// The rows of the table in `lines` (between its delimiters), with `header` read from
// the lines before it.
export function tableRows(header: BlockHeader, lines: string[], map: SourceMap): PMNode[] {
  const { attrs } = header;
  const named = new Map(attrs.named);
  if (attrs.style || attrs.positional.length || attrs.named.some(([k]) => !NAMED.has(k))) throw new Unsupported('table attributes');
  const opts = [...attrs.opts, ...[named.get('options'), named.get('opts')].flatMap((v) => v?.split(',').map((o) => o.trim()) ?? [])];
  if (opts.some((o) => !OPTIONS.has(o))) throw new Unsupported('table options');
  const cells: Cell[] = [];
  let firstLine = -1;
  let firstCount = 0;
  let blankAfterFirst = false;
  lines.forEach((line, k) => {
    if (!line.trim()) {
      if (firstLine >= 0 && k === firstLine + 1) blankAfterFirst = true;
      return;
    }
    const own = cellsOf(line);
    if (!own || /^\s/.test(line) || !line.trimStart().match(/^(?:(?:\d+(?:\.\d+)?|\.\d+)\+)?[<^>]?\|/)) throw new Unsupported('table line');
    if (firstLine < 0) {
      firstLine = k;
      firstCount = own.length;
    }
    cells.push(...own.map((c) => ({ ...c, line: k })));
  });
  const ncols = named.has('cols') ? columnsOf(named.get('cols')!) : firstCount;
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
  // The first row is the header: by its options, or by being alone on the first line
  // with a blank line after it.
  const headerRow = !opts.includes('noheader') && (opts.includes('header') || (firstLine === 0 && blankAfterFirst && firstCount === rows[0].length && rows[0].every((c) => c.colspan === 1 && c.rowspan === 1) && rows.length > 1));
  let end = -1; // the last line of the row before
  return rows.map((cells, k) => {
    const row = schema.node(
      'table_row',
      null,
      cells.map((c) => {
        const type = k === 0 && headerRow ? 'table_header' : 'table_cell';
        const node = schema.node(type, { colspan: c.colspan, rowspan: c.rowspan, align: c.align }, [schema.node('paragraph', null, parseInline(c.text.trim().replace(/\\\|/g, '|')))]);
        map.recordCell(node, c.text);
        return node;
      }),
    );
    // The row's lines as written, when it has them to itself, and the lines before it.
    const first = cells[0].line;
    const last = cells[cells.length - 1].line;
    if (first > end && !cells.some((c) => c.line < first)) {
      const trail = k === rows.length - 1 ? lines.slice(last + 1).map((l) => `${l}\n`).join('') : '';
      const breaks = cells.map((c, n) => n > 0 && c.line !== cells[n - 1].line);
      written.set(row, { text: lines.slice(first, last + 1).join('\n'), gap: lines.slice(end + 1, first).map((l) => `${l}\n`).join(''), trail, breaks });
    }
    end = last;
    return row;
  });
}

// Rows as they were written, and the lines between each and the row before it (blank
// lines, or none): untouched rows are written so again.
// `trail`: for the last, the lines after it.
// `breaks`: which of its cells start a line.
const written = new WeakMap<PMNode, { text: string; gap: string; trail: string; breaks: boolean[] }>();

// A table as AsciiDoc. Rows untouched since reading are written as they were; an
// edited one as the row it replaced was (one cell a line, or the row on one), with
// the lines between rows as they were. `original`: the table as read, if it was.
export function writeTable(node: PMNode, map: SourceMap | null, original: PMNode | undefined): string {
  let ncols = 0;
  node.firstChild?.forEach((c) => (ncols += c.attrs.colspan));
  const header = headerWithColumns(node.attrs.header as string | null, ncols);
  const before = (k: number) => (map && original && k < original.childCount ? written.get(original.child(k)) : undefined);
  const firstWritten = before(0)?.text ?? (original ? undefined : '| ');
  const spaced = firstWritten === undefined || /\|\s/.test(firstWritten);
  // A cell's text as written (with the spaces after its bar), or written anew: spaced
  // like the cell it replaced, or the table's first.
  const cellText = (cell: PMNode, k: number, n: number) => {
    const kept = map?.cellSource(cell);
    if (kept !== undefined) return kept;
    const parts: string[] = [];
    cell.forEach((p) => parts.push(serializeInline(p, { inCell: true }).replace(/ \+\n/g, ' ').replace(/\n/g, ' ')));
    const text = parts.filter(Boolean).join(' ').replace(/(?<!\\)\|/g, '\\|');
    const replaced = map && original && k < original.childCount && n < original.child(k).childCount ? map.cellSource(original.child(k).child(n)) : undefined;
    const pad = replaced !== undefined ? /^\s*/.exec(replaced)![0] : spaced ? ' ' : '';
    return text ? pad + text : '';
  };
  const spec = (cell: PMNode) => {
    const { colspan, rowspan, align } = cell.attrs as { colspan: number; rowspan: number; align: string | null };
    const span = colspan > 1 || rowspan > 1 ? `${colspan > 1 ? colspan : ''}${rowspan > 1 ? `.${rowspan}` : ''}+` : '';
    return span + (align ? ALIGN_MARKS[align] : '');
  };
  const cellOut = (cell: PMNode, k: number, n: number) => `${spec(cell)}|${cellText(cell, k, n)}`;
  const explicit = /%header|options=["']?[^"'\]]*\bheader/.test(header ?? '');
  const parts: { gap: string; text: string; header: boolean }[] = [];
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
      row.forEach((c, _p, n) => cells.push(cellOut(c, k, n)));
      // On lines as the row it replaced had them (a header written as one: on one).
      const breaks = was && (!isHeader || explicit) ? was.breaks : [];
      text = cells.map((c, n) => (n === 0 ? '' : (breaks[n] ?? breaks[breaks.length - 1] ?? false) ? '\n' : ' ') + c).join('');
    }
    parts.push({ gap, text, header: isHeader });
  });
  // A first row that isn't the header, on a line of its own with a blank line after
  // it, would be read as one: a blank line before it says it isn't.
  const [first, second] = parts;
  if (first && !first.header && !first.gap && second?.gap && !first.text.includes('\n')) first.gap = '\n';
  let out = `${header ? `${header}\n` : ''}|===\n`;
  for (const p of parts) out += `${p.gap}${p.text}\n`;
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
    if (columnsOf(cols) === ncols) return all;
    const specs = cols.includes(',') ? cols.split(',') : Array(columnsOf(cols) ?? 0).fill('1');
    const next = Array.from({ length: ncols }, (_, k) => specs[k]?.trim() || '1');
    return `${key}"${next.join(',')}"`;
  });
}
