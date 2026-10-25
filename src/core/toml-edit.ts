// Changing a TOML file's settings in its text, so its comments, layout and other
// settings stay as they are (a TOML library would write the file anew). Values are
// strings, booleans and lists of strings: what the app's settings use.
import { parse as parseToml } from 'smol-toml';

export type TomlScalar = string | boolean | number;
export type TomlValue = TomlScalar | string[] | Record<string, TomlScalar>[];

// A table header or a key = value line (with the lines its value runs over), as
// character offsets: `end` is past the line break after it.
type Item =
  | { kind: 'header'; path: string[]; start: number; end: number }
  | { kind: 'pair'; table: string[]; key: string[]; start: number; valueStart: number; valueEnd: number; end: number };

class Scanner {
  pos = 0;
  constructor(readonly text: string) {}
  get ch() {
    return this.text[this.pos];
  }
  spaces() {
    while (this.ch === ' ' || this.ch === '\t') this.pos++;
  }
  // To the start of the next line.
  lineEnd() {
    const nl = this.text.indexOf('\n', this.pos);
    this.pos = nl < 0 ? this.text.length : nl + 1;
  }
  fail(): never {
    throw new Error(`Unexpected text at ${this.pos}`);
  }
  // A key: bare, "basic" or 'literal' parts joined with dots.
  key(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.spaces();
      if (this.ch === '"') {
        const start = this.pos;
        this.string();
        parts.push(JSON.parse(this.text.slice(start, this.pos)));
      } else if (this.ch === "'") {
        const end = this.text.indexOf("'", this.pos + 1);
        if (end < 0) this.fail();
        parts.push(this.text.slice(this.pos + 1, end));
        this.pos = end + 1;
      } else {
        const m = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.pos));
        if (!m) this.fail();
        parts.push(m[0]);
        this.pos += m[0].length;
      }
      this.spaces();
      if (this.ch !== '.') return parts;
      this.pos++;
    }
  }
  // Past a string, from its opening quote.
  string() {
    const text = this.text;
    for (const q of ['"""', "'''"]) {
      if (!text.startsWith(q, this.pos)) continue;
      let i = this.pos + 3;
      for (;;) {
        if (i >= text.length) this.fail();
        if (q === '"""' && text[i] === '\\') i += 2;
        else if (text.startsWith(q, i)) break;
        else i++;
      }
      // Up to two more quotes belong to the string itself ("""a"""").
      for (let extra = 0; extra < 2 && text[i + 3] === q[0]; extra++) i++;
      this.pos = i + 3;
      return;
    }
    const q = this.ch;
    let i = this.pos + 1;
    while (i < text.length && text[i] !== q && text[i] !== '\n') i += q === '"' && text[i] === '\\' ? 2 : 1;
    if (text[i] !== q) this.fail();
    this.pos = i + 1;
  }
  // Past a value: a string, a list or inline table (over lines), or anything else to
  // the end of its line or a comment.
  value() {
    const c = this.ch;
    if (c === '"' || c === "'") return this.string();
    if (c === '[' || c === '{') {
      let depth = 0;
      while (this.pos < this.text.length) {
        const d = this.ch;
        if (d === '"' || d === "'") {
          this.string();
          continue;
        }
        if (d === '#') {
          const nl = this.text.indexOf('\n', this.pos);
          this.pos = nl < 0 ? this.text.length : nl;
          continue;
        }
        this.pos++;
        if (d === '[' || d === '{') depth++;
        else if (d === ']' || d === '}') {
          if (--depth === 0) return;
        }
      }
      this.fail();
    }
    const m = /^[^\n#]*/.exec(this.text.slice(this.pos))!;
    this.pos += m[0].trimEnd().length;
  }
}

function scan(text: string): Item[] {
  const s = new Scanner(text);
  const items: Item[] = [];
  let table: string[] = [];
  while (s.pos < text.length) {
    const start = s.pos;
    s.spaces();
    const c = s.ch;
    if (c === undefined || c === '\n' || c === '\r' || c === '#') {
      s.lineEnd();
      continue;
    }
    if (c === '[') {
      const array = text[s.pos + 1] === '[';
      s.pos += array ? 2 : 1;
      const path = s.key();
      if (s.ch !== ']' || (array && text[s.pos + 1] !== ']')) s.fail();
      s.lineEnd();
      // Arrays of tables aren't edited: their keys belong to none of the paths asked for.
      table = array ? [...path, '[]'] : path;
      items.push({ kind: 'header', path: table, start, end: s.pos });
      continue;
    }
    const key = s.key();
    if (s.ch !== '=') s.fail();
    s.pos++;
    s.spaces();
    const valueStart = s.pos;
    s.value();
    const valueEnd = s.pos;
    s.lineEnd();
    items.push({ kind: 'pair', table, key, start, valueStart, valueEnd, end: s.pos });
  }
  return items;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (a: string[], prefix: string[]) => prefix.length <= a.length && prefix.every((x, i) => x === a[i]);
const fullPath = (p: Extract<Item, { kind: 'pair' }>) => [...p.table, ...p.key];
const tableOf = (i: Item) => (i.kind === 'header' ? i.path : i.table);

export const tomlKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
const scalar = (v: TomlScalar) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
// A list of tables is written one inline table to a line.
export const tomlValue = (v: TomlValue): string =>
  !Array.isArray(v)
    ? scalar(v)
    : v.some((x) => typeof x === 'object')
      ? `[\n${(v as Record<string, TomlScalar>[]).map((t) => `  { ${Object.entries(t).map(([k, x]) => `${tomlKey(k)} = ${scalar(x)}`).join(', ')} },\n`).join('')}]`
      : `[${(v as string[]).map((x) => JSON.stringify(x)).join(', ')}]`;
const withBreak = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

// Where a new table goes, so the file reads in order: before its first subtable, if
// it has any; else after its parent table (and the parent's other subtables); else
// at the end, after a blank line.
function newTable(text: string, items: Item[], table: string[], body: string): string {
  const header = `[${table.map(tomlKey).join('.')}]\n${body}`;
  const sub = items.find((i) => i.kind === 'header' && startsWith(i.path, table));
  if (sub) return `${text.slice(0, sub.start)}${header}\n${text.slice(sub.start)}`;
  for (let n = table.length - 1; n > 0; n--) {
    const parent = table.slice(0, n);
    let i = items.findIndex((x) => x.kind === 'header' && same(x.path, parent));
    if (i < 0) continue;
    while (i + 1 < items.length && startsWith(tableOf(items[i + 1]), parent)) i++;
    const head = withBreak(text.slice(0, items[i].end));
    return `${head}\n${header}${text.slice(items[i].end)}`;
  }
  const before = withBreak(text);
  return `${before}${before.trim() ? '\n' : ''}${header}`;
}

// The text with `table`'s `key` set to `value`, or taken out (undefined). A new key
// goes after the table's last one; a new table is added.
export function setTomlKey(text: string, table: string[], key: string, value: TomlValue | undefined): string {
  const items = scan(text);
  const path = [...table, key];
  const found = items.find((i): i is Extract<Item, { kind: 'pair' }> => i.kind === 'pair' && same(fullPath(i), path));
  if (found) {
    if (value === undefined) return text.slice(0, found.start) + text.slice(found.end);
    return text.slice(0, found.valueStart) + tomlValue(value) + text.slice(found.valueEnd);
  }
  if (value === undefined) return text;
  // After the last key of the table, written under its header or as dotted keys of a
  // parent table ([conditions] colors.X = …).
  const pairs = items.filter((i): i is Extract<Item, { kind: 'pair' }> => i.kind === 'pair' && startsWith(fullPath(i), table) && startsWith(table, i.table));
  const after = pairs[pairs.length - 1] ?? items.find((i) => i.kind === 'header' && same(i.path, table));
  if (!after) return newTable(text, items, table, `${tomlKey(key)} = ${tomlValue(value)}\n`);
  const keyPath = after.kind === 'pair' ? path.slice(after.table.length) : [key];
  const at = after.end;
  const head = withBreak(text.slice(0, at));
  return `${head}${keyPath.map(tomlKey).join('.')} = ${tomlValue(value)}\n${text.slice(at)}`;
}

// The text without `table`'s header, if nothing is left under it (and the blank line
// before it).
export function removeTomlTableIfEmpty(text: string, table: string[]): string {
  const items = scan(text);
  const i = items.findIndex((x) => x.kind === 'header' && same(x.path, table));
  if (i < 0) return text;
  const next = items[i + 1];
  if (next && next.kind === 'pair' && same(next.table, table)) return text;
  const header = items[i];
  const start = text.slice(0, header.start).endsWith('\n\n') ? header.start - 1 : header.start;
  return text.slice(0, start) + text.slice(header.end);
}

// The text with `table` in it (empty if it's new).
export function ensureTomlTable(text: string, table: string[]): string {
  const items = scan(text);
  const there = items.some((i) => (i.kind === 'header' ? startsWith(i.path, table) : startsWith(fullPath(i), table) && fullPath(i).length > table.length));
  return there ? text : newTable(text, items, table, '');
}

// The value at a path of a TOML document, or undefined.
export function tomlAt(text: string, path: string[]): unknown {
  let v: unknown = parseToml(text);
  for (const p of path) v = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[p] : undefined;
  return v;
}
