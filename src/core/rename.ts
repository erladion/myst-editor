// Rewriting references when a page is renamed or moved.
//
// Paths here are POSIX and relative to the project's source directory. A reference
// is written on a page in folder `from` (where the page is now: `to`, if the page
// itself moved), and is either relative to that folder or, starting with /, to the
// source directory. Page names ({doc}, toctrees) have no .md; links to files do.

export interface Rename {
  from: string; // the moved page's old path or page name
  to: string; // and its new one
}

function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null; // above the source directory
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

// `to` written relative to the folder `dir`: "x", "sub/x" or "../x".
export function relativePath(dir: string, to: string): string {
  const a = dir ? dir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

// How to write `ref` now, or null if it stays as it is. `rename` is the page that
// moved (null when only the folder the reference is written in changed); `folder` is
// where the reference is written: before and after (the same unless the page
// holding it moved).
export function rewriteRef(ref: string, folder: { before: string; after: string }, rename: Rename | null): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][\w+.-]*:/i.test(trimmed)) return null; // anchors, URLs, mailto:
  const hash = trimmed.indexOf('#');
  const target = hash < 0 ? trimmed : trimmed.slice(0, hash);
  const fragment = hash < 0 ? '' : trimmed.slice(hash);
  const absolute = target.startsWith('/');
  const resolved = normalize(absolute ? target.slice(1) : `${folder.before}/${target}`);
  if (resolved === null) return null;
  const now = rename && resolved === rename.from ? rename.to : resolved;
  if (now === resolved && folder.before === folder.after) return null;
  const written = absolute ? `/${now}` : relativePath(folder.after, now);
  return written + fragment === trimmed ? null : written + fragment;
}

// A role or toctree value "Title <target>" or "target", with its target rewritten.
export function rewriteTitled(value: string, rewrite: (target: string) => string | null): string | null {
  const titled = /^(.*\S)\s*<([^<>]+)>\s*$/s.exec(value);
  const target = titled ? titled[2] : value;
  const next = rewrite(target);
  if (next === null) return null;
  return titled ? `${titled[1]} <${next}>` : value.replace(target.trim(), next);
}
