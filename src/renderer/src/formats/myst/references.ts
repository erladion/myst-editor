// Sphinx's cross-references in a MyST page: the dialog that inserts a role, offering
// the project's sections, figures, tables, images, anchors, pages and terms.
import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import { mystConfig } from '../../../../core/project-config';
import type { EditorContext } from '../../editor/context';
import { targetLabel } from '../../editor/commands';

const { nodes } = schema;

// What on a page can be referred to: figures, captioned tables and images, with the
// name each has (a figure's or table's :name:, the link target before an image's
// paragraph). In the page's order: `index` finds one again in the page as it is then.
interface Target {
  kind: 'figure' | 'table' | 'image';
  index: number;
  pos: number; // the figure or table; for an image, where its paragraph starts (a new target goes there)
  label: string | null;
  description: string;
  captioned: boolean; // Sphinx shows its caption as the link's text
}

const slug = (text: string) => targetLabel(text).slice(0, 40).replace(/-+$/, '');
const fileName = (src: string) => src.split('/').pop()!.replace(/\.\w+$/, '');

function docTargets(doc: PMNode): Target[] {
  const out: Target[] = [];
  doc.descendants((node, pos) => {
    if (node.type === nodes.md_directive && (node.attrs.name === 'figure' || node.attrs.name === 'table')) {
      const figure = node.attrs.name === 'figure';
      const label = (node.attrs.options as [string, string][]).find(([k]) => k === 'name')?.[1] || null;
      const caption = figure ? (node.firstChild?.textContent.trim() ?? '') : String(node.attrs.args).trim();
      out.push({ kind: figure ? 'figure' : 'table', index: out.length, pos, label, description: caption || (figure ? fileName(String(node.attrs.args)) : 'Table'), captioned: !!caption });
      return true;
    }
    if (node.type !== nodes.image) return true;
    const $pos = doc.resolve(pos);
    const depth = $pos.depth; // the paragraph's
    const index = $pos.index(depth - 1);
    const before = index > 0 ? $pos.node(depth - 1).child(index - 1) : null;
    const label = before?.type === nodes.target ? (before.attrs.label as string) : null;
    out.push({ kind: 'image', index: out.length, pos: $pos.before(depth), label, description: String(node.attrs.alt || fileName(String(node.attrs.src))), captioned: false });
    return false;
  });
  return out;
}

// A page's link targets ("anchors"), with what follows each, and whether Sphinx gives
// a link to it a title of its own (a heading's, a figure's or table's caption): one
// before a paragraph has none, so a link needs words of its own. Sphinx's build lists
// only those with titles, so these come from the pages.
interface Anchor {
  label: string;
  follows: string; // the start of the block after it
  titled: boolean;
}

function docAnchors(doc: PMNode): Anchor[] {
  const out: Anchor[] = [];
  doc.descendants((node, _pos, parent, index) => {
    if (node.type !== nodes.target) return !node.isTextblock;
    const next = parent?.maybeChild(index + 1) ?? null;
    const caption = next?.type === nodes.md_directive && (next.attrs.name === 'figure' ? next.firstChild?.textContent.trim() : next.attrs.name === 'table' ? String(next.attrs.args).trim() : '');
    const text = (next?.textContent ?? '').replace(/\s+/g, ' ').trim();
    out.push({ label: node.attrs.label, follows: text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, '')}…` : text, titled: next?.type === nodes.heading || !!caption });
    return false;
  });
  return out;
}

// Link text from an anchor's name: "before-you-start" → "before you start".
const anchorWords = (label: string) => label.replace(/[-_.]+/g, ' ').trim();

// The labels a document uses: link targets, and figures' and tables' names.
function docLabels(doc: PMNode, into: Set<string>) {
  doc.descendants((node) => {
    if (node.type === nodes.target) into.add(node.attrs.label);
    const name = node.type === nodes.md_directive ? (node.attrs.options as [string, string][]).find(([k]) => k === 'name')?.[1] : undefined;
    if (name) into.add(name);
  });
}

// The step naming a target: a link target before an image, a :name: for the rest.
function nameIt(tr: Transaction, t: Target, name: string): Transaction {
  if (t.kind === 'image') return tr.insert(t.pos, nodes.target.create({ label: name }));
  const node = tr.doc.nodeAt(t.pos)!;
  return tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, options: [...(node.attrs.options as [string, string][]), ['name', name]] });
}

const KIND_NAMES = { figure: 'Figure', table: 'Table', image: 'Image' };

export async function insertReference(ctx: EditorContext, run: (cmd: Command) => void, state?: EditorState) {
  // Figures, tables and images: this page's, then the project's other pages'.
  const pages = state ? [{ path: null as string | null, title: '', doc: state.doc }, ...(await ctx.otherPages())] : [];
  const taken = new Set(ctx.suggest('ref').map((s) => s.value));
  for (const p of pages) docLabels(p.doc, taken);
  const targets = pages.flatMap((p) =>
    docTargets(p.doc).map((t) => {
      let proposed = '';
      if (!t.label) {
        const base = `${{ figure: 'fig', table: 'table', image: 'img' }[t.kind]}-${slug(t.description) || t.kind}`;
        proposed = base;
        for (let n = 2; taken.has(proposed); n++) proposed = `${base}-${n}`;
        taken.add(proposed);
      }
      return { ...t, path: p.path, page: p.title, proposed };
    }),
  );
  const anchors = pages.flatMap((p) => docAnchors(p.doc).map((a) => ({ ...a, page: p.path ? p.title : null })));
  const values = await ctx.ui.editFields({
    title: 'Insert cross-reference',
    submit: 'Insert',
    fields: [
      {
        key: 'name',
        label: 'Refers to',
        value: 'ref',
        choices: [
          { value: 'ref', label: 'A section, figure or table (by its name)' },
          ...(targets.length ? [{ value: 'page', label: 'A figure, table or image' }] : []),
          ...(anchors.length ? [{ value: 'anchor', label: 'An anchor (a link target)' }] : []),
          { value: 'doc', label: 'A page' },
          { value: 'term', label: 'A glossary term' },
          { value: 'numref', label: mystConfig(ctx.config).numfig ? 'A figure or table, as “Figure 2”' : 'A figure or table, as “Figure 2” (needs numfig = True in conf.py)' },
        ],
      },
      {
        key: 'target',
        label: 'Target',
        value: '',
        placeholder: 'label-name or path/to/page',
        help: 'One without a name gets one when it’s chosen (an image, a link target before it), on whichever page it is.',
        suggestions: (values) =>
          values.name === 'page'
            ? targets.map((t) => ({ value: t.label ?? t.proposed, label: `${KIND_NAMES[t.kind]}: ${t.description}${t.path ? ` — ${t.page}` : ''}${t.label ? '' : ' (gets a name)'}` }))
            : values.name === 'anchor'
              ? anchors.map((a) => ({ value: a.label, label: `${a.follows || '(nothing after it)'}${a.page ? ` — ${a.page}` : ''}` }))
              : ctx.suggest(values.name),
      },
      {
        key: 'title',
        label: 'Link text',
        value: '',
        help: 'Optional: Sphinx shows the section’s title or the caption otherwise. An image has neither, so its description is used; an anchor before a paragraph neither, so its name, as words.',
      },
    ],
  });
  if (!values?.target) return;
  const target = values.target.trim();
  const chosen = values.name === 'page' ? targets.find((t) => (t.label ?? t.proposed) === target) : undefined;
  // Without a caption (an image, a figure with none), the link needs words of its own.
  // An anchor with no title of its own (before a paragraph, say), however it was chosen.
  const anchor = values.name === 'ref' || values.name === 'anchor' ? anchors.find((a) => a.label === target) : undefined;
  const title = values.title.trim() || (values.name === 'page' && !chosen?.captioned ? (chosen?.description ?? 'this') : anchor && !anchor.titled ? anchorWords(target) : '');
  const role = values.name === 'page' || values.name === 'anchor' ? 'ref' : values.name;
  // Named on its own page first (found again there by its place), and saved.
  if (chosen && !chosen.label && chosen.path) {
    const named = await ctx.editPage(chosen.path, (s) => {
      const t = docTargets(s.doc)[chosen.index];
      return t && t.kind === chosen.kind && !t.label ? nameIt(s.tr, t, target) : null;
    });
    if (!named) {
      ctx.ui.notify(`Couldn’t give it a name on ${chosen.path}: the page is open as Markdown, or couldn’t be saved. Name it there, then refer to it.`);
      return;
    }
  }
  run((s, dispatch) => {
    const tr = s.tr;
    if (chosen && !chosen.label && !chosen.path) nameIt(tr, docTargets(s.doc)[chosen.index] ?? chosen, target);
    tr.replaceSelectionWith(nodes.role.create({ name: role, value: title ? `${title} <${target}>` : target }), false);
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}
