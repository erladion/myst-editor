// Building an Asciidoctor project's pages with Asciidoctor.js: each page as HTML (for
// the preview), and what the editor needs from the build: titles, which pages include
// which, anchors, and Asciidoctor's warnings where it places them.
import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { getVersion, loadFile, LoggerManager, MemoryLogger } from '@asciidoctor/core';
import type { Project } from '../../shared/api.js';
import type { BuildInfo, BuildPage, BuildTarget, BuildWarning } from '../../shared/build.js';
import { fromProject } from '../../shared/projects.js';
// Asciidoctor's stylesheet, for the built pages (its package keeps it where a bundled
// app can't find it, so it's bundled too).
import STYLESHEET from '../../../node_modules/@asciidoctor/core/data/asciidoctor-default.css?raw';
import type { AsciidocConfig } from '../../core/asciidoc/config.js';

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

// The pages a page includes, in order (by their stems).
function includesOf(page: string, text: string, pages: Set<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^include::([^\s[]+\.adoc)\[/gm)) {
    const target = join(dirname(page), m[1]).split(sep).join('/');
    if (pages.has(target)) out.push(stem(target));
  }
  return out;
}

// `extra`: attributes set for this build (the capabilities being viewed as, say).
export function buildAsciidoctor(project: Project, outputDir: string, extra: Record<string, string> = {}): Promise<BuildInfo> {
  const run = queue.then(() => build(project, outputDir, extra));
  queue = run.catch(() => {});
  return run;
}

async function build(project: Project, outputDir: string, extra: Record<string, string>): Promise<BuildInfo> {
  const started = performance.now();
  const config = project.config as AsciidocConfig;
  const pages = await pagesIn(project.sourceDir);
  const pageSet = new Set(pages);
  const docs: Record<string, BuildPage> = {};
  const objects: BuildTarget[] = [];
  const seen = new Set<string>();
  const warnings: BuildWarning[] = [];
  const pageOf = (file: string | undefined) => {
    if (!file) return null;
    const rel = relative(project.sourceDir, resolve(file)).split(sep).join('/');
    return pageSet.has(rel) ? rel : null;
  };
  // The main document's header sets attributes for every page.
  const attributes = { ...config.attributes, ...extra, showtitle: '', 'attribute-missing': 'warn' };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(join(outputDir, 'asciidoctor.css'), STYLESHEET);
  const logger = MemoryLogger.create();
  const before = LoggerManager.getLogger();
  LoggerManager.setLogger(logger);
  try {
    for (const page of pages) {
      const file = join(project.sourceDir, page);
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      const from = logger.getMessages().length;
      const out = join(outputDir, `${stem(page)}.html`);
      const stylesdir = relative(dirname(out), outputDir).split(sep).join('/') || '.';
      const doc = await loadFile(file, { safe: 'safe', sourcemap: true, base_dir: project.sourceDir, attributes: { ...attributes, outfilesuffix: '.html', linkcss: '', stylesheet: 'asciidoctor.css', stylesdir } });
      const html = (await doc.convert({ standalone: true })) as string;
      await fs.mkdir(dirname(out), { recursive: true });
      await fs.writeFile(out, html);
      docs[stem(page)] = {
        source: fromProject(project, page),
        title: titleOf(doc.getDocumentTitle({ sanitize: true })),
        uri: `${stem(page)}.html`,
        children: includesOf(page, text, pageSet),
      };
      // Anchors, where they're written: a page's own, and its included pages'.
      for (const [id, node] of Object.entries(doc.getRefs() as Record<string, { getTitle?(): string; getContext?(): string; getSourceLocation?(): { getFile?(): string } | undefined }>)) {
        const where = pageOf(node.getSourceLocation?.()?.getFile?.()) ?? page;
        const key = `${where}#${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        objects.push({ domain: 'adoc', type: node.getContext?.() === 'section' ? 'section' : 'anchor', name: id, title: node.getTitle?.() ?? null, doc: stem(where), anchor: id });
      }
      for (const m of logger.getMessages().slice(from)) {
        const loc = m.getSourceLocation?.();
        const where = pageOf(loc?.getFile?.()) ?? page;
        const severity = String(m.getSeverity?.() ?? '').toLowerCase();
        warnings.push({
          source: fromProject(project, where),
          line: loc?.getLineNumber?.() ?? null,
          level: /error|fatal/.test(severity) ? 'error' : 'warning',
          message: String(m.getText?.() ?? m),
          type: null,
          phase: 'read',
        });
      }
    }
  } finally {
    LoggerManager.setLogger(before);
  }
  // The same warning, from a page and from a page including it, once.
  const unique = [...new Map(warnings.map((w) => [`${w.source}:${w.line}:${w.message}`, w])).values()];
  const root = config.main ? stem(config.main) : pages.includes('index.adoc') ? 'index' : stem(pages[0] ?? 'index');
  return {
    builtWith: { name: 'Asciidoctor', version: getVersion() },
    rootDoc: root,
    docs,
    objects,
    warnings: unique,
    builtAt: Date.now(),
    duration: (performance.now() - started) / 1000,
    variables: {},
  };
}
