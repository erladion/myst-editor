// Loading and saving documents, with a safety check on save.
import type { Node as PMNode } from 'prosemirror-model';
import { parseMyst } from './parse.js';
import { serializeMyst } from './serialize.js';
import type { SourceMap } from './sourcemap.js';
import { DEFAULT_CONFIG, parserExtensions, type MystConfig } from './project-config.js';

export interface LoadedDocument {
  doc: PMNode;
  map: SourceMap;
}

export interface SaveResult {
  text: string;
  // False if the text doesn't parse back to the document being saved, i.e. saving
  // would change what the writer sees. `problem` describes the first difference.
  verified: boolean;
  problem?: string;
}

export function loadDocument(text: string, config: MystConfig = DEFAULT_CONFIG): LoadedDocument {
  const { directives, conditions, tables } = config.editor;
  return parseMyst(text, {
    extensions: parserExtensions(config),
    directives: Object.fromEntries(Object.entries(directives).map(([name, d]) => [name, d.body])),
    conditionKeywords: conditions?.block,
    tableSpans: tables,
  });
}

// A page's saved text, parsed, for the parts that locate things in it after each save
// (problems, previews, Vale's remarks, the preview's scroll lines). They share one
// parse, which the save's own check has usually done already. Not to be changed.
const parsed: { text: string; config: MystConfig; result: LoadedDocument }[] = [];
export function parseSaved(text: string, config: MystConfig = DEFAULT_CONFIG): LoadedDocument {
  const hit = parsed.find((p) => p.config === config && p.text === text);
  if (hit) return hit.result;
  const result = loadDocument(text, config);
  parsed.unshift({ text, config, result });
  parsed.length = Math.min(parsed.length, 4);
  return result;
}

export function saveDocument(doc: PMNode, map: SourceMap, config: MystConfig = DEFAULT_CONFIG): SaveResult {
  const text = serializeMyst(doc, map, { tableSpans: config.editor.tables });
  const reparsed = parseSaved(text, config).doc;
  const problem = firstDifference(semanticForm(doc), semanticForm(reparsed), 'document');
  return problem ? { text, verified: false, problem } : { text, verified: true };
}

// Attributes that record how something was written rather than what it is.
// A directive's fence too: the serializer lengthens it when something nested would close it.
const BOOKKEEPING = new Set(['sid', 'header', 'headerKey', 'marker', 'pad', 'pretty', 'colwidth', 'fence', 'bullet', 'delim']);

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: unknown[] };

// Document JSON reduced to what the writer can see: no bookkeeping attributes, no
// empty paragraphs, adjacent text merged, and no whitespace at line edges.
export function semanticForm(node: PMNode): Json {
  return clean(node.toJSON() as Json);
}

function clean(node: Json): Json {
  const out: Json = { type: node.type };
  if (node.attrs) {
    // A Markdown table stores alignment per column, in its header row.
    const skip = (k: string) => BOOKKEEPING.has(k) || (node.type === 'table_cell' && k === 'align');
    const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !skip(k)));
    // A table row's conditions: their markers, not which group they're numbered as.
    if (node.type === 'table_row' && Array.isArray(attrs.conds)) attrs.conds = (attrs.conds as { start: string; end: string }[]).map((c) => [c.start, c.end]);
    if (Object.keys(attrs).length) out.attrs = attrs;
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.marks) out.marks = node.marks;
  if (node.content) {
    let content = node.content.map(clean);
    // A table cell's paragraphs are written as one line, so they read back as one.
    if ((node.type === 'table_cell' || node.type === 'table_header') && content.length > 1) {
      const joined: Json[] = [];
      content.forEach((p, i) => {
        if (i > 0 && p.content?.length && joined.length) joined.push({ type: 'text', text: ' ' });
        joined.push(...(p.content ?? []));
      });
      content = [{ type: 'paragraph', content: cleanInline(joined) }];
    }
    if (['paragraph', 'heading'].includes(node.type)) content = cleanInline(content);
    content = content.filter((c) => !(c.type === 'paragraph' && !c.content?.length));
    if (content.length) out.content = content;
  }
  return out;
}

function cleanInline(items: Json[]): Json[] {
  // Split into lines at soft breaks, trim each line, drop empty lines and trailing
  // hard breaks, then merge adjacent text with identical marks.
  const lines: Json[][] = [[]];
  for (const item of items) {
    if (item.type === 'soft_break') lines.push([]);
    else lines[lines.length - 1].push(item);
  }
  const trimmed = lines
    .map((line) => {
      const l = line.map((i) => ({ ...i }));
      while (l.length && l[0].type === 'text' && !/\S/.test(l[0].text!)) l.shift();
      while (l.length && ((l[l.length - 1].type === 'text' && !/\S/.test(l[l.length - 1].text!)) || l[l.length - 1].type === 'hard_break')) l.pop();
      if (l.length && l[0].type === 'text') l[0].text = l[0].text!.replace(/^\s+/, '');
      const last = l[l.length - 1];
      if (last?.type === 'text') last.text = last.text!.replace(/\s+$/, '');
      return l;
    })
    .filter((l) => l.length);
  const merged: Json[] = [];
  trimmed.forEach((line, i) => {
    if (i > 0) merged.push({ type: 'soft_break' });
    for (const item of line) {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'text' && item.type === 'text' && JSON.stringify(prev.marks) === JSON.stringify(item.marks)) {
        prev.text += item.text!;
      } else merged.push(item);
    }
  });
  while (merged.length && merged[merged.length - 1].type === 'hard_break') merged.pop();
  return merged;
}

function firstDifference(a: Json, b: Json, path: string): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (a.type !== b.type) return `${path}: ${a.type} became ${b.type}`;
  const ac = a.content ?? [];
  const bc = b.content ?? [];
  for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
    const d = firstDifference(ac[i], bc[i], `${path} › ${ac[i].type} ${i + 1}`);
    if (d) return d;
  }
  if (ac.length !== bc.length) return `${path}: ${ac.length} children became ${bc.length}`;
  return `${path}: ${describe(a)} became ${describe(b)}`;
}

function describe(n: Json): string {
  return JSON.stringify({ attrs: n.attrs, text: n.text, marks: n.marks }).slice(0, 200);
}
