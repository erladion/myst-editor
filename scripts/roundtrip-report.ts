// Round-trip report over directories of real MyST files.
//
//   npm run roundtrip -- <dir-or-file>...
//
// For each file: unedited byte-identity, fresh-serialization re-parse equality, and
// a fuzz pass that types one character into every paragraph/heading in turn and
// checks that exactly one source line changes and the result re-parses correctly.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { diffLines } from 'diff';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { parseMyst } from '../src/core/myst/parse.js';
import { serializeMyst } from '../src/core/myst/serialize.js';
import { schema } from '../src/core/schema.js';
import { normalized } from '../test/helpers.js';

const files = process.argv.slice(2).flatMap(walk);
const verbose = process.env.VERBOSE === '1';
const MAX_EDITS = Number(process.env.MAX_EDITS ?? 30);
const slow: [string, number][] = [];

const totals = { files: 0, identical: 0, fresh: 0, edits: 0, editOk: 0, crashed: 0, blocks: 0, rawBlocks: 0, ms: 0 };
const kinds = new Map<string, number>();
const failures: string[] = [];

for (const file of files) {
  totals.files++;
  const src = readFileSync(file, 'utf8');
  const name = relative(process.cwd(), file);
  try {
    const t0 = performance.now();
    const { doc, map } = parseMyst(src);
    const ms = performance.now() - t0;
    totals.ms += ms;
    slow.push([name, ms]);

    doc.descendants((n) => {
      if (!n.isBlock || n.type.name === 'list_item') return;
      totals.blocks++;
      if (n.type.name === 'raw_block' || n.type.name === 'opaque_directive') {
        totals.rawBlocks++;
        const k = n.type.name === 'raw_block' ? `raw:${n.attrs.kind}` : `{${n.attrs.name}}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    });

    if (serializeMyst(doc, map) === src) totals.identical++;
    else failures.push(`${name}: unedited round-trip differs\n${shortDiff(src, serializeMyst(doc, map))}`);

    const fresh = serializeMyst(doc, map, { fresh: true });
    if (same(parseMyst(fresh).doc, doc)) totals.fresh++;
    else failures.push(`${name}: fresh serialization re-parses differently\n${shortDiff(src, fresh)}`);

    fuzz(name, doc, map);
  } catch (e) {
    totals.crashed++;
    failures.push(`${name}: CRASH ${(e as Error).stack?.split('\n').slice(0, 4).join('\n')}`);
  }
}

function fuzz(name: string, doc: PMNode, map: ReturnType<typeof parseMyst>['map']) {
  const targets: number[] = [];
  doc.descendants((n, pos) => {
    if (n.isText && n.text!.length > 1 && (process.env.FUZZ_MARKS === "1" || !n.marks.length)) {
      const parent = doc.resolve(pos).parent;
      if (parent.type.name === 'paragraph' || parent.type.name === 'heading') targets.push(pos + Math.floor(n.text!.length / 2));
    }
  });
  const state = EditorState.create({ doc, schema });
  const base = serializeMyst(doc, map);
  // Evenly spaced sample so large files don't dominate the run time.
  const step = Math.max(1, targets.length / MAX_EDITS);
  const sample = Array.from({ length: Math.min(MAX_EDITS, targets.length) }, (_, i) => targets[Math.floor(i * step)]);
  for (const pos of sample) {
    totals.edits++;
    const edited = state.apply(state.tr.insertText('Q', pos)).doc;
    const out = serializeMyst(edited, map);
    const changed = diffLines(base, out).filter((p) => p.added || p.removed);
    const lines = changed.reduce((n, p) => n + (p.count ?? 0), 0);
    const reparsedOk = same(parseMyst(out).doc, edited);
    if (lines === 2 && reparsedOk) totals.editOk++;
    else if (failures.filter((f) => f.startsWith(name + ': edit')).length < 2) {
      failures.push(
        `${name}: edit at ${pos} changed ${lines} lines, reparse ${reparsedOk ? 'ok' : 'DIFFERS'}\n` +
          changed.map((p) => (p.added ? '+ ' : '- ') + p.value.trimEnd().split('\n').join('\n  ')).join('\n'),
      );
    }
  }
}

function same(a: PMNode, b: PMNode): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

function shortDiff(a: string, b: string): string {
  return diffLines(a, b)
    .filter((p) => p.added || p.removed)
    .slice(0, 6)
    .map((p) => (p.added ? '+ ' : '- ') + JSON.stringify(p.value.slice(0, 300)))
    .join('\n');
}

function walk(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((f) => {
    if (f.startsWith('.') || f === 'node_modules') return [];
    const p = join(path, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

const pct = (n: number, d: number) => `${n}/${d} (${d ? ((100 * n) / d).toFixed(1) : '-'}%)`;
console.log(`files:                 ${totals.files}  (crashed: ${totals.crashed})`);
console.log(`unedited identical:    ${pct(totals.identical, totals.files)}`);
console.log(`fresh re-parse equal:  ${pct(totals.fresh, totals.files)}`);
console.log(`fuzz edits minimal:    ${pct(totals.editOk, totals.edits)}`);
console.log(`blocks kept as raw:    ${pct(totals.rawBlocks, totals.blocks)}`);
console.log(`parse time:            ${totals.ms.toFixed(0)} ms total, ${(totals.ms / Math.max(1, totals.files)).toFixed(1)} ms/file`);
console.log('slowest parses:', slow.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, ms]) => `${f.split('/').slice(-3).join('/')} ${ms.toFixed(0)}ms`).join(', '));
console.log('raw kinds:', [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k}=${n}`).join(' '));
if (failures.length) {
  console.log(`\n${failures.length} failure reports${verbose ? '' : ' (first 15; VERBOSE=1 for all)'}:\n`);
  for (const f of verbose ? failures : failures.slice(0, 15)) console.log(f + '\n');
}
