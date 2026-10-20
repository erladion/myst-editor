// Adding and removing pages in a toctree directive's source, keeping the rest of it
// (options, other entries, the fence) exactly as written.
import { splitDirective } from './directive.js';

// A toctree entry's target: `path`, or `Title <path>`.
export function entryTarget(line: string): string {
  const t = line.trim();
  return (/<([^<>]+)>$/.exec(t)?.[1] ?? t).trim();
}

// The page names a toctree entry may point at: relative to the page holding the
// toctree, or (starting with /) to the project's source directory. `.md` optional.
// `fromDir` is that page's directory within the source directory ('' at the top).
export function entryDocname(target: string, fromDir: string): string {
  const clean = target.replace(/\.md$/, '');
  const parts = (clean.startsWith('/') ? clean.slice(1) : fromDir ? `${fromDir}/${clean}` : clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

// How to write `docname` in a toctree on a page in `fromDir`: relative when it's below
// that page's folder, else from the top of the project.
export function entryFor(docname: string, fromDir: string): string {
  if (!fromDir) return docname;
  return docname.startsWith(fromDir + '/') ? docname.slice(fromDir.length + 1) : `/${docname}`;
}

// Whether a :glob: toctree's patterns already take in the page.
export function globIncludes(source: string, docname: string, fromDir: string): boolean {
  const parsed = splitDirective(source);
  if (!parsed?.options.some(([k]) => k === 'glob')) return false;
  return bodyLines(parsed.body ?? '')
    .map(entryTarget)
    .filter((t) => /[*?[]/.test(t))
    .some((pattern) => globRegex(entryDocname(pattern, fromDir)).test(docname));
}

function globRegex(pattern: string): RegExp {
  // Sphinx's patterns: * and ? within a path segment, ** across them.
  const re = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`);
}

const bodyLines = (body: string) => body.split('\n').filter((l) => l.trim() && !/^\s*:[\w-]+:/.test(l));

// The toctree with `entry` added at the end (before the closing fence).
export function addTocEntry(source: string, entry: string): string {
  const lines = source.replace(/\n+$/, '').split('\n');
  // The closing fence, or the end if the directive was never closed.
  const close = splitDirective(source)?.closing ? lines.length - 1 : lines.length;
  const body = lines.slice(1, close);
  // Options come first; entries follow a blank line.
  const hasEntries = bodyLines(body.join('\n')).length > 0;
  const lastContent = (() => {
    for (let i = close - 1; i > 0; i--) if (lines[i].trim()) return i;
    return 0;
  })();
  const indent = hasEntries ? (/^\s*/.exec(lines[lastContent])?.[0] ?? '') : '';
  const insert = hasEntries ? [indent + entry] : lastContent > 0 ? ['', entry] : [entry];
  return [...lines.slice(0, lastContent + 1), ...insert, ...lines.slice(close)].join('\n');
}

// The toctree without entries for the given page names (null if nothing changed).
export function removeTocEntries(source: string, docnames: Set<string>, fromDir: string): string | null {
  const lines = source.split('\n');
  const last = splitDirective(source)?.closing ? lines.length - 1 : lines.length;
  const kept = lines.filter((line, i) => {
    if (i === 0 || i === last || !line.trim() || /^\s*:[\w-]+:/.test(line)) return true;
    return !docnames.has(entryDocname(entryTarget(line), fromDir));
  });
  return kept.length === lines.length ? null : kept.join('\n');
}
