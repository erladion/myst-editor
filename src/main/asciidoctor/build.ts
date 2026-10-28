// Building an Asciidoctor project's pages with Asciidoctor.js: each page as HTML (for
// the preview), and what the editor needs from the build: titles, which pages include
// which, anchors, and Asciidoctor's warnings where it places them.
//
// Only what a change affects is built again: a changed page, and the pages that
// include it (up to the main document). The main document's attributes apply to every
// page, so when they change everything is. What each page gave is kept (see
// BuildCache), between builds and between sessions.
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { getVersion, load, loadFile, LoggerManager, MemoryLogger } from '@asciidoctor/core';
import type { Project } from '../../shared/api.js';
import type { BuildInfo, BuildPage, BuildTarget, BuildWarning } from '../../shared/build.js';
import { fromProject } from '../../shared/projects.js';
import { headerAttributes, type AsciidocConfig } from '../../core/asciidoc/config.js';
// Asciidoctor's stylesheet, for the built pages (its package keeps it where a bundled
// app can't find it, so it's bundled too).
import STYLESHEET from '../../../node_modules/@asciidoctor/core/data/asciidoctor-default.css?raw';

// What one page gave, and the file it was built from (to tell whether it changed).
interface PageResult {
  size: number;
  mtime: number;
  doc: BuildPage;
  objects: BuildTarget[]; // the anchors written in it
  warnings: BuildWarning[]; // about it
}

export interface BuildCache {
  version: 1;
  attributes: string; // the main document's, as JSON: when they change, every page is built again
  pages: Record<string, PageResult>; // by page, relative to the project
}

export interface BuildOutcome {
  info: BuildInfo;
  cache: BuildCache;
  built: string[]; // the pages built this time
}

export interface BuildRequest {
  previous?: BuildCache | null; // the last build's, to build only what changed since
  changed?: string[]; // files that changed, relative to the project
  fresh?: boolean; // every page, whatever changed
  extra?: Record<string, string>; // attributes for this build
}

// One build at a time: Asciidoctor's logger is shared.
let queue: Promise<unknown> = Promise.resolve();

const SKIPPED = new Set(['node_modules', '_build', 'build']);

// The project's pages, relative to it.
export async function pagesIn(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIPPED.has(e.name)) continue;
    if (e.isDirectory()) out.push(...(await pagesIn(join(dir, e.name), base)));
    else if (e.name.endsWith('.adoc')) out.push(relative(base, join(dir, e.name)).split(sep).join('/'));
  }
  return out.sort();
}

const stem = (page: string) => page.replace(/\.adoc$/, '');
const titleOf = (title: unknown) => (title === undefined || title === null || title === '' ? null : String(title));

// The files a page includes, relative to the project, in order.
function includesOf(page: string, text: string): string[] {
  return [...text.matchAll(/^include::([^\s[]+)\[/gm)].map((m) => join(dirname(page), m[1]).split(sep).join('/'));
}

// What's used of Asciidoctor's blocks here.
interface Node {
  getBlocks(): unknown[];
  getContext(): string;
  getLineNumber?(): number | undefined;
  getSourceLocation?(): { getFile?(): string } | undefined;
  addRole?(name: string): boolean;
  convert(): Promise<string>;
}

// Each block written in the page gets its line as a class (mysteditor-line-N), as
// Sphinx's do, for the preview to follow the editor; and the page's blocks (those of
// its sections) their HTML, for cards: what blocks start on which lines.
function markLines(doc: Node, own: (file: string | undefined) => boolean): { block: Node; line: number }[] {
  const fragments: { block: Node; line: number }[] = [];
  const visit = (parent: Node, outer: boolean) => {
    for (const child of parent.getBlocks()) {
      if (!child || typeof child !== 'object' || !('getContext' in child)) continue;
      const block = child as Node;
      const line = block.getLineNumber?.();
      if (line && own(block.getSourceLocation?.()?.getFile?.())) {
        block.addRole?.(`mysteditor-line-${line}`);
        if (outer && block.getContext() !== 'section' && block.getContext() !== 'preamble') fragments.push({ block, line });
      }
      const context = block.getContext();
      visit(block, outer && (context === 'section' || context === 'preamble'));
    }
  };
  visit(doc, true);
  return fragments;
}

export function buildAsciidoctor(project: Project, outputDir: string, request: BuildRequest = {}): Promise<BuildOutcome> {
  const run = queue.then(() => build(project, outputDir, request));
  queue = run.catch(() => {});
  return run;
}

async function build(project: Project, outputDir: string, { previous, changed = [], fresh = false, extra = {} }: BuildRequest): Promise<BuildOutcome> {
  const started = performance.now();
  const config = project.config as AsciidocConfig;
  const pages = await pagesIn(project.sourceDir);
  const pageSet = new Set(pages);
  const texts = new Map<string, string>();
  const stats = new Map<string, { size: number; mtime: number }>();
  for (const page of pages) {
    const file = join(project.sourceDir, page);
    texts.set(page, await fs.readFile(file, 'utf8').catch(() => ''));
    const st = await fs.stat(file).catch(() => null);
    stats.set(page, { size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 });
  }
  // The main document's header sets attributes for every page (read again: it may
  // have changed since the project was opened).
  const mainAttributes = config.main ? headerAttributes(texts.get(config.main) ?? '') : {};
  const attributesKey = JSON.stringify([mainAttributes, extra]);
  const reuse = previous?.version === 1 && previous.attributes === attributesKey && !fresh ? previous : null;

  // What's built: pages that are new or changed (or whose included files are), and the
  // pages including those.
  const dirty = new Set<string>();
  for (const page of pages) {
    const was = reuse?.pages[page];
    const now = stats.get(page)!;
    if (!was || was.size !== now.size || was.mtime !== now.mtime) dirty.add(page);
  }
  for (const file of changed) {
    if (pageSet.has(file)) dirty.add(file);
    // A snippet, a code sample, an image: the pages that include or name it.
    else for (const page of pages) if (includesOf(page, texts.get(page)!).includes(file) || texts.get(page)!.includes(basename(file))) dirty.add(page);
  }
  const includers = new Map<string, string[]>();
  for (const page of pages) for (const inc of includesOf(page, texts.get(page)!)) includers.set(inc, [...(includers.get(inc) ?? []), page]);
  const upward = [...dirty];
  while (upward.length) {
    for (const up of includers.get(upward.pop()!) ?? []) {
      if (!dirty.has(up)) {
        dirty.add(up);
        upward.push(up);
      }
    }
  }

  const results: Record<string, PageResult> = {};
  for (const page of pages) if (!dirty.has(page) && reuse?.pages[page]) results[page] = reuse.pages[page];
  const pageOf = (file: string | undefined) => {
    if (!file) return null;
    const rel = relative(project.sourceDir, resolve(file)).split(sep).join('/');
    return pageSet.has(rel) ? rel : null;
  };
  const attributes = { ...mainAttributes, ...extra, showtitle: '', 'attribute-missing': 'warn' };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(join(outputDir, 'asciidoctor.css'), STYLESHEET);
  const logger = MemoryLogger.create();
  const before = LoggerManager.getLogger();
  LoggerManager.setLogger(logger);
  const built = pages.filter((p) => dirty.has(p));
  try {
    for (const page of built) {
      const file = join(project.sourceDir, page);
      const from = logger.getMessages().length;
      const out = join(outputDir, `${stem(page)}.html`);
      const stylesdir = relative(dirname(out), outputDir).split(sep).join('/') || '.';
      const doc = await loadFile(file, { safe: 'safe', sourcemap: true, base_dir: project.sourceDir, attributes: { ...attributes, outfilesuffix: '.html', linkcss: '', stylesheet: 'asciidoctor.css', stylesdir } });
      const blocks = markLines(doc as unknown as Node, (f) => pageOf(f) === page);
      const html = (await doc.convert({ standalone: true })) as string;
      // (After the page: converting a block on its own first would count its footnotes twice.)
      const fragments = [];
      for (const b of blocks) fragments.push({ line: b.line, html: await b.block.convert() });
      await fs.mkdir(dirname(out), { recursive: true });
      await fs.writeFile(out, html);
      // Its blocks one by one, for cards' previews (see sphinx/fragments.ts).
      const fragmentFile = join(outputDir, '_mysteditor', 'fragments', `${stem(page)}.json`);
      await fs.mkdir(dirname(fragmentFile), { recursive: true });
      await fs.writeFile(fragmentFile, JSON.stringify({ uri: `${stem(page)}.html`, fragments }));
      const objects: BuildTarget[] = [];
      // Its own anchors (an included page's are its own build's).
      for (const [id, node] of Object.entries(doc.getRefs() as Record<string, { getTitle?(): string; getContext?(): string; getSourceLocation?(): { getFile?(): string } | undefined }>)) {
        if ((pageOf(node.getSourceLocation?.()?.getFile?.()) ?? page) !== page) continue;
        objects.push({ domain: 'adoc', type: node.getContext?.() === 'section' ? 'section' : 'anchor', name: id, title: node.getTitle?.() ?? null, doc: stem(page), anchor: id });
      }
      const warnings: BuildWarning[] = [];
      for (const m of logger.getMessages().slice(from)) {
        const loc = m.getSourceLocation?.();
        const where = pageOf(loc?.getFile?.());
        // About an included page: its own build says so.
        if (where && where !== page) continue;
        const severity = String(m.getSeverity?.() ?? '').toLowerCase();
        warnings.push({
          source: fromProject(project, page),
          line: where ? (loc?.getLineNumber?.() ?? null) : null,
          level: /error|fatal/.test(severity) ? 'error' : 'warning',
          message: String(m.getText?.() ?? m),
          type: null,
          phase: 'read',
        });
      }
      results[page] = {
        ...stats.get(page)!,
        doc: {
          source: fromProject(project, page),
          title: titleOf(doc.getDocumentTitle({ sanitize: true })),
          uri: `${stem(page)}.html`,
          children: includesOf(page, texts.get(page)!).filter((f) => pageSet.has(f)).map(stem),
        },
        objects,
        warnings,
      };
    }
  } finally {
    LoggerManager.setLogger(before);
  }

  // A warning without a place (a missing attribute) comes from a page and from those
  // including it: it's the innermost's.
  const below = (page: string, seen = new Set<string>()): Set<string> => {
    for (const child of includesOf(page, texts.get(page)!)) if (pageSet.has(child) && !seen.has(child)) below(child, seen.add(child));
    return seen;
  };
  const warnings: BuildWarning[] = [];
  for (const page of pages) {
    const inner = new Set([...below(page)].flatMap((p) => results[p]?.warnings.filter((w) => w.line === null).map((w) => w.message) ?? []));
    warnings.push(...(results[page]?.warnings ?? []).filter((w) => w.line !== null || !inner.has(w.message)));
  }
  const root = config.main ? stem(config.main) : pages.includes('index.adoc') ? 'index' : stem(pages[0] ?? 'index');
  const info: BuildInfo = {
    builtWith: { name: 'Asciidoctor', version: getVersion() },
    rootDoc: root,
    docs: Object.fromEntries(pages.filter((p) => results[p]).map((p) => [stem(p), results[p].doc])),
    objects: pages.flatMap((p) => results[p]?.objects ?? []),
    warnings,
    builtAt: Date.now(),
    duration: (performance.now() - started) / 1000,
    variables: {},
  };
  return { info, cache: { version: 1, attributes: attributesKey, pages: results }, built };
}

// ---- the whole project as one page, for a PDF ------------------------------------

// The PDF's layout reads Sphinx's one page: content in [role="main"], sections, and a
// marker before each page's. Asciidoctor's page, made so in the window it's printed in.
const ONE_PAGE_SCRIPT = (chapters: Record<string, string>) => `<script>
(() => {
  const chapters = ${JSON.stringify(chapters).replace(/</g, '\\u003c')};
  const content = document.getElementById('content');
  if (!content) return;
  for (const div of [...content.querySelectorAll('div.sect1, div.sect2, div.sect3, div.sect4, div.sect5, div.sect6')].reverse()) {
    const section = document.createElement('section');
    section.className = div.className;
    while (div.firstChild) section.append(div.firstChild);
    // Its id on it, as Sphinx's sections have theirs (links to it still lead there).
    const heading = [...section.children].find((c) => /^H[1-6]$/.test(c.tagName));
    if (div.id) section.id = div.id;
    else if (heading && heading.id) {
      section.id = heading.id;
      heading.removeAttribute('id');
    }
    div.replaceWith(section);
  }
  for (const [id, doc] of Object.entries(chapters)) {
    const section = document.getElementById(id)?.closest('section');
    if (section) section.before(Object.assign(document.createElement('span'), { id: 'document-' + doc }));
  }
  const main = document.createElement('div');
  main.setAttribute('role', 'main');
  const root = document.createElement('section');
  const title = document.querySelector('#header > h1');
  if (title) root.append(title);
  root.append(...content.childNodes);
  const footnotes = document.getElementById('footnotes');
  if (footnotes) root.append(footnotes);
  main.append(root);
  document.body.replaceChildren(main);
})();
</script>`;

// The project as one page: the main document with what it includes, or (without one)
// every page in turn. `outputDir`: where the page goes, with the stylesheet if wanted.
export function onePage(project: Project, outputDir: string, siteCss: boolean): Promise<{ html: string; variables: Record<string, string>; version: string; release: string; warnings: BuildWarning[] }> {
  const run = queue.then(() => buildOnePage(project, outputDir, siteCss));
  queue = run.catch(() => {});
  return run;
}

async function buildOnePage(project: Project, outputDir: string, siteCss: boolean) {
  const config = project.config as AsciidocConfig;
  const pages = await pagesIn(project.sourceDir);
  const pageSet = new Set(pages);
  const mainText = config.main
    ? await fs.readFile(join(project.sourceDir, config.main), 'utf8')
    : `= ${project.name}\n\n${pages.map((p) => `include::${p}[leveloffset=+1]`).join('\n\n')}\n`;
  const mainAttributes = headerAttributes(mainText);
  await fs.mkdir(outputDir, { recursive: true });
  if (siteCss) await fs.writeFile(join(outputDir, 'asciidoctor.css'), STYLESHEET);
  const logger = MemoryLogger.create();
  const before = LoggerManager.getLogger();
  LoggerManager.setLogger(logger);
  let html: string;
  const chapters: Record<string, string> = {};
  try {
    const attributes = {
      ...mainAttributes,
      showtitle: '',
      'attribute-missing': 'warn',
      // Pictures in the page itself: it isn't where the pages are.
      'data-uri': '',
      ...(siteCss ? { linkcss: '', stylesheet: 'asciidoctor.css', stylesdir: '.' } : { 'stylesheet!': '' }),
    };
    const options = { safe: 'safe', sourcemap: true, base_dir: project.sourceDir, attributes };
    const doc = config.main ? await loadFile(join(project.sourceDir, config.main), options) : await load(mainText, options);
    // Where each included page starts: its first section of its own.
    const mainPage = config.main ?? '';
    for (const block of doc.getBlocks() as { getContext(): string; getId(): string; getSourceLocation?(): { getFile?(): string } | undefined }[]) {
      if (block.getContext() !== 'section') continue;
      const file = block.getSourceLocation?.()?.getFile?.();
      const page = file ? relative(project.sourceDir, resolve(file)).split(sep).join('/') : null;
      if (page && page !== mainPage && pageSet.has(page) && !Object.values(chapters).includes(stem(page))) chapters[block.getId()] = stem(page);
    }
    html = (await doc.convert({ standalone: true })) as string;
  } finally {
    LoggerManager.setLogger(before);
  }
  const file = join(outputDir, `${stem(config.main ?? 'index')}.html`);
  await fs.writeFile(file, html.replace('</body>', `${ONE_PAGE_SCRIPT(chapters)}\n</body>`));
  const warnings: BuildWarning[] = logger.getMessages().map((m) => {
    const loc = m.getSourceLocation?.();
    const where = loc?.getFile?.() ? relative(project.sourceDir, resolve(loc.getFile!()!)).split(sep).join('/') : null;
    return {
      source: where && pageSet.has(where) ? fromProject(project, where) : null,
      line: loc?.getLineNumber?.() ?? null,
      level: /error|fatal/i.test(String(m.getSeverity?.() ?? '')) ? 'error' : 'warning',
      message: String(m.getText?.() ?? m),
      type: null,
      phase: 'read',
    };
  });
  const version = mainAttributes.revnumber ?? '';
  return { html: file, variables: mainAttributes, version, release: version, warnings };
}
