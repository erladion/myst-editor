// Formatting toolbar. Reads the editor state on every render; App re-renders on each change.
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { schema } from '../../../core/schema';
import {
  blockKind, editLink, heading, inList, insertCodeBlock, insertDirective, insertDivider, insertFigure, insertMath,
  insertProjectDirective, insertReference, markActive, paragraph, toggleCode, toggleEm, toggleList, toggleQuote, toggleStrike, toggleStrong,
} from '../editor/commands';
import type { EditorContext } from '../editor/context';
import { ADMONITIONS } from '../editor/directives';
import { conditionKind, makeConditional } from '../editor/conditions';

// Ask for the condition, then wrap the selection (inline) or the blocks (block).
async function makeConditionalInteractive(ctx: EditorContext, view: EditorView) {
  const settings = ctx.config.editor.conditions;
  if (!settings) return;
  const kind = conditionKind(view.state);
  if (kind.inline && !kind.ok) return ctx.ui.notify(kind.reason!);
  const result = await ctx.ui.editCondition({ expr: '', settings, allowRemove: false });
  if (!result || 'remove' in result) return;
  makeConditional(settings, result.expr)(view.state, view.dispatch);
  view.focus();
}

function ViewAsMenu({ capabilities, viewAs, onViewAs }: { capabilities: string[]; viewAs: string[] | null; onViewAs: (v: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (c: string) => {
    const set = viewAs ?? [];
    onViewAs(set.includes(c) ? set.filter((x) => x !== c) : [...set, c]);
  };
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`tb wide${viewAs ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={viewAs ? `Viewing as ${viewAs.length ? viewAs.join(', ') : 'no capabilities'}` : 'Dim what a build with only some capabilities wouldn’t show'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {viewAs ? `View as (${viewAs.length})` : 'View as ▾'}
      </button>
      {open && (
        <div className="menu-items view-as" role="menu">
          <label className="check">
            <input type="radio" checked={viewAs === null} onChange={() => onViewAs(null)} />
            Everything
          </label>
          <div className="menu-heading">Only with these capabilities</div>
          {capabilities.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={!!viewAs?.includes(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
          {!capabilities.length && <small className="muted pad">No capabilities file is set in .mysteditor.toml.</small>}
        </div>
      )}
    </div>
  );
}

interface Props {
  view: EditorView | null;
  ctx: EditorContext;
  sourceMode: boolean;
  onToggleSource: () => void;
  previewAvailable: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  viewAs: string[] | null;
  onViewAs: (capabilities: string[] | null) => void;
}

export function Toolbar({ view, ctx, sourceMode, onToggleSource, previewAvailable, previewOpen, onTogglePreview, viewAs, onViewAs }: Props) {
  const conditions = ctx.config.editor.conditions;
  const state = view?.state;
  const run = (cmd: Command) => {
    if (!view) return;
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  const can = (cmd: Command) => !!state && !sourceMode && cmd(state);
  const mark = (name: keyof typeof schema.marks) => !!state && markActive(state, schema.marks[name]);
  const kind = state ? blockKind(state) : 'paragraph';
  const list = state ? inList(state) : null;
  const disabled = !view || sourceMode;

  const Btn = ({ label, title, cmd, active = false, wide = false }: { label: string; title: string; cmd: Command; active?: boolean; wide?: boolean }) => (
    <button
      type="button"
      className={`tb${active ? ' active' : ''}${wide ? ' wide' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled || !can(cmd)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(cmd)}
    >
      {label}
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="↶" title="Undo (Ctrl+Z)" cmd={undo} />
      <Btn label="↷" title="Redo (Ctrl+Shift+Z)" cmd={redo} />
      <span className="tb-sep" />
      <select
        className="tb-select"
        aria-label="Text style"
        disabled={disabled}
        value={['paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4'].includes(kind) ? kind : ''}
        onChange={(e) => {
          const v = e.target.value;
          run(v === 'paragraph' ? paragraph : heading(Number(v.split('-')[1])));
        }}
      >
        <option value="paragraph">Normal text</option>
        <option value="heading-1">Title</option>
        <option value="heading-2">Heading</option>
        <option value="heading-3">Subheading</option>
        <option value="heading-4">Small heading</option>
        <option value="" disabled hidden>
          —
        </option>
      </select>
      <span className="tb-sep" />
      <Btn label="B" title="Bold (Ctrl+B)" cmd={toggleStrong} active={mark('strong')} />
      <Btn label="I" title="Italic (Ctrl+I)" cmd={toggleEm} active={mark('em')} />
      <Btn label="S" title="Strikethrough (Ctrl+Shift+X)" cmd={toggleStrike} active={mark('strike')} />
      <Btn label="</>" title="Code (Ctrl+E)" cmd={toggleCode} active={mark('code')} wide />
      <button
        type="button"
        className={`tb${mark('link') ? ' active' : ''}`}
        title="Link (Ctrl+K)"
        aria-label="Link"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => state && editLink(ctx, state, run)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.9-.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <span className="tb-sep" />
      <Btn label="•" title="Bulleted list" cmd={toggleList(schema.nodes.bullet_list)} active={list === 'bullet_list'} />
      <Btn label="1." title="Numbered list" cmd={toggleList(schema.nodes.ordered_list)} active={list === 'ordered_list'} />
      <Btn label="❝" title="Quote" cmd={toggleQuote} />
      <span className="tb-sep" />
      <InsertMenu disabled={disabled} ctx={ctx} run={run} />
      {conditions && (
        <>
          <span className="tb-sep" />
          <button
            type="button"
            className="tb wide"
            title="Show the selection, or the current block, only for some capabilities"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view && void makeConditionalInteractive(ctx, view)}
          >
            Condition…
          </button>
          <ViewAsMenu capabilities={conditions.capabilities} viewAs={viewAs} onViewAs={onViewAs} />
        </>
      )}
      <span className="spacer" />
      <button
        type="button"
        className={`tb wide${previewOpen ? ' active' : ''}`}
        title={previewAvailable ? 'Show the page as Sphinx builds it' : 'The preview is available once Sphinx has built the project'}
        aria-pressed={previewOpen}
        disabled={!previewAvailable}
        onClick={onTogglePreview}
      >
        Preview
      </button>
      <button type="button" className={`tb wide${sourceMode ? ' active' : ''}`} title="Show the Markdown source (Ctrl+/)" aria-pressed={sourceMode} onClick={onToggleSource}>
        {sourceMode ? 'Back to editing' : 'Markdown'}
      </button>
    </div>
  );
}

function InsertMenu({ disabled, ctx, run }: { disabled: boolean; ctx: EditorContext; run: (cmd: Command) => void }) {
  const [open, setOpen] = useState(false);
  const projectDirectives = Object.entries(ctx.config.editor.directives).filter(([, d]) => d.insert);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const item = (label: string, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="tb wide" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        Insert ▾
      </button>
      {open && (
        <div className="menu-items" role="menu">
          <div className="menu-heading">Callouts</div>
          {['note', 'tip', 'important', 'warning', 'danger', 'seealso'].map((n) => item(ADMONITIONS[n].label, () => run(insertDirective(ctx, n))))}
          <div className="menu-heading">Blocks</div>
          {item('Figure…', () => insertFigure(ctx, run))}
          {item('Code block', () => run(insertCodeBlock()))}
          {item('Equation', () => run(insertMath(ctx)))}
          {item('Dropdown', () => run(insertDirective(ctx, 'dropdown', 'Click to expand')))}
          {item('Divider', () => run(insertDivider))}
          {projectDirectives.length > 0 && <div className="menu-heading">This project</div>}
          {projectDirectives.map(([name, def]) => item(def.label ?? name, () => run(insertProjectDirective(ctx, name, def))))}
          <div className="menu-heading">Inline</div>
          {item('Cross-reference…', () => insertReference(ctx, run))}
        </div>
      )}
    </div>
  );
}
