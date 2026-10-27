// The app's own URL schemes: images in pages, and the Sphinx build's pages for previews.
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME, BUILD_SCHEME } from '../shared/api.js';
import { resolveForReading, resolveInside } from './project.js';
import { current } from './state.js';
import { outputDirOf } from './sphinx/service.js';
import { fragmentPage } from './sphinx/fragments.js';
import { builtPage } from './sphinx/preview.js';

// Before the app is ready: the schemes act like https (fetch, streaming, origins).
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    // CORS: the window loads the project's fonts from here (Project Settings' PDF fonts).
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: BUILD_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

// `follow`: whether symlinks may lead out of the folder (see resolveForReading).
function serveFrom(base: (url: URL) => string | null, follow = false) {
  return async (request: Request) => {
    const dir = base(new URL(request.url));
    if (!dir) return new Response('Not available', { status: 404 });
    try {
      let rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      return await net.fetch(pathToFileURL((follow ? resolveForReading : resolveInside)(dir, rel)).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
}

export function registerProtocols() {
  // myst-asset://project/<path relative to the project root>: images in pages, and
  // fonts (which, unlike images, a page may only use from another origin with CORS).
  const assets = serveFrom(() => current.project?.root ?? null, true);
  protocol.handle(ASSET_SCHEME, async (request) => {
    const response = await assets(request);
    if (!response.ok || !/\.(ttf|otf|woff2?)$/i.test(new URL(request.url).pathname)) return response;
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, headers });
  });
  // myst-build://<project id>/<path in its HTML output>: the Sphinx preview, one
  // origin per project; _mysteditor/fragment.html previews a single block. Pages get
  // a script that follows the editor's scrolling.
  const files = serveFrom((url) => outputDirOf(url.hostname));
  protocol.handle(BUILD_SCHEME, async (request) => {
    const url = new URL(request.url);
    const outputDir = outputDirOf(url.hostname);
    if (outputDir && url.pathname === '/_mysteditor/fragment.html') {
      const q = url.searchParams;
      return fragmentPage(outputDir, q.get('doc') ?? '', Number(q.get('from')), Number(q.get('to')));
    }
    if (outputDir) {
      let rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const page = await builtPage(outputDir, rel);
      if (page) return page;
    }
    return files(request);
  });
}
