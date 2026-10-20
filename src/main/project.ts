// Sphinx project discovery and sandboxed file access for the main process.
import { promises as fs, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { DEFAULT_CONFIG, readConfPy } from '../core/project-config.js';
import type { ProjectInfo } from '../shared/api.js';

// Where conf.py usually lives, relative to the folder the writer opened.
const CONF_LOCATIONS = ['', 'docs', 'doc', 'docs/source', 'doc/source', 'source', 'documentation'];

const SKIP_DIRS = new Set([
  '_build', 'build', '_static', '_templates', 'node_modules', 'venv', '.venv', 'env', '__pycache__',
  'site-packages', 'dist', 'jupyter_execute', '.ipynb_checkpoints',
]);

export async function openProject(folder: string): Promise<ProjectInfo> {
  const root = realpathSync(resolve(folder));
  let confPy: string | null = null;
  for (const loc of CONF_LOCATIONS) {
    const candidate = join(root, loc, 'conf.py');
    if (await exists(candidate)) {
      confPy = candidate;
      break;
    }
  }
  const sourceDir = confPy ? dirname(confPy) : root;
  const config = confPy ? readConfPy(await fs.readFile(confPy, 'utf8')) : DEFAULT_CONFIG;
  const files = await listDocuments(sourceDir);
  return {
    root,
    sourceDir,
    name: basename(root),
    confPy: confPy && relative(root, confPy),
    config,
    files,
    titles: await readTitles(sourceDir, files),
  };
}

// The first heading of each page, for showing titles instead of file names.
export async function readTitles(sourceDir: string, files: string[]): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  await Promise.all(
    files.map(async (rel) => {
      let handle;
      try {
        handle = await fs.open(join(sourceDir, rel), 'r');
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(16384), 0, 16384, 0);
        const title = firstHeading(buffer.subarray(0, bytesRead).toString('utf8'));
        if (title) titles[rel] = title;
      } catch {
        // unreadable: fall back to the file name
      } finally {
        await handle?.close();
      }
    }),
  );
  return titles;
}

export function firstHeading(text: string): string | null {
  let body = text;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  let inFence: string | null = null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,}|:{3,})/.exec(line)?.[1];
    if (fence) {
      if (!inFence) inFence = fence[0];
      else if (fence[0] === inFence) inFence = null;
      continue;
    }
    if (inFence) continue;
    const atx = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const setext = line.trim() && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? '') && !/^\s*[-*+]\s/.test(line);
    const raw = atx?.[1] ?? (setext ? line.trim() : null);
    if (raw) return plain(raw);
  }
  return null;
}

// Strip inline Markdown: roles, code, emphasis, links.
function plain(text: string): string {
  return text
    .replace(/\{[\w:.-]+\}`([^`]*)`/g, (_m, v: string) => v.replace(/\s*<[^>]*>$/, ''))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .trim();
}

// Markdown files under the source directory, as sorted POSIX paths relative to it.
export async function listDocuments(sourceDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(relative(sourceDir, full).split(sep).join('/'));
      }
    }
  };
  await walk(sourceDir);
  return out.sort((a, b) => a.localeCompare(b));
}

// Resolve `rel` inside `base`, refusing anything that escapes it (including via
// symlinks). Used for every path that comes from the renderer.
export function resolveInside(base: string, rel: string): string {
  const target = resolve(base, rel);
  const realBase = realpathSync(base);
  // For files that don't exist yet, check the nearest existing parent instead.
  let probe = target;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = join(realpathSync(probe), relative(probe, target));
  if (real !== realBase && !real.startsWith(realBase + sep)) {
    throw new Error(`Path is outside the project: ${rel}`);
  }
  return target;
}

export async function readDocument(project: ProjectInfo, rel: string): Promise<string> {
  return fs.readFile(resolveInside(project.sourceDir, rel), 'utf8');
}

// Write via a temporary file and rename, so a crash never leaves a half-written page.
export async function writeDocument(project: ProjectInfo, rel: string, text: string): Promise<void> {
  const path = resolveInside(project.sourceDir, rel);
  const tmp = join(dirname(path), `.${basename(path)}.mysteditor-${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  try {
    const { mode } = await fs.stat(path);
    await fs.chmod(tmp, mode);
  } catch {
    // new file: keep default permissions
  }
  await fs.rename(tmp, path);
}

function existsSync(path: string): boolean {
  try {
    realpathSync(path);
    return true;
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
