// The advanced view's source editor (CodeMirror), with the format's syntax picked out
// and Sphinx warnings on their lines.
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { forEachDiagnostic, lintGutter, openLintPanel, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { imageFiles } from '../editor/images';
import { registerSourceView } from '../emacs';
import type { SphinxWarning } from '../../../shared/sphinx';
import type { ValeAlert } from '../../../shared/vale';
import { columnOffset } from '../../../core/vale';
import type { SourceSyntax } from '../formats/editing';

interface Props {
  text: string;
  onChange: (text: string) => void;
  problems: SphinxWarning[];
  vale: ValeAlert[]; // for the text as last saved
  onAcceptWord?: (word: string) => void;
  // The line the writer is at (cursor or top of the scrolled view), for the preview.
  onLine: (line: number) => void;
  // Move the cursor to a line (from the preview or the problems list).
  goto: number | null;
  onGotoDone: () => void;
  // A picture pasted or dropped in: saved, and its path (see SourceSyntax.image).
  onImage: (file: File) => Promise<string>;
  onImageError: (message: string) => void;
  syntax: SourceSyntax; // the page's format's
}

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', fontSize: '1.25em' },
  { tag: tags.heading2, fontWeight: '700', fontSize: '1.12em' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, color: 'var(--tone-tip)' },
  { tag: [tags.comment, tags.blockComment], color: 'var(--cond)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--fg-muted)' },
  { tag: tags.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '16px 0 120px', caretColor: 'var(--fg)' },
  // The cursor drawSelection draws (CodeMirror's own is black, unseen in dark mode).
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-soft)', color: 'var(--fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-panels': { backgroundColor: 'var(--bg-soft)', color: 'var(--fg)' },
  // Tooltips (Vale's and Sphinx's remarks, completions) and the find panel's fields,
  // in the app's colours rather than CodeMirror's light ones.
  '.cm-tooltip': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.16)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
  },
  '.cm-tooltip-lint': { padding: '2px 0' },
  '.cm-diagnostic': { padding: '6px 10px', borderLeftWidth: '3px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--tone-danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--tone-warning)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--accent)' },
  '.cm-diagnosticSource': { color: 'var(--fg-muted)', opacity: '1', fontSize: '11px' },
  '.cm-diagnosticAction': {
    backgroundColor: 'var(--bg-soft)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '1px 8px',
    marginLeft: '0',
    marginRight: '6px',
    font: 'inherit',
  },
  '.cm-diagnosticAction:hover': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, var(--bg))' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
  '.cm-textfield': { backgroundColor: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: '5px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: '5px' },
  '.cm-panel.cm-search label': { color: 'var(--fg)' },
});

function diagnostics(state: EditorState, problems: SphinxWarning[], vale: ValeAlert[], accept?: (word: string) => void): Diagnostic[] {
  const sphinx = problems
    .filter((w) => w.line)
    .map((w): Diagnostic => {
      const line = state.doc.line(Math.min(w.line!, state.doc.lines));
      return { from: line.from, to: line.to, severity: w.level === 'warning' ? 'warning' : 'error', message: w.message, source: w.type ? `Sphinx (${w.type})` : 'Sphinx' };
    });
  // Vale's, on their words, with its corrections as actions.
  const style = vale.flatMap((a): Diagnostic[] => {
    if (a.Line > state.doc.lines) return [];
    const line = state.doc.line(a.Line);
    const from = line.from + columnOffset(line.text, a.Span[0]);
    const to = line.from + columnOffset(line.text, a.Span[1] + 1);
    if (state.doc.sliceString(from, to) !== a.Match) return []; // edited since
    return [
      {
        from,
        to,
        severity: a.Severity === 'suggestion' ? 'info' : a.Severity,
        message: a.Message,
        source: `Vale (${a.Check})`,
        actions: [
          ...a.Suggestions.map((s) => ({
            name: s || 'Remove',
            apply: (view: EditorView, f: number, t: number) => view.dispatch({ changes: { from: f, to: t, insert: s } }),
          })),
          ...(accept ? [{ name: `Accept “${a.Match}”`, apply: () => accept(a.Match) }] : []),
        ],
      },
    ];
  });
  return [...sphinx, ...style];
}

// The Markdown view, while it's open: for the status bar's Vale chip.
let openView: EditorView | null = null;

// Go to Vale's next remark after the cursor (round to the first), and show it in the
// problems panel, with its corrections.
export function nextValeRemark(): boolean {
  const view = openView;
  if (!view) return false;
  const remarks: { from: number; to: number }[] = [];
  forEachDiagnostic(view.state, (d, from, to) => {
    if (d.source?.startsWith('Vale')) remarks.push({ from, to });
  });
  if (!remarks.length) return false;
  const head = view.state.selection.main.head;
  const next = remarks.find((r) => r.from > head) ?? remarks[0];
  view.dispatch({ selection: { anchor: next.from, head: next.to }, scrollIntoView: true });
  view.focus();
  openLintPanel(view);
  return true;
}

export function SourceEditor({ text, onChange, problems, vale, onAcceptWord, onLine, goto, onGotoDone, onImage, onImageError, syntax }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onLine, onImage, onImageError });
  callbacks.current = { onChange, onLine, onImage, onImageError };
  // Pictures go in at `pos`, once saved.
  const addImages = async (view: EditorView, files: File[], pos: number) => {
    const refs: string[] = [];
    for (const file of files) {
      try {
        refs.push(syntax.image(await callbacks.current.onImage(file)));
      } catch (e) {
        callbacks.current.onImageError(`Couldn’t add ${file.name || 'the image'}: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
      }
    }
    if (refs.length) view.dispatch({ changes: { from: pos, insert: refs.join(' ') }, selection: { anchor: pos + refs.join(' ').length } });
  };

  useEffect(() => {
    let frame = 0;
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          search({ top: true }),
          highlightSelectionMatches(),
          ...syntax.extensions(),
          syntaxHighlighting(highlight),
          lintGutter(),
          EditorView.lineWrapping,
          // Ctrl+/ switches views in this app; CodeMirror would toggle a comment.
          keymap.of([...defaultKeymap.filter((k) => k.key !== 'Mod-/'), ...historyKeymap, ...searchKeymap, indentWithTab]),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': `${syntax.label} source`, spellcheck: 'true' }),
          EditorView.domEventHandlers({
            paste(event, view) {
              const files = imageFiles(event.clipboardData);
              if (!files.length || event.clipboardData?.getData('text/plain')) return false;
              event.preventDefault();
              void addImages(view, files, view.state.selection.main.head);
              return true;
            },
            drop(event, view) {
              const files = imageFiles(event.dataTransfer);
              if (!files.length) return false;
              event.preventDefault();
              void addImages(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.selectionSet && u.view.hasFocus) callbacks.current.onLine(u.state.doc.lineAt(u.state.selection.main.head).number);
          }),
        ],
      }),
    });
    // Scrolling: report the line at the top of the view.
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8);
        callbacks.current.onLine(view.state.doc.lineAt(block.from).number);
      });
    };
    view.scrollDOM.addEventListener('scroll', onScroll);
    viewRef.current = view;
    registerSourceView(view);
    openView = view;
    view.focus();
    return () => {
      cancelAnimationFrame(frame);
      registerSourceView(null);
      if (openView === view) openView = null;
      view.destroy();
      viewRef.current = null;
    };
    // The view owns the text from here on; see below for changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text replaced from outside (reloaded from disk): swap the document in.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === text) return;
    const head = Math.min(view.state.selection.main.head, text.length);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
  }, [text]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, diagnostics(view.state, problems, vale, onAcceptWord)));
  }, [problems, vale, onAcceptWord]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || goto === null) return;
    const line = view.state.doc.line(Math.max(1, Math.min(goto, view.state.doc.lines)));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }) });
    view.focus();
    onGotoDone();
  }, [goto, onGotoDone]);

  return <div className="source-editor" ref={host} />;
}
