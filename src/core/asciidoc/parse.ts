// AsciiDoc source → ProseMirror document, recording the exact source of every block.
//
// Like the MyST reader (../myst/parse.ts): the text is cut into blocks at lines, so that
// lead + block + gap + block … + trail is the text again, and each block knows the
// text it was read from. AsciiDoc is read a line at a time: a delimited block runs to
// its closing delimiter, a paragraph to a blank line, a list over its items. What the
// editor can't show and write back exactly stays a block of source.
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema.js';
import { SourceMap, type ContainerEntry } from '../sourcemap.js';
import { parseInline, Unsupported } from './inline.js';
import { tableRows } from './table.js';
import { readCondition } from './conditions.js';
import {
  ADMONITION_PARAGRAPH,
  ADMONITIONS,
  ATTRIBUTE_ENTRY,
  BLOCK_MACRO,
  CALLOUT_ITEM,
  DESCRIPTION_ITEM,
  PREPROCESSOR,
  SECTION,
  anchorOf,
  closes,
  delimiterOf,
  isAttributeLine,
  isBlank,
  isComment,
  isDescriptionItem,
  isHeaderLine,
  isTitleLine,
  listItem,
  parseAttrlist,
  attributeTokens,
  type Attrlist,
} from './syntax.js';

export interface ParseResult {
  doc: PMNode;
  map: SourceMap;
}

export interface ParseOptions {
  // ifdef::[]…endif::[] lines are conditional content's markers (see conditions.ts).
  conditions?: boolean;
}

export function parseAsciidoc(source: string, opts: ParseOptions = {}): ParseResult {
  const map = new SourceMap();
  const { nodes, entry } = new Reader(map, opts).container(source, 1, true);
  const doc = schema.node('doc', { sid: null }, nodes.length ? nodes : [schema.node('paragraph')]);
  map.root = entry;
  return { doc, map };
}

type Kind =
  | 'heading'
  | 'paragraph'
  | 'literal'
  | 'delimited'
  | 'admonition'
  | 'styled'
  | 'macro'
  | 'list'
  | 'items'
  | 'target'
  | 'attributes'
  | 'header'
  | 'entries'
  | 'comment'
  | 'preprocessor'
  | 'break'
  | 'pagebreak';

// A block's lines: [start, end], `body` its first line after the header (attribute
// lines, title), `delimiter` a delimited block's.
interface Segment {
  kind: Kind;
  start: number;
  end: number;
  body: number;
  delimiter?: string;
  closed?: boolean;
  setext?: boolean;
  raw?: string; // for 'items': what kind of list it is
}

// ---- cutting a container's lines into blocks ----------------------------------

// A line followed by `====`, `----`, `~~~~`… about as long: a section title.
const SETEXT_UNDERLINE = /^(=+|-+|~+|\^+|\++)[ \t]*$/;
const SETEXT_LEVELS = '=-~^+';
const BREAK = /^(?:'{3,}|([-*_])( *)\1\2\1)[ \t]*$/;
const PAGE_BREAK = /^<{3,}[ \t]*$/;

function setextAt(lines: string[], j: number, to: number): boolean {
  const next = lines[j + 1];
  if (j + 1 >= to || !SETEXT_UNDERLINE.test(next)) return false;
  const title = lines[j];
  const underline = next.trimEnd();
  return underline.length >= 2 && Math.abs(title.trimEnd().length - underline.length) < 2 && /^(?!\.)[\s\S]*?\w/.test(title) && !/^\s/.test(title) && !isHeaderLine(title);
}

class Scanner {
  constructor(private lines: string[]) {}

  // The blocks in lines [from, to).
  blocks(from: number, to: number): Segment[] {
    const out: Segment[] = [];
    let i = from;
    while (i < to) {
      if (isBlank(this.lines[i])) {
        i++;
        continue;
      }
      const segs = this.block(i, to);
      out.push(...segs);
      i = segs[segs.length - 1].end + 1;
    }
    return out;
  }

  // The block starting at line i: one segment, or its header lines first when the
  // block's own node can't hold them.
  // `inList`: attached to a list item, where a list item ends a paragraph.
  block(i: number, to: number, inList = false): Segment[] {
    const lines = this.lines;
    let j = i;
    while (j < to && isHeaderLine(lines[j])) j++;
    if (j > i && (j >= to || isBlank(lines[j]))) return this.header(i, j - 1);
    const line = lines[j];
    const delimiter = delimiterOf(line);
    if (delimiter) {
      let k = j + 1;
      while (k < to && !closes(lines[k], delimiter)) k++;
      const closed = k < to;
      return [{ kind: 'delimited', start: i, body: j, end: closed ? k : to - 1, delimiter, closed }];
    }
    if (BLOCK_MACRO.test(line) && !PREPROCESSOR.test(line)) return [{ kind: 'macro', start: i, body: j, end: j }];
    const plain = this.plain(j, to, inList);
    // Paragraphs with a style that makes them something else (a note, code, a quote).
    if (j > i && plain.kind === 'paragraph' && !plain.setext) {
      const style = headerStyle(lines.slice(i, j));
      if (style !== null && STYLED.has(style.toLowerCase())) return [{ ...plain, kind: 'styled', start: i, body: j }];
    }
    if (plain.kind === 'paragraph' && ADMONITION_PARAGRAPH.test(line)) return [{ ...plain, kind: 'admonition', start: i, body: j }];
    return [...(j > i ? this.header(i, j - 1) : []), plain];
  }

  // Header lines on their own: anchors as targets, the rest as written.
  private header(from: number, to: number): Segment[] {
    const out: Segment[] = [];
    for (let k = from; k <= to; k++) {
      if (anchorOf(this.lines[k])) out.push({ kind: 'target', start: k, end: k, body: k });
      else if (out.length && out[out.length - 1].kind === 'attributes') out[out.length - 1].end = k;
      else out.push({ kind: 'attributes', start: k, end: k, body: k });
    }
    return out;
  }

  private plain(j: number, to: number, inList: boolean): Segment {
    const lines = this.lines;
    const line = lines[j];
    const one = (kind: Kind, end = j): Segment => ({ kind, start: j, end, body: j });
    const run = (kind: Kind, test: (l: string) => boolean) => {
      let k = j;
      while (k + 1 < to && test(lines[k + 1])) k++;
      return one(kind, k);
    };
    if (SECTION.test(line)) return one('heading');
    if (setextAt(lines, j, to)) return { ...one('heading', j + 1), setext: true };
    if (ATTRIBUTE_ENTRY.test(line)) {
      let k = j;
      // Entries, and values going on over lines ending in a backslash or " +".
      while (k + 1 < to && (ATTRIBUTE_ENTRY.test(lines[k + 1]) || / (\\|\+)$/.test(lines[k]))) k++;
      return one('entries', k);
    }
    if (isComment(line)) return run('comment', isComment);
    if (PREPROCESSOR.test(line)) return one('preprocessor');
    if (BREAK.test(line)) return one('break');
    if (PAGE_BREAK.test(line)) return one('pagebreak');
    if (listItem(line)) return { ...one('list', this.items(j, to, (l) => !!listItem(l)).end) };
    if (isDescriptionItem(line)) return { ...one('items', this.items(j, to, isDescriptionItem).end), raw: 'definitionList' };
    if (CALLOUT_ITEM.test(line)) return { ...one('items', this.items(j, to, (l) => CALLOUT_ITEM.test(l)).end), raw: 'callouts' };
    if (/^[ \t]/.test(line)) return run('literal', (l) => !isBlank(l));
    return one('paragraph', this.paragraphEnd(j, to, inList));
  }

  // A paragraph's last line: before a blank line or a line that starts a block.
  paragraphEnd(j: number, to: number, inList = false): number {
    const lines = this.lines;
    let k = j;
    while (k + 1 < to) {
      const l = lines[k + 1];
      if (isBlank(l) || delimiterOf(l) || isAttributeLine(l) || isComment(l) || PREPROCESSOR.test(l)) break;
      if (inList && (listItem(l) || isDescriptionItem(l) || l.trim() === '+')) break;
      k++;
    }
    return k;
  }

  // A list's items from line j: their text, nested items, and blocks attached with
  // "+". Lists go on over blank lines when an item follows.
  items(j: number, to: number, isItem: (line: string) => boolean): { end: number; entries: ListEntry[] } {
    const lines = this.lines;
    const entries: ListEntry[] = [{ type: 'item', line: j }];
    let last = j;
    let k = j + 1;
    let attached = false;
    while (k < to) {
      const l = lines[k];
      if (isItem(l)) {
        entries.push({ type: 'item', line: k });
        last = k++;
        attached = false;
        continue;
      }
      if (l.trim() === '+') {
        if (k + 1 >= to || isBlank(lines[k + 1])) break;
        const segs = this.block(k + 1, to, true);
        const block = segs[segs.length - 1];
        // Header lines alone aren't a block to attach.
        if (block.kind === 'attributes' || block.kind === 'target') break;
        entries.push({ type: 'attach', start: k + 1, end: block.end });
        last = block.end;
        k = block.end + 1;
        attached = true;
        continue;
      }
      if (isBlank(l)) {
        let m = k;
        while (m < to && isBlank(lines[m])) m++;
        if (m < to && isItem(lines[m])) {
          k = m;
          continue;
        }
        break;
      }
      if (attached || delimiterOf(l) || isAttributeLine(l) || isComment(l) || PREPROCESSOR.test(l)) break;
      entries.push({ type: 'text', line: k });
      last = k++;
    }
    return { end: last, entries };
  }
}

type ListEntry = { type: 'item'; line: number } | { type: 'text'; line: number } | { type: 'attach'; start: number; end: number };

// Styles that make a paragraph a block of another kind.
const STYLED = new Set([...ADMONITIONS, 'sidebar', 'example', 'quote', 'abstract', 'source', 'listing', 'literal']);

// The style of header lines: the first attribute list's first positional attribute.
function headerStyle(lines: string[]): string | null {
  for (const l of lines) {
    if (!isAttributeLine(l) || anchorOf(l)) continue;
    const list = parseAttrlist(l.trim().slice(1, -1));
    if (list?.style) return list.style;
  }
  return null;
}

// ---- header lines → a block's attributes ---------------------------------------

export interface BlockHeader {
  title: string;
  attrs: Attrlist;
}

// Anchors, title and attribute lists, merged. Null if one can't be read.
export function readHeader(lines: string[]): BlockHeader | null {
  const attrs: Attrlist = { style: '', id: null, roles: [], opts: [], positional: [], named: [] };
  let title = '';
  let styled = false;
  for (const l of lines) {
    const anchor = /^\[\[([A-Za-z_:][\w:.-]*)\]\][ \t]*$/.exec(l);
    if (anchor) {
      if (attrs.id) return null;
      attrs.id = anchor[1];
      continue;
    }
    if (isTitleLine(l)) {
      if (title) return null;
      title = l.slice(1).trim();
      continue;
    }
    const list = parseAttrlist(l.trim().slice(1, -1));
    if (!list || (styled && (list.style || list.positional.length))) return null;
    styled ||= !!list.style || list.positional.length > 0;
    if (list.id && attrs.id) return null;
    attrs.style ||= list.style;
    attrs.id ??= list.id;
    attrs.roles.push(...list.roles);
    attrs.opts.push(...list.opts);
    attrs.positional.push(...list.positional);
    attrs.named.push(...list.named);
  }
  return { title, attrs };
}

// Positional attributes' names, by style (after the style itself, which is 1).
const POSITIONAL: Record<string, string[]> = {
  quote: ['attribution', 'citetitle'],
  verse: ['attribution', 'citetitle'],
  source: ['language', 'linenums'],
};

// A header's attributes as the editor's options: id, roles and options first, then
// the others by name (numbered when they have none).
export function optionsOf(header: BlockHeader, style: string): [string, string][] {
  const { attrs } = header;
  const out: [string, string][] = [];
  const named = new Map(attrs.named);
  const id = attrs.id ?? named.get('id');
  if (id) out.push(['id', id]);
  const roles = [...attrs.roles, ...(named.get('role')?.split(/\s+/).filter(Boolean) ?? [])];
  if (roles.length) out.push(['role', roles.join(' ')]);
  const opts = [...attrs.opts, ...[named.get('options'), named.get('opts')].flatMap((v) => v?.split(',').map((o) => o.trim()).filter(Boolean) ?? [])];
  if (opts.length) out.push(['options', opts.join(',')]);
  const names = POSITIONAL[style] ?? [];
  attrs.positional.forEach((value, k) => out.push([names[k] ?? String(k + 2), value]));
  for (const [k, v] of attrs.named) if (!['id', 'role', 'options', 'opts'].includes(k)) out.push([k, v]);
  return out;
}

// ---- blocks → nodes ---------------------------------------------------------------

const ADMONITION_STYLE = new Set(ADMONITIONS);
const CODE_STYLES = new Set(['', 'source', 'listing']);

class Reader {
  private line = 1;

  constructor(
    private map: SourceMap,
    private opts: ParseOptions,
  ) {}

  container(text: string, base: number, isDoc = false): { nodes: PMNode[]; entry: ContainerEntry } {
    const lines = text.split('\n');
    const scanner = new Scanner(lines);
    const segs = scanner.blocks(0, lines.length);
    // The document header: the lines under the document title, as written.
    // It comes before anything but comments and attribute entries.
    const title = isDoc ? segs.findIndex((s) => !['comment', 'entries', 'preprocessor'].includes(s.kind)) : -1;
    const next = segs[title + 1];
    if (title >= 0 && segs[title].kind === 'heading' && /^[=#][ \t]/.test(lines[segs[title].start]) && next?.start === segs[title].end + 1) {
      let end = next.start;
      while (end + 1 < lines.length && !isBlank(lines[end + 1])) end++;
      let after = title + 1;
      while (after < segs.length && segs[after].start <= end) after++;
      // Only when that doesn't cut a block in two.
      if (segs[after - 1].end <= end) segs.splice(title + 1, after - title - 1, { kind: 'header', start: next.start, end, body: next.start });
    }
    const offsets: number[] = [];
    let off = 0;
    for (const l of lines) {
      offsets.push(off);
      off += l.length + 1;
    }
    const pieces = segs.map((s) => {
      let e = s.end;
      while (e > s.start && isBlank(lines[e])) e--;
      return { seg: s, from: offsets[s.start], to: offsets[e] + lines[e].length, end: e };
    });
    const entry = this.map.newContainer(pieces.length ? text.slice(0, pieces[0].from) : text, pieces.length ? text.slice(pieces[pieces.length - 1].to) : '');
    const nodes: PMNode[] = [];
    let prev: string | null = null;
    pieces.forEach((p, k) => {
      this.line = base + p.seg.start;
      const src = text.slice(p.from, p.to);
      let node: PMNode;
      try {
        node = this.convert(p.seg, lines.slice(p.seg.start, p.end + 1), src, scanner, lines);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        node = this.raw('asciidoc', src);
      }
      nodes.push(node);
      const sid = node.attrs.sid as string;
      if (prev) this.map.link(prev, sid, text.slice(pieces[k - 1].to, p.from));
      prev = sid;
    });
    return { nodes, entry };
  }

  private withSid(type: string, attrs: Record<string, unknown>, content: PMNode[] | null, src: string, container?: ContainerEntry): PMNode {
    const sid = this.map.nextSid();
    const node = schema.node(type, { ...attrs, sid }, content ?? undefined);
    this.map.record(sid, node, src, container, this.line);
    return node;
  }

  private raw(kind: string, src: string): PMNode {
    return this.withSid('raw_block', { kind, source: src }, null, src);
  }

  private paragraph(text: string): PMNode {
    return this.withSid('paragraph', {}, parseInline(text), text);
  }

  private convert(seg: Segment, own: string[], src: string, scanner: Scanner, all: string[]): PMNode {
    const first = own[seg.body - seg.start];
    switch (seg.kind) {
      case 'heading': {
        if (seg.setext) {
          const level = SETEXT_LEVELS.indexOf(own[1].trim()[0]) + 1;
          return this.withSid('heading', { level, setext: true }, parseInline(own[0].trim()), src);
        }
        const m = SECTION.exec(first)!;
        return this.withSid('heading', { level: m[1].length, setext: false }, parseInline(m[2]), src);
      }
      case 'paragraph':
        return this.paragraph(src);
      case 'literal': {
        const indent = Math.min(...own.map((l) => /^[ \t]*/.exec(l)![0].length));
        const fence = own[0].slice(0, indent);
        if (!own.every((l) => l.startsWith(fence))) throw new Unsupported('mixed indentation');
        return this.withSid('code_block', { lang: '', fence, indented: true, name: 'literal' }, text(own.map((l) => l.slice(indent)).join('\n')), src);
      }
      case 'delimited':
        return this.delimited(seg, own, src);
      case 'admonition':
      case 'styled':
        return this.styled(seg, own, src);
      case 'macro': {
        const header = readHeader(own.slice(0, seg.body - seg.start));
        if (!header) throw new Unsupported('header');
        const [, name, target, attrlist] = /^([A-Za-z][\w-]*)::(\S*?)\[(.*)\][ \t]*$/.exec(first)!;
        // A picture: a figure, with its caption (its title) to edit.
        const figure = name === 'image' && target ? this.figure(header, target, attrlist, src) : null;
        if (figure) return figure;
        const list = parseAttrlist(attrlist);
        const options: [string, string][] = [];
        if (list && name === 'image') {
          ['alt', 'width', 'height'].forEach((k, n) => {
            const v = n === 0 ? list.style : list.positional[n - 1];
            if (v) options.push([k, v]);
          });
          options.push(...list.named);
        }
        return this.withSid('opaque_directive', { name, args: target, options, source: src }, null, src);
      }
      case 'list':
        return this.list(seg, scanner, all);
      case 'items':
        if (seg.raw === 'definitionList') {
          try {
            return this.definitionList(seg, scanner, all, src);
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
          }
        }
        if (seg.raw === 'callouts') {
          try {
            return this.list(seg, scanner, all, true);
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
          }
        }
        return this.raw(seg.raw!, src);
      case 'target':
        return this.withSid('target', { label: anchorOf(first)! }, null, src);
      case 'attributes':
        return this.raw('block-attributes', src);
      case 'header':
        return this.raw('header', src);
      case 'entries':
        return this.raw('attributes', src);
      case 'comment':
        return this.raw('comment', src);
      case 'preprocessor': {
        const marker = this.opts.conditions ? readCondition(src) : null;
        return this.raw(marker ? `condition-${marker.kind}` : 'preprocessor', src);
      }
      case 'break':
        return this.withSid('thematic_break', { markup: src.trim() }, null, src);
      case 'pagebreak':
        return this.raw('page-break', src);
    }
  }

  // image::file[description,width,height,…] under its title (the caption), its id and
  // roles: the figure, its options those (id, role, alt, width, height and the rest).
  private figure(header: BlockHeader, target: string, attrlist: string, src: string): PMNode | null {
    const tokens = attributeTokens(attrlist);
    const { attrs } = header;
    if (!tokens || attrs.style || attrs.positional.length) return null;
    const positional = tokens.filter((t) => t.name === undefined).map((t) => t.value);
    const named = tokens.filter((t) => t.name !== undefined).map((t) => [t.name!, t.value] as [string, string]);
    if (positional.length > 3) return null;
    const options: [string, string][] = [];
    const id = attrs.id ?? attrs.named.find(([k]) => k === 'id')?.[1] ?? named.find(([k]) => k === 'id')?.[1];
    if (id) options.push(['id', id]);
    const roles = [...attrs.roles, ...[...attrs.named, ...named].filter(([k]) => k === 'role').flatMap(([, v]) => v.split(/\s+/).filter(Boolean))];
    if (roles.length) options.push(['role', roles.join(' ')]);
    if (attrs.opts.length) options.push(['options', attrs.opts.join(',')]);
    ['alt', 'width', 'height'].forEach((k, n) => positional[n] && options.push([k, positional[n]]));
    for (const [k, v] of [...attrs.named, ...named]) if (!['id', 'role'].includes(k)) options.push([k, v]);
    const caption = this.withSid('paragraph', {}, header.title ? parseInline(header.title) : [], header.title);
    return this.withSid('md_directive', { name: 'figure', args: target, options, fence: '', header: null, headerKey: null }, [caption], src);
  }

  // The header's text, up to and with the delimiter line.
  private headerText(own: string[], body: number): string {
    return own.slice(0, body + 1).join('\n');
  }

  private delimited(seg: Segment, own: string[], src: string): PMNode {
    const d = seg.delimiter!;
    const body = seg.body - seg.start;
    if (d.startsWith('////')) return this.raw('comment', src);
    if (!seg.closed) throw new Unsupported('unclosed block');
    const header = readHeader(own.slice(0, body));
    if (!header) throw new Unsupported('header');
    const style = header.attrs.style.toLowerCase();
    const inner = own.slice(body + 1, -1).join('\n');
    const headerText = this.headerText(own, body);
    const innerLine = this.line + body + 1;
    const common = (name: string) => {
      const options = optionsOf(header, name);
      return { name, args: header.title, options, header: headerText, headerKey: blockKey(name, '', header.title, options, d) };
    };
    const c = d[0];
    if (c === '-' && d !== '--') {
      // Listings: source code, or a diagram's.
      const name = style || (header.attrs.positional.length ? 'source' : 'listing');
      if (!CODE_STYLES.has(style) && /^[A-Z]/.test(header.attrs.style)) throw new Unsupported('styled listing');
      return this.code(name, header, d, headerText, inner, src);
    }
    if (c === '.') return this.code(style || 'literal', header, d, headerText, inner, src);
    if (c === '`') {
      const lang = /^`+([\w+#.-]*)/.exec(own[body])![1];
      const options = optionsOf(header, 'source');
      const attrs = { name: 'source', lang, args: header.title, options, fence: d, header: headerText, headerKey: blockKey('source', lang, header.title, options, d), directive: false };
      return this.withSid('code_block', attrs, text(inner), src);
    }
    if (c === '+') {
      if (['stem', 'latexmath', 'asciimath'].includes(style)) {
        return this.withSid('math_block', { ...common(style), label: header.attrs.id ?? '', directive: true, fence: d }, text(inner), src);
      }
      return this.raw('passthrough', src);
    }
    if (d === '|===') {
      try {
        // A cell of style a: its blocks, read as the page's are (on their own lines).
        const readBlocks = (text: string, line: number) => {
          const was = this.line;
          const { nodes } = this.container(text, innerLine + line);
          this.line = was;
          return nodes;
        };
        const rows = tableRows(header, own.slice(body + 1, -1), this.map, !!this.opts.conditions, readBlocks);
        return this.withSid('table', { header: body ? own.slice(0, body).join('\n') : null }, rows, src);
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
      }
    }
    if (c === '|' || c === '!' || c === ',' || (c === ':' && d.endsWith('==='))) return this.raw('table', src);
    // Blocks of blocks: their content read as a container of its own.
    let name: string | null = null;
    if (c === '=') name = ADMONITION_STYLE.has(style) ? style : !style || style === 'example' ? 'example' : null;
    else if (c === '*') name = !style || style === 'sidebar' ? 'sidebar' : null;
    else if (c === '_') {
      if (!style && !header.title && !optionsOf(header, '').length) return this.containerNode('blockquote', {}, inner, src, innerLine);
      name = style === 'quote' || !style ? 'quote' : null;
    } else if (d === '--') name = ADMONITION_STYLE.has(style) || ['abstract', 'partintro', 'sidebar', 'example', 'quote'].includes(style) ? style : !style ? 'open' : null;
    if (!name) throw new Unsupported(`${style} block`);
    return this.containerNode('md_directive', { ...common(name), fence: d }, inner, src, innerLine);
  }

  private code(name: string, header: BlockHeader, d: string, headerText: string, inner: string, src: string): PMNode {
    const lang = name === 'source' ? (header.attrs.positional[0] ?? '') : '';
    const options = optionsOf(header, name).filter(([k]) => !(name === 'source' && k === 'language'));
    const attrs = { name, lang, args: header.title, options, fence: d, header: headerText, headerKey: blockKey(name, lang, header.title, options, d), directive: false };
    return this.withSid('code_block', attrs, text(inner), src);
  }

  // A paragraph made a note, a quote or code by its style or its `NOTE:`.
  private styled(seg: Segment, own: string[], src: string): PMNode {
    const body = seg.body - seg.start;
    const header = readHeader(own.slice(0, body));
    if (!header) throw new Unsupported('header');
    const prefix = seg.kind === 'admonition' ? ADMONITION_PARAGRAPH.exec(own[body])![0] : '';
    const style = seg.kind === 'admonition' ? prefix.slice(0, prefix.indexOf(':')).toLowerCase() : header.attrs.style.toLowerCase();
    const paragraph = own.slice(body).join('\n').slice(prefix.length);
    const headerText = own.slice(0, body).join('\n') + (body ? '\n' : '') + prefix;
    if (style === 'source' || style === 'listing' || style === 'literal') {
      const lang = style === 'source' ? (header.attrs.positional[0] ?? '') : '';
      const options = optionsOf(header, style).filter(([k]) => !(style === 'source' && k === 'language'));
      const attrs = { name: style, lang, args: header.title, options, fence: '', header: headerText, headerKey: blockKey(style, lang, header.title, options, ''), directive: false };
      return this.withSid('code_block', attrs, text(paragraph), src);
    }
    const options = optionsOf(header, style);
    const line = this.line;
    this.line = line + body;
    const para = this.paragraph(paragraph);
    this.line = line;
    const attrs = { name: style, args: header.title, options, fence: '', header: headerText, headerKey: blockKey(style, '', header.title, options, '') };
    return this.withSid('md_directive', attrs, [para], src, this.map.newContainer(headerText, ''));
  }

  private containerNode(type: string, attrs: Record<string, unknown>, inner: string, src: string, innerLine: number): PMNode {
    const line = this.line;
    const { nodes, entry } = this.container(inner, innerLine);
    this.line = line;
    const content = nodes.length || type === 'md_directive' ? nodes : [schema.node('paragraph')];
    const node = this.withSid(type, attrs, content, src, entry);
    node.check();
    return node;
  }

  // ---- lists ----

  // Term:: description. Several terms may share one (each on its line, the
  // description after the last); the description goes on over the lines under it,
  // and blocks attach to it with "+". One kind of marker, not nested.
  private definitionList(seg: Segment, scanner: Scanner, all: string[], src: string): PMNode {
    const { entries } = scanner.items(seg.start, seg.end + 1, isDescriptionItem);
    interface Item {
      start: number;
      end: number;
      terms: { line: number; text: string }[];
      desc: { first: number; text: string[] } | null; // its paragraph: the lines it's on, as written
      attached: { start: number; end: number }[];
    }
    const items: Item[] = [];
    let marker: string | null = null;
    for (const e of entries) {
      const current = items[items.length - 1];
      if (e.type === 'item') {
        const m = DESCRIPTION_ITEM.exec(all[e.line])!;
        if (marker !== null && m[2] !== marker) throw new Unsupported('mixed or nested definition lists');
        marker = m[2];
        // A term under one without a description: the same item's.
        const shares = current && !current.desc && !current.attached.length && current.end === e.line - 1;
        const item = shares ? current : { start: e.line, end: e.line, terms: [], desc: null, attached: [] };
        item.terms.push({ line: e.line, text: m[1] });
        if (m[3] !== undefined && m[3].trim()) item.desc = { first: e.line, text: [all[e.line].slice(all[e.line].length - m[3].length)] };
        item.end = e.line;
        if (!shares) items.push(item);
      } else if (e.type === 'text') {
        if (!current || current.attached.length || listItem(all[e.line]) || /^[ \t]*\+[ \t]*$/.test(all[e.line])) throw new Unsupported('definition with other blocks');
        if (current.desc) current.desc.text.push(all[e.line]);
        else current.desc = { first: e.line, text: [all[e.line]] };
        current.end = e.line;
      } else {
        if (!current) throw new Unsupported('attached block without a term');
        current.attached.push(e);
        current.end = e.end;
      }
    }
    const slice = (from: number, to: number) => all.slice(from, to + 1).join('\n');
    const between = (a: number, b: number) => '\n' + all.slice(a + 1, b).map((l) => l + '\n').join('');
    const listLine = this.line;
    const nodes: PMNode[] = [];
    let prev: { sid: string; end: number } | null = null;
    for (const item of items) {
      this.line = listLine + item.start - seg.start;
      const content: PMNode[] = item.terms.map((t) => schema.node('definition_term', null, parseInline(t.text.trim())));
      const blocks: PMNode[] = [];
      let before: { sid: string; end: number } | null = null;
      if (item.desc) {
        const own = item.desc.text.join('\n');
        this.line = listLine + item.desc.first - seg.start;
        const para = this.withSid('paragraph', {}, parseInline(own.replace(/^[ \t]+/, '').replace(/\n[ \t]+/g, '\n')), own);
        blocks.push(para);
        before = { sid: para.attrs.sid, end: item.desc.first + item.desc.text.length - 1 };
      }
      for (const a of item.attached) {
        this.line = listLine + a.start - seg.start;
        const { nodes: attached } = this.container(slice(a.start, a.end), this.line);
        if (attached.length !== 1) throw new Unsupported('attached blocks');
        if (before) this.map.link(before.sid, attached[0].attrs.sid, between(before.end, a.start));
        blocks.push(attached[0]);
        before = { sid: attached[0].attrs.sid, end: a.end };
      }
      if (blocks.length) content.push(this.withSid('definition_desc', {}, blocks, ''));
      this.line = listLine + item.start - seg.start;
      const node = this.withSid('definition_item', { marker }, content, slice(item.start, item.end));
      if (prev) this.map.link(prev.sid, node.attrs.sid, between(prev.end, item.start));
      prev = { sid: node.attrs.sid, end: item.end };
      nodes.push(node);
    }
    this.line = listLine;
    return this.withSid('definition_list', {}, nodes, src);
  }

  // `callouts`: a list of callouts (<1> text), numbered from 1 or all <.>.
  private list(seg: Segment, scanner: Scanner, all: string[], callouts = false): PMNode {
    const itemOf = (line: string) => (callouts ? calloutItem(line) : listItem(line));
    const { entries } = scanner.items(seg.start, seg.end + 1, (l) => !!itemOf(l));
    interface Item {
      line: number;
      marker: string;
      text: number[]; // its text's other lines
      children: ({ list: List } | { attach: { start: number; end: number } })[];
      end: number;
    }
    interface List {
      marker: string; // as the level compares them: numbers are all one level
      ordered: boolean;
      items: Item[];
    }
    const level = (marker: string) => (/^\d+\.$/.test(marker) ? '1.' : /^</.test(marker) ? '<>' : marker);
    const root: List = { marker: level(itemOf(all[seg.start])!.marker), ordered: itemOf(all[seg.start])!.ordered, items: [] };
    const stack: List[] = [root];
    const current = () => {
      const list = stack[stack.length - 1];
      return list.items[list.items.length - 1];
    };
    for (const e of entries) {
      if (e.type === 'item') {
        const it = itemOf(all[e.line])!;
        const at = stack.findIndex((l) => l.marker === level(it.marker));
        const item: Item = { line: e.line, marker: it.marker, text: [], children: [], end: e.line };
        if (at >= 0) {
          stack.length = at + 1;
          stack[at].items.push(item);
        } else {
          const list: List = { marker: level(it.marker), ordered: it.ordered, items: [item] };
          current().children.push({ list });
          stack.push(list);
        }
      } else if (e.type === 'text') {
        // (A list under a callout: kept as written.)
        if (callouts && listItem(all[e.line])) throw new Unsupported('list in a callout');
        current().text.push(e.line);
      } else {
        current().children.push({ attach: e });
      }
    }
    const endOf = (item: Item): number => {
      const last = item.children[item.children.length - 1];
      if (!last) return item.text.length ? item.text[item.text.length - 1] : item.line;
      return 'list' in last ? endOf(last.list.items[last.list.items.length - 1]) : last.attach.end;
    };
    const slice = (from: number, to: number) => all.slice(from, to + 1).join('\n');
    // The text between two blocks: from the end of line `a` to the start of line `b`.
    const between = (a: number, b: number) => '\n' + all.slice(a + 1, b).map((l) => l + '\n').join('');
    const listLine = this.line;
    const build = (list: List): PMNode => {
      const nodes: PMNode[] = [];
      let prev: { sid: string; end: number } | null = null;
      for (const item of list.items) {
        item.end = endOf(item);
        this.line = listLine + item.line - seg.start;
        const content: PMNode[] = [];
        // Its text: the first line after the marker, and the lines going on from it.
        const m = /^[ \t]*(-|\*{1,5}|\.{1,5}|\d+\.|<(?:\d+|\.)>)([ \t]+)/.exec(all[item.line])!;
        const own = [all[item.line].slice(m[0].length), ...item.text.map((l) => all[l])].join('\n');
        const textEnd = item.text.length ? item.text[item.text.length - 1] : item.line;
        // Read without the lines' indentation; recorded as written.
        const para = this.withSid('paragraph', {}, own.trim() === '{empty}' ? [] : parseInline(own.replace(/\n[ \t]+/g, '\n')), own);
        content.push(para);
        let before = { sid: para.attrs.sid as string, end: textEnd };
        for (const child of item.children) {
          let node: PMNode;
          let start: number;
          let end: number;
          if ('list' in child) {
            start = child.list.items[0].line;
            node = build(child.list);
            end = endOf(child.list.items[child.list.items.length - 1]);
          } else {
            start = child.attach.start;
            end = child.attach.end;
            this.line = listLine + start - seg.start;
            const { nodes: attached } = this.container(slice(start, end), this.line);
            if (attached.length !== 1) throw new Unsupported('attached blocks');
            node = attached[0];
          }
          this.map.link(before.sid, node.attrs.sid, between(before.end, start));
          content.push(node);
          before = { sid: node.attrs.sid, end };
        }
        this.line = listLine + item.line - seg.start;
        const node = this.withSid('list_item', { marker: item.marker, pad: m[2].length }, content, slice(item.line, item.end));
        if (prev) this.map.link(prev.sid, node.attrs.sid, between(prev.end, item.line));
        prev = { sid: node.attrs.sid, end: item.end };
        nodes.push(node);
      }
      this.line = listLine + list.items[0].line - seg.start;
      const first = list.items[0].marker;
      if (list.marker === '<>') {
        // Numbered in turn (or all <.>): otherwise as written, numbers and all.
        const auto = first === '<.>';
        if (list.items.some((it, i) => it.marker !== (auto ? '<.>' : `<${i + 1}>`))) throw new Unsupported('callouts out of order');
      }
      const attrs =
        list.marker === '<>'
          ? { start: 1, delim: '<>', tight: true, repeat: first === '<.>' }
          : list.ordered
            ? { start: /^\d+/.test(first) ? parseInt(first, 10) : 1, delim: '.', tight: true, repeat: false }
            : { bullet: first, tight: true };
      return this.withSid(list.ordered ? 'ordered_list' : 'bullet_list', attrs, nodes, slice(list.items[0].line, list.items[list.items.length - 1].end));
    };
    const node = build(root);
    this.line = listLine;
    return node;
  }
}

// What a block's header says, to tell whether it's still the header as written.
export const blockKey = (name: string, lang: string, args: string, options: [string, string][], fence: string) => JSON.stringify([name, lang, args, options, fence]);

// A callout list's item: <1> text, or <.> text.
function calloutItem(line: string): { marker: string; text: string; ordered: boolean } | null {
  const m = /^<(\d+|\.)>[ \t]+(\S.*)$/.exec(line);
  return m ? { marker: `<${m[1]}>`, text: m[2], ordered: true } : null;
}

function text(value: string): PMNode[] {
  return value ? [schema.text(value)] : [];
}
