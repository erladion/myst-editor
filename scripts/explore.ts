// Dump the mdast myst-parser produces for a file (positions shortened to line:col ranges).
//   npx tsx scripts/explore.ts <file.md>
import { readFileSync } from 'node:fs';
import { mystParse } from 'myst-parser';

const tree = mystParse(readFileSync(process.argv[2], 'utf8'), { extensions: { smartquotes: false, strikethrough: true } });
console.log(
  JSON.stringify(
    tree,
    (k, v) => (k === 'position' ? `${v.start.line}:${v.start.column}-${v.end.line}:${v.end.column}` : v),
    1,
  ),
);
