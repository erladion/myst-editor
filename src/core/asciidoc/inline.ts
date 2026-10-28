// AsciiDoc inline text (a paragraph's, a title's) ↔ the editor's inline nodes.
//
// Close to Asciidoctor's normal substitutions for what writers use: bold, italic,
// monospace, links, cross-references, images, attribute references, passthroughs.
// What the editor can't show and write back exactly (highlights, index terms, links
// with attributes...) is Unsupported: its block stays as written.
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema.js';
import { PREPROCESSOR, delimiterOf, isAttributeLine, isComment, isDescriptionItem, isTitleLine, listItem } from './syntax.js';

export class Unsupported extends Error {}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

// A construct found in the text: where it ends, its nodes, and what a backslash
// before it does (makes it plain text, or something the editor doesn't model).
interface Found {
  end: number;
  nodes: PMNode[];
  escape: 'literal' | 'unsupported';
}

// Macros whose brackets hold the whole value: kbd:[Ctrl+C].
const CONTENT_MACROS = new Set(['kbd', 'btn', 'stem', 'asciimath']);
// Macros kept as written, target and brackets: menu:File[Save], footnote:[text].
const RAW_MACROS = new Set(['menu', 'footnote', 'footnoteref', 'icon']);

export function parseInline(src: string): PMNode[] {
  return new InlineParser(src).parse(0, src.length, []);
}

class InlineParser {
  constructor(private src: string) {}

  parse(from: number, to: number, marks: readonly Mark[], brackets = false): PMNode[] {
    const src = this.src;
    const out: PMNode[] = [];
    let text = '';
    const flush = () => {
      text.split('\n').forEach((part, k) => {
        if (k) out.push(schema.node('soft_break', null, undefined, marks));
        if (part) out.push(schema.text(part, marks));
      });
      text = '';
    };
    let i = from;
    while (i < to) {
      const c = src[i];
      if (brackets && c === '\\' && src[i + 1] === ']') {
        text += ']';
        i += 2;
        continue;
      }
      if (c === '\\') {
        // The backslash stands where a mark's boundary does; before a URL, the
        // boundary is what's before the backslash.
        const found = this.at(i + 1, to, marks, '\\') ?? this.url(i + 1, to, marks, src[i - 1]);
        if (found?.escape === 'unsupported') throw new Unsupported('escaped construct');
        if (found) {
          text += src.slice(i + 1, found.end);
          i = found.end;
          continue;
        }
        text += c;
        i++;
        continue;
      }
      // " +" at the end of a line: a hard line break.
      if (c === ' ' && src[i + 1] === '+' && (i + 2 === to || src[i + 2] === '\n')) {
        flush();
        out.push(schema.node('hard_break', null, undefined, marks));
        i += i + 2 === to ? 2 : 3;
        continue;
      }
      const found = c === '\n' ? null : this.at(i, to, marks, src[i - 1]);
      if (found) {
        flush();
        out.push(...found.nodes);
        i = found.end;
        continue;
      }
      text += c;
      i++;
    }
    flush();
    return out;
  }

  // The construct starting at `i`, if any. `prev` is the character before it.
  private at(i: number, to: number, marks: readonly Mark[], prev: string | undefined): Found | null {
    const src = this.src;
    const c = src[i];
    const rest = () => src.slice(i, to);
    const pass = this.passthrough(i, to, prev);
    if (pass) {
      const nodes = pass.html ? [schema.node('html_inline', { value: pass.content }, undefined, marks)] : textNodes(pass.content, marks);
      return { end: pass.end, nodes, escape: pass.html || pass.kind !== '+' ? 'unsupported' : 'literal' };
    }
    if (c === '[') {
      // [[id]]: an anchor here.
      const anchor = /^\[\[([A-Za-z_:][\w:.-]*(?:,[^\]\n]*)?)\]\]/.exec(rest());
      if (anchor) return { end: i + anchor[0].length, nodes: [role('anchor', anchor[1], marks)], escape: 'literal' };
      // [.role]#text#: only line-through, the editor's strikethrough.
      const attrs = /^\[([^\]\n]+)\](?=[*_`#^~])/.exec(rest());
      if (attrs) {
        const quoted = this.quote(i + attrs[0].length, to, marks, prev, attrs[1]);
        if (quoted) return quoted;
      }
      return null;
    }
    if ('*_`#^~'.includes(c)) return this.quote(i, to, marks, prev, null);
    if (c === '{') {
      const m = /^\{([\w][\w-]*)\}/.exec(rest());
      return m ? { end: i + m[0].length, nodes: [role('attribute', m[1], marks)], escape: 'literal' } : null;
    }
    if (c === '<' && src[i + 1] === '<') {
      const m = /^<<([\w"#/.:{][^>\n]*?)>>/.exec(rest());
      if (!m) return null;
      const comma = m[1].indexOf(',');
      const target = (comma < 0 ? m[1] : m[1].slice(0, comma)).trim();
      const text = comma < 0 ? '' : m[1].slice(comma + 1).trim();
      return { end: i + m[0].length, nodes: [role('ref', reference(text, target), marks)], escape: 'literal' };
    }
    if (c === '(' && src.startsWith('((', i) && /^\(\(\(?[^)\n]+\)\)\)?/.test(rest())) throw new Unsupported('index term');
    const url = this.url(i, to, marks, prev);
    if (url) return url;
    return this.macro(i, to, marks, prev);
  }

  // +text+, ++text++, +++html+++, pass:[html]. `kind`: which pluses.
  private passthrough(i: number, to: number, prev: string | undefined): { end: number; content: string; html: boolean; kind: string } | null {
    const src = this.src;
    if (src.startsWith('pass:', i)) {
      const m = /^pass:([a-z,]*)\[/.exec(src.slice(i, to));
      if (!m) return null;
      const close = closingBracket(src, i + m[0].length, to);
      if (close < 0) return null;
      // pass:c[text]: only special characters replaced, i.e. plain text.
      if (m[1] && m[1] !== 'c') throw new Unsupported('passthrough with substitutions');
      return { end: close + 1, content: src.slice(i + m[0].length, close).replace(/\\\]/g, ']'), html: !m[1], kind: 'pass' };
    }
    if (src[i] !== '+') return null;
    for (const kind of ['+++', '++']) {
      if (!src.startsWith(kind, i)) continue;
      const close = src.indexOf(kind, i + kind.length);
      if (close < 0 || close + kind.length > to) continue;
      return { end: close + kind.length, content: src.slice(i + kind.length, close), html: kind === '+++', kind };
    }
    // +text+: constrained, like *bold*.
    if (isWord(prev) || (prev !== undefined && ';:}'.includes(prev)) || isSpace(src[i + 1])) return null;
    for (let j = i + 2; j < to; j++) {
      if (src[j] === '+' && !isSpace(src[j - 1]) && !isWord(src[j + 1])) return { end: j + 1, content: src.slice(i + 1, j), html: false, kind: '+' };
    }
    if (i + 2 <= to && src[i + 2] === '+' && !isWord(src[i + 3])) return null;
    return null;
  }

  // Bold, italic, monospace, highlight, superscript and subscript, at `i`. `attrs`:
  // the [role] in front of it, if any.
  private quote(i: number, to: number, marks: readonly Mark[], prev: string | undefined, attrs: string | null): Found | null {
    const src = this.src;
    const c = src[i];
    let found: { start: number; end: number; close: number; double: boolean } | null = null;
    if (c === '^' || c === '~') {
      for (let j = i + 1; j < to && !/\s/.test(src[j]); j++) {
        if (src[j] === c && j > i + 1) {
          found = { start: i + 1, end: j + 1, close: j, double: false };
          break;
        }
      }
    } else {
      if (src[i + 1] === c) {
        const close = this.find(c + c, i + 2, to);
        if (close >= 0) found = { start: i + 2, end: close + 2, close, double: true };
      }
      if (!found) {
        const mono = c === '`';
        const before = mono ? ';:"\'`}' : ';:}';
        const after = (ch: string | undefined) => isWord(ch) || (mono && ch !== undefined && '"\'`'.includes(ch));
        if (!isWord(prev) && !(prev !== undefined && before.includes(prev)) && !isSpace(src[i + 1])) {
          for (let j = i + 1; j < to; j = this.skip(j, to)) {
            if (src[j] === c && j > i + 1 && !isSpace(src[j - 1]) && !after(src[j + 1])) {
              found = { start: i + 1, end: j + 1, close: j, double: false };
              break;
            }
          }
        }
      }
    }
    if (!found) return null;
    const literalEscape = found.double ? 'unsupported' : 'literal';
    // Its roles: [.path], [.term.key]. Only roles: other attributes aren't kept.
    let roles: string | null = null;
    if (attrs !== null) {
      if (!/^(\.[\w-]+)+$/.test(attrs)) throw new Unsupported('formatting with attributes');
      roles = attrs.slice(1).split('.').join(' ');
    }
    if (c === '#') {
      // The editor's strikethrough; else highlighted, or a span of its role.
      if (roles === 'line-through') {
        const strike = schema.marks.strike.create().addToSet(marks);
        return { end: found.end, nodes: this.parse(found.start, found.close, strike), escape: 'unsupported' };
      }
      const span = schema.marks.span.create({ role: roles }).addToSet(marks);
      return { end: found.end, nodes: this.parse(found.start, found.close, span), escape: found.double ? 'unsupported' : 'literal' };
    }
    if (c === '^' || c === '~') {
      if (roles !== null) throw new Unsupported('formatting with attributes');
      const value = src.slice(found.start, found.close);
      if (/[*_`#^~+{\[\\<]/.test(value)) throw new Unsupported('formatting in a superscript');
      return { end: found.end, nodes: [role(c === '^' ? 'sup' : 'sub', value, marks)], escape: 'literal' };
    }
    const mark = c === '*' ? schema.marks.strong : c === '_' ? schema.marks.em : schema.marks.code;
    const inner = mark.create({ role: roles }).addToSet(marks);
    // `+literal+` in monospace: no formatting inside.
    // (`++text++` is monospace around a passthrough, read as one.)
    const content = src.slice(found.start, found.close);
    if (c === '`' && /^\+(?!\+)[\s\S]*(?<!\+)\+$|^\+\+$/.test(content) && content.length >= 2) {
      return { end: found.end, nodes: textNodes(src.slice(found.start + 1, found.close - 1), inner), escape: literalEscape };
    }
    return { end: found.end, nodes: this.parse(found.start, found.close, inner), escape: literalEscape };
  }

  // The first `close` at or after `from` (passthroughs skipped, like Asciidoctor,
  // which takes them out before anything else).
  // `from` is where the content starts, which has at least a character.
  private find(close: string, from: number, to: number): number {
    for (let j = from; j + close.length <= to; j = this.skip(j, to)) if (j > from && this.src.startsWith(close, j)) return j;
    return -1;
  }

  private skip(j: number, to: number): number {
    const pass = this.passthrough(j, to, this.src[j - 1]);
    return pass ? pass.end : j + 1;
  }

  // https://example.org[text], bare URLs, link:target[text], mailto:address[text].
  private url(i: number, to: number, marks: readonly Mark[], prev: string | undefined): Found | null {
    const src = this.src;
    const rest = src.slice(i, to);
    const macro = /^(link|mailto):([^:\s[][^\s[]*)\[/.exec(rest);
    const scheme = !macro && (prev === undefined || /[\s>()[\];"'<]/.test(prev)) ? /^(?:https?|file|ftp|irc):\/\//.exec(rest) : null;
    if (!macro && !scheme) return null;
    let href: string;
    let open: number;
    if (macro) {
      href = macro[1] === 'mailto' ? `mailto:${macro[2]}` : macro[2];
      open = i + macro[0].length - 1;
    } else {
      const withText = /^[^\s[\]]+\[/.exec(rest);
      if (withText) {
        href = withText[0].slice(0, -1);
        open = i + withText[0].length - 1;
      } else {
        const bare = /^[^\s[\]<]*/.exec(rest)![0].replace(/[,.?!)]+$/, '');
        if (bare.length <= scheme![0].length) return null;
        const nodes = textNodes(bare, schema.marks.link.create({ href: bare, title: null }).addToSet(marks));
        return { end: i + bare.length, nodes, escape: 'literal' };
      }
    }
    const close = closingBracket(src, open + 1, to);
    if (close < 0) return null;
    // The text, and what's after it: ^ (a new window), or attributes (window=_blank).
    let from = open + 1;
    let until = close;
    let extra: string | null = null;
    const raw = src.slice(open + 1, close);
    if (raw.includes('=')) {
      const comma = topComma(raw);
      if (comma < 0) throw new Unsupported('link with only attributes');
      extra = raw.slice(comma + 1).trim();
      until = open + 1 + comma;
      const quoted = /^\s*"([\s\S]*)"\s*$/.exec(raw.slice(0, comma));
      if (quoted) {
        from = open + 1 + raw.indexOf('"') + 1;
        until = from + quoted[1].length;
        if (quoted[1].includes('"')) throw new Unsupported('quotes in a link’s text');
      }
    } else if (/\^$/.test(raw)) {
      extra = '^';
      until = close - 1;
    }
    const link = schema.marks.link.create({ href, title: null, extra }).addToSet(marks);
    const nodes = until > from ? this.parse(from, until, link, true) : textNodes(macro?.[1] === 'mailto' ? macro[2] : href, link);
    return { end: close + 1, nodes, escape: 'literal' };
  }

  // image:file[alt], xref:page.adoc#id[text], kbd:[Ctrl+C], latexmath:[x^2] and others.
  private macro(i: number, to: number, marks: readonly Mark[], prev: string | undefined): Found | null {
    const src = this.src;
    const m = /^([a-z][a-z0-9]*):(?!:)([^\s[]*)\[/.exec(src.slice(i, to));
    if (!m || isWord(prev)) return null;
    const [, name, target] = m;
    const close = closingBracket(src, i + m[0].length, to);
    if (close < 0) return null;
    const raw = src.slice(i + m[0].length, close);
    const content = raw.replace(/\\\]/g, ']');
    const end = close + 1;
    const one = (node: PMNode): Found => ({ end, nodes: [node], escape: 'literal' });
    if (name === 'image') {
      if (!target) throw new Unsupported('image without a file');
      // Its description, then the rest as written (a width, a role…).
      const comma = topComma(raw);
      const first = comma < 0 ? raw : raw.slice(0, comma);
      const named = /^\s*[\w-]+\s*=/.test(first);
      const altRaw = named ? '' : first.trim();
      const extra = named ? raw.trim() : comma < 0 ? null : raw.slice(comma + 1).trim();
      const quoted = /^"([\s\S]*)"$/.exec(altRaw);
      const alt = (quoted ? quoted[1] : altRaw).replace(/\\]/g, ']');
      if (quoted?.[1].includes('"')) throw new Unsupported('quotes in an image’s description');
      return one(schema.node('image', { src: target, alt, title: null, extra: extra || null }, undefined, marks));
    }
    if (name === 'xref') {
      if (/[=<>]/.test(content)) throw new Unsupported('cross-reference with attributes');
      return one(role('xref', reference(content.trim(), target), marks));
    }
    if (name === 'latexmath' && !target) return one(schema.node('inline_math', { value: content }, undefined, marks));
    if (CONTENT_MACROS.has(name) && !target) return one(role(name, content, marks));
    if (RAW_MACROS.has(name)) return one(role(name, `${target}[${raw}]`, marks));
    if (name === 'indexterm' || name === 'indexterm2' || name === 'anchor' || name === 'pass') throw new Unsupported(name);
    return null;
  }
}

function role(name: string, value: string, marks: readonly Mark[]): PMNode {
  return schema.node('role', { name, value }, undefined, marks);
}

// Where an attribute list's first entry ends: its first comma outside quotes; -1 if none.
function topComma(text: string): number {
  let quote = false;
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '"' && text[k - 1] !== '\\') quote = !quote;
    else if (text[k] === ',' && !quote) return k;
  }
  return -1;
}

// A cross-reference's value as the editor keeps them: "text <target>", or the target.
const reference = (text: string, target: string) => {
  if (/[<>]/.test(text)) throw new Unsupported('cross-reference text with < or >');
  return text ? `${text} <${target}>` : target;
};

function textNodes(text: string, marks: readonly Mark[]): PMNode[] {
  const out: PMNode[] = [];
  text.split('\n').forEach((part, k) => {
    if (k) out.push(schema.node('soft_break', null, undefined, marks));
    if (part) out.push(schema.text(part, marks));
  });
  return out;
}

// The `]` closing a bracket opened before `from`; a backslash escapes one.
function closingBracket(src: string, from: number, to: number): number {
  for (let j = from; j < to; j++) {
    if (src[j] === '\\' && src[j + 1] === ']') j++;
    else if (src[j] === ']') return j;
    else if (src[j] === '\n' && src[j + 1] === '\n') return -1;
  }
  return -1;
}

// ---- writing ----------------------------------------------------------------------

// A textblock's inline content as AsciiDoc. Written plainly first; if that doesn't
// read back the same, again with text that could be mistaken for markup passed
// through as it is (++text++). `was`: the text it was read from, whose lines are kept
// where they still say the same. `inList`: in a list item, where list markers and
// "+" at the start of a line would end its text.
// `inCell`: in a table cell, where nothing starts a block.
// `midLine`: written after something on its first line (a term's "::"), which then
// doesn't start a line.
export function serializeInline(block: PMNode, opts: { was?: string; inList?: boolean; inCell?: boolean; midLine?: boolean } = {}): string {
  const write = (safe: boolean) => new InlineWriter(safe, !!opts.inList, !!opts.inCell, !!opts.midLine).write(block);
  let text = write(false);
  if (!sameInline(text, block)) text = write(true);
  if (opts.was !== undefined) {
    const kept = keepLines(text, opts.was);
    // (Read without the lines' indentation, like a list item's text.)
    if (kept !== text && sameInline(kept.replace(/\n[ \t]+/g, '\n'), block)) text = kept;
  }
  return text;
}

// `text`'s lines, each as it was in `was` where one there says the same, in order.
function keepLines(text: string, was: string): string {
  const old = was.split('\n');
  const form = (line: string) => {
    try {
      return JSON.stringify(inlineForm(schema.node('paragraph', null, parseInline(line.trim()))));
    } catch {
      return null;
    }
  };
  const forms = old.map(form);
  const lines = text.split('\n');
  let from = 0;
  return lines
    .map((line, k) => {
      if (old[from] === line) return old[from++];
      const f = form(line);
      const at = f === null ? -1 : forms.indexOf(f, from);
      // An edited line: indented as the one it replaced was (a list item's text).
      if (at < 0) return lines.length === old.length && k > 0 ? /^[ \t]*/.exec(old[k])![0] + line : line;
      from = at + 1;
      return old[at];
    })
    .join('\n');
}

function sameInline(text: string, block: PMNode): boolean {
  try {
    const back = schema.node('paragraph', null, parseInline(text));
    return JSON.stringify(inlineForm(back)) === JSON.stringify(inlineForm(block));
  } catch {
    return false;
  }
}

// Inline content without the differences that don't matter: adjacent text merged,
// no whitespace at the edges of lines.
function inlineForm(block: PMNode): unknown[] {
  const out: { type: string; text?: string; marks: unknown; attrs?: unknown }[] = [];
  block.forEach((n) => {
    const marks = n.marks.map((m) => m.toJSON());
    const prev = out[out.length - 1];
    if (n.isText && prev?.text !== undefined && JSON.stringify(prev.marks) === JSON.stringify(marks)) prev.text += n.text!;
    else out.push(n.isText ? { type: 'text', text: n.text!, marks } : { type: n.type.name, attrs: n.attrs, marks });
  });
  out.forEach((item, k) => {
    if (item.text === undefined) return;
    if (k === 0 || out[k - 1].type === 'soft_break') item.text = item.text.replace(/^\s+/, '');
    if (k === out.length - 1 || out[k + 1].type === 'soft_break') item.text = item.text.replace(/\s+$/, '');
  });
  return out.filter((item) => item.text !== '');
}

const MARK_ORDER = ['link', 'span', 'code', 'strong', 'strike', 'em'];

// A mark's roles as written in front of it: [.path], [.term.key].
const rolePrefix = (mark: Mark) => (mark.attrs.role ? `[.${String(mark.attrs.role).split(/\s+/).join('.')}]` : '');

const SPECIAL = /[*_`#^~+{}[\]<>\\:]|\(\(|https?:|ftp:|irc:|file:/;

class InlineWriter {
  private out = '';

  // `safe`: pass text with markup characters through as it is.
  constructor(
    private safe: boolean,
    private inList: boolean,
    private inCell = false,
    private midLine = false,
  ) {}

  write(block: PMNode): string {
    const children: PMNode[] = [];
    block.forEach((n) => children.push(n));
    this.run(children, []);
    if (this.inCell) return this.out;
    // A line that would start a block (a list item, a title...) starts with its
    // first character passed through instead.
    return this.out
      .split('\n')
      .map((line, k) => (k === 0 && this.midLine ? line : escapeLineStart(line, k, this.inList)))
      .join('\n');
  }

  // Children with `outer` marks already open: groups them by the next mark.
  // Children with `outer` marks already open: groups them by the next mark, opened in
  // the order Asciidoctor's own docs nest them: links, monospace, bold, italic inside.
  private run(nodes: PMNode[], outer: readonly Mark[]) {
    let k = 0;
    while (k < nodes.length) {
      const node = nodes[k];
      const next = MARK_ORDER.map((name) => node.marks.find((m) => m.type.name === name && !m.isInSet(outer))).find((m) => m);
      if (!next) {
        this.leaf(node, nodes[k + 1]);
        k++;
        continue;
      }
      let e = k;
      while (e < nodes.length && next.isInSet(nodes[e].marks)) e++;
      const inside = nodes.slice(k, e);
      if (next.type !== schema.marks.code) this.span(next, inside, [...outer, next], nodes[e]);
      // Monospace around text alone: written as it is (`+literal+`) when it must be.
      else if (inside.every((n) => n.isText && n.marks.length === outer.length + 1)) this.code(inside.map((n) => n.text).join(''), nodes[e], rolePrefix(next));
      else {
        const tick = !this.safe && this.constrainedBefore('"\'`') && edgesOk(inside) && constrainedAfter(nodes[e], '"\'`') ? '`' : '``';
        this.out += rolePrefix(next) + tick;
        this.run(inside, [...outer, next]);
        this.out += tick;
      }
      k = e;
    }
  }

  private span(mark: Mark, nodes: PMNode[], marks: readonly Mark[], after: PMNode | undefined) {
    if (mark.type === schema.marks.link) return this.link(mark, nodes, marks, after);
    const char = mark.type === schema.marks.strong ? '*' : mark.type === schema.marks.em ? '_' : mark.type === schema.marks.span ? '#' : null;
    if (mark.type === schema.marks.strike) {
      this.out += '[.line-through]#';
      this.run(nodes, marks);
      this.out += '#';
      return;
    }
    if (!char) throw new Unsupported(`mark ${mark.type.name}`);
    // Whether it may be constrained is up to what's before its roles.
    const constrained = !this.safe && this.constrainedBefore() && edgesOk(nodes) && constrainedAfter(after);
    this.out += rolePrefix(mark);
    const start = this.out.length;
    const open = constrained ? char : char + char;
    this.out += open;
    this.run(nodes, marks);
    this.out += open;
    // A constrained mark whose content ended up with a space at an edge (an atom's
    // text, say): unconstrained, which doesn't care.
    if (constrained && (isSpace(this.out[start + 1]) || isSpace(this.out[this.out.length - 2]))) {
      this.out = this.out.slice(0, start) + char + this.out.slice(start, this.out.length) + char;
    }
  }

  private link(mark: Mark, nodes: PMNode[], marks: readonly Mark[], after: PMNode | undefined) {
    const href: string = mark.attrs.href;
    const text = nodes.map((n) => n.textContent).join('');
    const plainText = nodes.every((n) => n.isText && n.marks.length === marks.length);
    const scheme = /^(?:https?|file|ftp|irc):\/\/[^\s[\]<]*$/.test(href);
    // A bare URL, when that reads back as this link: what follows doesn't make it
    // longer (punctuation at its end isn't part of one).
    const following = after?.isText ? /^\S*/.exec(after.text!)![0] : '';
    const read = /^[^\s[\]<]*/.exec(href + following)![0].replace(/[,.?!)]+$/, '');
    const extra: string | null = mark.attrs.extra;
    // What's written after the text: ^ (a new window), or attributes.
    const suffix = extra === null ? '' : extra === '^' ? '^' : `,${extra}`;
    if (!extra && scheme && plainText && text === href && read === href && !following.startsWith('[') && this.urlBoundary()) {
      this.out += href;
      return;
    }
    const target = scheme ? href : href.startsWith('mailto:') ? href : `link:${/[\s[]/.test(href) ? `++${href}++` : href}`;
    if (scheme && !this.urlBoundary()) this.out += 'link:';
    // A URL as its own text: empty brackets say that.
    if (scheme && plainText && text === href) {
      this.out += `${href}[${suffix}]`;
      return;
    }
    this.out += `${target}[`;
    const start = this.out.length;
    this.run(nodes, marks);
    let written = this.out.slice(start).replace(/\]/g, '\\]');
    // Before attributes, text with a comma or = in it goes in quotes.
    if (extra && extra !== '^' && /[,="]/.test(written)) written = `"${written}"`;
    this.out = this.out.slice(0, start) + written + suffix + ']';
  }

  private code(text: string, after: PMNode | undefined, prefix = '') {
    // Literal when it must be, or (writing safely) when it could need to.
    const literal = (this.safe && /[*_`#^~+{\\[<:]/.test(text)) || /`|\s$|^\s/.test(text);
    const constrained = this.constrainedBefore('"\'`') && !isSpace(text[0]) && !isSpace(text[text.length - 1]) && constrainedAfter(after, '"\'`');
    const tick = constrained ? '`' : '``';
    this.out += prefix;
    if (!literal) this.out += `${tick}${text}${tick}`;
    // With backticks or pluses in it: ++text++ inside, which nothing ends early.
    else if (/[`+]/.test(text) && !text.includes('++')) this.out += `${tick}++${text}++${tick}`;
    else this.out += `${tick}+${text}+${tick}`;
  }

  private leaf(node: PMNode, after: PMNode | undefined) {
    switch (node.type.name) {
      case 'text':
        return this.text(node.text!);
      case 'soft_break':
        this.out += '\n';
        return;
      case 'hard_break':
        if (after && after.type.name !== 'hard_break') this.out += ' +\n';
        return;
      case 'image': {
        // Its description, then what was written after it (a width, say).
        const alt = (node.attrs.alt as string).replace(/\]/g, '\\]');
        const extra: string | null = node.attrs.extra;
        if (!extra) this.out += `image:${node.attrs.src}[${alt}]`;
        else if (!alt && /^[\w-]+\s*=/.test(extra)) this.out += `image:${node.attrs.src}[${extra}]`;
        else this.out += `image:${node.attrs.src}[${/[,"=]|^\s|\s$/.test(alt) ? `"${alt}"` : alt},${extra}]`;
        return;
      }
      case 'inline_math':
        this.out += `latexmath:[${(node.attrs.value as string).replace(/\]/g, '\\]')}]`;
        return;
      case 'html_inline': {
        // +++html+++, unless pluses in it or before it would run into those.
        const value: string = node.attrs.value;
        this.out += /\+/.test(value) || this.out.endsWith('+') ? `pass:[${value.replace(/\]/g, '\\]')}]` : `+++${value}+++`;
        return;
      }
      case 'role':
        return this.role(node.attrs.name, node.attrs.value);
      case 'ref_link':
        this.out += `<<${node.attrs.href.replace(/^#/, '')}>>`;
        return;
      case 'footnote_ref':
        this.out += `footnote:${node.attrs.label}[]`;
        return;
      default:
        throw new Unsupported(`inline ${node.type.name}`);
    }
  }

  private role(name: string, value: string) {
    const split = /^([\s\S]*?)\s*<([^<>]*)>$/.exec(value);
    const [text, target] = split ? [split[1], split[2]] : ['', value];
    switch (name) {
      case 'attribute':
        this.out += `{${value}}`;
        return;
      case 'ref':
        this.out += text ? `<<${target},${text}>>` : `<<${target}>>`;
        return;
      case 'xref':
        this.out += `xref:${target}[${text.replace(/\]/g, '\\]')}]`;
        return;
      case 'anchor':
        this.out += `[[${value}]]`;
        return;
      case 'sup':
        this.out += `^${value}^`;
        return;
      case 'sub':
        this.out += `~${value}~`;
        return;
      default:
        if (CONTENT_MACROS.has(name)) this.out += `${name}:[${value.replace(/\]/g, '\\]')}]`;
        else if (RAW_MACROS.has(name)) this.out += `${name}:${value}`;
        // A role from elsewhere (pasted from a MyST page): its text, in monospace.
        else this.code(value, undefined);
    }
  }

  private text(text: string) {
    if (!this.safe) {
      // What would read as an attribute reference or a cross-reference: escaped.
      this.out += text.replace(/\{(?=[\w][\w-]*\})/g, '\\{').replace(/<<(?=[\w"#/.:{])/g, '\\<<');
      return;
    }
    // Each word that could be read as markup passed through: ++word++, or with
    // pluses in it, pass:c[word].
    this.out += text.replace(/\S+/g, (word, at: number) => {
      if (!SPECIAL.test(word)) return word;
      const afterPlus = at === 0 && this.out.endsWith('+');
      return word.includes('+') || afterPlus ? `pass:c[${word.replace(/\]/g, '\\]')}]` : `++${word}++`;
    });
  }

  // Whether a constrained mark may open here (after a space, punctuation, nothing).
  private constrainedBefore(also = ''): boolean {
    const prev = this.out[this.out.length - 1];
    return !isWord(prev) && !(prev !== undefined && (';:}\\' + also).includes(prev));
  }

  private urlBoundary(): boolean {
    const prev = this.out[this.out.length - 1];
    return prev === undefined || /[\s>()[\];"'<]/.test(prev);
  }
}

// Text marked from its first character to its last, not whitespace at the edges.
function edgesOk(nodes: PMNode[]): boolean {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  return !!first?.isText && !!last?.isText && !isSpace(first.text![0]) && !isSpace(last.text![last.text!.length - 1]);
}

// Whether what follows lets a constrained mark close (not a word character).
function constrainedAfter(after: PMNode | undefined, also = ''): boolean {
  if (!after) return true;
  if (after.type.name === 'soft_break' || after.type.name === 'hard_break') return true;
  if (!after.isText) return false;
  const c = after.text![0];
  return !isWord(c) && !also.includes(c);
}

// Lines that would end a paragraph wherever they are in it: delimiters, attribute
// lines, comments, conditions. In a list item, also items and "+".
type LineTest = { test(line: string): boolean };
const PARAGRAPH_BREAKS: LineTest[] = [{ test: (l) => delimiterOf(l) !== null }, { test: isAttributeLine }, { test: isComment }, PREPROCESSOR];
const LIST_ITEM: LineTest = { test: (l) => listItem(l) !== null };
// (A definition list's items too: "term:: text".)
const LIST_BREAKS: LineTest[] = [LIST_ITEM, /^\+[ \t]*$/, { test: (l) => isDescriptionItem(l) }];
// And those that make a paragraph something else when it starts with them: breaks,
// titles, sections, attribute entries, notes, block macros, callout lists.
const LINE_STARTS: LineTest[] = [
  ...PARAGRAPH_BREAKS,
  LIST_ITEM,
  /^('{3,}|<{3,}|\+|([-*_])( *)\2\3\2)[ \t]*$/,
  /^\.[^\s.]/,
  /^(={1,6}|#{1,6})[ \t]/,
  { test: isTitleLine },
  /^:!?[\w{][\w{}-]*!?:/,
  /^(NOTE|TIP|IMPORTANT|CAUTION|WARNING):[ \t]/,
  /^[A-Za-z][\w-]*::\S*\[.*\]\s*$/,
  /^<(\d+|\.)>[ \t]/,
];
// Its second line, under a first about as long, would make it a section title.
const UNDERLINE = /^(=+|-+|~+|\^+|\++)[ \t]*$/;

function escapeLineStart(line: string, k: number, inList: boolean): string {
  if (!line) return line;
  const first = k === 0;
  if (first || inList) {
    // term:: description: its marker passed through.
    const dlist = /^(\S.*?)(:{2,4}|;;)([ \t]|$)/.exec(line);
    if (dlist && !/^[A-Za-z][\w-]*::\S*\[/.test(line)) line = `${dlist[1]}++${dlist[2]}++${line.slice(dlist[1].length + dlist[2].length)}`;
  }
  // Spaces in front of a paragraph would make it a literal one; they don't matter.
  if (first) line = line.trimStart();
  const starts = first ? LINE_STARTS : inList ? [...PARAGRAPH_BREAKS, ...LIST_BREAKS] : k === 1 ? [...PARAGRAPH_BREAKS, UNDERLINE] : PARAGRAPH_BREAKS;
  if (!starts.some((re) => re.test(line))) return line;
  const m = /^[ \t]*(\S)/.exec(line);
  if (!m) return line;
  const at = m.index + m[0].length - 1;
  const char = line[at] === '+' ? 'pass:c[+]' : `++${line[at]}++`;
  return `${line.slice(0, at)}${char}${line.slice(at + 1)}`;
}
