// Formatting toolbar. Reads the editor state on every render; App re-renders on each change.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command, EditorState } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { schema } from '../../../core/schema';
import {
  blockKind, editLink, heading, inList, insertAsking, insertCaptionedTable, insertCard, insertCodeBlock, insertCodeDirective, insertDirective,
  insertDivider, insertFigure, insertImage, insertTarget, insertMath, insertProjectDirective, insertReference, markActive, paragraph, toggleCode, toggleEm, toggleList, toggleQuote, toggleStrike, toggleStrong,
} from '../editor/commands';
import type { EditorContext } from '../editor/context';
import { ADMONITIONS, CALLOUT_CHOICES } from '../editor/directives';
import { conditionColor, conditionKind, makeConditional } from '../editor/conditions';
import type { ConditionsDef } from '../../../core/editor-config';
import {
  addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, alignColumn, columnAlign, deleteColumn, deleteRow, deleteTable,
  insertTable, isInTable, mergeCells, splitCell,
} from '../editor/tables';

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

export function ViewAsMenu({ settings, viewAs, onViewAs }: { settings: ConditionsDef; viewAs: string[] | null; onViewAs: (v: string[] | null) => void }) {
  const capabilities = settings.capabilities;
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
              <span className="cond-swatch" style={{ background: conditionColor(c, settings) }} aria-hidden="true" />
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
  onMarkdown: () => void; // switch to the Markdown view
  previewAvailable: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onHistory: () => void; // the page's earlier versions
  viewAs: string[] | null;
  onViewAs: (capabilities: string[] | null) => void;
}

export function Toolbar({ view, ctx, onMarkdown, previewAvailable, previewOpen, onTogglePreview, onHistory, viewAs, onViewAs }: Props) {
  const conditions = ctx.config.editor.conditions;
  const state = view?.state;
  const run = (cmd: Command) => {
    if (!view) return;
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  const can = (cmd: Command) => !!state && cmd(state);
  const mark = (name: keyof typeof schema.marks) => !!state && markActive(state, schema.marks[name]);
  const kind = state ? blockKind(state) : 'paragraph';
  const list = state ? inList(state) : null;
  const disabled = !view;

  const Btn = ({ label, title, cmd, active = false, wide = false }: { label: string; title: string; cmd: Command; active?: boolean; wide?: boolean }) => (
    <button
      type="button"
      className={`tb${active ? ' active' : ''}${wide ? ' wide' : ''}`}
      title={title}
      // Symbol buttons are named by their tooltip; text buttons by their text.
      aria-label={wide ? undefined : title}
      aria-pressed={active}
      disabled={disabled || !can(cmd)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(cmd)}
    >
      {label}
    </button>
  );

  const inTable = !!state && isInTable(state);
  const spans = ctx.config.editor.tables;
  const align = state && inTable ? columnAlign(state) : null;
  return (
    <div className="toolbars">
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
      <InsertMenu disabled={disabled} ctx={ctx} state={state} run={run} />
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
          <ViewAsMenu settings={conditions} viewAs={viewAs} onViewAs={onViewAs} />
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
      <button type="button" className="tb wide" title="Edit the Markdown beside a live preview (Ctrl+/)" onClick={onMarkdown}>
        Markdown
      </button>
      <span className="tb-sep" />
      <button type="button" className="tb wide" title="Earlier versions of this page, and what changed" disabled={!view} onClick={onHistory}>
        History
      </button>
    </div>
    {inTable && (
      <div className="toolbar toolbar-table" role="toolbar" aria-label="Table">
        <span className="tb-heading">Table</span>
        <Btn label="Row above" title="Insert a row above" cmd={addRowBefore} wide />
        <Btn label="Row below" title="Insert a row below" cmd={addRowAfter} wide />
        <Btn label="Column left" title="Insert a column to the left" cmd={addColumnBefore} wide />
        <Btn label="Column right" title="Insert a column to the right" cmd={addColumnAfter} wide />
        <span className="tb-sep" />
        <Btn label="⇤" title="Align column left" cmd={alignColumn(align === 'left' ? null : 'left')} active={align === 'left'} />
        <Btn label="↔" title="Center column" cmd={alignColumn(align === 'center' ? null : 'center')} active={align === 'center'} />
        <Btn label="⇥" title="Align column right" cmd={alignColumn(align === 'right' ? null : 'right')} active={align === 'right'} />
        <span className="tb-sep" />
        {spans.colspan || spans.rowspan ? (
          <>
            <Btn label="Merge cells" title="Merge the selected cells (drag across cells to select them)" cmd={mergeCells} wide />
            <Btn label="Split cell" title="Split a merged cell" cmd={splitCell} wide />
          </>
        ) : (
          <span className="tb-hint" title="Set colspan_role and rowspan_role under [tables] in .mysteditor.toml to write merged cells the way your project's extension expects">
            Merging cells needs span roles in .mysteditor.toml
          </span>
        )}
        <span className="spacer" />
        <MenuButton
          label="Delete ▾"
          items={[
            ['Delete row', deleteRow],
            ['Delete column', deleteColumn],
            ['Delete table', deleteTable],
          ]}
          state={state!}
          run={run}
        />
      </div>
    )}
    </div>
  );
}

// A small dropdown of commands.
function MenuButton({ label, items, state, run }: { label: string; items: [string, Command][]; state: EditorState; run: (cmd: Command) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="tb wide" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu-items menu-right" role="menu">
          {items.map(([name, cmd]) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              disabled={!cmd(state)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                run(cmd);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VERSION_NOTES = [
  ['versionadded', 'New in version'],
  ['versionchanged', 'Changed in version'],
  ['deprecated', 'Deprecated'],
  ['versionremoved', 'Removed in version'],
] as const;
const FILE_HELP = 'Relative to this page.';
const LIST_TABLE = '* - Name\n  - Value\n* - first\n  - 1';

function InsertMenu({ disabled, ctx, state, run }: { disabled: boolean; ctx: EditorContext; state: EditorState | undefined; run: (cmd: Command) => void }) {
  const [open, setOpen] = useState(false);
  const projectDirectives = Object.entries(ctx.config.editor.directives).filter(([, d]) => d.insert);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  // It's wide: moved left as far as needed to stay in the window.
  const items = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = items.current;
    if (!open || !el) return;
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.left = `${-over}px`;
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
        <div className="menu-items insert-menu" role="menu" ref={items}>
          <div className="menu-column">
            <div className="menu-heading">Callouts</div>
            {CALLOUT_CHOICES.map((n) =>
              item(n === 'admonition' ? 'Callout with title' : ADMONITIONS[n].label, () => run(insertDirective(ctx, n, n === 'admonition' ? 'Title' : ''))),
            )}
            <div className="menu-heading">Version notes</div>
            {VERSION_NOTES.map(([name, label]) => item(`${label}…`, () => void insertAsking(ctx, run, { title: label, label: 'Version', placeholder: '2.1', insert: (v) => insertDirective(ctx, name, v) })))}
          </div>
          <div className="menu-column">
            <div className="menu-heading">Blocks</div>
            {item('Image…', () => insertImage(ctx, run))}
            {item('Figure…', () => insertFigure(ctx, run))}
            {item('Table', () => run(insertTable))}
            {item('Table with caption', () => run(insertCaptionedTable(ctx)))}
            {item('Code block', () => run(insertCodeBlock()))}
            {item('Equation', () => run(insertMath(ctx)))}
            {item('Dropdown', () => run(insertDirective(ctx, 'dropdown', 'Click to expand')))}
            {item('Divider', () => run(insertDivider))}
            <div className="menu-heading">Text</div>
            {item('Topic', () => run(insertDirective(ctx, 'topic', 'Title')))}
            {item('Sidebar', () => run(insertDirective(ctx, 'sidebar', 'Title')))}
            {item('Rubric…', () => void insertAsking(ctx, run, { title: 'Insert rubric', label: 'Heading', help: 'A heading that isn’t a section: not in the contents, nothing nested under it.', insert: (v) => insertCard(ctx, 'rubric', v) }))}
            {item('Epigraph', () => run(insertDirective(ctx, 'epigraph')))}
            {item('Pull quote', () => run(insertDirective(ctx, 'pull-quote')))}
            {item('Highlights', () => run(insertDirective(ctx, 'highlights')))}
          </div>
          <div className="menu-column">
            <div className="menu-heading">Structure</div>
            {item('Table of contents', () => run(insertCard(ctx, 'toctree', '', [['maxdepth', '2']])))}
            {item('Contents of this page', () => run(insertCard(ctx, 'contents', '', [['local', '']])))}
            {item('Glossary', () => run(insertCard(ctx, 'glossary', '', [], 'Term\n  What the term means.')))}
            {item('Include a file…', () => void insertAsking(ctx, run, { title: 'Include a file', label: 'File', placeholder: 'snippets/common.md', help: FILE_HELP, insert: (v) => insertCard(ctx, 'include', v) }))}
            {item('Code from a file…', () => void insertAsking(ctx, run, { title: 'Code from a file', label: 'File', placeholder: '../examples/hello.py', help: FILE_HELP, insert: (v) => insertCard(ctx, 'literalinclude', v) }))}
            {item('List table', () => run(insertCard(ctx, 'list-table', 'Caption', [['header-rows', '1']], LIST_TABLE)))}
            {item('CSV table', () => run(insertCard(ctx, 'csv-table', 'Caption', [['header-rows', '1']], 'Name, Value\nfirst, 1')))}
            {item('Raw HTML', () => run(insertCodeDirective(ctx, 'raw', 'html')))}
            {item('reStructuredText', () => run(insertCodeDirective(ctx, 'eval-rst')))}
            {projectDirectives.length > 0 && <div className="menu-heading">This project</div>}
            {projectDirectives.map(([name, def]) => item(def.label ?? name, () => run(insertProjectDirective(ctx, name, def))))}
            <div className="menu-heading">Inline</div>
            {item('Cross-reference…', () => insertReference(ctx, run))}
            {state && item('Link target…', () => insertTarget(ctx, state, run))}
          </div>
        </div>
      )}
    </div>
  );
}
