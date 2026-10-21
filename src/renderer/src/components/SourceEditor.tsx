// The advanced view's Markdown editor (CodeMirror), with MyST syntax picked out and
// Sphinx warnings on their lines.
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { imageFiles } from '../editor/images';
import { registerSourceView } from '../emacs';
import type { SphinxWarning } from '../../../shared/sphinx';

interface Props {
  text: string;
  onChange: (text: string) => void;
  problems: SphinxWarning[];
  // The line the writer is at (cursor or top of the scrolled view), for the preview.
  onLine: (line: number) => void;
  // Move the cursor to a line (from the preview or the problems list).
  goto: number | null;
  onGotoDone: () => void;
  // A picture pasted or dropped in: saved, and its path for `![](path)`.
  onImage: (file: File) => Promise<string>;
  onImageError: (message: string) => void;
}

// MyST syntax CommonMark highlighting doesn't know: {roles} and {directive} names,
// directive :options:, and (label)= targets.
function mystMarks(regexp: RegExp, cls: string) {
  const decorator = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = decorator.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
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
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-soft)', color: 'var(--fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-panels': { backgroundColor: 'var(--bg-soft)', color: 'var(--fg)' },
});

function diagnostics(state: EditorState, problems: SphinxWarning[]): Diagnostic[] {
  return problems
    .filter((w) => w.line)
    .map((w) => {
      const line = state.doc.line(Math.min(w.line!, state.doc.lines));
      return { from: line.from, to: line.to, severity: w.level === 'warning' ? 'warning' : 'error', message: w.message, source: w.type ? `Sphinx (${w.type})` : 'Sphinx' };
    });
}

export function SourceEditor({ text, onChange, problems, onLine, goto, onGotoDone, onImage, onImageError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onLine, onImage, onImageError });
  callbacks.current = { onChange, onLine, onImage, onImageError };
  // Pictures become ![](path) at `pos`, once saved.
  const addImages = async (view: EditorView, files: File[], pos: number) => {
    const refs: string[] = [];
    for (const file of files) {
      try {
        refs.push(`![](${await callbacks.current.onImage(file)})`);
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
          markdown(),
          syntaxHighlighting(highlight),
          mystMarks(/\{[\w:.-]+\}/g, 'cm-myst-name'),
          mystMarks(/^\s*:[\w.-]+:/g, 'cm-myst-option'),
          mystMarks(/^\([^()\s]+\)=\s*$/g, 'cm-myst-target'),
          lintGutter(),
          EditorView.lineWrapping,
          // Ctrl+/ switches views in this app; CodeMirror would toggle a comment.
          keymap.of([...defaultKeymap.filter((k) => k.key !== 'Mod-/'), ...historyKeymap, ...searchKeymap, indentWithTab]),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'true' }),
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
    view.focus();
    return () => {
      cancelAnimationFrame(frame);
      registerSourceView(null);
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
    if (view) view.dispatch(setDiagnostics(view.state, diagnostics(view.state, problems)));
  }, [problems]);

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
