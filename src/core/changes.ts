// What changed in a page since a version of it (its last commit): blocks added,
// removed or changed, and in a changed paragraph or heading, the words. Positions are
// in the page as it is now; what was removed is placed where it was.
import { diffArrays, diffWordsWithSpace } from 'diff';
import type { Node as PMNode } from 'prosemirror-model';
import { semanticForm } from './document.js';

export type Change =
  | { kind: 'added-block'; from: number; to: number }
  | { kind: 'changed-block'; from: number; to: number } // the same words, other formatting or settings
  | { kind: 'removed-block'; at: number; text: string; inTable: boolean }
  | { kind: 'added-text'; from: number; to: number }
  | { kind: 'removed-text'; at: number; text: string };

// A block as the writer sees it (no bookkeeping such as ids), for telling whether two
// are the same. Nodes are kept as they are between edits, so it's worked out once each.
const keys = new WeakMap<PMNode, string>();
function key(node: PMNode): string {
  let k = keys.get(node);
  if (k === undefined) {
    k = JSON.stringify(semanticForm(node));
    keys.set(node, k);
  }
  return k;
}

// Blocks whose children are compared one by one when they differ.
const containers = new Set(['bullet_list', 'ordered_list', 'list_item', 'blockquote', 'md_directive', 'table', 'table_row', 'table_header', 'table_cell']);
const sameKind = (a: PMNode, b: PMNode) => a.type === b.type && (a.type.name !== 'md_directive' || a.attrs.name === b.attrs.name);

// A textblock's text, atoms (images, roles, …) as one character each.
function inlineText(node: PMNode): string {
  let text = '';
  node.forEach((child) => (text += child.isText ? child.text : '￼'));
  return text;
}

export function diffDocs(base: PMNode, now: PMNode): Change[] {
  const out: Change[] = [];
  compare(base, now, 0, false, out);
  return out;
}

// `pos`: where `now`'s content starts.
function compare(base: PMNode, now: PMNode, pos: number, inTable: boolean, out: Change[]) {
  const olds: PMNode[] = [];
  const news: { node: PMNode; pos: number }[] = [];
  base.forEach((n) => olds.push(n));
  now.forEach((n, offset) => news.push({ node: n, pos: pos + offset }));
  const table = inTable || now.type.name.startsWith('table');
  const parts = diffArrays(
    olds.map(key),
    news.map((n) => key(n.node)),
  );
  let i = 0; // in olds
  let j = 0; // in news
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part.added && !part.removed) {
      i += part.count!;
      j += part.count!;
      continue;
    }
    // A run removed and a run added at the same place: paired up one by one where
    // they're the same kind of block (a paragraph edited), the rest added or removed.
    const removed = part.removed ? part.count! : 0;
    const next = parts[p + 1];
    const added = part.added ? part.count! : part.removed && next?.added ? next.count! : 0;
    if (part.removed && next?.added) p++;
    // Removed blocks beyond those paired go after the run's new ones.
    const after = j + added < news.length ? news[j + added].pos : pos + now.content.size;
    for (let k = 0; k < Math.max(removed, added); k++) {
      const old = k < removed ? olds[i + k] : null;
      const cur = k < added ? news[j + k] : null;
      if (old && cur && sameKind(old, cur.node)) changed(old, cur.node, cur.pos, table, out);
      else {
        if (old) out.push({ kind: 'removed-block', at: cur ? cur.pos : after, text: old.textContent, inTable: table });
        if (cur) out.push({ kind: 'added-block', from: cur.pos, to: cur.pos + cur.node.nodeSize });
      }
    }
    i += removed;
    j += added;
  }
}

// Two versions of the same kind of block.
function changed(old: PMNode, cur: PMNode, pos: number, inTable: boolean, out: Change[]) {
  if (cur.isTextblock && old.isTextblock) {
    const before = inlineText(old);
    const after = inlineText(cur);
    if (before === after) {
      out.push({ kind: 'changed-block', from: pos, to: pos + cur.nodeSize });
      return;
    }
    // Where each character of the text now is in the page.
    const starts: number[] = [];
    cur.forEach((child, offset) => {
      const n = child.isText ? child.text!.length : 1;
      for (let c = 0; c < n; c++) starts.push(pos + 1 + offset + c);
    });
    let at = 0;
    for (const part of diffWordsWithSpace(before, after)) {
      if (part.added) {
        out.push({ kind: 'added-text', from: starts[at], to: starts[at + part.value.length - 1] + 1 });
        at += part.value.length;
      } else if (part.removed) {
        out.push({ kind: 'removed-text', at: at < starts.length ? starts[at] : pos + cur.nodeSize - 1, text: part.value.replace(/￼/g, '▢') });
      } else at += part.value.length;
    }
    return;
  }
  if (containers.has(cur.type.name) && JSON.stringify({ ...old.attrs, sid: 0 }) === JSON.stringify({ ...cur.attrs, sid: 0 })) {
    compare(old, cur, pos + 1, inTable, out);
    return;
  }
  // A container with other settings (a callout's kind, a list's numbering), or a block
  // that's edited as a whole.
  out.push({ kind: 'changed-block', from: pos, to: pos + cur.nodeSize });
  if (containers.has(cur.type.name)) compare(old, cur, pos + 1, inTable, out);
}
