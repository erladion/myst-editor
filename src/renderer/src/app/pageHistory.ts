// Back and forward through the pages opened, as in a browser: File → Back and Forward
// (Alt+← and Alt+→), and the mouse's back and forward buttons. Pages since deleted or
// renamed are skipped; each folder has its own.
import { useCallback, useEffect, useRef } from 'react';
import type { Workspace } from '../workspace';

const MAX = 100;

export type Direction = 'back' | 'forward';

export function usePageHistory(ws: Workspace | null, open: (path: string) => unknown, emacs: boolean) {
  const h = useRef({ ws: null as Workspace | null, back: [] as string[], forward: [] as string[], at: null as string | null, going: null as string | null });
  const current = ws?.current ?? null;
  useEffect(() => {
    const s = h.current;
    if (s.ws !== ws) Object.assign(s, { ws, back: [], forward: [], at: null, going: null });
    if (current === s.at) return;
    // Another page opened (not by going back or forward): what was open is behind it.
    if (current !== s.going && s.at) {
      s.back.push(s.at);
      if (s.back.length > MAX) s.back.shift();
      s.forward = [];
    }
    s.going = null;
    s.at = current;
  }, [ws, current]);

  const go = useCallback(
    (direction: Direction) => {
      const s = h.current;
      if (!ws) return;
      const [from, to] = direction === 'back' ? [s.back, s.forward] : [s.forward, s.back];
      while (from.length) {
        const path = from.pop()!;
        if (path === s.at || !ws.project.files.includes(path)) continue;
        if (s.at) to.push(s.at);
        s.going = path;
        void open(path);
        return;
      }
    },
    [ws, open],
  );

  // The mouse's buttons 4 and 5 (3 and 4 to the browser): nothing else happens with
  // them, such as the window's own history going back.
  useEffect(() => {
    const isSide = (e: MouseEvent) => e.button === 3 || e.button === 4;
    const down = (e: MouseEvent) => isSide(e) && e.preventDefault();
    const up = (e: MouseEvent) => {
      if (!isSide(e)) return;
      e.preventDefault();
      go(e.button === 3 ? 'back' : 'forward');
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
    };
  }, [go]);

  // Alt+← and Alt+→, before the editors see them (the Markdown view moves by syntax
  // with them); Emacs keys keep them.
  useEffect(() => {
    if (emacs) return;
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      e.stopPropagation();
      go(e.key === 'ArrowLeft' ? 'back' : 'forward');
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [go, emacs]);

  return go;
}
