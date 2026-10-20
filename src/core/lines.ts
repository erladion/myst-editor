// Mapping source lines (e.g. from Sphinx warnings) to blocks of a parsed document.
import type { Node as PMNode } from 'prosemirror-model';
import type { SourceMap } from './sourcemap.js';

// Index path (child indices from the document root) of the innermost block whose
// source contains `line`, or null if none does.
export function blockPathAtLine(doc: PMNode, map: SourceMap, line: number): number[] | null {
  let best: number[] | null = null;
  const visit = (node: PMNode, path: number[]) => {
    node.forEach((child, _offset, i) => {
      if (!child.isBlock) return;
      const entry = map.get(child.attrs.sid);
      if (!entry) return;
      const end = entry.line + entry.text.split('\n').length - 1;
      if (line < entry.line || line > end) return;
      best = [...path, i];
      visit(child, best);
    });
  };
  visit(doc, []);
  return best;
}

// Resolve an index path in `doc` to a node position, stopping at the deepest part of
// the path that still exists (the document may have changed since).
export function positionOfPath(doc: PMNode, path: number[]): { pos: number; node: PMNode } | null {
  let node = doc;
  let pos = -1; // position before `node`; the document itself has none
  for (const index of path) {
    if (index >= node.childCount || !node.child(index).isBlock) break;
    let offset = pos + 1;
    for (let i = 0; i < index; i++) offset += node.child(i).nodeSize;
    pos = offset;
    node = node.child(index);
  }
  return pos < 0 ? null : { pos, node };
}
