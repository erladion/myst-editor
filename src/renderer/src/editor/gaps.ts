// Getting out at the end (or start) of a block that holds others: a callout inside a
// callout, a callout at the end of the page. The gap cursor's own arrows only stop
// beside blocks they count as closed, and a callout ending in a paragraph isn't one,
// so there was no way past it. Here the arrows go to the gap just after (before) the
// block when there's no text to go to; typing, or Enter, there starts a paragraph. A
// click below a block's last child does the same.
import { GapCursor } from 'prosemirror-gapcursor';
import { Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

// Where to put the cursor leaving `$pos` (between blocks, in a container) forwards or
// backwards, when there's nothing beside it: the gap past the container, or past its
// container in turn where a paragraph can't go (between list items, table cells).
// Null where the usual arrows have somewhere to go.
function pastContainer(state: EditorState, $pos: ResolvedPos, dir: 1 | -1): GapCursor | null {
  const paragraph = state.schema.nodes.paragraph;
  for (let $at = $pos; $at.depth > 0; ) {
    if (dir > 0 ? $at.nodeAfter : $at.nodeBefore) return null;
    const $out = state.doc.resolve(dir > 0 ? $at.after() : $at.before());
    const next = dir > 0 ? $out.nodeAfter : $out.nodeBefore;
    if (next?.isTextblock) return null;
    if ($out.parent.contentMatchAt($out.index()).matchType(paragraph)) return new GapCursor($out);
    $at = $out;
  }
  return null;
}

function leave(dir: 1 | -1, axis: 'vert' | 'horiz'): Command {
  return (state, dispatch, view) => {
    const sel = state.selection;
    let $pos: ResolvedPos;
    if (sel instanceof GapCursor) {
      $pos = sel.$head;
    } else if (sel instanceof TextSelection && sel.empty && sel.$head.parent.isTextblock && sel.$head.depth > 1) {
      const where = dir > 0 ? (axis === 'vert' ? 'down' : 'forward') : axis === 'vert' ? 'up' : 'backward';
      if (!view?.endOfTextblock(where)) return false;
      // Between the textblock and what's beside it, in its container.
      $pos = state.doc.resolve(dir > 0 ? sel.$head.after() : sel.$head.before());
    } else {
      return false;
    }
    const gap = pastContainer(state, $pos, dir);
    if (!gap) return false;
    dispatch?.(state.tr.setSelection(gap).scrollIntoView());
    return true;
  };
}

// A click below the last child of the page, or of a block that holds others.
function clickBelow(view: EditorView, e: MouseEvent): boolean {
  if (e.button !== 0 || !view.editable) return false;
  const target = e.target as HTMLElement;
  if (target !== view.dom && !target.classList.contains('directive-body')) return false;
  const last = target.lastElementChild;
  if (!last || e.clientY <= last.getBoundingClientRect().bottom) return false;
  let pos: number;
  try {
    pos = view.posAtDOM(target, target.childNodes.length);
  } catch {
    return false;
  }
  const $pos = view.state.doc.resolve(pos);
  if ($pos.parent.inlineContent) return false;
  const before = $pos.nodeBefore;
  const sel = before?.isTextblock ? TextSelection.create(view.state.doc, pos - 1) : new GapCursor($pos);
  e.preventDefault();
  view.dispatch(view.state.tr.setSelection(sel));
  view.focus();
  return true;
}

export const gapsPlugin = new Plugin({
  props: {
    handleKeyDown(view, e) {
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
      const command = { ArrowDown: leave(1, 'vert'), ArrowRight: leave(1, 'horiz'), ArrowUp: leave(-1, 'vert'), ArrowLeft: leave(-1, 'horiz') }[e.key];
      return !!command && command(view.state, view.dispatch, view);
    },
    handleDOMEvents: {
      mousedown: (view, e) => clickBelow(view, e),
    },
  },
});
