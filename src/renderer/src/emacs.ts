// Emacs keys, for both the formatted view (ProseMirror) and the Markdown view
// (CodeMirror): one table of keys, and an adapter per editor for what they do. One kill
// ring is shared, so text killed in one view can be yanked in the other.
//
// The keys are read before the editors see them (a capture listener on the window),
// so Emacs meanings win over the usual ones (C-b moves back rather than making bold).
// Keys typed in dialogs and other fields are left alone.
import * as cm from '@codemirror/commands';
import { findNext, findPrevious, openSearchPanel } from '@codemirror/search';
import type { EditorView as CMView } from '@codemirror/view';
import { chainCommands, deleteSelection, joinForward, selectAll as pmSelectAll, selectNodeForward, splitBlock, toggleMark } from 'prosemirror-commands';
import { undo as pmUndo } from 'prosemirror-history';
import { TextSelection, type Command } from 'prosemirror-state';
import type { EditorView as PMView } from 'prosemirror-view';
import { schema } from '../../core/schema';

type Unit = 'char' | 'word' | 'line' | 'lineboundary' | 'doc' | 'page';

// What a key can ask of the focused editor.
interface Target {
  move(unit: Unit, forward: boolean, extend: boolean): void;
  deleteChar(): void;
  killWord(forward: boolean): string;
  killLine(): string;
  region(): string; // the selected text
  deleteRegion(): void;
  collapse(): void;
  yank(text: string): void;
  openLine(): void;
  transpose(): void;
  selectAll(): void;
  undo(): void;
  find(forward: boolean): void;
  mark?(name: 'strong' | 'em' | 'code'): void;
}

// The app's own commands that Emacs keys reach.
export interface EmacsApp {
  save(): void;
  goToPage(): void;
  openFolder(): void;
  toggleMarkdown(): void;
  findInPage(forward: boolean): void; // the formatted view's find bar
  closeFind(): boolean; // true if it was open
  prefix(text: string | null): void; // show a pending prefix ("C-x-"), or none
}

let killRing = '';
let markActive = false;
let sourceView: CMView | null = null;

// The Markdown view's editor, while it's there.
export function registerSourceView(view: CMView | null) {
  sourceView = view;
}

// ---- the formatted view ------------------------------------------------------------

const flush = (view: PMView) => (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
const run = (view: PMView, cmd: Command) => cmd(view.state, view.dispatch, view);

function prose(view: PMView, app: EmacsApp): Target {
  // The browser moves the cursor the way it's shown (by line as wrapped, by word);
  // ProseMirror then reads the new position.
  const modify = (alter: 'move' | 'extend', forward: boolean, unit: string) => {
    view.focus();
    (getSelection() as Selection & { modify(a: string, d: string, g: string): void }).modify(alter, forward ? 'forward' : 'backward', unit);
    flush(view);
  };
  const text = (from: number, to: number) => view.state.doc.textBetween(from, to, '\n', ' ');
  return {
    move(unit, forward, extend) {
      const alter = extend ? 'extend' : 'move';
      if (unit === 'page') {
        const lines = Math.max(1, Math.floor((view.dom.closest('.scroll')?.clientHeight ?? 600) / 26) - 2);
        for (let i = 0; i < lines; i++) modify(alter, forward, 'line');
      } else modify(alter, forward, { char: 'character', word: 'word', line: 'line', lineboundary: 'lineboundary', doc: 'documentboundary' }[unit]);
      if (!extend) markActive = false;
    },
    deleteChar: () => run(view, chainCommands(deleteSelection, joinForward, selectNodeForward)),
    killWord(forward) {
      modify('extend', forward, 'word');
      const { from, to } = view.state.selection;
      const killed = text(from, to);
      run(view, deleteSelection);
      return killed;
    },
    killLine() {
      const { $head, empty } = view.state.selection;
      if (!empty) return '';
      // To the end of the paragraph (or table cell, list item…); at its end, the line
      // break goes: the next paragraph joins this one.
      if ($head.parentOffset === $head.parent.content.size) {
        run(view, joinForward);
        return '\n';
      }
      const end = $head.end();
      const killed = text($head.pos, end);
      view.dispatch(view.state.tr.delete($head.pos, end).scrollIntoView());
      return killed;
    },
    region: () => text(view.state.selection.from, view.state.selection.to),
    deleteRegion: () => run(view, deleteSelection),
    collapse: () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.head))),
    yank: (t) => view.dispatch(view.state.tr.insertText(t).scrollIntoView()),
    openLine() {
      const at = view.state.selection.from;
      if (run(view, splitBlock)) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at))));
    },
    transpose() {
      const { $head, empty } = view.state.selection;
      if (!empty || $head.parentOffset === 0) return;
      // At the end of a paragraph, the two characters before; otherwise either side.
      const at = $head.parentOffset === $head.parent.content.size ? $head.pos - 1 : $head.pos;
      if (at - 1 < $head.start()) return;
      const a = text(at - 1, at);
      const b = text(at, at + 1);
      if (a.length !== 1 || b.length !== 1) return;
      view.dispatch(view.state.tr.insertText(b + a, at - 1, at + 1));
    },
    selectAll: () => run(view, pmSelectAll),
    undo: () => run(view, pmUndo),
    find: (forward) => app.findInPage(forward),
    mark: (name) => run(view, toggleMark(schema.marks[name])),
  };
}

// ---- the Markdown view -------------------------------------------------------------

function source(view: CMView): Target {
  const go = (move: (v: CMView) => boolean, select: (v: CMView) => boolean, extend: boolean) => (extend ? select(view) : move(view));
  const slice = () => {
    const r = view.state.selection.main;
    return view.state.sliceDoc(r.from, r.to);
  };
  const killWith = (command: (v: CMView) => boolean) => {
    const before = view.state.doc;
    const at = view.state.selection.main.head;
    command(view);
    // What went: the text between where the cursor was and where it is now.
    const after = view.state.selection.main.head;
    return before.sliceString(Math.min(at, after), Math.min(at, after) + (before.length - view.state.doc.length));
  };
  return {
    move(unit, forward, extend) {
      const pick = {
        char: [forward ? cm.cursorCharForward : cm.cursorCharBackward, forward ? cm.selectCharForward : cm.selectCharBackward],
        word: [forward ? cm.cursorGroupForward : cm.cursorGroupBackward, forward ? cm.selectGroupForward : cm.selectGroupBackward],
        line: [forward ? cm.cursorLineDown : cm.cursorLineUp, forward ? cm.selectLineDown : cm.selectLineUp],
        lineboundary: [forward ? cm.cursorLineBoundaryForward : cm.cursorLineBoundaryBackward, forward ? cm.selectLineBoundaryForward : cm.selectLineBoundaryBackward],
        doc: [forward ? cm.cursorDocEnd : cm.cursorDocStart, forward ? cm.selectDocEnd : cm.selectDocStart],
        page: [forward ? cm.cursorPageDown : cm.cursorPageUp, forward ? cm.selectPageDown : cm.selectPageUp],
      }[unit];
      go(pick[0], pick[1], extend);
      if (!extend) markActive = false;
    },
    deleteChar: () => void cm.deleteCharForward(view),
    killWord: (forward) => killWith(forward ? cm.deleteGroupForward : cm.deleteGroupBackward),
    killLine: () => killWith(cm.deleteToLineEnd),
    region: slice,
    deleteRegion: () => view.dispatch(view.state.replaceSelection('')),
    collapse: () => view.dispatch({ selection: { anchor: view.state.selection.main.head } }),
    yank: (t) => view.dispatch(view.state.replaceSelection(t)),
    openLine: () => void cm.splitLine(view),
    transpose: () => void cm.transposeChars(view),
    selectAll: () => void cm.selectAll(view),
    undo: () => void cm.undo(view),
    find(forward) {
      // The search panel first; once it's open, the next (or previous) match.
      if (!view.dom.querySelector('.cm-search')) openSearchPanel(view);
      else (forward ? findNext : findPrevious)(view);
    },
  };
}

// ---- keys --------------------------------------------------------------------------

// "C-x", "M-f", "C-M-%"…: the key as Emacs writes it.
export function keyName(e: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let key = e.key === ' ' ? 'SPC' : e.key === 'Backspace' ? 'DEL' : e.key;
  if (key.length === 1 && e.ctrlKey) key = key.toLowerCase(); // C-x, whatever the shift state
  return `${e.ctrlKey ? 'C-' : ''}${e.altKey || e.metaKey ? 'M-' : ''}${key}`;
}

type Action = (t: Target) => void;
const kill = (text: string) => {
  if (!text) return;
  killRing = text;
  void navigator.clipboard?.writeText(text).catch(() => {});
};

// Keys that work in either editor.
const EDITING: Partial<Record<string, Action>> = {
  'C-f': (t) => t.move('char', true, markActive),
  'C-b': (t) => t.move('char', false, markActive),
  'C-n': (t) => t.move('line', true, markActive),
  'C-p': (t) => t.move('line', false, markActive),
  'M-f': (t) => t.move('word', true, markActive),
  'M-b': (t) => t.move('word', false, markActive),
  'C-a': (t) => t.move('lineboundary', false, markActive),
  'C-e': (t) => t.move('lineboundary', true, markActive),
  'M-<': (t) => t.move('doc', false, markActive),
  'M->': (t) => t.move('doc', true, markActive),
  'C-v': (t) => t.move('page', true, markActive),
  'M-v': (t) => t.move('page', false, markActive),
  'C-d': (t) => t.deleteChar(),
  'M-d': (t) => kill(t.killWord(true)),
  'M-DEL': (t) => kill(t.killWord(false)),
  'C-k': (t) => kill(t.killLine()),
  'C-w': (t) => {
    kill(t.region());
    t.deleteRegion();
    markActive = false;
  },
  'M-w': (t) => {
    kill(t.region());
    t.collapse();
    markActive = false;
  },
  'C-y': (t) => killRing && t.yank(killRing),
  'C-o': (t) => t.openLine(),
  'C-t': (t) => t.transpose(),
  'C-SPC': (t) => {
    t.collapse();
    markActive = true;
  },
  'C-@': (t) => {
    t.collapse();
    markActive = true;
  },
  'C-/': (t) => t.undo(),
  'C-_': (t) => t.undo(),
  'C-x u': (t) => t.undo(),
  'C-x h': (t) => t.selectAll(),
  'C-s': (t) => t.find(true),
  'C-r': (t) => t.find(false),
  'C-c C-s b': (t) => t.mark?.('strong'),
  'C-c C-s i': (t) => t.mark?.('em'),
  'C-c C-s c': (t) => t.mark?.('code'),
};

// Keys for the app itself, wherever focus is (outside dialogs and fields).
const APP: Partial<Record<string, (app: EmacsApp) => void>> = {
  'C-x C-s': (app) => app.save(),
  'C-x b': (app) => app.goToPage(),
  'C-x C-f': (app) => app.openFolder(),
  'C-c m': (app) => app.toggleMarkdown(),
};

const PREFIXES = new Set(['C-x', 'C-c', 'C-c C-s']);

// The focused editor, if any (the live preview beside the Markdown is read-only).
function focusedTarget(proseView: PMView | null, app: EmacsApp): Target | null {
  const active = document.activeElement;
  if (sourceView && active && sourceView.dom.contains(active)) return source(sourceView);
  if (proseView && proseView.editable && active && proseView.dom.contains(active)) return prose(proseView, app);
  return null;
}

// Start reading Emacs keys; returns a function that stops.
export function startEmacs(getProse: () => PMView | null, app: EmacsApp): () => void {
  let pending: string | null = null;
  const reset = () => {
    pending = null;
    app.prefix(null);
  };
  const onKey = (e: KeyboardEvent) => {
    const name = keyName(e);
    if (!name) return;
    const target = e.target as HTMLElement | null;
    const editor = focusedTarget(getProse(), app);
    // Fields in dialogs and bars keep their own keys (C-g closes the find bar).
    if (!editor && target?.closest('input, textarea, select, [contenteditable="true"]:not(.ProseMirror)')) {
      if (name === 'C-g' && app.closeFind()) e.preventDefault();
      return;
    }
    const keys = pending ? `${pending} ${name}` : name;
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (name === 'C-g') {
      const had = pending !== null || markActive;
      reset();
      markActive = false;
      if (app.closeFind() || had) {
        editor?.collapse();
        consume();
      }
      return;
    }
    if (PREFIXES.has(keys)) {
      consume();
      pending = keys;
      app.prefix(`${keys}-`);
      return;
    }
    const appCommand: ((app: EmacsApp) => void) | undefined = APP[keys];
    const editing: Action | undefined = editor ? EDITING[keys] : undefined;
    if (pending) {
      // Inside a prefix every key is ours: an unknown chord does nothing, as in Emacs.
      consume();
      reset();
    } else if (appCommand || editing) consume();
    else return;
    if (appCommand) appCommand(app);
    else if (editing) editing(editor!);
  };
  // A click starts afresh: no mark, no pending prefix.
  const onMouse = () => {
    markActive = false;
    if (pending) reset();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onMouse, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    markActive = false;
    app.prefix(null);
  };
}

