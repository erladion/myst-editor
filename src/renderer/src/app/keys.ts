// Keys the window handles itself, wherever the focus is: Ctrl+F, Ctrl+/, Ctrl+K and
// the Insert shortcuts with dialogs, and the Emacs keys when they're on (see emacs.ts).
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorContext } from '../editor/context';
import type { Command } from 'prosemirror-state';
import { editLink } from '../editor/commands';
import { insertItem, runInsert } from '../formats/editing';
import { startEmacs, type EmacsApp } from '../emacs';

const api = window.myst;

function useKey(onKey: (e: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Ctrl+Shift with these: what's inserted (the table: its size first, on the Insert menu's grid).
const SHIFTED_INSERTS: Record<string, string> = { k: 'reference', g: 'figure', t: 'table' };

export function useShortcuts(opts: {
  emacs: boolean;
  openFind: () => boolean;
  toggleMode: () => void;
  openPalette: () => void;
  pageOpen: boolean;
  ctx: EditorContext;
  viewRef: MutableRefObject<EditorView | null>;
}) {
  const { emacs, openFind, toggleMode, openPalette, pageOpen, ctx, viewRef } = opts;
  // The command palette: Ctrl+Shift+P, or M-x with Emacs keys.
  useKey(
    (e) => {
      const palette = emacs ? e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'x' : (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p';
      if (!palette) return;
      e.preventDefault();
      openPalette();
    },
    [emacs, openPalette],
  );
  // Ctrl+F: find in the page.
  useKey(
    (e) => {
      if (!emacs && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && openFind()) e.preventDefault();
    },
    [openFind, emacs],
  );
  // Ctrl+/ switches between formatted editing and the Markdown view, wherever focus is.
  useKey(
    (e) => {
      if (!emacs && (e.ctrlKey || e.metaKey) && e.key === '/' && pageOpen) {
        e.preventDefault();
        toggleMode();
      }
    },
    [pageOpen, toggleMode, emacs],
  );
  // Ctrl+K for links, and the Insert shortcuts that open a dialog or need the
  // project's settings (so they live here rather than in the keymap).
  useKey(
    (e) => {
      const view = viewRef.current;
      if (!view || !view.hasFocus() || !(e.ctrlKey || e.metaKey)) return;
      const run = (cmd: Command) => {
        cmd(view.state, view.dispatch, view);
        view.focus();
      };
      const key = e.key.toLowerCase();
      // What the page's format inserts for it, if it has that.
      const insert = (id: string) => {
        const item = insertItem(ctx, id);
        return item && (() => runInsert(item, run, view.state));
      };
      const action = e.altKey
        ? !e.shiftKey && key === 'n'
          ? insert('callout-note')
          : undefined
        : !e.shiftKey
          ? { k: () => void editLink(ctx, view.state, run) }[key]
          : SHIFTED_INSERTS[key] && insert(SHIFTED_INSERTS[key]);
      if (!action) return;
      e.preventDefault();
      action();
    },
    [ctx],
  );
}

// Emacs keys: the menu leaves them alone, and the window reads them (see emacs.ts).
// The app's side goes through a ref, so the keys always reach the current state.
export function useEmacs(on: boolean, app: EmacsApp, viewRef: MutableRefObject<EditorView | null>) {
  const current = useRef(app);
  current.current = app;
  useEffect(() => {
    api.setEmacsKeys(on);
    if (!on) return;
    const proxy = new Proxy({} as EmacsApp, { get: (_t, key: keyof EmacsApp) => (...args: never[]) => (current.current[key] as (...a: never[]) => unknown)(...args) });
    return startEmacs(() => viewRef.current, proxy);
  }, [on, viewRef]);
}
