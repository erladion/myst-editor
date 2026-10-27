// Where Vale's alerts are in the formatted document. Vale reports a line and columns
// of the saved file; formatting (`**bold**`, roles, …) means columns don't carry over,
// so an alert is found by its text instead: the same occurrence of it, counting from
// the start of its block, as in the file.
import type { Node as PMNode } from 'prosemirror-model';
import { parseSaved } from './document.js';
import { blockPathAtLine, positionOfPath } from './lines.js';
import type { PageConfig } from './format.js';
import type { ValeAlert } from '../shared/vale.js';

export interface LocatedAlert {
  from: number;
  to: number;
  alert: ValeAlert;
}

// Character columns (Vale counts characters) as UTF-16 offsets into the line.
export function columnOffset(line: string, column: number): number {
  return Array.from(line).slice(0, Math.max(0, column - 1)).join('').length;
}

function count(text: string, needle: string): number {
  let n = 0;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

// The text of a block's textblocks, with the document position of each character
// (-1 for what isn't text: atoms, and the breaks between textblocks).
function textOf(node: PMNode, pos: number): { text: string; starts: number[] } {
  let text = '';
  const starts: number[] = [];
  const visit = (n: PMNode, at: number) => {
    if (n.isTextblock) {
      if (text) {
        text += '\n';
        starts.push(-1);
      }
      n.forEach((child, offset) => {
        if (child.isText) {
          for (let i = 0; i < child.text!.length; i++) starts.push(at + 1 + offset + i);
          text += child.text!;
        } else {
          starts.push(-1);
          text += '￼';
        }
      });
    } else n.forEach((child, offset) => visit(child, at + 1 + offset));
  };
  visit(node, pos);
  return { text, starts };
}

export function locateAlerts(doc: PMNode, savedText: string, config: PageConfig, alerts: ValeAlert[]): LocatedAlert[] {
  const saved = parseSaved(savedText, config);
  const lines = savedText.split('\n');
  const lineStart: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i++) lineStart.push(at);
  const out: LocatedAlert[] = [];
  for (const alert of alerts) {
    const { Line, Span, Match } = alert;
    if (!Match || !lines[Line - 1]) continue;
    const path = blockPathAtLine(saved.doc, saved.map, Line);
    const there = path && positionOfPath(saved.doc, path);
    const here = path && positionOfPath(doc, path);
    if (!there || !here || here.node.type !== there.node.type) continue;
    const entry = saved.map.get(there.node.attrs.sid);
    if (!entry) continue;
    // Which occurrence of the text, from the start of the block in the file.
    const first = lines[entry.line - 1] ?? '';
    const blockStart = lineStart[entry.line - 1] + Math.max(0, first.indexOf(entry.text.split('\n')[0]));
    const at = lineStart[Line - 1] + columnOffset(lines[Line - 1], Span[0]);
    const nth = count(savedText.slice(blockStart, at), Match);
    // The same one in the block as it is now.
    const { text, starts } = textOf(here.node, here.pos);
    const found: number[] = [];
    for (let i = text.indexOf(Match); i >= 0; i = text.indexOf(Match, i + Match.length)) {
      if (starts[i] >= 0 && starts[i + Match.length - 1] >= 0) found.push(i);
    }
    if (!found.length) continue;
    const i = found[Math.min(nth, found.length - 1)];
    out.push({ from: starts[i], to: starts[i + Match.length - 1] + 1, alert });
  }
  return out;
}
