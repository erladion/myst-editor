// Editor state factory: keymaps, input rules and helper plugins.
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule, undoInputRule } from 'prosemirror-inputrules';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { schema } from '../../../core/schema';
import { heading, paragraph, toggleCode, toggleEm, toggleStrike, toggleStrong } from './commands';
import { problemsPlugin } from './problems';
import { conditionsPlugin } from './conditions';
import { previewsPlugin } from './previews';
import { tablePlugins } from './tables';

const { nodes, marks } = schema;

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
  return true;
};

// `**bold**`, `*italic*` and `` `code` `` typed as Markdown become formatting.
function markRule(pattern: RegExp, type: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const text = match[1];
    const lead = match[0].length - match[0].trimStart().length;
    const tr = state.tr.replaceWith(start + lead, end, schema.text(text, [type.create()]));
    return tr.removeStoredMark(type);
  });
}

const rules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,4})\s$/, nodes.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list, (m) => ({ bullet: m[1] })),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list,
      (m) => ({ start: +m[1] }),
      (m, node) => node.childCount + node.attrs.start === +m[1],
    ),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    textblockTypeInputRule(/^```([\w-]*)\s$/, nodes.code_block, (m) => ({ lang: m[1] })),
    markRule(/(?:^|\s)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks.strong),
    markRule(/(?:^|[\s(])\*([^*\s](?:[^*]*[^*\s])?)\*$/, marks.em),
    markRule(/(?:^|[\s(])`([^`]+)`$/, marks.code),
  ],
});

const keys = keymap({
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  Backspace: undoInputRule,
  'Mod-b': toggleStrong,
  'Mod-i': toggleEm,
  'Mod-e': toggleCode,
  'Mod-Shift-x': toggleStrike,
  Enter: splitListItem(nodes.list_item),
  Tab: sinkListItem(nodes.list_item),
  'Shift-Tab': liftListItem(nodes.list_item),
  'Shift-Enter': chainCommands(exitCode, insertHardBreak),
  'Mod-Enter': exitCode,
  'Mod-Alt-0': paragraph,
  'Mod-Alt-1': heading(1),
  'Mod-Alt-2': heading(2),
  'Mod-Alt-3': heading(3),
  'Mod-Alt-4': heading(4),
});

// Marks the math block containing the cursor, so its source is shown for editing.
const mathEditing = new Plugin({
  props: {
    decorations(state) {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === nodes.math_block) {
          return DecorationSet.create(state.doc, [Decoration.node($from.before(d), $from.after(d), {}, { mathEditing: true })]);
        }
      }
      return null;
    },
  },
});

const placeholder = new Plugin({
  props: {
    decorations(state) {
      const { doc } = state;
      if (doc.childCount !== 1 || !doc.firstChild!.isTextblock || doc.firstChild!.content.size) return null;
      return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: 'empty', 'data-placeholder': 'Start writing…' })]);
    },
  },
});

// Ctrl/Cmd+click follows a link (opened in the system browser by the main process).
const followLinks = new Plugin({
  props: {
    handleClick(view, pos, event) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const link = marks.link.isInSet(view.state.doc.resolve(pos).marks());
      if (!link || !/^https?:/.test(link.attrs.href)) return false;
      window.open(link.attrs.href, '_blank');
      return true;
    },
  },
});

// Chromium reports selection changes asynchronously, so a key pressed right after a
// click or End/Home can reach the keymap before ProseMirror has seen the new cursor
// position, and Enter would split the block at the old one. Read the DOM selection
// first. `domObserver` is internal to prosemirror-view; this is what its own
// forceFlush does once a selectionchange event has arrived.
const syncSelectionOnKey = new Plugin({
  props: {
    handleKeyDown(view) {
      (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
      return false;
    },
  },
});

export function createEditorState(doc: PMNode): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      syncSelectionOnKey,
      // Before the general keymap, so Tab and Enter move between cells in tables.
      ...tablePlugins,
      rules,
      keys,
      keymap(baseKeymap),
      history(),
      dropCursor(),
      gapCursor(),
      mathEditing,
      placeholder,
      followLinks,
      problemsPlugin,
      conditionsPlugin,
      previewsPlugin,
    ],
  });
}
