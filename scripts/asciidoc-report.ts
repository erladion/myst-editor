// Round-trip report over directories of real AsciiDoc files.
//
//   npx tsx scripts/asciidoc-report.ts <dir-or-file>...
//
// For each file: unedited byte-identity, fresh writing re-read the same, and typing
// a character into every paragraph and heading in turn (one line changes, and it
// reads back as edited). Then what was kept as written, by kind.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { diffLines } from 'diff';
import { Fragment, Slice } from 'prosemirror-model';
import { parseAsciidoc } from '../src/core/asciidoc/parse.js';
import { serializeAsciidoc } from '../src/core/asciidoc/serialize.js';
import { semanticForm } from '../src/core/document.js';

const files = process.argv.slice(2).flatMap(walk);
const verbose = process.env.VERBOSE === '1';
const totals = { files: 0, identical: 0, fresh: 0, edits: 0, editOk: 0, crashed: 0, blocks: 0, raw: 0 };
const kinds = new Map<string, number>();
const failures: string[] = [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const file of files) {
  totals.files++;
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const name = relative(process.cwd(), file);
  try {
    const { doc, map } = parseAsciidoc(src);
    doc.descendants((n) => {
      if (!n.isBlock || n.type.name === 'list_item') return true;
      totals.blocks++;
      if (n.type.name === 'raw_block' || n.type.name === 'opaque_directive') {
        totals.raw++;
        const k = n.type.name === 'raw_block' ? n.attrs.kind : `${n.attrs.name}::`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        if (verbose && n.attrs.kind === 'asciidoc') console.log(`${name}: kept as written:\n${n.attrs.source.split('\n').slice(0, 4).join('\n')}\n`);
      }
      return true;
    });
    const out = serializeAsciidoc(doc, map);
    if (out === src) totals.identical++;
    else failures.push(`${name}: unedited round-trip differs\n${diff(src, out)}`);
    const fresh = serializeAsciidoc(doc, map, { fresh: true });
    if (same(semanticForm(parseAsciidoc(fresh).doc), semanticForm(doc))) totals.fresh++;
    else failures.push(`${name}: written anew, reads differently\n${diff(src, fresh)}`);
    const places: number[] = [];
    doc.descendants((n, pos) => {
      if (n.isTextblock && n.type.name !== 'code_block' && n.type.name !== 'math_block' && n.content.size) places.push(pos + n.nodeSize - 1);
      return true;
    });
    for (const at of places.slice(0, 40)) {
      totals.edits++;
      const { doc, map } = parseAsciidoc(src);
      const edited = doc.replace(at, at, new Slice(Fragment.from(doc.type.schema.text('X')), 0, 0));
      const text = serializeAsciidoc(edited, map);
      const removed = diffLines(src, text).filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
      if (same(semanticForm(parseAsciidoc(text).doc), semanticForm(edited)) && removed <= 1) totals.editOk++;
      else failures.push(`${name}: typing at ${at} (${removed} lines changed)\n${diff(src, text)}`);
    }
  } catch (e) {
    totals.crashed++;
    failures.push(`${name}: CRASH ${(e as Error).stack?.split('\n').slice(0, 4).join('\n')}`);
  }
}

console.log(failures.slice(0, Number(process.env.SHOW ?? 15)).join('\n\n'));
console.log(`\n${failures.length} failures`);
console.log(totals);
console.log([...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', '));

function walk(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((f) => (f.startsWith('.') ? [] : walk(join(path, f)))).filter((f) => f.endsWith('.adoc'));
}

function diff(a: string, b: string): string {
  return diffLines(a, b)
    .filter((p) => p.added || p.removed)
    .slice(0, 6)
    .map((p) => p.value.replace(/\n$/, '').split('\n').slice(0, 6).map((l) => (p.added ? '+ ' : '- ') + l).join('\n'))
    .join('\n');
}
