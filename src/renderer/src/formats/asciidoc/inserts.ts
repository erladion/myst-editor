// What can be inserted in an AsciiDoc page.
import type { Command } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import type { EditorContext } from '../../editor/context';
import { IMAGE_HELP, insertAsking, insertBlock, insertImage, insertTarget, targetLabel, uniqueLabel } from '../../editor/commands';
import type { InsertItem } from '../editing';
import { ADMONITIONS } from './blocks';
import { insertReference } from './references';

const { nodes } = schema;

// A block of blocks (a note, an example, a sidebar). A note is written as a
// paragraph (NOTE: …) while it is one; the others between their delimiters.
function insertContainer(name: string, fence: string, args = '', options: [string, string][] = []): Command {
  return insertBlock(nodes.md_directive.create({ name, args, options, fence }, nodes.paragraph.create()), 2);
}

// A block macro (image::, include::, toc::) kept as written.
function insertMacro(name: string, target: string, attrs = '', before = ''): Command {
  const source = `${before}${name}::${target}[${attrs}]`;
  return insertBlock(nodes.opaque_directive.create({ name, args: target, options: [], source }));
}

async function insertFigure(ctx: EditorContext, run: (cmd: Command) => void) {
  const values = await ctx.ui.editFields({
    title: 'Insert figure',
    submit: 'Insert',
    fields: [
      { key: 'src', label: 'Image file', value: '', placeholder: 'images/diagram.png', help: IMAGE_HELP, browse: () => ctx.chooseImage() },
      { key: 'alt', label: 'Description', value: '', help: 'Read aloud by screen readers' },
      { key: 'caption', label: 'Caption', value: '' },
      { key: 'id', label: 'Name', value: '', placeholder: 'fig-architecture', help: 'To refer to it from other places (Insert → Cross-reference). Left empty: made from the caption.' },
    ],
  });
  if (!values?.src) return;
  const caption = values.caption.trim();
  const id = values.id.trim() || (caption ? uniqueLabel(ctx, `fig-${targetLabel(caption).slice(0, 40).replace(/-+$/, '')}`) : '');
  const alt = values.alt.trim();
  const options: [string, string][] = [...(id ? [['id', id] as [string, string]] : []), ...(alt ? [['alt', alt] as [string, string]] : [])];
  const figure = nodes.md_directive.create({ name: 'figure', args: values.src.trim(), options, fence: '' }, nodes.paragraph.create(null, caption ? schema.text(caption) : undefined));
  run(insertBlock(figure, 2));
}

// A table with its caption written above it (.Caption).
function insertCaptionedTable(): Command {
  const cell = (type: typeof nodes.table_cell, text = '') => type.create(null, nodes.paragraph.create(null, text ? schema.text(text) : undefined));
  const row = (type: typeof nodes.table_cell, texts: string[]) => nodes.table_row.create(null, texts.map((t) => cell(type, t)));
  return insertBlock(nodes.table.create({ header: '.Caption' }, [row(nodes.table_header, ['Column 1', 'Column 2']), row(nodes.table_cell, ['', ''])]), 4);
}

// A term and its description (Term:: What it means.), the cursor in the term.
function insertDefinitionList(): Command {
  const item = nodes.definition_item.create({ marker: '::' }, [nodes.definition_term.create(null, schema.text('Term')), nodes.definition_desc.create(null, nodes.paragraph.create(null, schema.text('What it means.')))]);
  return insertBlock(nodes.definition_list.create(null, item), 3);
}

const FILE_HELP = 'Relative to this page.';
const RESOURCE_HELP = 'A partial or example of this module (partial$name.adoc), or of another (module:partial$name.adoc); or a path relative to this page.';

export function asciidocInserts(ctx: EditorContext): InsertItem[] {
  // In an Antora component, included files are the module's partials and examples.
  const antora = ctx.config.format === 'asciidoc' && !!(ctx.config as AsciidocConfig).antora;
  const asking = (title: string, label: string, insert: (value: string) => Command, more: { placeholder?: string; help?: string } = {}) => (run: (cmd: Command) => void) =>
    void insertAsking(ctx, run, { title, label, insert, ...more });
  return [
    ...Object.entries(ADMONITIONS).map(([n, info]): InsertItem => ({
      id: `callout-${n}`,
      group: 'Callouts',
      label: info.label,
      palette: `${info.label} callout`,
      keys: n === 'note' ? 'Callout (note)' : undefined,
      command: insertContainer(n, ''),
    })),
    { id: 'image', group: 'Blocks', label: 'Image…', palette: 'Image…', ask: (run) => void insertImage(ctx, run) },
    { id: 'figure', group: 'Blocks', label: 'Figure…', palette: 'Figure…', keys: 'Figure', ask: (run) => void insertFigure(ctx, run) },
    // The Insert menu's grid, for the table's size.
    { id: 'table', group: 'Blocks', label: 'Table…', palette: 'Table…', keys: 'Table', ask: () => window.dispatchEvent(new CustomEvent('mysteditor-table-picker')) },
    { id: 'captioned-table', group: 'Blocks', label: 'Table with caption', palette: 'Table with caption', command: insertCaptionedTable() },
    { id: 'code-block', group: 'Blocks', label: 'Code block', palette: 'Code block', keys: 'Code block', command: insertBlock(nodes.code_block.create({ name: 'source', lang: '', fence: '----' })) },
    {
      id: 'equation',
      group: 'Blocks',
      label: 'Equation',
      palette: 'Equation',
      command: insertBlock(nodes.math_block.create({ directive: true, name: 'latexmath', fence: '++++' }, schema.text('E = mc^2'))),
    },
    { id: 'collapsible', group: 'Blocks', label: 'Dropdown', palette: 'Dropdown', command: insertContainer('example', '====', 'Click to expand', [['options', 'collapsible']]) },
    { id: 'divider', group: 'Blocks', label: 'Divider', palette: 'Divider', command: insertBlock(nodes.thematic_break.create({ markup: "'''" })) },
    { id: 'page-break', group: 'Blocks', label: 'Page break', command: insertBlock(nodes.raw_block.create({ kind: 'page-break', source: '<<<' })) },
    { id: 'example', group: 'Text', label: 'Example', command: insertContainer('example', '====') },
    { id: 'sidebar', group: 'Text', label: 'Sidebar', command: insertContainer('sidebar', '****') },
    { id: 'quote', group: 'Text', label: 'Quote', command: insertContainer('quote', '____') },
    { id: 'definition-list', group: 'Structure', label: 'Definition list', palette: 'Definition list', command: insertDefinitionList() },
    { id: 'page-contents', group: 'Structure', label: 'Contents of this page', command: insertMacro('toc', '') },
    { id: 'include', group: 'Structure', label: 'Include a file…', ask: asking('Include a file', 'File', (v) => insertMacro('include', v), antora ? { placeholder: 'partial$common.adoc', help: RESOURCE_HELP } : { placeholder: 'partials/common.adoc', help: FILE_HELP }) },
    {
      id: 'code-include',
      group: 'Structure',
      label: 'Code from a file…',
      ask: asking('Code from a file', 'File', (v) => insertBlock(nodes.code_block.create({ name: 'source', lang: '', fence: '----' }, schema.text(`include::${v}[]`))), antora ? { placeholder: 'example$hello.py', help: RESOURCE_HELP } : { placeholder: '../examples/hello.py', help: FILE_HELP }),
    },
    { id: 'raw-html', group: 'Structure', label: 'Raw HTML', command: insertBlock(nodes.raw_block.create({ kind: 'passthrough', source: '++++\n<p>HTML</p>\n++++' })) },
    { id: 'reference', group: 'Inline', label: 'Cross-reference…', palette: 'Cross-reference…', keys: 'Cross-reference', ask: (run, state) => void insertReference(ctx, run, state) },
    { id: 'anchor', group: 'Inline', label: 'Link target…', palette: 'Link target…', ask: (run, state) => state && void insertTarget(ctx, state, run) },
  ];
}
