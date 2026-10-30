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
import { isComponentPage, resolveResource, startPageOf, type Antora } from '../../core/asciidoc/antora.js';
import { antoraConverter, builtFiles, contentsOf, includeResources, pageAttributes, pageLinks, readComponentIn, titlesOf, type Links } from './antora.js';
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
  version: 2;
  attributes: string; // the main document's, as JSON: when they change, every page is built again
  files: Record<string, { size: number; mtime: number }>; // every AsciiDoc file's, to tell which changed
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

// A book's :imagesdir: (from its main document's folder) as seen from `page`.
function imagesFrom(page: string, main: string, imagesdir: string | undefined): string | null {
  if (imagesdir && /^([a-z][\w+.-]*:|\/)/i.test(imagesdir)) return null;
  const target = join(dirname(main), imagesdir ?? '');
  return relative(dirname(page), target).split(sep).join('/') || '.';
}
const titleOf = (title: unknown) => (title === undefined || title === null || title === '' ? null : String(title));

// The files a page includes, relative to the project, in order. In an Antora
// component, resources (partial$note.adoc) are the module's.
function includesOf(page: string, text: string, antora: Antora | null): string[] {
  return [...text.matchAll(/^include::([^\s[]+)\[/gm)].map((m) => includeTarget(page, m[1], antora));
}

// The file an include names, relative to the project.
function includeTarget(page: string, target: string, antora: Antora | null): string {
  return antora && /\$/.test(target) ? (resolveResource(antora, page, target, 'partial')?.file ?? target) : join(dirname(page), target).split(sep).join('/');
}

// What's used of Asciidoctor's blocks here.
interface Node {
  getBlocks(): unknown[];
  getContext(): string;
  getLineNumber?(): number | undefined;
  getSourceLocation?(): { getFile?(): string } | undefined;
  addRole?(name: string): boolean;
  getLevel?(): number;
  getId?(): string;
  getTitle?(): string;
  convert(): Promise<string>;
}

// The most an include's preview shows (a whole book's chapter can be a lot).
const MAX_FRAGMENT = 300_000;

// What an include brought into a page, for its card: blocks, and its sections' headings.
type Included = { block: Node } | { heading: string };

// Each block written in the page gets its line as a class (mysteditor-line-N), as
// Sphinx's do, for the preview to follow the editor; and the page's blocks (those of
// its sections) their HTML, for cards: what blocks start on which lines. What an
// include brings in is its include's (`includeAt`: the line of the include that
// brought a file's blocks in, after the page's own block on line `after`): its first
// block gets the include's line, and its card all of it.
function markLines(doc: Node, own: (file: string | undefined) => boolean, includeAt: (file: string | undefined, after: number) => number | null) {
  const fragments: { block: Node; line: number }[] = [];
  const included = new Map<number, Included[]>();
  let lastOwn = 0;
  const visit = (parent: Node, outer: boolean, group: number | null) => {
    for (const child of parent.getBlocks()) {
      if (!child || typeof child !== 'object' || !('getContext' in child)) continue;
      const block = child as Node;
      const line = block.getLineNumber?.();
      const file = block.getSourceLocation?.()?.getFile?.();
      const context = block.getContext();
      const sectionish = context === 'section' || context === 'preamble';
      if (line && own(file)) {
        block.addRole?.(`mysteditor-line-${line}`);
        lastOwn = line;
        if (outer && !sectionish) fragments.push({ block, line });
        visit(block, outer && sectionish, null);
        continue;
      }
      const at = outer ? (group ?? includeAt(file, lastOwn)) : null;
      if (at === null) {
        visit(block, outer && sectionish, group);
        continue;
      }
      let parts = included.get(at);
      if (!parts) {
        included.set(at, (parts = []));
        block.addRole?.(`mysteditor-line-${at}`);
      }
      if (context === 'section') {
        const h = (block.getLevel?.() ?? 1) + 1;
        parts.push({ heading: `<h${h}${block.getId?.() ? ` id="${block.getId()}"` : ''}>${block.getTitle?.() ?? ''}</h${h}>` });
      }
      if (sectionish) visit(block, true, at);
      else parts.push({ block });
    }
  };
  visit(doc, true, null);
  return { fragments, included };
}

export function buildAsciidoctor(project: Project, outputDir: string, request: BuildRequest = {}): Promise<BuildOutcome> {
  const run = queue.then(() => build(project, outputDir, request));
  queue = run.catch(() => {});
  return run;
}

async function build(project: Project, outputDir: string, { previous, changed = [], fresh = false, extra = {} }: BuildRequest): Promise<BuildOutcome> {
  const started = performance.now();
  const config = project.config as AsciidocConfig;
  // Every AsciiDoc file, and of those the pages built (an Antora component's partials
  // aren't pages: they're built in the pages including them).
  const files = await pagesIn(project.sourceDir);
  const fileSet = new Set(files);
  const component = config.antora ? await readComponentIn(project.sourceDir, config.antora) : null;
  const antora = component?.antora ?? null;
  const pages = antora ? builtFiles(antora, files) : files;
  const pageSet = new Set(pages);
  const texts = new Map<string, string>();
  const stats: Record<string, { size: number; mtime: number }> = {};
  for (const rel of files) {
    const file = join(project.sourceDir, rel);
    texts.set(rel, await fs.readFile(file, 'utf8').catch(() => ''));
    const st = await fs.stat(file).catch(() => null);
    stats[rel] = { size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 };
  }
  // The main document's header sets attributes for every page, or the component's
  // antora.yml does (read again: they may have changed since the project was opened).
  const mainAttributes = component ? component.attributes : config.main ? headerAttributes(texts.get(config.main) ?? '') : {};
  const attributesKey = JSON.stringify([mainAttributes, extra, antora]);
  const reuse = previous?.version === 2 && previous.attributes === attributesKey && !fresh ? previous : null;
  const includes = (rel: string) => includesOf(rel, texts.get(rel) ?? '', antora);
  // Where `page` (or what it includes) refers to the attribute a warning says is missing.
  const attributeAt = (page: string, message: string, seen = new Set<string>()): { file: string; line: number } | null => {
    const name = /missing attribute: ([\w-]+)/.exec(message)?.[1];
    if (!name || seen.has(page)) return null;
    seen.add(page);
    const line = (texts.get(page) ?? '').split('\n').findIndex((l) => l.includes(`{${name}}`));
    if (line >= 0) return { file: page, line: line + 1 };
    for (const inc of includes(page)) {
      const found = attributeAt(inc, message, seen);
      if (found) return found;
    }
    return null;
  };

  // What's built: pages that are new or changed (or whose included files are), and the
  // pages including those.
  const dirty = new Set<string>();
  for (const rel of files) {
    const was = reuse?.files[rel];
    const now = stats[rel];
    if (!was || was.size !== now.size || was.mtime !== now.mtime || (pageSet.has(rel) && !reuse?.pages[rel])) dirty.add(rel);
  }
  for (const file of changed) {
    if (fileSet.has(file)) dirty.add(file);
    // A snippet, a code sample, an image: the pages that include or name it.
    else for (const rel of files) if (includes(rel).includes(file) || texts.get(rel)!.includes(basename(file))) dirty.add(rel);
  }
  const includers = new Map<string, string[]>();
  for (const rel of files) for (const inc of includes(rel)) includers.set(inc, [...(includers.get(inc) ?? []), rel]);
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
  // A file Asciidoctor read, relative to the project: a page, or what a page includes.
  const fileOf = (file: string | undefined) => {
    if (!file) return null;
    const rel = relative(project.sourceDir, resolve(file)).split(sep).join('/');
    return fileSet.has(rel) ? rel : null;
  };
  const attributes = { ...mainAttributes, ...extra, showtitle: '', 'attribute-missing': 'warn' };
  const titles = antora ? titlesOf(texts, mainAttributes) : null;
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
      const own = { outfilesuffix: '.html', linkcss: '', stylesheet: 'asciidoctor.css', stylesdir };
      let options;
      if (antora) {
        options = {
          extension_registry: includeResources(antora, project.sourceDir, page),
          converter: antoraConverter(antora, project.sourceDir, page, pageLinks(page, titles!, antora.nav.includes(page))),
          attributes: { ...attributes, ...pageAttributes(antora, page), ...own },
        };
      } else {
        // In a book, pictures are found from the main document's folder, also when a
        // chapter is built on its own.
        const imagesdir = config.main ? imagesFrom(page, config.main, mainAttributes.imagesdir) : null;
        options = { attributes: { ...attributes, ...(imagesdir !== null ? { imagesdir } : {}), ...own } };
      }
      const doc = await loadFile(file, { safe: 'safe', sourcemap: true, base_dir: project.sourceDir, ...options });
      // The page's includes, by line, and the file each brings in.
      const direct = (texts.get(page) ?? '').split('\n').flatMap((l, i) => {
        const m = /^include::([^\s[]+)\[/.exec(l);
        return m ? [{ line: i + 1, file: includeTarget(page, m[1], antora) }] : [];
      });
      const reaches = (from: string, to: string, seen = new Set<string>()): boolean => from === to || includes(from).some((f) => !seen.has(f) && (seen.add(f), reaches(f, to, seen)));
      const includeAt = (f: string | undefined, after: number) => {
        if (!f) return null;
        const rel = relative(project.sourceDir, resolve(f)).split(sep).join('/');
        const candidates = direct.filter((d) => reaches(d.file, rel));
        return (candidates.find((d) => d.line > after) ?? candidates[candidates.length - 1])?.line ?? null;
      };
      const { fragments: blocks, included } = markLines(doc as unknown as Node, (f) => fileOf(f) === page, includeAt);
      const html = (await doc.convert({ standalone: true })) as string;
      // (After the page: converting a block on its own first would count its footnotes twice.)
      const fragments = [];
      for (const b of blocks) fragments.push({ line: b.line, html: await b.block.convert() });
      for (const [line, parts] of included) {
        let html = '';
        for (const part of parts) html += 'heading' in part ? part.heading : await part.block.convert();
        if (html.length <= MAX_FRAGMENT) fragments.push({ line, html });
      }
      fragments.sort((a, b) => a.line - b.line);
      await fs.mkdir(dirname(out), { recursive: true });
      await fs.writeFile(out, html);
      // Its blocks one by one, for cards' previews (see sphinx/fragments.ts).
      const fragmentFile = join(outputDir, '_mysteditor', 'fragments', `${stem(page)}.json`);
      await fs.mkdir(dirname(fragmentFile), { recursive: true });
      await fs.writeFile(fragmentFile, JSON.stringify({ uri: `${stem(page)}.html`, fragments }));
      // Anchors in it, and in what it includes that isn't a page built itself.
      const ownerOf = (f: string | undefined) => {
        const rel = fileOf(f);
        return rel && pageSet.has(rel) ? rel : page;
      };
      const objects: BuildTarget[] = [];
      for (const [id, node] of Object.entries(doc.getRefs() as Record<string, { getTitle?(): string; getContext?(): string; getSourceLocation?(): { getFile?(): string } | undefined }>)) {
        if (ownerOf(node.getSourceLocation?.()?.getFile?.()) !== page) continue;
        objects.push({ domain: 'adoc', type: node.getContext?.() === 'section' ? 'section' : 'anchor', name: id, title: node.getTitle?.() ?? null, doc: stem(page), anchor: id });
      }
      const warnings: BuildWarning[] = [];
      for (const m of logger.getMessages().slice(from)) {
        const loc = m.getSourceLocation?.();
        const where = fileOf(loc?.getFile?.());
        // About an included page: its own build says so.
        if (where && where !== page && pageSet.has(where)) continue;
        const severity = String(m.getSeverity?.() ?? '').toLowerCase();
        const text = String(m.getText?.() ?? m);
        // A missing attribute is said without a place: where it's written.
        const at = where ? { file: where, line: loc?.getLineNumber?.() ?? null } : (attributeAt(page, text) ?? { file: page, line: null });
        if (at.file !== page && pageSet.has(at.file)) continue;
        warnings.push({
          source: fromProject(project, at.file),
          line: at.line,
          level: /error|fatal/.test(severity) ? 'error' : 'warning',
          message: text,
          type: null,
          phase: 'read',
        });
      }
      results[page] = {
        ...stats[page],
        doc: {
          source: fromProject(project, page),
          title: titleOf(doc.getDocumentTitle({ sanitize: true })),
          uri: `${stem(page)}.html`,
          children: antora ? [] : includes(page).filter((f) => pageSet.has(f)).map(stem),
        },
        objects,
        warnings,
      };
    }
  } finally {
    LoggerManager.setLogger(before);
  }

  // A warning without a place comes from a page and from those including it: it's the
  // innermost's. One in a partial is said once, whichever pages include it.
  const below = (page: string, seen = new Set<string>()): Set<string> => {
    for (const child of includes(page)) if (pageSet.has(child) && !seen.has(child)) below(child, seen.add(child));
    return seen;
  };
  const warnings: BuildWarning[] = [];
  const said = new Set<string>();
  for (const page of pages) {
    const inner = new Set([...below(page)].flatMap((p) => results[p]?.warnings.filter((w) => w.line === null).map((w) => w.message) ?? []));
    for (const w of results[page]?.warnings ?? []) {
      if (w.line === null && inner.has(w.message)) continue;
      // Said once (a page's blocks are converted again for cards).
      const key = JSON.stringify([w.source, w.line, w.message]);
      if (said.has(key)) continue;
      said.add(key);
      warnings.push(w);
    }
  }
  const docs: Record<string, BuildPage> = Object.fromEntries(pages.filter((p) => results[p]).map((p) => [stem(p), results[p].doc]));
  let root = config.main ? stem(config.main) : pages.includes('index.adoc') ? 'index' : stem(pages[0] ?? 'index');
  if (antora) {
    // The contents are the navigation files': pages under their entries there, and
    // its headings (which aren't pages: they show the navigation file).
    const contents = contentsOf(antora, texts);
    const start = stem(startPageOf(antora));
    root = contents.root ?? start;
    for (const entry of contents.entries.values()) {
      const doc = docs[entry.name];
      if (doc) docs[entry.name] = { ...doc, title: doc.title ?? entry.title, children: entry.children };
      else if (!entry.page) {
        const source = entry.source ?? 'antora.yml';
        docs[entry.name] = { source: fromProject(project, source), title: entry.title, uri: entry.source ? `${stem(entry.source)}.html` : `${start}.html`, children: entry.children };
      }
    }
  }
  const info: BuildInfo = {
    builtWith: { name: 'Asciidoctor', version: getVersion() },
    rootDoc: root,
    docs,
    objects: pages.flatMap((p) => results[p]?.objects ?? []),
    warnings,
    builtAt: Date.now(),
    duration: (performance.now() - started) / 1000,
    variables: {},
  };
  return { info, cache: { version: 2, attributes: attributesKey, files: stats, pages: results }, built };
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
  const files = await pagesIn(project.sourceDir);
  const component = config.antora ? await readComponentIn(project.sourceDir, config.antora) : null;
  const antora = component?.antora ?? null;
  const pages = antora ? builtFiles(antora, files) : files;
  const pageSet = new Set(pages);
  let book: { text: string; pages: Set<string>; titles: ReturnType<typeof titlesOf> } | null = null;
  if (antora) {
    const texts = new Map<string, string>();
    for (const rel of files) texts.set(rel, await fs.readFile(join(project.sourceDir, rel), 'utf8').catch(() => ''));
    book = { ...antoraBook(antora, texts, pages), titles: titlesOf(texts, component!.attributes) };
  }
  const mainText = book
    ? book.text
    : config.main
      ? await fs.readFile(join(project.sourceDir, config.main), 'utf8')
      : `= ${project.name}\n\n${pages.map((p) => `include::${p}[leveloffset=+1]`).join('\n\n')}\n`;
  const mainAttributes = component ? component.attributes : headerAttributes(mainText);
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
    let doc;
    if (antora && book) {
      // Links to pages in it lead to where they are in it; pictures are in it.
      const inBook = book.pages;
      const titles = book.titles;
      const links: Links = {
        page: (file, fragment) => (fragment ? `#${fragment}` : inBook.has(file) ? `#document-${stem(file)}` : '#'),
        image: (file) => file,
        title: (file) => titles.get(file)?.reftext ?? titles.get(file)?.title ?? null,
      };
      const start = startPageOf(antora);
      doc = await load(mainText, { ...options, extension_registry: includeResources(antora, project.sourceDir, start), converter: antoraConverter(antora, project.sourceDir, start, links), attributes: { ...attributes, ...pageAttributes(antora, start) } });
    } else doc = config.main ? await loadFile(join(project.sourceDir, config.main), options) : await load(mainText, options);
    // Where each included page starts: its first section of its own.
    const mainPage = config.main ?? '';
    type Section = { getContext(): string; getId(): string; getBlocks(): Section[]; getSourceLocation?(): { getFile?(): string } | undefined };
    const visit = (blocks: Section[]) => {
      for (const block of blocks) {
        if (block.getContext() !== 'section') continue;
        const file = block.getSourceLocation?.()?.getFile?.();
        const page = file ? relative(project.sourceDir, resolve(file)).split(sep).join('/') : null;
        if (page && page !== mainPage && pageSet.has(page) && !Object.values(chapters).includes(stem(page))) chapters[block.getId()] = stem(page);
        visit(block.getBlocks());
      }
    };
    visit(doc.getBlocks() as Section[]);
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
  const version = antora?.version ?? mainAttributes.revnumber ?? '';
  return { html: file, variables: mainAttributes, version, release: version, warnings };
}

// An Antora component as one document: its pages in its navigation's order, each a
// section at its depth there, and its headings as sections over theirs. Without
// navigation, its pages in turn.
function antoraBook(antora: Antora, texts: Map<string, string>, pages: string[]): { text: string; pages: Set<string> } {
  const { root, entries } = contentsOf(antora, texts);
  const lines = [`= ${antora.title ?? antora.name}`, ''];
  const included = new Set<string>();
  const walk = (name: string, depth: number) => {
    for (const child of entries.get(name)?.children ?? []) {
      const entry = entries.get(child)!;
      if (entry.page && entry.source) {
        lines.push(`include::${entry.source}[leveloffset=+${depth}]`, '');
        included.add(entry.source);
      } else lines.push(`${'='.repeat(Math.min(depth, 5) + 1)} ${entry.title ?? ''}`, '');
      walk(child, depth + 1);
    }
  };
  if (root) walk(root, 1);
  else
    for (const page of pages.filter(isComponentPage)) {
      lines.push(`include::${page}[leveloffset=+1]`, '');
      included.add(page);
    }
  return { text: lines.join('\n'), pages: included };
}
