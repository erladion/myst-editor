// Cross-references in an AsciiDoc page: <<anchor>> on the page, xref:page.adoc#anchor[]
// to others (in an Antora component, by resource ID: from the module's pages).
import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { schema } from '../../../../core/schema';
import { relativePath } from '../../../../core/rename';
import type { EditorContext } from '../../editor/context';
import { dirname } from '../../paths';
import type { AsciidocConfig } from '../../../../core/asciidoc/config';
import { resourceIdFor } from '../../../../core/asciidoc/antora';
import { inComponent } from '../../builders/antora/references';

const { nodes } = schema;

// A page's anchors: link targets, and blocks' ids. With the text of what they're on.
function anchorsOf(doc: PMNode): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  doc.descendants((node, _pos, parent, index) => {
    const id = node.type === nodes.target ? (node.attrs.label as string) : ((node.attrs.options as [string, string][] | undefined)?.find(([k]) => k === 'id')?.[1] ?? null);
    if (id) {
      const next = node.type === nodes.target ? (parent?.maybeChild(index + 1) ?? null) : node;
      const text = (next?.textContent ?? '').replace(/\s+/g, ' ').trim();
      out.push({ id, text: text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, '')}…` : text });
    }
    return !node.isTextblock;
  });
  return out;
}

export async function insertReference(ctx: EditorContext, run: (cmd: Command) => void, state?: EditorState) {
  const here = ctx.filePath;
  const others = await ctx.otherPages();
  const own = state ? anchorsOf(state.doc) : [];
  const fromDir = here ? dirname(here) : '';
  const antora = ctx.config.format === 'asciidoc' ? (ctx.config as AsciidocConfig).antora : null;
  const pageRef = (path: string) => (antora && here && resourceIdFor(inComponent(antora, here), inComponent(antora, path), 'page')) || relativePath(fromDir, path);
  const values = await ctx.ui.editFields({
    title: 'Insert cross-reference',
    submit: 'Insert',
    fields: [
      {
        key: 'kind',
        label: 'Refers to',
        value: own.length ? 'anchor' : 'page',
        choices: [
          { value: 'anchor', label: 'An anchor on this page' },
          { value: 'page', label: 'A page' },
          { value: 'other', label: 'An anchor on another page' },
        ],
      },
      {
        key: 'target',
        label: 'Target',
        value: '',
        suggestions: (v) =>
          v.kind === 'anchor'
            ? own.map((a) => ({ value: a.id, label: a.text ? `${a.id} — ${a.text}` : a.id }))
            : v.kind === 'page'
              ? others.map((p) => ({ value: pageRef(p.path), label: p.title }))
              : others.flatMap((p) => anchorsOf(p.doc).map((a) => ({ value: `${pageRef(p.path)}#${a.id}`, label: `${p.title}: ${a.text || a.id}` }))),
      },
      { key: 'text', label: 'Text', value: '', help: 'Left empty: the title of what it refers to.' },
    ],
  });
  const target = values?.target.trim();
  if (!values || !target) return;
  const text = values.text.trim();
  const value = text ? `${text} <${target}>` : target;
  const role = nodes.role.create({ name: values.kind === 'anchor' ? 'ref' : 'xref', value });
  run((s, dispatch) => {
    if (!s.selection.$from.parent.type.contentMatch.matchType(nodes.role)) return false;
    dispatch?.(s.tr.replaceSelectionWith(role, false).scrollIntoView());
    return true;
  });
}
