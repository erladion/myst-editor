// Editing commands used by the toolbar and keymap.
import type { MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { schema } from '../../../core/schema';
import type { EditorContext } from './context';
import { blocksAllowed, cellKind } from './tables';
import { toggleHtmlList } from './html';

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
    // In a Markdown table's cell, which can't hold a list: an HTML one.
    if (cellKind.getState(state) === 'line' && !blocksAllowed(state) && toggleHtmlList(type === nodes.ordered_list)(state, dispatch)) return true;
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
export function insertBlock(node: PMNode, cursorOffset = 1): Command {
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

// Blocks that can't do without their argument (a version, a file): asked for first.
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

export const insertDivider: Command = insertBlock(nodes.thematic_break.create());

export const IMAGE_HELP = 'Relative to this page. Images from outside the folder are copied into an images folder next to it.';

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
      // What else the link had (its title, a format's ^ for a new window) stays.
      if (values.href) tr = tr.addMark(start, end, marks.link.create({ ...existing?.attrs, href: values.href }));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

// Enter in a definition list: from a term to its description (made if it has none);
// in an empty paragraph ending an item's last description, to a new term after it.
export const definitionEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const parent = $from.parent;
  if (parent.type === nodes.definition_term) {
    if ($from.parentOffset < parent.content.size) return false; // splits the term as text does
    const item = $from.node(-1);
    const after = $from.after();
    const next = item.childAfter(after - $from.start(-1)).node;
    if (next?.type === nodes.definition_desc) {
      dispatch?.(state.tr.setSelection(TextSelection.near(state.doc.resolve(after + 1))).scrollIntoView());
      return true;
    }
    const desc = nodes.definition_desc.create(null, nodes.paragraph.create());
    const tr = state.tr.insert(after, desc);
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView());
    return true;
  }
  // An empty last paragraph of the last description: a new term instead.
  if (parent.type !== nodes.paragraph || parent.content.size || $from.depth < 3) return false;
  const desc = $from.node(-1);
  const item = $from.node(-2);
  if (desc.type !== nodes.definition_desc || item.type !== nodes.definition_item) return false;
  if ($from.index(-1) !== desc.childCount - 1 || $from.index(-2) !== item.childCount - 1) return false;
  const itemEnd = $from.after(-2);
  let tr = state.tr;
  // The empty paragraph goes (its description too, if that's all it had).
  tr = desc.childCount === 1 ? tr.delete($from.before(-1), $from.after(-1)) : tr.delete($from.before(), $from.after());
  const at = tr.mapping.map(itemEnd);
  tr = tr.insert(at, nodes.definition_item.create(null, nodes.definition_term.create()));
  dispatch?.(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
  return true;
};
