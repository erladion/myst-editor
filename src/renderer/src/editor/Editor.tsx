// Mounts a ProseMirror view for one open page.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { SphinxWarning } from '../../../shared/sphinx';
import type { EditorContext } from './context';
import { nodeViews } from './nodeviews';
import { imageInput } from './images';
import { locateProblems, setProblems } from './problems';
import { setConditionView } from './conditions';
import { locatePreviews, setPreviews, type PreviewBuild } from './previews';

interface Props {
  state: EditorState;
  ctx: EditorContext;
  onChange: (state: EditorState, docChanged: boolean) => void;
  viewRef: MutableRefObject<EditorView | null>;
  onView: (view: EditorView | null) => void;
  // Sphinx warnings for this page, located via the text as last saved.
  problems: SphinxWarning[];
  savedText: string;
  // A source line to move the cursor to (e.g. from the problems list).
  reveal: number | null;
  onRevealed: () => void;
  // Capabilities to preview the page with ("View as"); null shows everything.
  viewAs: string[] | null;
  // The latest build of this page's project, for previews in cards.
  build: PreviewBuild | null;
}

// Remount (via `key`) when switching pages, so node views never carry state across files.
export function Editor({ state, ctx, onChange, viewRef, onView, problems, savedText, reveal, onRevealed, viewAs, build }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view: EditorView = new EditorView(host.current!, {
      state,
      nodeViews: nodeViews(ctx),
      ...imageInput(ctx),
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Page content' },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        onChangeRef.current(next, tr.docChanged);
      },
    });
    viewRef.current = view;
    onView(view);
    view.focus();
    return () => {
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
        onView(null);
      }
    };
    // The view owns its state from here on; see the effect below for outside changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // State replaced from outside (e.g. reloaded from disk or edited as source).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state !== state) view.updateState(state);
  }, [state, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setPreviews(view.state.tr, locatePreviews(view.state.doc, savedText, ctx.config, build)));
  }, [build, savedText, ctx, viewRef]);

  const conditions = ctx.config.editor.conditions;
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setConditionView(view.state.tr, conditions, viewAs));
  }, [conditions, viewAs, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setProblems(view.state.tr, locateProblems(view.state.doc, savedText, ctx.config, problems)));
  }, [problems, savedText, ctx, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || reveal === null) return;
    const [hit] = locateProblems(view.state.doc, savedText, ctx.config, [
      { source: null, line: reveal, level: 'warning', message: '', type: null, phase: 'read' },
    ]);
    if (hit) {
      const selection = TextSelection.near(view.state.doc.resolve(Math.min(hit.pos + 1, view.state.doc.content.size)));
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      view.focus();
    }
    onRevealed();
  }, [reveal, savedText, ctx, viewRef, onRevealed]);

  return <div className="editor-host" ref={host} />;
}
