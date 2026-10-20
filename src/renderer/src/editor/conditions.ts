// Conditional content in the editor: finding and pairing markers, showing what is
// conditional, "View as", and the make/remove commands.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { ConditionsDef } from '../../../core/editor-config';
import { endMarker, evaluate, parseCondition, readMarker, startMarker, unknownNames, type ParseResult } from '../../../core/conditions';
import { schema } from '../../../core/schema';

interface MarkerAt {
  pos: number;
  node: PMNode;
  kind: 'start' | 'end';
  expr: string; // start markers only
  inline: boolean;
}

export interface Region {
  start: MarkerAt;
  end: MarkerAt;
  parsed: ParseResult;
  depth: number; // 1 for outermost
}

export interface ConditionScan {
  regions: Region[];
  unmatched: MarkerAt[];
}

// Every marker in document order, paired by nesting. Inline pairs must be in the same
// paragraph; block pairs may span container boundaries (e.g. list items).
export function scanConditions(doc: PMNode, settings: ConditionsDef): ConditionScan {
  const regions: Region[] = [];
  const unmatched: MarkerAt[] = [];
  const blockStack: MarkerAt[] = [];
  const pair = (stack: MarkerAt[], m: MarkerAt) => {
    if (m.kind === 'start') return void stack.push(m);
    const start = stack.pop();
    if (!start) return void unmatched.push(m);
    regions.push({ start, end: m, parsed: parseCondition(start.expr), depth: stack.length + 1 });
  };
  doc.descendants((node, pos) => {
    if (node.type.name === 'raw_block' && /^condition-/.test(node.attrs.kind)) {
      const marker = readMarker(node.attrs.source, settings.block);
      if (marker) pair(blockStack, { pos, node, kind: marker.kind, expr: marker.kind === 'start' ? marker.expr : '', inline: false });
      return false;
    }
    if (node.isTextblock) {
      const inlineStack: MarkerAt[] = [];
      node.forEach((child, offset) => {
        if (child.type.name !== 'html_inline') return;
        const marker = readMarker(child.attrs.value, settings.inline);
        if (marker) pair(inlineStack, { pos: pos + 1 + offset, node: child, kind: marker.kind, expr: marker.kind === 'start' ? marker.expr : '', inline: true });
      });
      unmatched.push(...inlineStack);
      return false;
    }
    return true;
  });
  unmatched.push(...blockStack);
  return { regions, unmatched };
}

// ---- plugin -----------------------------------------------------------------------

interface PluginState {
  settings: ConditionsDef | null;
  viewAs: string[] | null; // capabilities to preview with; null shows everything
  decorations: DecorationSet;
}

export const conditionsKey = new PluginKey<PluginState>('conditions');

export function regionVisible(region: Region, settings: ConditionsDef, viewAs: string[] | null): boolean {
  if (!viewAs || !region.parsed.ok) return true;
  const have = new Set(settings.caseSensitive ? viewAs : viewAs.map((c) => c.toLowerCase()));
  return evaluate(region.parsed.expr, (n) => have.has(settings.caseSensitive ? n : n.toLowerCase()));
}

function decorate(doc: PMNode, settings: ConditionsDef | null, viewAs: string[] | null): DecorationSet {
  if (!settings) return DecorationSet.empty;
  const { regions, unmatched } = scanConditions(doc, settings);
  const decorations: Decoration[] = [];
  // Per block inside conditions: how deeply nested, and whether "View as" hides it.
  const inside = new Map<number, { node: PMNode; depth: number; hidden: boolean }>();

  for (const region of regions) {
    const hidden = !regionVisible(region, settings, viewAs);
    const problem = !region.parsed.ok ? region.parsed.error : unknownNames(region.parsed.names, settings).map((n) => `Unknown capability “${n}”`).join('\n');
    const markerClass = `cond-marker${problem ? ' cond-problem' : ''}${hidden ? ' cond-off' : ''}`;
    const title = problem || (region.parsed.ok ? '' : region.start.expr);
    decorations.push(Decoration.node(region.start.pos, region.start.pos + region.start.node.nodeSize, { class: markerClass, title }));
    decorations.push(Decoration.node(region.end.pos, region.end.pos + region.end.node.nodeSize, { class: `cond-marker${hidden ? ' cond-off' : ''}` }));

    const from = region.start.pos + region.start.node.nodeSize;
    const to = region.end.pos;
    if (from >= to) continue;
    if (region.start.inline) {
      decorations.push(Decoration.inline(from, to, { class: `cond-inline${hidden ? ' cond-off' : ''}` }));
      continue;
    }
    // The outermost blocks entirely between the markers.
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isBlock) return false;
      if (pos >= from && pos + node.nodeSize <= to) {
        const seen = inside.get(pos) ?? { node, depth: 0, hidden: false };
        inside.set(pos, { node, depth: seen.depth + 1, hidden: seen.hidden || hidden });
        return false;
      }
      return true;
    });
  }
  for (const [pos, { node, depth, hidden }] of inside) {
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `cond-in cond-d${Math.min(depth, 4)}${hidden ? ' cond-off' : ''}` }));
  }
  for (const m of unmatched) {
    decorations.push(
      Decoration.node(m.pos, m.pos + m.node.nodeSize, {
        class: 'cond-marker cond-unmatched',
        title: m.kind === 'start' ? 'This condition has no end marker' : 'This end marker has no matching start',
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export const conditionsPlugin = new Plugin<PluginState>({
  key: conditionsKey,
  state: {
    init: () => ({ settings: null, viewAs: null, decorations: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(conditionsKey) as Partial<Pick<PluginState, 'settings' | 'viewAs'>> | undefined;
      if (!meta && !tr.docChanged) return prev;
      const next = { ...prev, ...meta };
      return { ...next, decorations: decorate(tr.doc, next.settings, next.viewAs) };
    },
  },
  props: {
    decorations: (state) => conditionsKey.getState(state)?.decorations,
  },
});

export function setConditionView(tr: Transaction, settings: ConditionsDef | null, viewAs: string[] | null): Transaction {
  return tr.setMeta(conditionsKey, { settings, viewAs }).setMeta('addToHistory', false);
}

// ---- commands -------------------------------------------------------------------

const marker = (source: string, kind: 'start' | 'end') => schema.nodes.raw_block.create({ kind: `condition-${kind}`, source });

// Where an inline condition can't start: a line starting with "<!--" would be read
// as a block of HTML instead.
function atLineStart(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if ($pos.parentOffset === 0) return true;
  return $pos.nodeBefore?.type.name === 'soft_break' || $pos.nodeBefore?.type.name === 'hard_break';
}

export type MakeConditional = { inline: true; ok: boolean; reason?: string } | { inline: false };

// Whether the selection would become an inline or a block condition.
export function conditionKind(state: EditorState): MakeConditional {
  const { $from, $to, empty } = state.selection;
  const sameBlock = $from.sameParent($to) && $from.parent.isTextblock;
  const whole = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  if (empty || !sameBlock || whole) return { inline: false };
  if (atLineStart(state, $from.pos)) {
    return { inline: true, ok: false, reason: 'An inline condition can’t start at the beginning of a line. Select from a later word, or the whole paragraph.' };
  }
  return { inline: true, ok: true };
}

// Wrap the selection (or the block the cursor is in) in a condition.
export function makeConditional(settings: ConditionsDef, expr: string): Command {
  return (state, dispatch) => {
    const kind = conditionKind(state);
    const { $from, $to, from, to } = state.selection;
    let tr = state.tr;
    if (kind.inline) {
      if (!kind.ok) return false;
      const start = schema.nodes.html_inline.create({ value: startMarker(settings.inline[0], expr) });
      const end = schema.nodes.html_inline.create({ value: endMarker(settings.inline[1]) });
      // Spaces at the edges of the selection stay outside, so the text reads the same
      // either way (double-clicking a word on Windows also selects the space after it).
      const text = state.doc.textBetween(from, to, '\ufffc', '\ufffc');
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      const [a, b] = lead + trail < text.length ? [from + lead, to - trail] : [from, to];
      tr = tr.insert(b, end).insert(a, start);
    } else {
      const range = $from.blockRange($to);
      if (!range) return false;
      tr = tr.insert(range.end, marker(endMarker(settings.block[1]), 'end')).insert(range.start, marker(startMarker(settings.block[0], expr), 'start'));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

// Remove a condition's markers (both, if they're paired), keeping its content.
export function removeCondition(settings: ConditionsDef, markerPos: number): Command {
  return (state, dispatch) => {
    const { regions } = scanConditions(state.doc, settings);
    const region = regions.find((r) => r.start.pos === markerPos || r.end.pos === markerPos);
    const targets = region ? [region.end, region.start] : [];
    if (!region) {
      const node = state.doc.nodeAt(markerPos);
      if (!node) return false;
      targets.push({ pos: markerPos, node } as MarkerAt);
    }
    let tr = state.tr;
    for (const m of targets) tr = tr.delete(m.pos, m.pos + m.node.nodeSize); // end first, so start's position holds
    dispatch?.(tr);
    return true;
  };
}
