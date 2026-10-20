// Sphinx project discovery and sandboxed file access for the main process.
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { DEFAULT_CONFIG, readConfPy } from '../core/project-config.js';
import { loadEditorConfig, SETTINGS_FILE, type SettingsSource } from '../core/editor-config.js';
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

const MAX_DEPTH = 6; // how deep conf.py files are looked for

// Reports what opening a folder is doing: a step, and how far along it is.
export type OpenProgress = (step: string, detail?: string) => void;

export async function openProject(folder: string, progress: OpenProgress = () => {}): Promise<ProjectInfo> {
  const root = realpathSync(resolve(folder));
  const finding = 'Looking for pages and Sphinx projects';
  progress(finding);
  const { files, projects, defaultConfig, buildInputs } = await inspect(root, (n) => progress(finding, `${n} page${n === 1 ? '' : 's'} found`));
  const titles = await readTitles(root, files, (done) => progress('Reading page titles', `${done} of ${files.length}`));
  return { root, name: basename(root), projects, defaultConfig, files, titles, buildInputs };
}

// The folder's current ProjectInfo.buildInputs.
export async function buildInputsOf(root: string): Promise<string> {
  return (await inspect(root)).buildInputs;
}

async function inspect(root: string, found?: (pages: number) => void) {
  const { files, confDirs, inputs } = await scanFolder(root, found);
  // Capabilities files the settings name are build inputs too (an extension reads them).
  const read = new Set<string>();
  const projects = await sphinxProjects(root, confDirs, read);
  // Pages outside every project still get the folder's own editor settings.
  const defaultConfig = { ...DEFAULT_CONFIG, editor: loadEditorConfig(settingsSources(root, root, read)) };
  return { files, projects, defaultConfig, buildInputs: await fingerprintOf(root, [...new Set([...inputs, ...read])]) };
}

async function fingerprintOf(root: string, files: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of files.sort()) {
    try {
      const { size, mtimeMs } = await fs.stat(join(root, rel));
      hash.update(`${rel}\0${size}\0${mtimeMs}\n`);
    } catch {
      // gone since the scan
    }
  }
  return hash.digest('hex').slice(0, 24);
}

// One walk of the folder: its Markdown pages (sorted POSIX paths relative to it), the
// directories holding a conf.py, and its Python files (extensions a build may load).
async function scanFolder(root: string, found: (pages: number) => void = () => {}): Promise<{ files: string[]; confDirs: string[]; inputs: string[] }> {
  const files: string[] = [];
  const confDirs: string[] = [];
  const inputs: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isFile()) {
        if (e.name.endsWith('.md')) {
          files.push(relative(root, join(dir, e.name)).split(sep).join('/'));
          if (files.length % 100 === 0) found(files.length);
        } else {
          if (e.name === 'conf.py' && depth <= MAX_DEPTH) confDirs.push(dir);
          if (e.name.endsWith('.py')) inputs.push(relative(root, join(dir, e.name)).split(sep).join('/'));
        }
      } else if (e.isDirectory() && !(await skipDir(dir, e.name))) subdirs.push(join(dir, e.name));
    }
    // A few folders at a time: quick on slow (network) drives without opening thousands at once.
    for (let i = 0; i < subdirs.length; i += 8) await Promise.all(subdirs.slice(i, i + 8).map((d) => walk(d, depth + 1)));
  };
  await walk(root, 0);
  found(files.length);
  return { files: files.sort((a, b) => a.localeCompare(b)), confDirs, inputs };
}

// Files a Sphinx build may depend on without Sphinx noticing when they change: the
// project's own extensions, and data such as a capabilities list. Not package
// manager files, which change when tools are installed.
export function isBuildInput(name: string): boolean {
  return name.endsWith('.py') || (name.endsWith('.json') && !/^(package(-lock)?|tsconfig|composer)\.json$/.test(name));
}

// Directories whose changes never matter to the app: hidden ones (.git, .venv),
// dependencies, build output and virtualenvs whatever they're called. Unlike page
// listing, _static and _templates are watched: the build uses them.
export const UNWATCHED_DIRS = new Set(['_build', 'build', 'node_modules', 'venv', 'env', '__pycache__', 'site-packages', 'dist', 'jupyter_execute']);

export async function unwatchedDir(parent: string, name: string): Promise<boolean> {
  return name.startsWith('.') || UNWATCHED_DIRS.has(name) || (await exists(join(parent, name, 'pyvenv.cfg')));
}

// The .mysteditor.toml files that apply to `dir`, from the opened folder down.
export function settingsSources(root: string, dir: string, read?: Set<string>): SettingsSource[] {
  const dirs = [dir];
  for (let d = dir; d !== root && d.startsWith(root + sep); ) dirs.unshift((d = dirname(d)));
  const sources: SettingsSource[] = [];
  for (const d of dirs) {
    const path = join(d, SETTINGS_FILE);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    sources.push({
      file: relative(root, path).split(sep).join('/'),
      text,
      // Relative to the settings file, and like every path, inside the opened folder.
      readCapabilities: (p) => {
        const rel = relative(root, resolve(d, p));
        read?.add(rel.split(sep).join('/'));
        return readFileSync(resolveInside(root, rel), 'utf8');
      },
    });
  }
  return sources;
}

// Every Sphinx project under `root`. A conf.py counts if it looks like Sphinx
// configuration and has a root document next to it, so a Python package's own
// conf.py module isn't mistaken for documentation.
export async function findSphinxProjects(root: string): Promise<SphinxProject[]> {
  return sphinxProjects(root, (await scanFolder(root)).confDirs);
}

async function sphinxProjects(root: string, confDirs: string[], read?: Set<string>): Promise<SphinxProject[]> {
  const found: string[] = [];
  for (const dir of confDirs) if (await looksLikeSphinx(dir)) found.push(dir);
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
      config: { ...readConfPy(confText), editor: loadEditorConfig(settingsSources(root, sourceDir, read)) },
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
export async function readTitles(base: string, files: string[], progress: (done: number) => void = () => {}): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  let next = 0;
  let done = 0;
  // A bounded number of files open at once (thousands at a time can run out of handles).
  const worker = async () => {
    while (next < files.length) {
      const rel = files[next++];
      const title = await readTitle(join(base, rel));
      if (title) titles[rel] = title;
      if (++done % 100 === 0) progress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(32, files.length) }, worker));
  progress(done);
  return titles;
}

export async function readTitle(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await fs.open(path, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16384), 0, 16384, 0);
    return firstHeading(buffer.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null; // unreadable: the file name is shown instead
  } finally {
    await handle?.close();
  }
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
  return (await scanFolder(base)).files;
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

// An image the writer picked for `page`, as the path to write in the page (relative
// to it). One from outside the opened folder is copied into an images/ folder next to
// the page first, under a name not already taken.
export async function placeImage(root: string, page: string, picked: string): Promise<string> {
  const pageDir = dirname(resolveInside(root, page));
  const real = realpathSync(picked);
  const realRoot = realpathSync(root);
  let target = real;
  if (!real.startsWith(realRoot + sep)) {
    const dir = join(pageDir, 'images');
    await fs.mkdir(dir, { recursive: true });
    const ext = real.slice(real.lastIndexOf('.'));
    const stem = basename(real, ext);
    target = join(dir, basename(real));
    for (let n = 2; existsSync(target); n++) target = join(dir, `${stem}-${n}${ext}`);
    await fs.copyFile(real, target);
  }
  return relative(realpathSync(pageDir), target).split(sep).join('/');
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
