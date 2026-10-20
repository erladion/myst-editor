// Sphinx project discovery and sandboxed file access for the main process.
import { createHash } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { readConfPy } from '../core/project-config.js';
import type { ProjectInfo, SphinxProject } from '../shared/api.js';

const SKIP_DIRS = new Set([
  '_build', 'build', '_static', '_templates', 'node_modules', 'venv', '.venv', 'env', '__pycache__',
  'site-packages', 'dist', 'jupyter_execute', '.ipynb_checkpoints',
]);

// Directories never searched for pages or projects: build output, dependencies,
// virtualenvs (recognised by pyvenv.cfg whatever they're called) and hidden folders.
async function skipDir(dir: string, name: string): Promise<boolean> {
  return name.startsWith('.') || SKIP_DIRS.has(name) || (await exists(join(dir, name, 'pyvenv.cfg')));
}

const MAX_DEPTH = 6;

export async function openProject(folder: string): Promise<ProjectInfo> {
  const root = realpathSync(resolve(folder));
  const projects = await findSphinxProjects(root);
  const files = await listDocuments(root);
  return { root, name: basename(root), projects, files, titles: await readTitles(root, files) };
}

// Every Sphinx project under `root`. A conf.py counts if it looks like Sphinx
// configuration and has a root document next to it, so a Python package's own
// conf.py module isn't mistaken for documentation.
export async function findSphinxProjects(root: string): Promise<SphinxProject[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'conf.py') && (await looksLikeSphinx(dir))) found.push(dir);
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !(await skipDir(dir, e.name))) await walk(join(dir, e.name), depth + 1);
    }
  };
  await walk(root, 0);
  const projects: SphinxProject[] = [];
  for (const sourceDir of found.sort()) {
    const confText = await fs.readFile(join(sourceDir, 'conf.py'), 'utf8');
    const dir = relative(root, sourceDir).split(sep).join('/');
    projects.push({
      id: `p${createHash('sha256').update(sourceDir).digest('hex').slice(0, 12)}`,
      name: /^\s*project\s*=\s*(["'])(.+?)\1/m.exec(confText)?.[2] ?? (dir ? basename(sourceDir) : basename(root)),
      dir,
      sourceDir,
      confPy: dir ? `${dir}/conf.py` : 'conf.py',
      config: readConfPy(confText),
    });
  }
  return projects;
}

async function looksLikeSphinx(dir: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(join(dir, 'conf.py'), 'utf8');
  } catch {
    return false;
  }
  if (!/^\s*(extensions|project|html_theme|master_doc|root_doc|myst_enable_extensions)\s*=/m.test(text)) return false;
  const rootDoc = /^\s*(?:root_doc|master_doc)\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? 'index';
  for (const ext of ['.md', '.rst', '.ipynb', '.txt']) if (await exists(join(dir, rootDoc + ext))) return true;
  return false;
}

// The first heading of each page, for showing titles instead of file names.
export async function readTitles(base: string, files: string[]): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  await Promise.all(
    files.map(async (rel) => {
      let handle;
      try {
        handle = await fs.open(join(base, rel), 'r');
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

// Markdown files under `base`, as sorted POSIX paths relative to it.
export async function listDocuments(base: string): Promise<string[]> {
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
        if (!(await skipDir(dir, e.name))) await walk(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(relative(base, full).split(sep).join('/'));
      }
    }
  };
  await walk(base);
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
  return fs.readFile(resolveInside(project.root, rel), 'utf8');
}

// Write via a temporary file and rename, so a crash never leaves a half-written page.
export async function writeDocument(project: ProjectInfo, rel: string, text: string): Promise<void> {
  const path = resolveInside(project.root, rel);
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
