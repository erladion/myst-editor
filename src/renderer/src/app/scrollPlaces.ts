// Where the writer was: the open page, and how far each page was scrolled, kept per
// folder (see places.ts) and put back when the page opens again.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { Workspace } from '../workspace';
import { loadPlaces, rememberPage, rememberScroll } from '../places';

export function useScrollPlaces(ws: Workspace | null, scrollRef: RefObject<HTMLDivElement | null>, mode: string) {
  const current = ws?.current ?? null;
  useEffect(() => {
    if (ws && current) rememberPage(ws.project.root, current);
  }, [ws, current]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onScroll = useCallback(() => {
    clearTimeout(scrollTimer.current);
    const el = scrollRef.current;
    if (!ws || !current || !el) return;
    const top = el.scrollTop;
    scrollTimer.current = setTimeout(() => rememberScroll(ws.project.root, current, top), 250);
  }, [ws, current, scrollRef]);
  // Back where it was, once the page's editor is there (it mounts first).
  useEffect(() => {
    const el = scrollRef.current;
    if (!ws || !current || !el) return;
    const top = loadPlaces(ws.project.root).scroll[current] ?? 0;
    el.scrollTop = top;
    // Again once images and previews have their size.
    const again = setTimeout(() => el.scrollTop < top && (el.scrollTop = top), 400);
    return () => clearTimeout(again);
  }, [ws, current, mode, scrollRef]);
  return onScroll;
}
