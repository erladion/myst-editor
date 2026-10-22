// Built pages as the preview shows them: with a script that scrolls to where the
// editor is. mysteditor_build.py tags each block with its source line (a
// mysteditor-line-N class); the editor posts the line at the top of its view, a
// fraction when it's part way through a block, or "end".
import { promises as fs } from 'node:fs';
import { resolveInside } from '../project.js';

const SCRIPT = `
(() => {
  let want = null;
  function anchors() {
    const out = [];
    for (const el of document.querySelectorAll('[class*="mysteditor-line-"]')) {
      const m = /(?:^|\\s)mysteditor-line-(\\d+)(?:\\s|$)/.exec(el.className);
      if (m && el.getClientRects().length) out.push({ line: Number(m[1]), el });
    }
    return out.sort((a, b) => a.line - b.line);
  }
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  function go() {
    if (want === null) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    let y = 0;
    if (want === 'end') y = max;
    else {
      const list = anchors();
      const i = list.findLastIndex((a) => a.line <= want);
      if (i >= 0) {
        const a = list[i], b = list[i + 1];
        y = top(a.el);
        if (b && b.line > a.line) y += ((want - a.line) / (b.line - a.line)) * (top(b.el) - y);
        y -= 8;
      }
    }
    scrollTo({ top: Math.max(0, Math.min(max, y)), behavior: 'instant' });
  }
  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || !('mysteditorScroll' in e.data)) return;
    want = e.data.mysteditorScroll;
    go();
  });
  // Pictures change the layout as they load.
  addEventListener('load', go);
})();
`;

// The page at `rel` in the build output, or null when it isn't an HTML page.
export async function builtPage(outputDir: string, rel: string): Promise<Response | null> {
  if (!rel.endsWith('.html')) return null;
  let html: string;
  try {
    html = await fs.readFile(resolveInside(outputDir, rel), 'utf8');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const script = `<script>${SCRIPT}</script>`;
  const at = html.lastIndexOf('</body>');
  html = at < 0 ? html + script : html.slice(0, at) + script + html.slice(at);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
