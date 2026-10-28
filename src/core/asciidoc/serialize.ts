// ProseMirror document → AsciiDoc source.
//
// As for MyST (../myst/serialize.ts): blocks unchanged since reading are written as they
// were, with the text that was between them; only edited ones are written anew, in
// the style they had (their delimiter, header, markers).
import type { Node as PMNode } from 'prosemirror-model';
import type { ContainerEntry, SourceMap } from '../sourcemap.js';
import { serializeInline } from './inline.js';
import { writeTable } from './table.js';
import { blockKey } from './parse.js';
import { ADMONITIONS, closes, renderAttrlist, type Attrlist } from './syntax.js';

export interface SerializeOptions {
  // Ignore the source map and write everything anew (to test the writer).
  fresh?: boolean;
}

export function serializeAsciidoc(doc: PMNode, map: SourceMap, opts: SerializeOptions = {}): string {
  return new Writer(map, !!opts.fresh).container(doc, opts.fresh ? undefined : map.root, []);
}

const SETEXT_LEVELS = '=-~^+';

// The delimiter a block of this kind gets when it needs one.
const DELIMITERS: Record<string, string> = { example: '====', sidebar: '****', quote: '____', open: '--', abstract: '--', partintro: '--', listing: '----', source: '----', literal: '....' };
const delimiterFor = (name: string) => DELIMITERS[name] ?? (ADMONITIONS.includes(name) ? '====' : '----');

// Its style in the header, if the delimiter doesn't already say it.
function styleOf(name: string, fence: string): string {
  if (ADMONITIONS.includes(name)) return name.toUpperCase();
  if ((name === 'example' && fence.startsWith('=')) || (name === 'sidebar' && fence.startsWith('*')) || name === 'open') return '';
  if ((name === 'listing' && fence.startsWith('-')) || (name === 'literal' && fence.startsWith('.'))) return '';
  return name;
}

const POSITIONAL: Record<string, string[]> = {
  quote: ['attribution', 'citetitle'],
  verse: ['attribution', 'citetitle'],
  source: ['language', 'linenums'],
};

// A block's header: its title, its attribute list, and (if it has one) its delimiter.
function renderHeader(name: string, lang: string, title: string, options: [string, string][], fence: string): string {
  const style = styleOf(name, fence);
  const attrs: Attrlist = { style, id: null, roles: [], opts: [], positional: [], named: [] };
  const names = POSITIONAL[name] ?? [];
  const positional: string[] = [];
  if (name === 'source' && !fence.startsWith('`')) positional[0] = lang;
  for (const [k, v] of options) {
    if (k === 'id') attrs.id = v;
    else if (k === 'role') attrs.roles.push(...v.split(/\s+/).filter(Boolean));
    else if (k === 'options') attrs.opts.push(...v.split(',').filter(Boolean));
    else if (names.includes(k)) positional[names.indexOf(k)] = v;
    else if (/^\d+$/.test(k)) positional[Number(k) - 2] = v;
    else attrs.named.push([k, v]);
  }
  attrs.positional = Array.from(positional, (v) => v ?? '');
  while (attrs.positional.length && attrs.positional[attrs.positional.length - 1] === '') attrs.positional.pop();
  const lines: string[] = [];
  if (title) lines.push(`.${title}`);
  if (attrs.style || attrs.id || attrs.roles.length || attrs.opts.length || attrs.positional.length || attrs.named.length) lines.push(renderAttrlist(attrs));
  if (fence) lines.push(fence.startsWith('`') ? fence + lang : fence);
  return lines.join('\n');
}

// A delimiter no line of `body` would close: longer, if it must be.
function delimiterAround(fence: string, body: string): string {
  if (fence === '--') return body.split('\n').some((l) => closes(l, '--')) ? '====' : fence;
  let d = fence;
  while (body.split('\n').some((l) => closes(l, d))) d += d[d.length - 1];
  return d;
}

class Writer {
  constructor(
    private map: SourceMap,
    private fresh: boolean,
  ) {}

  private unchanged(node: PMNode): string | undefined {
    return this.fresh ? undefined : this.map.unchanged(node);
  }

  private originalGap(a: PMNode, b: PMNode): string | undefined {
    return this.fresh ? undefined : this.map.gapBetween(a, b);
  }

  private entry(node: PMNode): ContainerEntry | undefined {
    return this.fresh ? undefined : this.map.get(node.attrs.sid)?.container;
  }

  // `lists`: the markers of the lists around (their items' children can't reuse them).
  container(node: PMNode, entry: ContainerEntry | undefined, lists: string[]): string {
    let out = '';
    let prev: PMNode | null = null;
    node.forEach((child) => {
      const text = this.block(child, lists);
      if (text === '' && child.type.name === 'paragraph') return;
      if (prev) out += this.gap(prev, child);
      out += text;
      prev = child;
    });
    if (!entry) return out;
    return entry.lead + out + (node.childCount ? entry.trail : '');
  }

  private gap(a: PMNode, b: PMNode): string {
    const original = this.originalGap(a, b);
    if (original !== undefined) return original;
    // Anchors and attribute lines belong to the block under them.
    if (a.type.name === 'target' || (a.type.name === 'raw_block' && a.attrs.kind === 'block-attributes')) return '\n';
    // The document header goes right under the title.
    if (b.type.name === 'raw_block' && b.attrs.kind === 'header') return '\n';
    // A condition's markers go right around what's in it.
    const kind = (n: PMNode) => (n.type.name === 'raw_block' ? n.attrs.kind : null);
    if (kind(a) === 'condition-start' || kind(b) === 'condition-end') return '\n';
    return '\n\n';
  }

  block(node: PMNode, lists: string[] = []): string {
    const original = this.unchanged(node);
    if (original !== undefined) return original;
    switch (node.type.name) {
      case 'paragraph':
        return serializeInline(node, { was: this.fresh ? undefined : this.map.get(node.attrs.sid)?.text, inList: lists.length > 0 });
      case 'heading': {
        const text = serializeInline(node).replace(/\n/g, ' ');
        const was = this.fresh ? undefined : this.map.get(node.attrs.sid)?.text;
        const { level, setext } = node.attrs as { level: number; setext: boolean };
        if (setext && level <= SETEXT_LEVELS.length) {
          // Its underline as it was while that's still long enough (within one).
          const line = was?.split('\n')[1]?.trimEnd();
          const char = SETEXT_LEVELS[level - 1];
          const underline = line && line[0] === char && Math.abs(line.length - text.length) < 2 ? line : char.repeat(Math.max(2, text.length));
          return `${text}\n${underline}`;
        }
        // Markdown-style (#) if it was.
        return `${(was?.startsWith('#') ? '#' : '=').repeat(level)} ${text}`;
      }
      case 'thematic_break':
        return /^('{3,}|([-*_])( *)\2\3\2)$/.test(node.attrs.markup) ? node.attrs.markup : "'''";
      case 'blockquote': {
        const body = this.container(node, this.entry(node), []);
        const fence = delimiterAround('____', body);
        return `${fence}\n${body}\n${fence}`;
      }
      case 'bullet_list':
      case 'ordered_list':
        return this.list(node, lists);
      case 'definition_list':
        return this.definitionList(node);
      case 'code_block':
        return this.code(node);
      case 'math_block':
        return this.math(node);
      case 'md_directive':
        return this.directive(node);
      case 'opaque_directive':
      case 'raw_block':
        return node.attrs.source;
      case 'target':
        return `[[${node.attrs.label}]]`;
      case 'table':
        return writeTable(node, this.fresh ? null : this.map, this.fresh ? undefined : this.map.get(node.attrs.sid)?.node);
      default:
        throw new Error(`Cannot write block node ${node.type.name} as AsciiDoc`);
    }
  }

  // The header as written while what it says is unchanged; else written anew.
  private header(node: PMNode, lang: string, fence: string): string {
    const { name, args, options } = node.attrs;
    const key = blockKey(name, lang, args, options, fence);
    if (node.attrs.header !== null && node.attrs.headerKey === key) return node.attrs.header;
    return renderHeader(name, lang, args, options, fence);
  }

  // A figure: its id and roles, its caption as its title, the picture's macro.
  private figure(node: PMNode): string {
    const options = node.attrs.options as [string, string][];
    const get = (k: string) => options.find(([key]) => key === k)?.[1] ?? '';
    const lines: string[] = [];
    if (get('id')) lines.push(`[[${get('id')}]]`);
    const roles = get('role').split(/\s+/).filter(Boolean);
    const opts = get('options').split(',').filter(Boolean);
    if (roles.length || opts.length) lines.push(renderAttrlist({ style: '', id: null, roles, opts, positional: [], named: [] }));
    const caption = node.childCount ? serializeInline(node.firstChild!, { was: this.fresh ? undefined : this.map.get(node.firstChild!.attrs.sid)?.text }).replace(/\n/g, ' ') : '';
    // Only the caption changed: the figure as written, with its title line for it.
    const was = this.fresh ? undefined : this.map.get(node.attrs.sid);
    if (was && was.node.attrs.args === node.attrs.args && JSON.stringify(was.node.attrs.options) === JSON.stringify(options)) {
      const own = was.text.split('\n').filter((l) => !/^\.[^\s.]/.test(l));
      const title = caption ? [`.${caption}`] : [];
      const at = Math.max(0, own.length - 1); // just above the picture's line
      return [...own.slice(0, at), ...title, ...own.slice(at)].join('\n');
    }
    if (caption) lines.push(`.${caption}`);
    const quote = (v: string) => (/[,"\]=]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);
    const positional = ['alt', 'width', 'height'].map(get);
    while (positional.length && !positional[positional.length - 1]) positional.pop();
    const named = options.filter(([k]) => !['id', 'role', 'options', 'alt', 'width', 'height'].includes(k)).map(([k, v]) => `${k}=${quote(v)}`);
    lines.push(`image::${node.attrs.args}[${[...positional.map(quote), ...named].join(',')}]`);
    return lines.join('\n');
  }

  private directive(node: PMNode): string {
    const { name } = node.attrs as { name: string };
    if (name === 'figure') return this.figure(node);
    let fence: string = node.attrs.fence;
    // Written as a paragraph (NOTE: text) while it's one paragraph.
    if (fence === '' && node.childCount === 1 && node.firstChild!.type.name === 'paragraph' && name !== 'open') {
      const para = this.block(node.firstChild!);
      if (para && !para.split('\n').some((l) => !l.trim())) {
        const key = blockKey(name, '', node.attrs.args, node.attrs.options, '');
        if (node.attrs.header !== null && node.attrs.headerKey === key) return node.attrs.header + para;
        const simple = ADMONITIONS.includes(name) && !node.attrs.args && !node.attrs.options.length;
        return simple ? `${name.toUpperCase()}: ${para}` : `${renderHeader(name, '', node.attrs.args, node.attrs.options, '')}\n${para}`;
      }
    }
    if (fence === '') fence = delimiterFor(name);
    const body = this.container(node, fence === node.attrs.fence ? this.entry(node) : undefined, []);
    fence = delimiterAround(fence, body);
    return `${this.header(node, '', fence)}\n${body ? `${body}\n` : ''}${fence}`;
  }

  private code(node: PMNode): string {
    const text = node.textContent;
    const { name, lang } = node.attrs as { name: string; lang: string };
    let fence: string = node.attrs.fence;
    const lines = text.split('\n');
    // A literal paragraph: its lines indented.
    if (node.attrs.indented) {
      if (text && lines.every((l) => l.trim())) return lines.map((l) => fence + l).join('\n');
      fence = '....';
    } else if (fence === '') {
      // [source] and the code as a paragraph, while it's one.
      if (text && lines.every((l) => l.trim()) && !/^\s/.test(text)) {
        const key = blockKey(name, lang, node.attrs.args, node.attrs.options, '');
        const header = node.attrs.header !== null && node.attrs.headerKey === key ? node.attrs.header : `${renderHeader(name, lang, node.attrs.args, node.attrs.options, '')}\n`;
        return header + text;
      }
      fence = delimiterFor(name);
    }
    fence = fence.startsWith('`') ? fenceAround(fence, text) : delimiterAround(fence, text);
    return `${this.header(node, lang, fence)}\n${text ? `${text}\n` : ''}${fence}`;
  }

  private math(node: PMNode): string {
    const text = node.textContent;
    const fence = delimiterAround(node.attrs.directive ? node.attrs.fence || '++++' : '++++', text);
    const named = node.attrs.directive ? node : node.type.create({ ...node.attrs, name: 'latexmath', directive: true, header: null });
    return `${this.header(named, '', fence)}\n${text ? `${text}\n` : ''}${fence}`;
  }

  // ---- lists ----

  // Each item: its terms (the last with its description's first paragraph after it),
  // then the description's other blocks attached with "+".
  private definitionList(node: PMNode): string {
    let out = '';
    node.forEach((item, _o, i) => {
      // Items one under another; after one with blocks attached, a blank line between.
      const prev = i > 0 ? node.child(i - 1) : null;
      const plain = prev && (prev.lastChild?.type.name !== 'definition_desc' || (prev.lastChild.childCount === 1 && prev.lastChild.firstChild!.type.name === 'paragraph'));
      if (prev) out += this.originalGap(prev, item) ?? (plain ? '\n' : '\n\n');
      const original = this.unchanged(item);
      if (original !== undefined) {
        out += original;
        return;
      }
      const marker: string = item.attrs.marker ?? '::';
      // The item as written, its terms first, one a line: each term kept while it says the same.
      const was = this.fresh ? undefined : this.map.get(item.attrs.sid)?.text;
      // (With the spaces before them: " :name: text::" isn't an attribute entry.)
      const wasTerms = (was ?? '').split('\n').map((l) => /^([ \t]*\S.*?)(:{2,4}|;;)(?:[ \t]|$)/.exec(l)?.[1]);
      const terms: string[] = [];
      const blocks: PMNode[] = [];
      item.forEach((part) => {
        if (part.type.name === 'definition_term') terms.push(serializeInline(part, { inList: true, was: wasTerms[terms.length] }).replace(/\n/g, ' ') || '{empty}');
        else part.forEach((b) => blocks.push(b));
      });
      let text = terms.map((t) => `${t}${marker}`).join('\n');
      // The description on the last term's line, or (as it was) on the lines under it.
      // (Its terms are its first lines, one each.)
      const under = !!was && /(:{2,4}|;;)[ \t]*$/.test(was.split('\n')[terms.length - 1] ?? '');
      blocks.forEach((b, k) => {
        if (k === 0 && b.type.name === 'paragraph') {
          const para = this.unchanged(b) ?? serializeInline(b, { was: this.fresh ? undefined : this.map.get(b.attrs.sid)?.text, inList: true, midLine: !under });
          text += under ? `\n${para}` : ` ${para}`;
          return;
        }
        // (In a list's context: lines that would be its items are escaped.)
        const written = this.block(b, ['::']);
        text += (k > 0 ? this.originalGap(blocks[k - 1], b) : undefined) ?? `\n+\n`;
        text += written;
      });
      out += text;
    });
    return out;
  }

  private list(node: PMNode, lists: string[]): string {
    const ordered = node.type.name === 'ordered_list';
    const level = (m: string) => (/^\d+\.$/.test(m) ? '1.' : m);
    const valid = (m: unknown): m is string => typeof m === 'string' && (ordered ? /^(\.{1,5}|\d+\.)$/ : /^(-|\*{1,5})$/).test(m) && !lists.includes(level(m));
    let marker = node.firstChild?.attrs.marker;
    if (!valid(marker)) {
      // One more of the character than the lists around have.
      const char = ordered ? '.' : '*';
      marker = char;
      while (lists.includes(marker) && marker.length < 5) marker += char;
    }
    const numbered = /^\d+\.$/.test(marker);
    const inner = [...lists, level(marker)];
    let out = '';
    node.forEach((item, _o, i) => {
      // Items one under the other; after one ending in another kind of block (which
      // may go on over lines, like a definition list), a blank line between.
      if (i > 0) out += this.originalGap(node.child(i - 1), item) ?? (/^(paragraph|bullet_list|ordered_list)$/.test(node.child(i - 1).lastChild?.type.name ?? '') ? '\n' : '\n\n');
      const original = this.unchanged(item);
      if (original !== undefined && valid(item.attrs.marker) && level(item.attrs.marker) === level(marker)) {
        out += original;
        return;
      }
      const m = numbered ? `${(node.attrs.start ?? 1) + i}.` : marker;
      let text = '';
      item.forEach((child, _off, k) => {
        if (k === 0) {
          if (child.type.name === 'paragraph') {
            text = `${m}${' '.repeat(item.attrs.pad || 1)}${this.block(child, inner) || '{empty}'}`;
            return;
          }
          text = `${m} {empty}`;
        }
        const prev = k > 0 ? item.child(k - 1) : null;
        const list = child.type.name === 'bullet_list' || child.type.name === 'ordered_list';
        text += (prev && this.originalGap(prev, child)) ?? (list ? '\n' : '\n+\n');
        text += list ? this.list(child, inner) : this.block(child, inner);
      });
      out += text;
    });
    return out;
  }
}

// A Markdown-style code fence longer than any line of backticks in the code.
function fenceAround(fence: string, text: string): string {
  let d = fence;
  while (text.split('\n').some((l) => l.trimEnd() === d)) d += '`';
  return d;
}
