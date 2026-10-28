// Project discovery and sandboxed file access for the main process.
//
// Real paths come from realpathSync.native, like fs.promises.realpath: on Windows the
// non-native one keeps 8.3 short names (C:\Users\RUNNER~1\…), so paths that are the
// same wouldn't compare equal.
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { DEFAULT_CONFIG, readConfPy } from '../core/project-config.js';
import { isPage, pageFormat } from '../core/format.js';
import { loadEditorConfig, SETTINGS_FILE, type SettingsSource } from '../core/editor-config.js';
import type { PageMatches, ProjectInfo, Project } from '../shared/api.js';

// Directories whose changes never matter to the app: hidden ones (.git, .venv),
// dependencies, build output, and Python environments whatever they're called.
// Names like build/ or env/ are also ordinary documentation sections ("Building",
// "Environments"), so those only count when they look like what the name suggests.
export const UNWATCHED_DIRS = new Set(['_build', 'node_modules', '__pycache__', 'site-packages', 'jupyter_execute']);

export async function unwatchedDir(parent: string, name: string): Promise<boolean> {
  if (name.startsWith('.') || UNWATCHED_DIRS.has(name)) return true;
  const dir = join(parent, name);
  if ((await exists(join(dir, 'pyvenv.cfg'))) || (await exists(join(dir, 'conda-meta')))) return true;
  // Build output (Python packaging, CMake, `sphinx-build docs build`), unless it holds pages.
  if (name === 'build' || name === 'dist') {
    try {
      return !(await fs.readdir(dir)).some(isPage);
    } catch {
      return true;
    }
  }
  return false;
}

// Directories never searched for pages or projects: the above, and the theme
// overrides and static files next to a conf.py.
async function skipDir(dir: string, name: string): Promise<boolean> {
  return name === '_static' || name === '_templates' || (await unwatchedDir(dir, name));
}

const MAX_DEPTH = 6; // how deep marker files (conf.py) are looked for

// One walk of the opened folder, for finding its projects: its pages, and the
// folders holding each marker file (by name).
export interface FolderScan {
  files: string[];
  markers: Map<string, string[]>;
}

// Finds the projects of one kind (Sphinx's) in a scan; records the settings files
// it reads in `read`.
type ProjectFinder = (root: string, scan: FolderScan, read: Set<string>) => Promise<Project[]>;

// The files that make a folder a project, and the finders, a kind each.
const MARKERS = ['conf.py'];
// Whether a file (relative to the opened folder) is one of those: when it changes,
// the projects are found again.
export const isMarker = (rel: string) => MARKERS.includes(rel.slice(rel.lastIndexOf('/') + 1));
const FINDERS: ProjectFinder[] = [(root, scan, read) => sphinxProjects(root, scan.markers.get('conf.py') ?? [], read)];

async function findProjects(root: string, scan: FolderScan, read: Set<string>): Promise<Project[]> {
  const found = (await Promise.all(FINDERS.map((find) => find(root, scan, read)))).flat();
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

// Reports what opening a folder is doing: a step, and how far along it is.
export type OpenProgress = (step: string, detail?: string) => void;

export async function openProject(folder: string, progress: OpenProgress = () => {}): Promise<ProjectInfo> {
  const root = realpathSync.native(resolve(folder));
  const finding = 'Looking for pages and projects';
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
  const { files, markers, inputs } = await scanFolder(root, found);
  // Capabilities files the settings name are build inputs too (an extension reads them).
  const read = new Set<string>();
  const projects = await findProjects(root, { files, markers }, read);
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

// One walk of the folder: its pages (sorted POSIX paths relative to it), the
// directories holding each marker file, and its Python files (extensions a build may
// load).
async function scanFolder(root: string, found: (pages: number) => void = () => {}): Promise<FolderScan & { inputs: string[] }> {
  const files: string[] = [];
  const markers = new Map<string, string[]>();
  const inputs: string[] = [];
  // Symlinked pages and folders count when they lead somewhere inside the folder: a
  // shared section linked into two guides is a page of each, under each one's path.
  // A link back up to a folder it's in would go round forever, so those are skipped.
  const realRoot = realpathSync.native(root);
  const walk = async (dir: string, depth: number, within: string[] = [realRoot]) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      let e: { name: string; isFile(): boolean; isDirectory(): boolean } = entry;
      if (entry.isSymbolicLink()) {
        try {
          const real = await fs.realpath(join(dir, entry.name));
          if (!isInside(realRoot, real)) continue;
          const st = await fs.stat(real);
          if (st.isDirectory() && within.includes(real)) continue;
          e = { name: entry.name, isFile: () => st.isFile(), isDirectory: () => st.isDirectory() };
        } catch {
          continue; // broken link
        }
      }
      if (e.isFile()) {
        if (isPage(e.name)) {
          files.push(relative(root, join(dir, e.name)).split(sep).join('/'));
          if (files.length % 100 === 0) found(files.length);
        } else {
          if (MARKERS.includes(e.name) && depth <= MAX_DEPTH) markers.set(e.name, [...(markers.get(e.name) ?? []), dir]);
          if (e.name.endsWith('.py')) inputs.push(relative(root, join(dir, e.name)).split(sep).join('/'));
        }
      } else if (e.isDirectory() && !(await skipDir(dir, e.name))) subdirs.push(join(dir, e.name));
    }
    // A few folders at a time: quick on slow (network) drives without opening thousands at once.
    const next = async (d: string) => walk(d, depth + 1, [...within, await fs.realpath(d).catch(() => d)]);
    for (let i = 0; i < subdirs.length; i += 8) await Promise.all(subdirs.slice(i, i + 8).map(next));
  };
  await walk(root, 0);
  found(files.length);
  return { files: files.sort((a, b) => a.localeCompare(b)), markers, inputs };
}

// Files a Sphinx build may depend on without Sphinx noticing when they change: the
// project's own extensions, and data such as a capabilities list. Not package
// manager files, which change when tools are installed.
export function isBuildInput(name: string): boolean {
  return name.endsWith('.py') || (name.endsWith('.json') && !/^(package(-lock)?|tsconfig|composer)\.json$/.test(name));
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
export async function findSphinxProjects(root: string): Promise<Project[]> {
  return sphinxProjects(root, (await scanFolder(root)).markers.get('conf.py') ?? []);
}

async function sphinxProjects(root: string, confDirs: string[], read?: Set<string>): Promise<Project[]> {
  const found: string[] = [];
  for (const dir of confDirs) if (await looksLikeSphinx(dir)) found.push(dir);
  const projects: Project[] = [];
  for (const sourceDir of found.sort()) {
    const confText = await fs.readFile(join(sourceDir, 'conf.py'), 'utf8');
    const dir = relative(root, sourceDir).split(sep).join('/');
    projects.push({
      id: `p${createHash('sha256').update(sourceDir).digest('hex').slice(0, 12)}`,
      name: /^\s*project\s*=\s*(["'])(.+?)\1/m.exec(confText)?.[2] ?? (dir ? basename(sourceDir) : basename(root)),
      dir,
      sourceDir,
      builder: 'sphinx',
      marker: dir ? `${dir}/conf.py` : 'conf.py',
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
    return pageFormat(path)?.title(buffer.subarray(0, bytesRead).toString('utf8')) ?? null;
  } catch {
    return null; // unreadable: the file name is shown instead
  } finally {
    await handle?.close();
  }
}

// The pages under `base`, as sorted POSIX paths relative to it.
export async function listDocuments(base: string): Promise<string[]> {
  return (await scanFolder(base)).files;
}

// Where `query` appears in the folder's pages (their Markdown), line by line, up to
// `limit` matches in all.
export async function searchPages(root: string, files: string[], query: string, caseSensitive: boolean, limit = 2000): Promise<{ results: PageMatches[]; truncated: boolean }> {
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: PageMatches[] = [];
  let total = 0;
  for (const rel of files) {
    if (!needle) break;
    let text: string;
    try {
      text = await fs.readFile(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const hay = caseSensitive ? text : text.toLowerCase();
    if (!hay.includes(needle)) continue;
    const lines = text.split(/\r?\n/);
    const page: PageMatches = { path: rel, matches: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
      for (let at = line.indexOf(needle); at >= 0; at = line.indexOf(needle, at + needle.length)) {
        if (total >= limit) {
          if (page.matches.length) results.push(page);
          return { results, truncated: true };
        }
        page.matches.push({ line: i + 1, text: lines[i], from: at, to: at + needle.length });
        total++;
      }
    }
    if (page.matches.length) results.push(page);
  }
  return { results, truncated: false };
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

// An image the writer picked for `page`, as the path to write in the page (relative
// to it). One from outside the opened folder is copied into an images/ folder next to
// the page first, under a name not already taken.
export async function placeImage(root: string, page: string, picked: string): Promise<string> {
  // Real paths throughout, so the page's folder and the image compare as they are.
  const pageDir = realpathSync.native(dirname(resolveInside(root, page)));
  const real = realpathSync.native(picked);
  const realRoot = realpathSync.native(root);
  let target = real;
  if (!isInside(realRoot, real)) {
    const dir = join(pageDir, 'images');
    await fs.mkdir(dir, { recursive: true });
    const ext = real.slice(real.lastIndexOf('.'));
    const stem = basename(real, ext);
    target = join(dir, basename(real));
    for (let n = 2; existsSync(target); n++) target = join(dir, `${stem}-${n}${ext}`);
    await fs.copyFile(real, target);
  }
  return relative(pageDir, target).split(sep).join('/');
}

// An image given as bytes (pasted from the clipboard, say), saved in an images/ folder
// next to `page` under a name not already taken. Returns the path to write in the page.
export async function saveImage(root: string, page: string, name: string, bytes: Uint8Array): Promise<string> {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || !IMAGE_EXTENSIONS.includes(ext)) throw new Error(`Not an image file: ${name}`);
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Images over 50 MB aren’t added; make it smaller first.');
  const pageDir = realpathSync.native(dirname(resolveInside(root, page)));
  const dir = join(pageDir, 'images');
  await fs.mkdir(dir, { recursive: true });
  const stem = basename(name).slice(0, -(ext.length + 1)).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  let target = join(dir, `${stem}.${ext}`);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${stem}-${n}.${ext}`);
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return relative(pageDir, target).split(sep).join('/');
}

// Whether `path` is `base` or inside it. Windows (and macOS) paths ignore case.
export function isInside(base: string, path: string, orSame = false): boolean {
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (p: string) => p.toLowerCase() : (p: string) => p;
  const [b, p] = [fold(base), fold(path)];
  return (orSame && p === b) || p.startsWith(b.endsWith(sep) ? b : b + sep);
}

// Resolve `rel` inside `base`, refusing anything that escapes it (including via
// symlinks). Used for every path that comes from the renderer.
export function resolveInside(base: string, rel: string): string {
  const target = resolve(base, rel);
  const realBase = realpathSync.native(base);
  // For files that don't exist yet, check the nearest existing parent instead.
  let probe = target;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = join(realpathSync.native(probe), relative(probe, target));
  if (!isInside(realBase, real, true)) {
    throw new Error(`Path is outside the project: ${rel}`);
  }
  return target;
}

// Resolve `rel` inside `base` for reading a file the project refers to (an image, a
// font, a stylesheet): it may not climb out with "..", but symlinks in the folder are
// followed wherever they lead, so a shared folder linked into several projects works
// (as it does in Sphinx). Writing, renaming and deleting keep to resolveInside.
export function resolveForReading(base: string, rel: string): string {
  const target = resolve(base, rel);
  if (!isInside(resolve(base), target, true)) throw new Error(`Path is outside the project: ${rel}`);
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
  await replace(tmp, path);
}

// Rename over the old file. On Windows that fails while something (a virus scanner, a
// search indexer) has the file open, usually for a moment: try again briefly.
async function replace(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.rm(from, { force: true });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

function existsSync(path: string): boolean {
  try {
    realpathSync.native(path);
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
