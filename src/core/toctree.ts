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

// A toctree's entries, with the line each is on (in `source.split('\n')`).
export interface TocLine {
  line: number;
  text: string;
  docname: string;
}

export function tocLines(source: string, fromDir: string): TocLine[] {
  const lines = source.split('\n');
  const last = splitDirective(source)?.closing ? lines.length - 1 : lines.length;
  const out: TocLine[] = [];
  for (let i = 1; i < last; i++) {
    const text = lines[i];
    if (!text.trim() || /^\s*:[\w-]+:/.test(text)) continue;
    const target = entryTarget(text);
    // External links and the "self" entry aren't pages.
    if (/^[a-z][\w+.-]*:/i.test(target) || target === 'self') continue;
    out.push({ line: i, text, docname: entryDocname(target, fromDir) });
  }
  return out;
}

// An entry line pointed at `docname` from a toctree on a page in `fromDir`, keeping
// its title (`Title <path>`) and indentation.
export function retarget(text: string, docname: string, fromDir: string): string {
  const indent = /^\s*/.exec(text)![0];
  const path = entryFor(docname, fromDir);
  const titled = /^(.*\S)\s*<[^<>]+>\s*$/.exec(text.trim());
  return indent + (titled ? `${titled[1]} <${path}>` : path);
}

// The toctree with `entry` inserted before the entry for `before` (null if that
// isn't in this toctree).
export function insertTocEntry(source: string, entry: string, before: string, fromDir: string): string | null {
  const at = tocLines(source, fromDir).find((l) => l.docname === before);
  if (!at) return null;
  const lines = source.split('\n');
  const indent = /^\s*/.exec(lines[at.line])![0];
  lines.splice(at.line, 0, indent + entry.trim());
  return lines.join('\n');
}

// The toctree without the entry for `docname`, and that entry's line (null if it
// isn't listed here by name, e.g. only through a :glob: pattern).
export function takeTocEntry(source: string, docname: string, fromDir: string): { source: string; text: string } | null {
  const at = tocLines(source, fromDir).find((l) => l.docname === docname);
  if (!at) return null;
  const lines = source.split('\n');
  const [text] = lines.splice(at.line, 1);
  return { source: lines.join('\n'), text };
}
