// Previews from the Sphinx build: the open page's built page, the pages cards preview
// single blocks with, and where the preview should be while the formatted view scrolls.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { BuildInfo } from '../../../shared/build';
import { configFor } from '../../../shared/projects';
import type { Session, Workspace } from '../workspace';
import type { PreviewBuild } from '../editor/previews';
import type { PreviewLine } from '../components/SphinxUi';
import { blockLines, lineAtTop } from '../editor/scrollsync';
import { docnameOf } from '../build';

const api = window.myst;

// Stable while the page and build are the same, so cards don't reload their previews.
export function usePreviewBuild(project: string | null, info: BuildInfo | null, session: Session | undefined): PreviewBuild | null {
  const docname = info && session ? docnameOf(info, session.path) : null;
  const builtAt = info?.builtAt ?? null;
  return useMemo(() => {
    if (!project || !docname || !builtAt) return null;
    const base = api.buildUrl(project, '_mysteditor/fragment.html');
    return { url: (from, to) => `${base}?doc=${encodeURIComponent(docname)}&from=${from}&to=${to}&built=${builtAt}` };
  }, [project, docname, builtAt]);
}

// The open page as built, for the preview pane.
export function previewUrlOf(project: string | null, info: BuildInfo | null, session: Session | undefined): string | null {
  const docname = info && session ? docnameOf(info, session.path) : null;
  const uri = docname ? info?.docs[docname]?.uri : null;
  return uri && info && project ? `${api.buildUrl(project, uri)}?built=${info.builtAt}` : null;
}

// The preview follows the formatted view's scrolling (the Markdown view reports its
// line itself): call follow() when it scrolls.
export function usePreviewFollow(ws: Workspace | null, session: Session | undefined, shown: boolean, scrollRef: RefObject<HTMLDivElement | null>, viewRef: MutableRefObject<EditorView | null>) {
  const [line, setLine] = useState<PreviewLine>(null);
  const savedLines = useMemo(
    () => (ws && session && shown ? blockLines(session.savedText, configFor(ws.project, session.path)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, session?.path, session?.savedText, shown],
  );
  const frame = useRef(0);
  const follow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      const v = viewRef.current;
      if (el && v && savedLines) setLine(lineAtTop(v, el, savedLines));
    });
  }, [savedLines, scrollRef, viewRef]);
  useEffect(follow, [follow]);
  return { line, follow };
}
