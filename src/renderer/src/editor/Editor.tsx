// Mounts a ProseMirror view for one open page.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { BuildWarning } from '../../../shared/build';
import type { EditorContext } from './context';
import { nodeViews } from './nodeviews';
import { imageInput } from './images';
import { locateProblems, setProblems } from './problems';
import { setConditionView } from './conditions';
import { tableMenuCommand, tableMenuItems } from './tableMenu';
import { locatePreviews, setPreviews, type PreviewBuild } from './previews';
import { setAccept, setVale } from './vale';
import { setChangesBase } from './changes';
import type { Node as PMNode } from 'prosemirror-model';
import { locateAlerts } from '../../../core/vale';
import type { ValeAlert } from '../../../shared/vale';

interface Props {
  state: EditorState;
  ctx: EditorContext;
  onChange: (state: EditorState, docChanged: boolean) => void;
  viewRef: MutableRefObject<EditorView | null>;
  onView: (view: EditorView | null) => void;
  // Sphinx warnings for this page, located via the text as last saved.
  problems: BuildWarning[];
  savedText: string;
  // A source line to move the cursor to (e.g. from the problems list).
  reveal: number | null;
  onRevealed: () => void;
  // Capabilities to preview the page with ("View as"); null shows everything.
  viewAs: string[] | null;
  // The latest build of this page's project, for previews in cards.
  build: PreviewBuild | null;
  // Vale's alerts for the page, and the saved text they're about.
  vale: { text: string; alerts: ValeAlert[] } | null;
  changesBase: PMNode | null; // the page as committed, to mark what changed since; null: not shown
  // Accept a word Vale flags: into its vocabulary.
  onAcceptWord?: (word: string) => void;
}

// Remount (via `key`) when switching pages, so node views never carry state across files.
export function Editor({ state, ctx, onChange, viewRef, onView, problems, savedText, reveal, onRevealed, viewAs, build, vale, changesBase, onAcceptWord }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // States the view made itself (by editing): the page passes them back as `state`,
  // possibly from before the latest edits, and those must not be put back.
  const own = useRef(new WeakSet<EditorState>());

  useEffect(() => {
    const view: EditorView = new EditorView(host.current!, {
      state,
      nodeViews: nodeViews(ctx),
      ...imageInput(ctx),
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Page content' },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        own.current.add(next);
        view.updateState(next);
        onChangeRef.current(next, tr.docChanged);
      },
    });
    viewRef.current = view;
    onView(view);
    view.focus();
    // Right-click in a table: its rows and columns in the context menu.
    const onContextMenu = (e: MouseEvent) => {
      const items = tableMenuItems(view, ctxRef.current, e);
      if (items.length) window.myst.tableContext(items);
    };
    view.dom.addEventListener('contextmenu', onContextMenu);
    const offTableMenu = window.myst.onTableMenu((id) => tableMenuCommand(view, id));
    return () => {
      view.dom.removeEventListener('contextmenu', onContextMenu);
      offTableMenu();
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
        onView(null);
      }
    };
    // The view owns its state from here on; see the effect below for outside changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // State replaced from outside (e.g. reloaded from disk or edited as source). It
  // comes without what the effects below add (problems, previews, Vale, …), so they
  // run again. A state the view made itself is never one of those: by the time this
  // runs, the writer may have typed on.
  const [replaced, setReplaced] = useState(0);
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state !== state && !own.current.has(state)) {
      view.updateState(state);
      setReplaced((n) => n + 1);
    }
  }, [state, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setPreviews(view.state.tr, locatePreviews(view.state.doc, savedText, ctx.config, build)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, savedText, ctx, viewRef, replaced]);

  const conditions = ctx.config.editor.conditions;
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setConditionView(view.state.tr, conditions, viewAs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions, viewAs, viewRef, replaced]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setProblems(view.state.tr, locateProblems(view.state.doc, savedText, ctx.config, problems)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, savedText, ctx, viewRef, replaced]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setVale(view.state.tr, vale ? locateAlerts(view.state.doc, vale.text, ctx.config, vale.alerts) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vale, ctx, viewRef, replaced]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setChangesBase(view.state.tr, changesBase));
  }, [changesBase, viewRef, replaced]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    setAccept(view, onAcceptWord ?? null);
    return () => setAccept(view, null);
  }, [onAcceptWord, viewRef]);

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
