// POSIX path helpers for project-relative paths in the renderer.

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

// Join and normalize, resolving `.` and `..`. Returns null if the result would
// leave the base (more `..` than directories).
export function join(...parts: string[]): string | null {
  const out: string[] = [];
  for (const segment of parts.join('/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

// Resolve a reference written in `fromFile` the way Sphinx does: absolute paths are
// relative to the project's source directory (`projectDir`), everything else to the
// file's own directory. All paths are relative to the opened folder.
export function resolveRef(fromFile: string | null, ref: string, projectDir = ''): string | null {
  const clean = ref.split('#')[0].trim();
  if (!clean) return null;
  return clean.startsWith('/') ? join(projectDir, clean) : join(dirname(fromFile ?? ''), clean);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
