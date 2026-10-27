// What can be inserted in a MyST page, and the directives that does it with.
import type { Command } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import { newDirectiveFence } from '../../../../core/project-config';
import { renderHeader } from '../../../../core/directive';
import type { DirectiveDef } from '../../../../core/editor-config';
import type { EditorContext } from '../../editor/context';
import { IMAGE_HELP, insertAsking, insertBlock, insertCodeBlock, insertDivider, insertImage, insertTarget, targetLabel, uniqueLabel } from '../../editor/commands';
import type { InsertItem } from '../editing';
import { ADMONITIONS, CALLOUT_CHOICES } from './directives';
import { insertReference } from './references';

const { nodes } = schema;

export function insertDirective(ctx: EditorContext, name: string, args = ''): Command {
  const node = nodes.md_directive.create({ name, args, fence: newDirectiveFence(ctx.config) }, nodes.paragraph.create());
  return insertBlock(node, 2);
}

// A directive declared in .mysteditor.toml, with its options' defaults.
export function insertProjectDirective(ctx: EditorContext, name: string, def: DirectiveDef): Command {
  const fence = newDirectiveFence(ctx.config);
  const options = Object.entries(def.options)
    .filter(([, o]) => o.default !== undefined)
    .map(([k, o]) => [k, o.default!] as [string, string]);
  if (def.body === 'markdown') {
    return insertBlock(nodes.md_directive.create({ name, fence, options }, nodes.paragraph.create()), 2);
  }
  if (def.body === 'text') {
    return insertBlock(nodes.code_block.create({ name, directive: true, fence, options }));
  }
  const header = renderHeader(fence, name, '', options).replace(/\n$/, '');
  return insertBlock(nodes.opaque_directive.create({ name, options, source: `${header}\n${fence}` }));
}

// A directive shown as a card, its source edited as Markdown (a toctree, an include…).
export function insertCard(ctx: EditorContext, name: string, args = '', options: [string, string][] = [], body = ''): Command {
  const fence = newDirectiveFence(ctx.config);
  const header = renderHeader(fence, name, args, options);
  const source = body ? `${header}\n${body}\n${fence}` : `${header.replace(/\n$/, '')}\n${fence}`;
  return insertBlock(nodes.opaque_directive.create({ name, args, options, source }));
}

// A directive whose body is literal text (raw HTML, reStructuredText), edited as code.
export function insertCodeDirective(ctx: EditorContext, name: string, args = ''): Command {
  return insertBlock(nodes.code_block.create({ name, args, lang: args, directive: true, fence: newDirectiveFence(ctx.config) }));
}

// A table with a caption: the table directive around a Markdown table.
export function insertCaptionedTable(ctx: EditorContext): Command {
  const cell = (type: typeof nodes.table_cell, text = '') => type.create(null, nodes.paragraph.create(null, text ? schema.text(text) : undefined));
  const row = (type: typeof nodes.table_cell, texts: string[]) => nodes.table_row.create(null, texts.map((t) => cell(type, t)));
  const table = nodes.table.create({ pretty: true, ruleSpaces: true }, [row(nodes.table_header, ['Column 1', 'Column 2']), row(nodes.table_cell, ['', ''])]);
  return insertBlock(nodes.md_directive.create({ name: 'table', args: 'Caption', fence: newDirectiveFence(ctx.config) }, table), 5);
}

export function insertMath(ctx: EditorContext): Command {
  const dollar = ctx.config.extensions.includes('dollarmath') || ctx.config.extensions.includes('amsmath');
  const attrs = dollar ? {} : { directive: true, name: 'math', fence: newDirectiveFence(ctx.config) };
  return insertBlock(nodes.math_block.create(attrs, schema.text('E = mc^2')));
}

export async function insertFigure(ctx: EditorContext, run: (cmd: Command) => void) {
  const values = await ctx.ui.editFields({
    title: 'Insert figure',
    submit: 'Insert',
    fields: [
      { key: 'src', label: 'Image file', value: '', placeholder: 'images/diagram.png', help: IMAGE_HELP, browse: () => ctx.chooseImage() },
      { key: 'alt', label: 'Description', value: '', help: 'Read aloud by screen readers' },
      { key: 'caption', label: 'Caption', value: '' },
      { key: 'name', label: 'Name', value: '', placeholder: 'fig-architecture', help: 'To refer to it from other places (Insert → Cross-reference). Left empty: made from the caption.' },
    ],
  });
  if (!values?.src) return;
  const options: [string, string][] = values.alt ? [['alt', values.alt]] : [];
  const name = values.name.trim() || (values.caption.trim() ? uniqueLabel(ctx, `fig-${targetLabel(values.caption).slice(0, 40).replace(/-+$/, '')}`) : '');
  if (name) options.push(['name', name]);
  const caption = values.caption ? [nodes.paragraph.create(null, schema.text(values.caption))] : [nodes.paragraph.create()];
  run(insertBlock(nodes.md_directive.create({ name: 'figure', args: values.src, options, fence: newDirectiveFence(ctx.config) }, caption), 2));
}

const VERSION_NOTES = [
  ['version-added', 'versionadded', 'New in version'],
  ['version-changed', 'versionchanged', 'Changed in version'],
  ['deprecated', 'deprecated', 'Deprecated'],
  ['version-removed', 'versionremoved', 'Removed in version'],
] as const;
const FILE_HELP = 'Relative to this page.';
const LIST_TABLE = '* - Name\n  - Value\n* - first\n  - 1';

export function mystInserts(ctx: EditorContext): InsertItem[] {
  const asking = (title: string, label: string, insert: (value: string) => Command, more: { placeholder?: string; help?: string } = {}) => (run: (cmd: Command) => void) =>
    void insertAsking(ctx, run, { title, label, insert, ...more });
  const projectDirectives = Object.entries(ctx.config.editor.directives).filter(([, d]) => d.insert);
  return [
    ...CALLOUT_CHOICES.map((n): InsertItem => {
      const titled = n === 'admonition';
      return {
        id: titled ? 'callout-titled' : `callout-${n}`,
        group: 'Callouts',
        label: titled ? 'Callout with title' : ADMONITIONS[n].label,
        palette: titled ? 'Callout with title' : `${ADMONITIONS[n].label} callout`,
        keys: n === 'note' ? 'Callout (note)' : undefined,
        command: insertDirective(ctx, n, titled ? 'Title' : ''),
      };
    }),
    ...VERSION_NOTES.map(([id, name, label]): InsertItem => ({
      id,
      group: 'Version notes',
      label: `${label}…`,
      ask: asking(label, 'Version', (v) => insertDirective(ctx, name, v), { placeholder: '2.1' }),
    })),
    { id: 'image', group: 'Blocks', label: 'Image…', palette: 'Image…', ask: (run) => void insertImage(ctx, run) },
    { id: 'figure', group: 'Blocks', label: 'Figure…', palette: 'Figure…', keys: 'Figure', ask: (run) => void insertFigure(ctx, run) },
    // The Insert menu's grid, for the table's size.
    { id: 'table', group: 'Blocks', label: 'Table…', palette: 'Table…', keys: 'Table', ask: () => window.dispatchEvent(new CustomEvent('mysteditor-table-picker')) },
    { id: 'captioned-table', group: 'Blocks', label: 'Table with caption', palette: 'Table with caption', command: insertCaptionedTable(ctx) },
    { id: 'code-block', group: 'Blocks', label: 'Code block', palette: 'Code block', keys: 'Code block', command: insertCodeBlock() },
    { id: 'equation', group: 'Blocks', label: 'Equation', palette: 'Equation', command: insertMath(ctx) },
    { id: 'collapsible', group: 'Blocks', label: 'Dropdown', palette: 'Dropdown', command: insertDirective(ctx, 'dropdown', 'Click to expand') },
    { id: 'divider', group: 'Blocks', label: 'Divider', palette: 'Divider', command: insertDivider },
    { id: 'topic', group: 'Text', label: 'Topic', command: insertDirective(ctx, 'topic', 'Title') },
    { id: 'sidebar', group: 'Text', label: 'Sidebar', command: insertDirective(ctx, 'sidebar', 'Title') },
    {
      id: 'rubric',
      group: 'Text',
      label: 'Rubric…',
      ask: asking('Insert rubric', 'Heading', (v) => insertCard(ctx, 'rubric', v), { help: 'A heading that isn’t a section: not in the contents, nothing nested under it.' }),
    },
    { id: 'epigraph', group: 'Text', label: 'Epigraph', command: insertDirective(ctx, 'epigraph') },
    { id: 'pull-quote', group: 'Text', label: 'Pull quote', command: insertDirective(ctx, 'pull-quote') },
    { id: 'highlights', group: 'Text', label: 'Highlights', command: insertDirective(ctx, 'highlights') },
    { id: 'contents', group: 'Structure', label: 'Table of contents', palette: 'Table of contents', command: insertCard(ctx, 'toctree', '', [['maxdepth', '2']]) },
    { id: 'page-contents', group: 'Structure', label: 'Contents of this page', command: insertCard(ctx, 'contents', '', [['local', '']]) },
    { id: 'glossary', group: 'Structure', label: 'Glossary', command: insertCard(ctx, 'glossary', '', [], 'Term\n  What the term means.') },
    { id: 'include', group: 'Structure', label: 'Include a file…', ask: asking('Include a file', 'File', (v) => insertCard(ctx, 'include', v), { placeholder: 'snippets/common.md', help: FILE_HELP }) },
    {
      id: 'code-include',
      group: 'Structure',
      label: 'Code from a file…',
      ask: asking('Code from a file', 'File', (v) => insertCard(ctx, 'literalinclude', v), { placeholder: '../examples/hello.py', help: FILE_HELP }),
    },
    { id: 'list-table', group: 'Structure', label: 'List table', command: insertCard(ctx, 'list-table', 'Caption', [['header-rows', '1']], LIST_TABLE) },
    { id: 'csv-table', group: 'Structure', label: 'CSV table', command: insertCard(ctx, 'csv-table', 'Caption', [['header-rows', '1']], 'Name, Value\nfirst, 1') },
    { id: 'raw-html', group: 'Structure', label: 'Raw HTML', command: insertCodeDirective(ctx, 'raw', 'html') },
    { id: 'rst', group: 'Structure', label: 'reStructuredText', command: insertCodeDirective(ctx, 'eval-rst') },
    ...projectDirectives.map(([name, def]): InsertItem => ({ id: `project-${name}`, group: 'This project', label: def.label ?? name, command: insertProjectDirective(ctx, name, def) })),
    { id: 'reference', group: 'Inline', label: 'Cross-reference…', palette: 'Cross-reference…', keys: 'Cross-reference', ask: (run, state) => void insertReference(ctx, run, state) },
    { id: 'anchor', group: 'Inline', label: 'Link target…', palette: 'Link target…', ask: (run, state) => state && void insertTarget(ctx, state, run) },
  ];
}
