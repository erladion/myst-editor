// Count inline mdast types that force a paragraph to fall back to a raw block.
import { readFileSync } from 'node:fs';
import { mystParse } from 'myst-parser';

const known = new Set(['text', 'emphasis', 'strong', 'delete', 'link', 'inlineCode', 'break', 'mystRole', 'inlineMath', 'html', 'footnoteReference', 'image']);
const counts = new Map<string, number>();
const examples = new Map<string, string>();
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, 'utf8');
  const walk = (n: any, inPara: boolean) => {
    if (inPara && !known.has(n.type) && !['paragraph', 'heading'].includes(n.type)) {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
      if (!examples.has(n.type)) examples.set(n.type, src.split('\n')[n.position?.start.line - 1]?.slice(0, 120) ?? '');
    }
    if (n.type === 'mystRole') return;
    for (const c of n.children ?? []) walk(c, inPara || n.type === 'paragraph' || n.type === 'heading');
  };
  walk(mystParse(src, { extensions: { smartquotes: false, strikethrough: true } }), false);
}
for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(n, t, '  e.g.', JSON.stringify(examples.get(t)));
