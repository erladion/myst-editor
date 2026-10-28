// What can be inserted in an AsciiDoc page.
import type { Command } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
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
  const before = `${id ? `[[${id}]]\n` : ''}${caption ? `.${caption}\n` : ''}`;
  const alt = values.alt.trim();
  const source = `${before}image::${values.src.trim()}[${/[,"\]]/.test(alt) ? `"${alt.replace(/"/g, '\\"')}"` : alt}]`;
  run(insertBlock(nodes.opaque_directive.create({ name: 'image', args: values.src.trim(), options: alt ? [['alt', alt]] : [], source })));
}

const FILE_HELP = 'Relative to this page.';

export function asciidocInserts(ctx: EditorContext): InsertItem[] {
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
    { id: 'page-contents', group: 'Structure', label: 'Contents of this page', command: insertMacro('toc', '') },
    { id: 'include', group: 'Structure', label: 'Include a file…', ask: asking('Include a file', 'File', (v) => insertMacro('include', v), { placeholder: 'partials/common.adoc', help: FILE_HELP }) },
    {
      id: 'code-include',
      group: 'Structure',
      label: 'Code from a file…',
      ask: asking('Code from a file', 'File', (v) => insertBlock(nodes.code_block.create({ name: 'source', lang: '', fence: '----' }, schema.text(`include::${v}[]`))), { placeholder: '../examples/hello.py', help: FILE_HELP }),
    },
    { id: 'raw-html', group: 'Structure', label: 'Raw HTML', command: insertBlock(nodes.raw_block.create({ kind: 'passthrough', source: '++++\n<p>HTML</p>\n++++' })) },
    { id: 'reference', group: 'Inline', label: 'Cross-reference…', palette: 'Cross-reference…', keys: 'Cross-reference', ask: (run, state) => void insertReference(ctx, run, state) },
    { id: 'anchor', group: 'Inline', label: 'Link target…', palette: 'Link target…', ask: (run, state) => state && void insertTarget(ctx, state, run) },
  ];
}
