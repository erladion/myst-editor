// Conditional content in the editor: finding and pairing markers, showing what is
// conditional, "View as", and the make/remove commands.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { CONDITION_PALETTE, type ConditionsDef } from '../../../core/editor-config';
import { endMarker, evaluate, parseCondition, readMarker, startMarker, unknownNames, withExpression, type ParseResult } from '../../../core/conditions';
import { isInTable, selectedRect } from 'prosemirror-tables';
import { schema, type RowCondition } from '../../../core/schema';

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

// ---- colours ----------------------------------------------------------------------

// A condition's colour, as CSS. The same condition has the same colour on every page:
// one chosen in the settings, else a single capability's place in the capabilities
// list (so the first few always differ), else one picked from the expression's text.
export function conditionColor(expr: string, settings: ConditionsDef): string {
  const key = (e: string) => (settings.caseSensitive ? e : e.toLowerCase()).trim().replace(/\s+/g, ' ');
  const wanted = key(expr);
  const chosen = Object.entries(settings.colors).find(([e]) => key(e) === wanted)?.[1];
  if (chosen) return chosen.startsWith('#') ? chosen : `var(--cond-${chosen})`;
  const index = settings.capabilities.findIndex((c) => key(c) === wanted);
  let n = index;
  if (n < 0) {
    n = 0x811c9dc5; // FNV-1a
    for (const ch of wanted) n = Math.imul(n ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `var(--cond-${CONDITION_PALETTE[n % CONDITION_PALETTE.length]})`;
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
  // Per block inside conditions: the colours of the conditions around it (outermost
  // first), and whether "View as" hides it.
  const inside = new Map<number, { node: PMNode; colors: string[]; hidden: boolean }>();

  // Outer conditions first, so a block's stripes go outside in.
  for (const region of [...regions].sort((a, b) => a.depth - b.depth)) {
    const hidden = !regionVisible(region, settings, viewAs);
    const color = conditionColor(region.start.expr, settings);
    const style = `--cond: ${color}`;
    const problem = !region.parsed.ok ? region.parsed.error : unknownNames(region.parsed.names, settings).map((n) => `Unknown capability “${n}”`).join('\n');
    const markerClass = `cond-marker${problem ? ' cond-problem' : ''}${hidden ? ' cond-off' : ''}`;
    const title = problem || (region.parsed.ok ? '' : region.start.expr);
    decorations.push(Decoration.node(region.start.pos, region.start.pos + region.start.node.nodeSize, { class: markerClass, title, style }));
    decorations.push(Decoration.node(region.end.pos, region.end.pos + region.end.node.nodeSize, { class: `cond-marker${hidden ? ' cond-off' : ''}`, style }));

    const from = region.start.pos + region.start.node.nodeSize;
    const to = region.end.pos;
    if (from >= to) continue;
    if (region.start.inline) {
      // Text typed right next to a marker is inside the condition (see textOnly).
      decorations.push(Decoration.inline(from, to, { class: `cond-inline${hidden ? ' cond-off' : ''}`, style }, { inclusiveStart: true, inclusiveEnd: true }));
      continue;
    }
    // The outermost blocks entirely between the markers.
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isBlock) return false;
      if (pos >= from && pos + node.nodeSize <= to) {
        const seen = inside.get(pos) ?? { node, colors: [], hidden: false };
        inside.set(pos, { node, colors: [...seen.colors, color], hidden: seen.hidden || hidden });
        return false;
      }
      return true;
    });
  }
  for (const [pos, { node, colors, hidden }] of inside) {
    // One 3px stripe per condition, 2px apart.
    const shown = colors.slice(0, 4);
    const stripes = shown.map((c, i) => `${c} ${i * 5}px ${i * 5 + 3}px, transparent ${i * 5 + 3}px ${i * 5 + 5}px`).join(', ');
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `cond-in cond-d${shown.length}${hidden ? ' cond-off' : ''}`,
        // Only the stripes: a nested condition's own marker sits inside the outer one and
        // keeps its own --cond.
        style: `--cond-stripes: linear-gradient(to right, ${stripes})`,
      }),
    );
  }
  decorateRows(doc, settings, viewAs, decorations);
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

// Whether a change only edits text within a paragraph (typing, deleting, formatting)
// and touches no marker: the conditions are then where they were, so their
// decorations only move along, and a long page isn't scanned on every keystroke.
function textOnly(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return false;
    const doc = tr.docs[i];
    const $from = doc.resolve(step.from);
    if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(step.to))) return false;
    let ok = true;
    step.slice.content.forEach((n) => {
      if (!n.isInline || n.type.name === 'html_inline') ok = false;
    });
    doc.nodesBetween(step.from, step.to, (n) => {
      if (n.type.name === 'html_inline') ok = false;
      return ok;
    });
    return ok;
  });
}

// Table rows in conditions (their markers sit between the rows, see RowCondition):
// each tinted in its condition's colour, with a stripe per condition it's in; the
// first row of a group names the condition; "View as" dims what wouldn't be seen.
function decorateRows(doc: PMNode, settings: ConditionsDef, viewAs: string[] | null, decorations: Decoration[]) {
  doc.descendants((table, pos) => {
    if (table.type.name !== 'table') return !table.isTextblock;
    let prev: RowCondition[] = [];
    table.forEach((row, offset) => {
      const conds: RowCondition[] = row.attrs.conds;
      const at = pos + 1 + offset;
      if (conds.length) {
        const exprs = conds.map((c) => {
          const m = readMarker(c.start, settings.block);
          return m?.kind === 'start' ? m.expr : '';
        });
        const parsed = exprs.map((e) => parseCondition(e));
        const hidden = parsed.some((p) => !regionVisible({ parsed: p } as Region, settings, viewAs));
        const problems = parsed.flatMap((p, i) => (!p.ok ? [`${exprs[i]}: ${p.error}`] : unknownNames(p.names, settings).map((n) => `Unknown capability “${n}”`)));
        const colors = exprs.map((e) => conditionColor(e, settings));
        decorations.push(
          Decoration.node(at, at + row.nodeSize, {
            class: `cond-row${conds.length > 1 ? ' cond-row-nested' : ''}${hidden ? ' cond-off' : ''}${problems.length ? ' cond-row-problem' : ''}`,
            style: `--cond: ${colors[colors.length - 1]}; --cond-outer: ${colors[0]}`,
            title: problems.join('\n') || `Only for ${exprs.join(', within ')}`,
          }),
        );
        // A group starts here: its condition above the first cell's text.
        const starting = conds.findIndex((c, i) => prev[i]?.id !== c.id);
        if (starting >= 0 && row.firstChild) {
          decorations.push(Decoration.node(at + 1, at + 1 + row.firstChild.nodeSize, { class: 'cond-row-label', 'data-cond': exprs.slice(starting).join(' › ') }));
        }
      }
      prev = conds;
    });
    return false;
  });
}

export const conditionsPlugin = new Plugin<PluginState>({
  key: conditionsKey,
  state: {
    init: () => ({ settings: null, viewAs: null, decorations: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(conditionsKey) as Partial<Pick<PluginState, 'settings' | 'viewAs'>> | undefined;
      if (!meta && !tr.docChanged) return prev;
      if (!meta && textOnly(tr)) return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) };
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

// ---- table rows ---------------------------------------------------------------

let rowGroup = 0;

// The body rows of the table the selection is in (all of them, by position), and
// which of them the selection covers. The header row can't be conditional.
function tableRows(state: EditorState) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const rows: { node: PMNode; pos: number; index: number }[] = [];
  rect.table.forEach((node, offset, index) => rows.push({ node, pos: rect.tableStart + offset, index }));
  const selected = rows.slice(Math.max(1, rect.top), rect.bottom);
  return selected.length ? { rows, selected } : null;
}

// The condition the selected rows are all in, innermost: what "Condition…" edits.
export function rowCondition(state: EditorState, settings: ConditionsDef): { id: string; expr: string } | null {
  const t = tableRows(state);
  const inner = t?.selected.map((r) => (r.node.attrs.conds as RowCondition[]).at(-1));
  const first = inner?.[0];
  if (!first || inner!.some((c) => c?.id !== first.id)) return null;
  const m = readMarker(first.start, settings.block);
  return { id: first.id, expr: m?.kind === 'start' ? m.expr : '' };
}

export const canConditionRows = (state: EditorState) => !!tableRows(state);

// The selected rows' condition, as `expr`: the one they're all in gets the new
// expression (for the whole group), or else they go into a new one.
export function setRowCondition(settings: ConditionsDef, expr: string): Command {
  return (state, dispatch) => {
    const t = tableRows(state);
    if (!t) return false;
    if (!dispatch) return true;
    const shared = rowCondition(state, settings);
    const group: RowCondition = { id: `r${++rowGroup}`, start: startMarker(settings.block[0], expr), end: endMarker(settings.block[1]) };
    const tr = state.tr;
    for (const row of shared ? t.rows : t.selected) {
      const conds: RowCondition[] = row.node.attrs.conds;
      const next = shared ? conds.map((c) => (c.id === shared.id ? { ...c, start: withExpression(c.start, expr) } : c)) : [...conds, group];
      if (next !== conds) tr.setNodeMarkup(row.pos, null, { ...row.node.attrs, conds: next });
    }
    dispatch(tr);
    return true;
  };
}

// No condition around the selected rows' group any more (its markers go; its rows stay).
export function removeRowCondition(settings: ConditionsDef): Command {
  return (state, dispatch) => {
    const t = tableRows(state);
    const shared = rowCondition(state, settings);
    if (!t || !shared) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const row of t.rows) {
      const conds: RowCondition[] = row.node.attrs.conds;
      if (conds.some((c) => c.id === shared.id)) tr.setNodeMarkup(row.pos, null, { ...row.node.attrs, conds: conds.filter((c) => c.id !== shared.id) });
    }
    dispatch(tr);
    return true;
  };
}
