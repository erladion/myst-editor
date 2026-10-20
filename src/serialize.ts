// ProseMirror document -> MyST source.
//
// Blocks that are unchanged since parsing are written back as their original text,
// and original gaps between untouched neighbours are kept. Only edited blocks are
// serialized, and their header/marker/fence style is carried over from the original.
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { MarkdownSerializerState, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { schema } from './schema.js';
import { SourceMap, type ContainerEntry, type InlineStyle } from './sourcemap.js';
import { headerKey, renderHeader, fenceFor } from './directive.js';

export interface SerializeOptions {
  // Ignore the source map and serialize everything (used to test the serializer).
  fresh?: boolean;
}

export function serializeMyst(doc: PMNode, map: SourceMap, opts: SerializeOptions = {}): string {
  return new Writer(map, !!opts.fresh).container(doc, opts.fresh ? undefined : map.root);
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

  private containerEntry(node: PMNode): ContainerEntry | undefined {
    return this.fresh ? undefined : this.map.get(node.attrs.sid)?.container;
  }

  container(node: PMNode, entry: ContainerEntry | undefined, tight = false): string {
    let out = '';
    node.forEach((child, _off, i) => {
      if (i > 0) out += this.gap(node.child(i - 1), child, tight);
      out += this.block(child);
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
    if (tight && a.type.name === 'paragraph' && b.type.name.endsWith('_list')) return '\n';
    return '\n\n';
  }

  block(node: PMNode): string {
    const original = this.unchanged(node);
    if (original !== undefined) return original;
    const inner = () => this.container(node, this.containerEntry(node));

    switch (node.type.name) {
      case 'paragraph':
        return inlineMarkdown(node, this.map.style);

      case 'heading': {
        const text = inlineMarkdown(node, this.map.style);
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
        return `$$\n${node.textContent}\n$$${node.attrs.label ? ` (${node.attrs.label})` : ''}`;
      }

      case 'md_directive':
        return this.directive(node, inner());

      case 'opaque_directive':
      case 'raw_block':
        return node.attrs.source;

      case 'target':
        return `(${node.attrs.label})=`;

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
    }
    const parts = [header];
    if (body !== '' || node.type.name !== 'md_directive') parts.push(body);
    parts.push(fence.trimStart());
    return parts.join('\n');
  }

  private list(node: PMNode): string {
    const ordered = node.type.name === 'ordered_list';
    const tight: boolean = node.attrs.tight;
    let out = '';
    let number = ordered ? node.attrs.start - 1 : 0;
    node.forEach((item, _off, i) => {
      if (i > 0) out += this.originalGap(node.child(i - 1), item) ?? (tight ? '\n' : '\n\n');
      let marker: string = item.attrs.marker ?? (ordered ? '' : node.attrs.bullet);
      if (ordered && node.attrs.repeat) {
        // "1. 1. 1." style: every item uses the same number.
        marker = item.attrs.marker ?? `${node.attrs.start}${node.attrs.delim}`;
      } else if (ordered) {
        const n = parseInt(marker, 10);
        number = Number.isNaN(n) || n <= number ? number + 1 : n;
        if (Number.isNaN(n) || n !== number) marker = `${number}${node.attrs.delim}`;
      }
      const original = this.unchanged(item);
      if (original !== undefined) {
        out += original;
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
  lineStart = false;

  esc(str: string, startOfLine = false): string {
    let out = super.esc(str, startOfLine);
    if (startOfLine) out = out.replace(/^(%|\+\+\+|:::|\(.*\)=\s*$)/, '\\$&');
    return out;
  }
}

type State = MystInlineState & { atBlockStart: boolean; inAutolink?: boolean };
type NodeFn = (state: State, node: PMNode, parent: PMNode, index: number) => void;

// Atoms write markup directly, which ends any pending line start.
const atom =
  (fn: NodeFn): NodeFn =>
  (state, node, parent, index) => {
    state.lineStart = false;
    fn(state, node, parent, index);
  };

const nodes: Record<string, NodeFn> = {
  paragraph: (state, node) => state.renderInline(node),
  text: (state, node) => {
    if (state.lineStart) state.atBlockStart = true;
    state.lineStart = false;
    state.text(node.text!);
  },
  soft_break: (state) => {
    state.write('\n');
    state.lineStart = true;
  },
  hard_break: atom((state) => state.write('\\\n')),
  role: atom((state, node) => {
    const t = tick(node.attrs.value);
    state.write(`{${node.attrs.name}}${t}${node.attrs.value}${t}`);
  }),
  inline_math: atom((state, node) => state.write(`$${node.attrs.value}$`)),
  html_inline: atom((state, node) => state.write(node.attrs.value)),
  footnote_ref: atom((state, node) => state.write(`[^${node.attrs.label}]`)),
  ref_link: atom((state, node) => state.write(`[](${linkDestination(node.attrs.href, node.attrs.title)})`)),
  image: atom((state, node) =>
    state.write(`![${state.esc(node.attrs.alt || '')}](${linkDestination(node.attrs.src, node.attrs.title)})`),
  ),
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
      const close = (state as LinkState).linkClose!.pop()!;
      // A shortcut reference directly followed by `(` or `[` would parse differently.
      const next = index < parent.childCount ? parent.child(index) : null;
      if (close === ']' && next?.isText && /^[([]/.test(next.text!)) return `][${style.refs.get(mark.attrs.href)!.label}]`;
      return close;
    },
    mixable: true,
  },
  code: defaultMarkdownSerializer.marks.code,
});

const inlineOptions = {
  // `$` starts inline math; `<` and `&` could start HTML or an entity.
  escapeExtraCharacters: /\$|<(?=[A-Za-z/!?])|&(?=#?\w+;)/g,
};

function inlineMarkdown(textblock: PMNode, style: InlineStyle): string {
  const para = schema.node('doc', null, [schema.node('paragraph', null, textblock.content)]);
  // The state constructor and `out` are public at runtime but marked internal in the typings.
  const Ctor = MystInlineState as unknown as new (n: object, m: object, o: object) => MystInlineState & { out: string };
  const state = new Ctor(nodes, marksFor(style), inlineOptions);
  state.renderContent(para);
  return state.out;
}
