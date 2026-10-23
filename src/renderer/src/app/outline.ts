// The open page's headings for the outline, and the one the writer is in: top-level
// headings (Sphinx's sections) in the formatted view, # lines in the Markdown view.
import { useCallback, useMemo, type MutableRefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { markdownHeadings, type Heading } from '../components/Navigation';
import type { Session } from '../workspace';

export function useOutline(session: Session | undefined, textMode: boolean, sourceLine: number | null, viewRef: MutableRefObject<EditorView | null>, gotoLine: (line: number) => void) {
  const headings = useMemo<Heading[]>(() => {
    if (!session) return [];
    if (textMode) return markdownHeadings(session.text!);
    const out: Heading[] = [];
    session.state.doc.forEach((node, offset) => {
      if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent, at: offset });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, session?.state.doc, session?.text, textMode]);
  const where = textMode ? (sourceLine ?? 1) : (session?.state.selection.from ?? 0);
  const currentHeading = useMemo(() => {
    let found: number | null = null;
    headings.forEach((h, i) => {
      if (h.at <= where) found = i;
    });
    return found;
  }, [headings, where]);
  const pickHeading = useCallback(
    (h: Heading) => {
      if (textMode) return gotoLine(h.at);
      const v = viewRef.current;
      if (!v) return;
      (v.nodeDOM(h.at) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(h.at + 1))));
      v.focus();
    },
    [textMode, viewRef, gotoLine],
  );
  return { headings, currentHeading, pickHeading };
}
