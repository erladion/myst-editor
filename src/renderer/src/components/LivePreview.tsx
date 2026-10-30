// The advanced view's live preview: the typed Markdown shown the way the formatted
// editor shows it (read-only), following the part of the source being worked on.
import { useEffect, useRef } from 'react';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument } from '../../../core/document';
import { blockPathAtLine, positionOfPath } from '../../../core/lines';
import type { SourceMap } from '../../../core/sourcemap';
import type { EditorContext } from '../editor/context';
import { nodeViews } from '../editor/nodeviews';
import { createEditorState } from '../editor/setup';
import { setConditionView } from '../editor/conditions';
import { locatePreviews, setPreviews, type PreviewBuild } from '../editor/previews';
import { editingFor } from '../formats/editing';

interface Props {
  text: string;
  ctx: EditorContext;
  savedText: string; // build previews are keyed to the saved file's lines
  build: PreviewBuild | null;
  viewAs: string[] | null;
  line: number | null; // the source line to keep in view
  onPick: (line: number) => void; // a block was clicked: go to its source
}

const PARSE_DELAY_MS = 150;

export function LivePreview({ text, ctx, savedText, build, viewAs, line, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const parsed = useRef<{ doc: PMNode; map: SourceMap } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const first = loadDocument(text, ctx.config);
    parsed.current = first;
    const view = new EditorView(host.current!, {
      state: createEditorState(first.doc, editingFor(ctx.config).cells),
      editable: () => false,
      nodeViews: nodeViews(ctx),
      attributes: { class: 'prose', 'aria-label': 'Live preview', role: 'document' },
      // Read-only: nothing here changes the page.
      dispatchTransaction(tr) {
        if (!tr.docChanged) view.updateState(view.state.apply(tr));
      },
      handleClickOn(_view, _pos, node) {
        const entry = parsed.current?.map.get(node.attrs.sid);
        if (node.isBlock && entry) {
          onPickRef.current(entry.line);
          return true;
        }
        return false;
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render shortly after typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      const view = viewRef.current;
      if (!view) return;
      const next = loadDocument(text, ctx.config);
      parsed.current = next;
      view.updateState(createEditorState(next.doc, editingFor(ctx.config).cells));
      view.dispatch(setConditionView(view.state.tr, ctx.config.editor.conditions, viewAs));
      view.dispatch(setPreviews(view.state.tr, locatePreviews(view.state.doc, savedText, ctx.config, build)));
    }, PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, ctx, viewAs, savedText, build]);

  // Keep the block for `line` in view.
  useEffect(() => {
    const view = viewRef.current;
    const p = parsed.current;
    if (!view || !p || line === null) return;
    const path = blockPathAtLine(p.doc, p.map, line);
    const hit = path && positionOfPath(view.state.doc, path);
    const dom = hit ? (view.nodeDOM(hit.pos) as HTMLElement | null) : null;
    if (!dom?.scrollIntoView) return;
    dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    host.current?.querySelectorAll('.sync-current').forEach((el) => el.classList.remove('sync-current'));
    dom.classList.add('sync-current');
  }, [line, text]);

  return <div className="live-preview" ref={host} />;
}
