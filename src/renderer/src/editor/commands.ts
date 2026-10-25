// Editing commands used by the toolbar and keymap.
import type { MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { schema } from '../../../core/schema';
import { newDirectiveFence } from '../../../core/project-config';
import { renderHeader } from '../../../core/directive';
import type { DirectiveDef } from '../../../core/editor-config';
import type { EditorContext } from './context';

const { nodes, marks } = schema;

export const toggleStrong = toggleMark(marks.strong);
export const toggleEm = toggleMark(marks.em);
export const toggleCode = toggleMark(marks.code);
export const toggleStrike = toggleMark(marks.strike);
export const bulletList = wrapInList(nodes.bullet_list);
export const orderedList = wrapInList(nodes.ordered_list);
export const quote = wrapIn(nodes.blockquote);
export const paragraph = setBlockType(nodes.paragraph);
export const heading = (level: number) => setBlockType(nodes.heading, { level });

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

// "paragraph", "heading-2", "code", ... for the block-type dropdown.
export function blockKind(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (parent.type === nodes.heading) return `heading-${parent.attrs.level}`;
  if (parent.type === nodes.paragraph) return 'paragraph';
  return parent.type.name;
}

export function inList(state: EditorState): 'bullet_list' | 'ordered_list' | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'bullet_list' || name === 'ordered_list') return name;
  }
  return null;
}

// Toggle a list: unwrap if already in that kind of list.
export function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    if (inList(state) === type.name) return liftListItem(nodes.list_item)(state, dispatch);
    return wrapInList(type)(state, dispatch);
  };
}

export const toggleQuote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === nodes.blockquote) return lift(state, dispatch);
  return quote(state, dispatch);
};

// Insert a block after the current top-level-ish block (or replace an empty
// paragraph), and put the cursor inside it.
function insertBlock(node: PMNode, cursorOffset = 1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const parent = $from.parent;
    let tr = state.tr;
    let pos: number;
    if (parent.type === nodes.paragraph && parent.content.size === 0 && $from.depth > 0) {
      pos = $from.before();
      tr = tr.replaceWith(pos, $from.after(), node);
    } else {
      pos = $from.depth > 0 ? $from.after() : state.selection.to;
      tr = tr.insert(pos, node);
    }
    if (!dispatch) return true;
    const inside = Math.min(pos + cursorOffset, tr.doc.content.size);
    try {
      tr = tr.setSelection(node.isAtom ? NodeSelection.create(tr.doc, pos) : TextSelection.near(tr.doc.resolve(inside)));
    } catch {
      // keep the default mapped selection
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export function insertDirective(ctx: EditorContext, name: string, args = ''): Command {
  const node = nodes.md_directive.create({ name, args, fence: newDirectiveFence(ctx.config) }, nodes.paragraph.create());
  return insertBlock(node, 2);
}

// A directive declared in .mysteditor.toml, with its options' defaults.
export function insertProjectDirective(ctx: EditorContext, name: string, def: DirectiveDef): Command {
  const fence = newDirectiveFence(ctx.config);
  const options = Object.entries(def.options)
    .filter(([, o]) => o.default !== undefined)
    .map(([k, o]) => [k, o.default!] as [string, string]);
  if (def.body === 'markdown') {
    return insertBlock(nodes.md_directive.create({ name, fence, options }, nodes.paragraph.create()), 2);
  }
  if (def.body === 'text') {
    return insertBlock(nodes.code_block.create({ name, directive: true, fence, options }));
  }
  const header = renderHeader(fence, name, '', options).replace(/\n$/, '');
  return insertBlock(nodes.opaque_directive.create({ name, options, source: `${header}\n${fence}` }));
}

// A directive shown as a card, its source edited as Markdown (a toctree, an include…).
export function insertCard(ctx: EditorContext, name: string, args = '', options: [string, string][] = [], body = ''): Command {
  const fence = newDirectiveFence(ctx.config);
  const header = renderHeader(fence, name, args, options);
  const source = body ? `${header}\n${body}\n${fence}` : `${header.replace(/\n$/, '')}\n${fence}`;
  return insertBlock(nodes.opaque_directive.create({ name, args, options, source }));
}

// A directive whose body is literal text (raw HTML, reStructuredText), edited as code.
export function insertCodeDirective(ctx: EditorContext, name: string, args = ''): Command {
  return insertBlock(nodes.code_block.create({ name, args, lang: args, directive: true, fence: newDirectiveFence(ctx.config) }));
}

// A table with a caption: the table directive around a Markdown table.
export function insertCaptionedTable(ctx: EditorContext): Command {
  const cell = (type: typeof nodes.table_cell, text = '') => type.create(null, nodes.paragraph.create(null, text ? schema.text(text) : undefined));
  const row = (type: typeof nodes.table_cell, texts: string[]) => nodes.table_row.create(null, texts.map((t) => cell(type, t)));
  const table = nodes.table.create({ pretty: true, ruleSpaces: true }, [row(nodes.table_header, ['Column 1', 'Column 2']), row(nodes.table_cell, ['', ''])]);
  return insertBlock(nodes.md_directive.create({ name: 'table', args: 'Caption', fence: newDirectiveFence(ctx.config) }, table), 5);
}

// Directives that can't do without their argument (a version, a file): asked for first.
export async function insertAsking(
  ctx: EditorContext,
  run: (cmd: Command) => void,
  opts: { title: string; label: string; placeholder?: string; help?: string; insert: (value: string) => Command },
) {
  const values = await ctx.ui.editFields({
    title: opts.title,
    submit: 'Insert',
    fields: [{ key: 'value', label: opts.label, value: '', placeholder: opts.placeholder, help: opts.help }],
  });
  const value = values?.value.trim();
  if (value) run(opts.insert(value));
}

export function insertCodeBlock(): Command {
  return insertBlock(nodes.code_block.create({ lang: '' }));
}

export function insertMath(ctx: EditorContext): Command {
  const dollar = ctx.config.extensions.includes('dollarmath') || ctx.config.extensions.includes('amsmath');
  const attrs = dollar ? {} : { directive: true, name: 'math', fence: newDirectiveFence(ctx.config) };
  return insertBlock(nodes.math_block.create(attrs, schema.text('E = mc^2')));
}

export const insertDivider: Command = insertBlock(nodes.thematic_break.create());

const IMAGE_HELP = 'Relative to this page. Images from outside the folder are copied into an images folder next to it.';

export async function insertFigure(ctx: EditorContext, run: (cmd: Command) => void) {
  const values = await ctx.ui.editFields({
    title: 'Insert figure',
    submit: 'Insert',
    fields: [
      { key: 'src', label: 'Image file', value: '', placeholder: 'images/diagram.png', help: IMAGE_HELP, browse: () => ctx.chooseImage() },
      { key: 'alt', label: 'Description', value: '', help: 'Read aloud by screen readers' },
      { key: 'caption', label: 'Caption', value: '' },
      { key: 'name', label: 'Name', value: '', placeholder: 'fig-architecture', help: 'To refer to it from other places (Insert → Cross-reference). Left empty: made from the caption.' },
    ],
  });
  if (!values?.src) return;
  const options: [string, string][] = values.alt ? [['alt', values.alt]] : [];
  const name = values.name.trim() || (values.caption.trim() ? uniqueLabel(ctx, `fig-${targetLabel(values.caption).slice(0, 40).replace(/-+$/, '')}`) : '');
  if (name) options.push(['name', name]);
  const caption = values.caption ? [nodes.paragraph.create(null, schema.text(values.caption))] : [nodes.paragraph.create()];
  run(insertBlock(nodes.md_directive.create({ name: 'figure', args: values.src, options, fence: newDirectiveFence(ctx.config) }, caption), 2));
}

// An image in the text, `![description](path)`; a figure adds a caption and numbering.
export async function insertImage(ctx: EditorContext, run: (cmd: Command) => void) {
  const values = await ctx.ui.editFields({
    title: 'Insert image',
    submit: 'Insert',
    fields: [
      { key: 'src', label: 'Image file', value: '', placeholder: 'images/screenshot.png', help: IMAGE_HELP, browse: () => ctx.chooseImage() },
      { key: 'alt', label: 'Description', value: '', help: 'Read aloud by screen readers' },
    ],
  });
  if (!values?.src) return;
  run((state, dispatch) => {
    const image = nodes.image.create({ src: values.src.trim(), alt: values.alt.trim() });
    if (!state.selection.$from.parent.type.contentMatch.matchType(nodes.image)) return false;
    dispatch?.(state.tr.replaceSelectionWith(image, false).scrollIntoView());
    return true;
  });
}

// A label no target in the project has yet: `base`, or with a number after it.
export function uniqueLabel(ctx: EditorContext, base: string): string {
  const taken = new Set(ctx.suggest('ref').map((s) => s.value));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

// A label for a link target: lower case, words joined by hyphens.
export function targetLabel(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

// `(label)=` before the current block, so {ref}`label` links to it (a heading's title
// becomes the link text).
export async function insertTarget(ctx: EditorContext, state: EditorState, run: (cmd: Command) => void) {
  const { $from } = state.selection;
  const block = $from.depth > 0 ? $from.node(1) : null;
  const values = await ctx.ui.editFields({
    title: 'Insert link target',
    submit: 'Insert',
    fields: [
      {
        key: 'label',
        label: 'Label',
        value: block?.type === nodes.heading ? targetLabel(block.textContent) : '',
        placeholder: 'installing-on-rhel',
        help: 'Placed before this block. Other pages link here with a cross-reference to this label.',
      },
    ],
  });
  const label = values && targetLabel(values.label);
  if (!label) return;
  run((s, dispatch) => {
    const at = s.selection.$from.depth > 0 ? s.selection.$from.before(1) : s.selection.from;
    dispatch?.(s.tr.insert(at, nodes.target.create({ label })).scrollIntoView());
    return true;
  });
}

// The images on a page, for referring to: the link target before each (its
// paragraph's), or the one that would be added.
interface PageImage {
  block: number; // where its paragraph starts: a new target goes there
  label: string | null; // the target already before it
  proposed: string; // the label a new target would have
  description: string;
}

function pageImages(ctx: EditorContext, state: EditorState): PageImage[] {
  const taken = new Set(ctx.suggest('ref').map((s) => s.value));
  state.doc.descendants((node) => {
    if (node.type === nodes.target) taken.add(node.attrs.label);
  });
  const images: PageImage[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type !== nodes.image) return;
    const $pos = state.doc.resolve(pos);
    const depth = $pos.depth; // the paragraph's
    const index = $pos.index(depth - 1);
    const before = index > 0 ? $pos.node(depth - 1).child(index - 1) : null;
    const label = before?.type === nodes.target ? (before.attrs.label as string) : null;
    const file = String(node.attrs.src).split('/').pop()!.replace(/\.\w+$/, '');
    const description = String(node.attrs.alt || file);
    let proposed = '';
    if (!label) {
      const base = `img-${targetLabel(description).slice(0, 40).replace(/-+$/, '') || 'image'}`;
      proposed = base;
      for (let n = 2; taken.has(proposed); n++) proposed = `${base}-${n}`;
      taken.add(proposed);
    }
    images.push({ block: $pos.before(depth), label, proposed, description });
  });
  return images;
}

export async function insertReference(ctx: EditorContext, run: (cmd: Command) => void, state?: EditorState) {
  const images = state ? pageImages(ctx, state) : [];
  const values = await ctx.ui.editFields({
    title: 'Insert cross-reference',
    submit: 'Insert',
    fields: [
      {
        key: 'name',
        label: 'Refers to',
        value: 'ref',
        choices: [
          { value: 'ref', label: 'A section, figure or table (by its name)' },
          ...(images.length ? [{ value: 'image', label: 'An image on this page' }] : []),
          { value: 'doc', label: 'A page' },
          { value: 'term', label: 'A glossary term' },
          { value: 'numref', label: ctx.config.numfig ? 'A figure or table, as “Figure 2”' : 'A figure or table, as “Figure 2” (needs numfig = True in conf.py)' },
        ],
      },
      {
        key: 'target',
        label: 'Target',
        value: '',
        placeholder: 'label-name or path/to/page',
        help: 'A figure or table has a name when it’s given one (the Name of a figure, or # on its card). An image gets a link target before it, if it has none.',
        suggestions: (values) =>
          values.name === 'image'
            ? images.map((img) => ({ value: img.label ?? img.proposed, label: img.label ? img.description : `${img.description} (adds a link target)` }))
            : ctx.suggest(values.name),
      },
      { key: 'title', label: 'Link text', value: '', help: 'Optional, but for an image: Sphinx uses the target’s title or caption otherwise, and an image has none.' },
    ],
  });
  if (!values?.target) return;
  const image = values.name === 'image' ? images.find((img) => (img.label ?? img.proposed) === values.target.trim()) : undefined;
  // An image has no caption for Sphinx to show: the link text is needed.
  const title = values.title.trim() || (values.name === 'image' ? (image?.description ?? 'this image') : '');
  const target = values.target.trim();
  const role = values.name === 'image' ? 'ref' : values.name;
  run((s, dispatch) => {
    const tr = s.tr;
    if (image && !image.label) tr.insert(image.block, nodes.target.create({ label: target }));
    tr.replaceSelectionWith(nodes.role.create({ name: role, value: title ? `${title} <${target}>` : target }), false);
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

export async function editLink(ctx: EditorContext, state: EditorState, run: (cmd: Command) => void) {
  const { from, to, empty, $from } = state.selection;
  const existing = marks.link.isInSet(empty ? $from.marks() : state.doc.resolve(from + 1).marks());
  const values = await ctx.ui.editFields({
    title: existing ? 'Edit link' : 'Insert link',
    submit: existing ? 'Save' : 'Insert',
    fields: [
      { key: 'href', label: 'Address', value: existing?.attrs.href ?? '', placeholder: 'https://… or page.md' },
      ...(empty && !existing ? [{ key: 'text', label: 'Text', value: '' }] : []),
    ],
  });
  if (!values) return;
  run((s, dispatch) => {
    let tr = s.tr;
    if (empty && !existing) {
      if (!values.href) return false;
      const text = values.text || values.href;
      tr = tr.insert(from, schema.text(text, [marks.link.create({ href: values.href })]));
    } else {
      // Extend to the whole link when editing an existing one with a cursor.
      let start = from;
      let end = to;
      if (empty && existing) {
        const parent = $from.parent;
        const offset = $from.parentOffset;
        let pos = $from.start();
        parent.forEach((child, childOffset) => {
          if (existing.isInSet(child.marks) && childOffset <= offset && childOffset + child.nodeSize >= offset) {
            start = pos + childOffset;
            end = pos + childOffset + child.nodeSize;
          }
        });
      }
      tr = tr.removeMark(start, end, marks.link);
      if (values.href) tr = tr.addMark(start, end, marks.link.create({ href: values.href }));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}
