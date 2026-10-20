// Preview pages for single blocks, from the fragments mysteditor_build.py exports.
// Served on the project's myst-build:// origin and shown in sandboxed iframes, so
// whatever HTML a directive produced never runs in the editor itself.
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveInside } from '../project.js';

interface FragmentFile {
  uri: string | null;
  fragments: { line: number; html: string }[];
}

// Reports its height (or that it's empty) to the editor, and keeps clicks on links
// from navigating the preview away.
const SCRIPT = `
const id = new URLSearchParams(location.search).get('id');
const main = document.querySelector('main');
function post() {
  const empty = !main.innerText.trim() && !main.querySelector('img, svg, canvas, iframe, video, object');
  // The content's own extent: themes often give the page margins or a min-height.
  const height = Math.ceil(main.getBoundingClientRect().bottom + window.scrollY);
  parent.postMessage({ mysteditorFragment: id, height, empty }, '*');
}
new ResizeObserver(post).observe(main);
addEventListener('load', post);
document.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); }, true);
`;

const STYLE = `
html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; min-height: 0 !important; }
body > main { display: block; max-width: none; margin: 0; padding: 2px 4px 6px; }
body > main > .body { max-width: none !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important; }
`;

// `docname` and lines come from the renderer; the page joins the head of the built
// page with the fragments that start within [from, to].
export async function fragmentPage(outputDir: string, docname: string, from: number, to: number): Promise<Response> {
  let data: FragmentFile;
  try {
    data = JSON.parse(await fs.readFile(resolveInside(outputDir, join('_mysteditor', 'fragments', `${docname}.json`)), 'utf8'));
  } catch {
    return page('', '', '/');
  }
  const html = data.fragments
    .filter((f) => f.line >= from && f.line <= to)
    .map((f) => f.html)
    .join('\n');
  let head = '';
  if (data.uri) {
    try {
      const built = await fs.readFile(resolveInside(outputDir, data.uri.endsWith('/') ? `${data.uri}index.html` : data.uri), 'utf8');
      head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(built)?.[1].replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<base[^>]*>/gi, '') ?? '';
    } catch {
      // no built page yet: unstyled preview
    }
  }
  const dir = data.uri ? dirname(data.uri.endsWith('/') ? `${data.uri}x` : data.uri) : '.';
  return page(head, html, `/${dir === '.' ? '' : `${dir}/`}`);
}

function page(head: string, body: string, base: string): Response {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base href="${base}">${head}<style>${STYLE}</style></head>
<body class="mysteditor-fragment"><main><div class="body rst-content bd-article" role="main"><article class="bd-article" role="main">${body}</article></div></main><script>${SCRIPT}</script></body></html>`;
  return new Response(doc, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
