// Building an Antora component's pages as Antora would, with Asciidoctor.js: includes
// of partial$ and example$ resources, cross-references and pictures by resource ID
// (see core/asciidoc/antora.ts), antora.yml's attributes, and the contents its
// navigation files list.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Extensions, Html5Converter } from '@asciidoctor/core';
import { readComponent, resolveResource, isComponentPage, type Antora, type Family } from '../../core/asciidoc/antora.js';
import { headingName, listName, readNav, type NavItem } from '../../core/asciidoc/nav.js';
import { parseAsciidoc } from '../../core/asciidoc/parse.js';
import { headerAttributes } from '../../core/asciidoc/config.js';
import { documentTitle } from '../../core/asciidoc/pages.js';
import { relativePath } from '../../core/rename.js';

export interface Component {
  antora: Antora;
  attributes: Record<string, string>; // antora.yml's
}

// antora.yml as it is now (it may have changed since the project was opened).
export async function readComponentIn(sourceDir: string, was: Antora): Promise<Component> {
  const text = await fs.readFile(join(sourceDir, 'antora.yml'), 'utf8').catch(() => '');
  return readComponent(text, was.root) ?? { antora: was, attributes: {} };
}

// What's built: the component's pages, and its navigation files.
export const builtFiles = (antora: Antora, files: string[]) => files.filter((f) => isComponentPage(f) || antora.nav.includes(f));

// Attributes Antora sets on each page.
export function pageAttributes(antora: Antora, page: string): Record<string, string> {
  const m = /^modules\/([^/]+)\/pages\/(.*)$/.exec(page);
  return {
    'page-component-name': antora.name,
    'page-component-version': antora.version ?? '',
    'page-version': antora.version ?? '',
    'page-component-title': antora.title ?? antora.name,
    ...(m ? { 'page-module': m[1], 'page-relative-src-path': m[2] } : {}),
    // Pictures' paths are worked out here (see the converter), not from :imagesdir:.
    imagesdir: '',
  };
}

// The pages' titles, for references without text of their own: a page's reftext, or
// its title; in navigation, its navtitle first.
export function titlesOf(texts: Map<string, string>, attributes: Record<string, string>) {
  const out = new Map<string, { title: string | null; reftext: string | null; navtitle: string | null }>();
  const subs = (s: string | undefined | null) => (s ? s.replace(/\{([\w][\w-]*)\}/g, (all, name) => (name in attributes ? attributes[name].replace(/@$/, '') : all)) : null);
  for (const [page, text] of texts) {
    if (!isComponentPage(page)) continue;
    const header = headerAttributes(text);
    out.set(page, { title: subs(documentTitle(text)), reftext: subs(header.reftext), navtitle: subs(header.navtitle) });
  }
  return out;
}

// Which lines of an included file are wanted: lines=, tag= and tags= (as Asciidoctor
// does for includes it reads itself).
export function selectLines(text: string, attrs: Record<string, string>): string {
  let lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (attrs.lines) {
    const wanted = new Set<number>();
    for (const part of attrs.lines.split(/[;,]/)) {
      const [a, b] = part.split('..').map((n) => n.trim());
      const from = Number(a);
      const to = b === undefined ? from : b === '' || Number(b) < 0 ? lines.length : Number(b);
      for (let i = from; i <= to && i <= lines.length; i++) wanted.add(i);
    }
    lines = lines.filter((_l, i) => wanted.has(i + 1));
  }
  const tags = (attrs.tags ?? attrs.tag ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean);
  if (tags.length) {
    const negated = tags.filter((t) => t.startsWith('!')).map((t) => t.slice(1));
    // Only tags left out: all the others (**).
    const given = tags.filter((t) => !t.startsWith('!'));
    const wanted = given.length ? given : ['**'];
    const untagged = wanted.includes('**');
    const out: string[] = [];
    const open: string[] = [];
    for (const line of lines) {
      const m = /\b(tag|end)::([\w*-]+)\[\]\s*$/.exec(line);
      if (m) {
        if (m[1] === 'tag') open.push(m[2]);
        else open.splice(open.lastIndexOf(m[2]), 1);
        continue;
      }
      const inside = open.length ? open.some((t) => !negated.includes(t) && (wanted.includes(t) || wanted.includes('*') || wanted.includes('**'))) && !open.some((t) => negated.includes(t)) : untagged;
      if (inside) out.push(line);
    }
    lines = out;
  }
  return lines.join('\n');
}

const relFile = (sourceDir: string, file: string | undefined | null) => {
  if (!file) return null;
  const rel = file.startsWith(sourceDir) ? file.slice(sourceDir.length + 1).split('\\').join('/') : null;
  return rel && !rel.startsWith('..') ? rel : null;
};

// Includes of resources (partial$note.adoc, ROOT:example$app.js): the module's file.
// Others are Asciidoctor's: from the including file's folder.
export function includeResources(antora: Antora, sourceDir: string, page: string) {
  return Extensions.create('antora', function (this: { includeProcessor(f: () => void): void }) {
    this.includeProcessor(function (this: { handles(f: (doc: unknown, target: string) => boolean): void; process(f: (doc: unknown, reader: Reader, target: string, attrs: Record<string, string>) => Promise<void>): void }) {
      this.handles((_doc, target) => /^([^:$/]+:){0,2}[a-z]+\$/.test(target));
      this.process(async (_doc, reader, target, attrs) => {
        const from = relFile(sourceDir, reader.getFile?.()) ?? page;
        const found = resolveResource(antora, from, target, 'partial');
        const text = found ? await fs.readFile(join(sourceDir, found.file), 'utf8').catch(() => null) : null;
        if (text === null || !found) {
          reader.logger?.error?.(reader.messageWithContext?.(`include file not found: ${target}`, { sourceLocation: reader.getCursor() }) ?? `include file not found: ${target}`);
          reader.pushInclude(`Unresolved directive in ${from} - include::${target}[]`, null, target, reader.getLineNumber?.() ?? 1, {});
          return;
        }
        reader.pushInclude(selectLines(text, attrs), join(sourceDir, found.file), target, 1, attrs);
      });
    });
  });
}

interface Reader {
  getFile?(): string;
  getCursor(): unknown;
  getLineNumber?(): number;
  logger?: { error?(m: unknown): void };
  messageWithContext?(text: string, context: Record<string, unknown>): unknown;
  pushInclude(data: string, file: string | null, path: string, lineno: number, attrs: Record<string, string>): void;
}

// What the converter needs of a node.
interface Node {
  type?: string;
  target?: string;
  text?: string;
  attributes: Record<string, string | undefined>;
  getAttribute(name: string): string | undefined;
  setAttribute(name: string, value: string): void;
  getParent?(): Node | undefined;
  getSourceLocation?(): { getFile?(): string } | undefined;
}

export interface Links {
  page(file: string, fragment: string | null): string; // a page's href
  image(file: string): string; // a picture's
  title(file: string): string | null; // a reference's text when it has none
}

// The page a node is written in: its block's (a partial's blocks are the page's that
// includes them), else `page`.
function pageOfNode(sourceDir: string, node: Node, page: string): string {
  for (let n: Node | undefined = node; n; n = n.getParent?.()) {
    const file = relFile(sourceDir, n.getSourceLocation?.()?.getFile?.());
    if (file && isComponentPage(file)) return file;
  }
  return page;
}

// Asciidoctor's HTML, with resource IDs made links: xrefs to the page's href and
// title, pictures to their files.
export function antoraConverter(antora: Antora, sourceDir: string, page: string, links: Links) {
  const resolve = (node: Node, spec: string, family: Family) => resolveResource(antora, pageOfNode(sourceDir, node, page), spec, family);
  const picture = (node: Node, target: string | undefined) => {
    if (!target) return null;
    const found = resolve(node, target, 'image');
    return found ? links.image(found.file) : null;
  };
  class AntoraConverter extends Html5Converter {
    async convert_inline_anchor(node: Node) {
      if (node.type === 'xref' && node.attributes.path) {
        const refid = String(node.attributes.refid ?? '');
        const fragment = node.attributes.fragment;
        const spec = `${refid.replace(/#.*$/, '').replace(/\.adoc$/, '')}.adoc${fragment ? `#${fragment}` : ''}`;
        const found = resolve(node, spec, 'page');
        if (found) {
          node.target = links.page(found.file, found.fragment);
          if (!node.text) node.text = links.title(found.file) ?? undefined;
        }
      }
      return super.convert_inline_anchor(node);
    }
    async convert_image(node: Node) {
      const src = picture(node, node.getAttribute('target'));
      if (src) node.setAttribute('target', src);
      return super.convert_image(node);
    }
    async convert_inline_image(node: Node) {
      const src = picture(node, node.target);
      if (src) node.target = src;
      return super.convert_inline_image(node);
    }
  }
  return new AntoraConverter('html5');
}

// Links from one built page to the others: beside each other, as their files are.
export const pageLinks = (page: string, titles: ReturnType<typeof titlesOf>, nav = false): Links => ({
  page: (file, fragment) => `${relativePath(dirOf(page), file.replace(/\.adoc$/, '.html'))}${fragment ? `#${fragment}` : ''}`,
  image: (file) => relativePath(dirOf(page), file),
  title: (file) => {
    const t = titles.get(file);
    return (nav ? t?.navtitle : t?.reftext) ?? t?.title ?? null;
  },
});

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// ---- contents ---------------------------------------------------------------------

export interface ContentsEntry {
  name: string; // its docname
  source: string | null; // its file, relative to the component (a heading's: its navigation file's; the component's: none)
  title: string | null;
  page: boolean;
  children: string[];
}

const stem = (file: string) => file.replace(/\.adoc$/, '');

// The component's contents, from its navigation files: entries by name, and the top
// one. With one navigation file it's the top; with several, the component is (named
// "antora", for antora.yml); with none, there's none.
export function contentsOf(antora: Antora, texts: Map<string, string>): { root: string | null; entries: Map<string, ContentsEntry> } {
  const entries = new Map<string, ContentsEntry>();
  const navs: string[] = [];
  for (const file of antora.nav) {
    const text = texts.get(file);
    if (text === undefined) continue;
    const name = stem(file);
    const lists = readNav(parseAsciidoc(text).doc);
    const nav: ContentsEntry = { name, source: file, title: null, page: false, children: [] };
    entries.set(name, nav);
    navs.push(name);
    const add = (item: NavItem, parent: ContentsEntry) => {
      let entry: ContentsEntry | undefined;
      if (item.target !== null) {
        const found = resolveResource(antora, file, item.target, 'page');
        if (!found || !texts.has(found.file)) return; // another component's, or missing
        const key = stem(found.file);
        if (entries.has(key)) return; // listed twice: where it first is
        entry = { name: key, source: found.file, title: null, page: true, children: [] };
      } else {
        const key = headingName(name, item.heading!);
        entry = { name: key, source: file, title: item.text || null, page: false, children: [] };
      }
      entries.set(entry.name, entry);
      parent.children.push(entry.name);
      for (const child of item.children) add(child, entry);
    };
    if (lists.length === 1) {
      nav.title = lists[0].title;
      for (const item of lists[0].items) add(item, nav);
    } else {
      for (const list of lists) {
        if (list.title === null) {
          for (const item of list.items) add(item, nav);
          continue;
        }
        const heading: ContentsEntry = { name: listName(name, list.index), source: file, title: list.title, page: false, children: [] };
        entries.set(heading.name, heading);
        nav.children.push(heading.name);
        for (const item of list.items) add(item, heading);
      }
    }
    const module = /^modules\/([^/]+)\//.exec(file)?.[1];
    nav.title ??= navs.length === 1 && antora.nav.length === 1 ? (antora.title ?? antora.name) : module && module !== 'ROOT' ? module : (antora.title ?? antora.name);
  }
  if (navs.length <= 1) return { root: navs[0] ?? null, entries };
  const root: ContentsEntry = { name: 'antora', source: null, title: antora.title ?? antora.name, page: false, children: navs };
  entries.set('antora', root);
  return { root: 'antora', entries };
}
