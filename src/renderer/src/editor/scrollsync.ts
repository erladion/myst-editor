// Where the formatted view is scrolled to, as a line of the saved page, for the Sphinx
// preview to follow: the start line of the block at the top of the view, plus how far
// into it.
import type { EditorView } from 'prosemirror-view';
import { parseSaved } from '../../../core/document';
import type { PageConfig } from '../../../core/format';
import type { PreviewLine } from '../components/SphinxUi';

// The start line of each top-level block of the saved page, then the line after it.
export function blockLines(savedText: string, config: PageConfig): number[] {
  const { doc, map } = parseSaved(savedText, config);
  const lines: number[] = [];
  doc.forEach((node) => lines.push(map.get(node.attrs.sid)?.line ?? lines[lines.length - 1] ?? 1));
  lines.push(savedText.split('\n').length + 1);
  return lines;
}

export function lineAtTop(view: EditorView, scroller: HTMLElement, lines: number[]): PreviewLine {
  if (scroller.scrollTop <= 0) return 0;
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) return 'end';
  const y = scroller.getBoundingClientRect().top + 8;
  const starts: number[] = [];
  view.state.doc.forEach((_node, offset) => starts.push(offset));
  if (!starts.length) return 0;
  const rect = (i: number) => (view.nodeDOM(starts[i]) as HTMLElement | null)?.getBoundingClientRect?.();
  // The first block that reaches below the top of the view.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rect(mid);
    if (r && r.bottom <= y) lo = mid + 1;
    else hi = mid;
  }
  const r = rect(lo);
  const i = Math.min(lo, lines.length - 2);
  const into = r && r.height > 0 ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0;
  return lines[i] + into * (lines[i + 1] - lines[i]);
}
