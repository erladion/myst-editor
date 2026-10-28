// Print the block structure of parsed corpus files, and the fresh serialization.
import { readFileSync } from 'node:fs';
import type { Node } from 'prosemirror-model';
import { parseMyst } from '../src/core/myst/parse.js';
import { serializeMyst } from '../src/core/myst/serialize.js';

const [file, mode] = process.argv.slice(2);
const { doc, map } = parseMyst(readFileSync(file, 'utf8'));
if (mode === 'fresh') {
  console.log(serializeMyst(doc, map, { fresh: true }));
} else {
  const show = (n: Node, d: number) => {
    const a = n.attrs;
    const info = a.name ? `{${a.name}}` : a.kind ?? (a.marker ? `"${a.marker}"` : '');
    if (n.isBlock) console.log('  '.repeat(d) + n.type.name, info, n.isTextblock ? JSON.stringify(n.textContent.slice(0, 50)) : '');
    if (!n.isTextblock) n.forEach((c) => show(c, d + 1));
  };
  doc.forEach((c) => show(c, 0));
}
