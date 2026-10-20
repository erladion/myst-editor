// Show the first block whose fresh serialization re-parses differently.
//   npx tsx scripts/debug-file.ts <file.md>
import { readFileSync } from 'node:fs';
import type { Node as PMNode } from 'prosemirror-model';
import { parseMyst } from '../src/parse.js';
import { serializeMyst } from '../src/serialize.js';
import { normalized } from '../test/helpers.js';

const src = readFileSync(process.argv[2], 'utf8');
const { doc, map } = parseMyst(src);
const unedited = serializeMyst(doc, map);
if (unedited !== src) {
  const a = src.split('\n');
  const b = unedited.split('\n');
  const i = a.findIndex((l, i) => l !== b[i]);
  console.log(`UNEDITED differs at line ${i + 1} (src ${a.length} lines, out ${b.length} lines)`);
  console.log(' src:', JSON.stringify(a.slice(Math.max(0, i - 2), i + 3)));
  console.log(' out:', JSON.stringify(b.slice(Math.max(0, i - 2), i + 3)));
}

// Compare block by block, descending into containers with matching child counts.
const reparsed = parseMyst(serializeMyst(doc, map, { fresh: true })).doc;
const key = (n: PMNode) => JSON.stringify(normalized(n));
function find(a: PMNode, b: PMNode, path: string): boolean {
  if (key(a) === key(b)) return false;
  if (!a.isTextblock && !a.isAtom && a.childCount === b.childCount && a.type === b.type) {
    for (let i = 0; i < a.childCount; i++) if (find(a.child(i), b.child(i), `${path}/${a.child(i).type.name}[${i}]`)) return true;
  }
  console.log(`FRESH differs at ${path}`);
  console.log(' original source:', JSON.stringify(map.get(a.attrs.sid)?.text ?? '(no source)'));
  console.log(' fresh output:   ', JSON.stringify(serializeMyst(a.type.name === 'doc' ? a : a.type.schema.node('doc', null, [a.type.name === 'list_item' ? a.type.schema.node('bullet_list', null, [a]) : a]), map, { fresh: true })));
  console.log(' original:', JSON.stringify(normalized(a)).slice(0, 600));
  console.log(' reparsed:', JSON.stringify(normalized(b)).slice(0, 600));
  return true;
}
if (!find(doc, reparsed, 'doc')) console.log('fresh OK');
