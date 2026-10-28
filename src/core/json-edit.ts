// Adding to a list in a JSON file where it is, so the rest of the file stays as
// it was written (its layout, its spacing, lists kept on one line).

interface JsonNode {
  start: number; // the value's first character
  end: number; // after its last
  kind: 'array' | 'object' | 'value';
  // An object's members start at their key; `valueStart` is where the value does.
  children: { key: string | null; start: number; valueStart: number; node: JsonNode }[];
}

// The value at `path` (object keys) in JSON text, or null. The text must be valid JSON.
function nodeAt(text: string, path: string[]): JsonNode | null {
  let node: JsonNode | null = new Scanner(text).value();
  for (const key of path) node = node?.kind === 'object' ? (node.children.find((c) => c.key === key)?.node ?? null) : null;
  return node;
}

class Scanner {
  private i = 0;
  constructor(private text: string) {}

  private space() {
    while (/\s/.test(this.text[this.i] ?? '')) this.i++;
  }

  value(): JsonNode {
    this.space();
    const start = this.i;
    const open = this.text[this.i];
    if (open === '{' || open === '[') {
      const close = open === '{' ? '}' : ']';
      const children: JsonNode['children'] = [];
      this.i++;
      this.space();
      while (this.text[this.i] !== close) {
        const at = this.i;
        let key: string | null = null;
        if (open === '{') {
          key = JSON.parse(this.text.slice(at, this.string()));
          this.space();
          this.i++; // :
          this.space();
        }
        const valueStart = this.i;
        children.push({ key, start: at, valueStart, node: this.value() });
        this.space();
        if (this.text[this.i] === ',') this.i++;
        this.space();
      }
      this.i++;
      return { start, end: this.i, kind: open === '{' ? 'object' : 'array', children };
    }
    if (open === '"') return { start, end: this.string(), kind: 'value', children: [] };
    while (this.i < this.text.length && !/[\s,\]}]/.test(this.text[this.i])) this.i++;
    return { start, end: this.i, kind: 'value', children: [] };
  }

  // Past the string starting here; returns its end.
  private string(): number {
    this.i++;
    while (this.text[this.i] !== '"') this.i += this.text[this.i] === '\\' ? 2 : 1;
    return ++this.i;
  }
}

// How the file writes entries: colons, indentation (and its step), and the list's
// first entry as written.
export interface JsonStyle {
  colon: string;
  indent: string;
  unit: string;
  first: string;
}

// Commas as the file writes them (with a space or not); with none, like its colons.
const commaLike = (text: string, colon: string) => (/,\s/.test(text) ? ', ' : text.includes(',') || (text.includes(':') && !colon.endsWith(' ')) ? ',' : ', ');

const indentAt = (text: string, pos: number) => /[ \t]*/.exec(text.slice(text.lastIndexOf('\n', pos - 1) + 1))![0];

// `text` with an entry added at the end of the list or object at `path`: `entry`
// gets the indentation (if it has several lines) and separators the others have.
export function appendToJson(text: string, path: string[], entry: (style: JsonStyle) => string): string | null {
  const node = nodeAt(text, path);
  if (!node || node.kind === 'value') return null;
  const items = node.children;
  // How members write their colon, and the file's indentation step.
  const member = items.find((c) => c.key !== null);
  const colon = member ? text.slice(member.start, member.valueStart).replace(/^"(?:[^"\\]|\\.)*"/, '') : /":\s/.test(text) ? ': ' : ':';
  const unit = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
  if (!items.length) {
    const inner = text.slice(node.start + 1, node.end - 1);
    // On one line in a file on one line; in one over lines, over lines of its own.
    if (!inner.includes('\n') && !text.trim().includes('\n')) return text.slice(0, node.start + 1) + entry({ colon, indent: '', unit, first: '' }) + text.slice(node.end - 1);
    const outer = indentAt(text, node.start);
    return text.slice(0, node.start + 1) + `\n${outer}${unit}` + entry({ colon, indent: outer + unit, unit, first: '' }) + `\n${outer}` + text.slice(node.end - 1);
  }
  const last = items[items.length - 1];
  const multiline = text.slice(node.start, items[0].start).includes('\n');
  const indent = multiline ? indentAt(text, last.start) : '';
  // Between the first two as written; with one, a new line or a comma and a space.
  const sep = items.length > 1 ? text.slice(items[0].node.end, items[1].start) : multiline ? `,\n${indent}` : commaLike(text, colon);
  return text.slice(0, last.node.end) + sep + entry({ colon, indent, unit, first: text.slice(items[0].valueStart, items[0].node.end) }) + text.slice(last.node.end);
}

// Like JSON.stringify, but written like the list's first entry: on one line with the
// file's colons, or over lines at the list's indentation.
export function jsonLike(value: unknown, style: JsonStyle): string {
  if (!style.first.includes('\n')) {
    return JSON.stringify(value).replace(/("(?:[^"\\]|\\.)*"):/g, `$1${style.colon}`).replace(/,(?=")/g, style.colon.endsWith(' ') ? ', ' : ',');
  }
  return JSON.stringify(value, null, style.unit)
    .split('\n')
    .map((line, k) => (k ? style.indent + line : line))
    .join('\n');
}
