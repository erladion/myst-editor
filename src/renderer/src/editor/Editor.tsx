// Mounts a ProseMirror view for one open page.
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { EditorContext } from './context';
import { nodeViews } from './nodeviews';

interface Props {
  state: EditorState;
  ctx: EditorContext;
  onChange: (state: EditorState, docChanged: boolean) => void;
  viewRef: MutableRefObject<EditorView | null>;
  onView: (view: EditorView | null) => void;
}

// Remount (via `key`) when switching pages, so node views never carry state across files.
export function Editor({ state, ctx, onChange, viewRef, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view: EditorView = new EditorView(host.current!, {
      state,
      nodeViews: nodeViews(ctx),
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

  return <div className="editor-host" ref={host} />;
}
