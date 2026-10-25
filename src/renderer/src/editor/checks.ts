// The page's checks (see core/checks.ts), kept up to date as it's edited: marked in
// the page (a dotted underline, with the finding on hover), listed by the status bar's
// chip, and fixed from there where they can be.
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { checkDoc, type Finding } from '../../../core/checks';
import { editLink } from './commands';
import type { EditorContext } from './context';

interface State {
  findings: Finding[];
  decorations: DecorationSet;
}

export const checksKey = new PluginKey<State>('checks');

function build(state: EditorState): State {
  const findings = checkDoc(state.doc);
  const decorations = findings.map((f) => {
    const node = state.doc.nodeAt(f.from);
    const attrs = { class: 'check-mark', title: f.message };
    // Whole blocks (and images) as nodes; a stretch of text inline.
    return node && f.to === f.from + node.nodeSize && !node.isText ? Decoration.node(f.from, f.to, attrs) : Decoration.inline(f.from, f.to, attrs);
  });
  return { findings, decorations: DecorationSet.create(state.doc, decorations) };
}

export const checksPlugin = new Plugin<State>({
  key: checksKey,
  state: {
    init: (_config, state) => build(state),
    apply: (tr, old, _before, state) => (tr.docChanged ? build(state) : old),
  },
  props: {
    decorations: (state) => checksKey.getState(state)?.decorations,
  },
});

export const checksOf = (state: EditorState): Finding[] => checksKey.getState(state)?.findings ?? [];

// The finding selected and shown.
export function showFinding(view: EditorView, f: Finding) {
  const node = view.state.doc.nodeAt(f.from);
  const selection = node && !node.isTextblock && f.to === f.from + node.nodeSize && NodeSelection.isSelectable(node) ? NodeSelection.create(view.state.doc, f.from) : TextSelection.create(view.state.doc, f.from + (node?.isTextblock ? 1 : 0), f.to - (node?.isTextblock ? 1 : 0));
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
}

// Fixing it: asking for a description, changing a heading's level, or the link's text.
export async function fixFinding(view: EditorView, ctx: EditorContext, f: Finding) {
  const fix = f.fix;
  if (!fix) return showFinding(view, f);
  const run = (cmd: (s: EditorState, d?: EditorView['dispatch']) => boolean) => {
    cmd(view.state, view.dispatch);
    view.focus();
  };
  if (fix.kind === 'heading-level') {
    const node = view.state.doc.nodeAt(fix.pos);
    if (node?.type.name === 'heading') view.dispatch(view.state.tr.setNodeMarkup(fix.pos, undefined, { ...node.attrs, level: fix.level }));
    return view.focus();
  }
  if (fix.kind === 'link-text') {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, fix.from, fix.to)));
    return editLink(ctx, view.state, run);
  }
  const values = await ctx.ui.editFields({
    title: fix.kind === 'describe-image' ? 'Describe the image' : 'Describe the figure',
    submit: 'Save',
    fields: [{ key: 'alt', label: 'Description', value: '', help: 'What the image shows, in a sentence: read aloud by screen readers, and shown when it can’t load.' }],
  });
  const alt = values?.alt.trim();
  if (!alt) return;
  const node = view.state.doc.nodeAt(fix.pos);
  if (!node) return;
  if (fix.kind === 'describe-image' && node.type.name === 'image') view.dispatch(view.state.tr.setNodeMarkup(fix.pos, undefined, { ...node.attrs, alt }));
  if (fix.kind === 'describe-figure' && node.type.name === 'md_directive') {
    const options = (node.attrs.options as [string, string][]).filter(([k]) => k !== 'alt');
    view.dispatch(view.state.tr.setNodeMarkup(fix.pos, undefined, { ...node.attrs, options: [['alt', alt], ...options] }));
  }
  view.focus();
}
