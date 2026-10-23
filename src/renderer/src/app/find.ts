// The find bar over the formatted view: what was selected when it opened, and a
// counter that refocuses it when Ctrl+F is pressed again. A page opened from a search
// of all pages opens with that search in it.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { EditorView } from 'prosemirror-view';

export interface FindState {
  initial: string;
  focus: number;
  caseSensitive?: boolean;
}

export function useFind(viewRef: MutableRefObject<EditorView | null>, mode: 'rich' | 'markdown', page: string | null) {
  const [find, setFind] = useState<FindState | null>(null);
  const pending = useRef<{ path: string; query: string; caseSensitive: boolean } | null>(null);

  // Ctrl+F finds in the formatted view (the Markdown view's editor has its own search).
  const openFind = useCallback(() => {
    const v = viewRef.current;
    if (!v || mode !== 'rich') return false;
    const { from, to } = v.state.selection;
    const selected = v.state.doc.textBetween(from, to, ' ');
    setFind((f) => ({ initial: selected && !selected.includes('\n') ? selected : (f?.initial ?? ''), focus: (f?.focus ?? 0) + 1 }));
    return true;
  }, [mode, viewRef]);

  // A new page (or view) starts without the find bar, unless it was opened from a search.
  useEffect(() => {
    const p = pending.current;
    if (p && p.path === page && mode === 'rich') {
      pending.current = null;
      setFind((f) => ({ initial: p.query, caseSensitive: p.caseSensitive, focus: (f?.focus ?? 0) + 1 }));
    } else setFind(null);
  }, [page, mode]);

  // A search result in `path`: its matches in the find bar, now if it's the open page,
  // or once it opens. (The Markdown view's editor finds by itself.)
  const showMatches = useCallback(
    (path: string, query: string, caseSensitive: boolean) => {
      if (mode !== 'rich') return;
      if (path === page) setFind((f) => ({ initial: query, caseSensitive, focus: (f?.focus ?? 0) + 1 }));
      else pending.current = { path, query, caseSensitive };
    },
    [mode, page],
  );

  return { find, setFind, openFind, showMatches };
}
