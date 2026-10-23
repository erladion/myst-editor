// Keys the window handles itself, wherever the focus is: Ctrl+F, Ctrl+/ and Ctrl+K,
// and the Emacs keys when they're on (see emacs.ts).
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { EditorContext } from '../editor/context';
import { editLink } from '../editor/commands';
import { startEmacs, type EmacsApp } from '../emacs';

const api = window.myst;

function useKey(onKey: (e: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useShortcuts(opts: { emacs: boolean; openFind: () => boolean; toggleMode: () => void; pageOpen: boolean; ctx: EditorContext; viewRef: MutableRefObject<EditorView | null> }) {
  const { emacs, openFind, toggleMode, pageOpen, ctx, viewRef } = opts;
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
  // Ctrl+K for links (needs the dialog, so it lives here rather than in the keymap).
  useKey(
    (e) => {
      const view = viewRef.current;
      if (view && view.hasFocus() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        void editLink(ctx, view.state, (cmd) => {
          cmd(view.state, view.dispatch, view);
          view.focus();
        });
      }
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
