// The open folder: opening it, watching its files, keeping its page list and titles up
// to date, and reading its settings again when they change.
import { app, dialog, ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildInputsOf, isBuildInput, listDocuments, openProject, readTitle, resolveInside, UNWATCHED_DIRS, unwatchedDir } from './project.js';
import { FolderWatcher } from './watch.js';
import type { ProjectInfo } from '../shared/api.js';
import type { SphinxInfo } from '../shared/sphinx.js';
import { SETTINGS_FILE } from '../core/editor-config.js';
import { isPage } from '../core/format.js';
import { current, requireProject, toWindow } from './state.js';
import { loadSettings, updateSettings } from './settings.js';
import { setRecentFolders } from './menu.js';
import { setWindowTitle } from './window.js';
import { checkServer, refreshGit, resetGit } from './git/service.js';
import { buildFor, forgetChangesInBuilds, rebuildFresh, startSphinx } from './sphinx/service.js';

let watcher: FolderWatcher | null = null;

// The content of files as last seen (or written by us), by path relative to the
// opened folder: a file event only counts when the content really changed.
export const fingerprints = new Map<string, string>();
export const fingerprintText = (text: string | Buffer) => createHash('sha1').update(text).digest('hex');

// Opening a large folder takes a while: tell the window what's happening.
let progressTimer: NodeJS.Timeout | undefined;
let progressNext: { step: string; detail?: string } | null = null;
function openProgress(folder: string, step: string | null, detail?: string) {
  clearTimeout(progressTimer);
  if (step === null) {
    progressNext = null;
    toWindow('open-progress', null);
    return;
  }
  const first = !progressNext;
  progressNext = { step, detail };
  const send = () => toWindow('open-progress', { folder, ...progressNext });
  if (first) send();
  else progressTimer = setTimeout(send, 100);
}

async function useProject(folder: string): Promise<ProjectInfo> {
  let project: ProjectInfo;
  try {
    project = current.project = await openProject(folder, (step, detail) => openProgress(folder, step, detail));
  } finally {
    openProgress(folder, null);
  }
  fingerprints.clear();
  builtPages.clear();
  resetGit();
  startWatching(project);
  setTimeout(() => void checkServer(), 2000);
  setWindowTitle(`${project.name} — MyST Editor`);
  const root = project.root;
  await updateSettings((s) => ({ ...s, lastProject: root, recent: [root, ...(s.recent ?? []).filter((r) => r !== root)].slice(0, 10) }));
  setRecentFolders((await loadSettings()).recent ?? []);
  await startSphinx(project, (p, info) => void addBuiltPages(p, info));
  refreshGit();
  return project;
}

// Pages Sphinx built that the folder scan didn't list (in a folder skipped by its name,
// say): they're pages all the same, so add them and keep them when the list is re-read.
export const builtPages = new Set<string>();
async function addBuiltPages(p: ProjectInfo, info: SphinxInfo) {
  const listed = new Set(p.files);
  const missing = [...new Set(Object.values(info.docs).map((d) => d.source))].filter((s) => isPage(s) && !listed.has(s));
  const found: string[] = [];
  for (const rel of missing) {
    try {
      if ((await fs.stat(resolveInside(p.root, rel))).isFile()) found.push(rel);
    } catch {
      // gone, or outside the folder
    }
  }
  if (!found.length || current.project !== p) return;
  const titles = { ...p.titles };
  for (const rel of found) {
    builtPages.add(rel);
    const title = await readTitle(join(p.root, rel));
    if (title) titles[rel] = title;
  }
  if (current.project !== p) return;
  p.files = [...new Set([...p.files, ...found])].sort((a, b) => a.localeCompare(b));
  p.titles = titles;
  toWindow('files-changed', { files: p.files, titles, changed: [] });
}

// The page list changed by the app itself (a page added or deleted): tell the window
// now rather than waiting for the watcher. `added` gets its title read.
export async function pagesChanged(p: ProjectInfo, files: string[], added?: string) {
  p.files = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  p.titles = Object.fromEntries(Object.entries(p.titles).filter(([f]) => p.files.includes(f)));
  if (added) {
    const title = await readTitle(join(p.root, added));
    if (title) p.titles[added] = title;
  }
  toWindow('files-changed', { files: p.files, titles: p.titles, changed: [] });
  refreshGit();
}

async function existing(root: string, rels: Iterable<string>): Promise<string[]> {
  const out: string[] = [];
  for (const rel of rels) {
    try {
      if ((await fs.stat(join(root, rel))).isFile()) out.push(rel);
    } catch {
      // gone
    }
  }
  return out;
}

// Re-read the folder's projects and settings, and tell the renderer if they changed.
// The same projects keep their build managers; new or removed ones restart them all.
export async function refreshProject(p: ProjectInfo) {
  const next = await openProject(p.root);
  if (current.project !== p) return;
  const same = (a: ProjectInfo, b: ProjectInfo) => JSON.stringify([a.projects, a.defaultConfig]) === JSON.stringify([b.projects, b.defaultConfig]);
  if (same(next, p)) return;
  const restart = JSON.stringify(next.projects.map((x) => x.id)) !== JSON.stringify(p.projects.map((x) => x.id));
  // Projects whose [sphinx.env] changed build again from scratch (conf.py may read it).
  const envChanged = next.projects.filter((x) => JSON.stringify(x.config.editor.sphinxEnv) !== JSON.stringify(p.projects.find((y) => y.id === x.id)?.config.editor.sphinxEnv));
  Object.assign(p, { projects: next.projects, defaultConfig: next.defaultConfig, buildInputs: next.buildInputs });
  toWindow('project-changed', { project: p });
  if (restart) await startSphinx(p, (q, info) => void addBuiltPages(q, info));
  else rebuildFresh(envChanged.map((x) => x.id));
}

// After switching branch: the files under the app changed, so the page list and the
// projects' settings are read again (before the window reopens a page).
export async function rereadAfterCheckout() {
  const p = requireProject();
  await pagesChanged(p, [...(await listDocuments(p.root)), ...(await existing(p.root, builtPages))]);
  await refreshProject(p);
}

// A file's content as a fingerprint; size and time for large files. Null if it's gone,
// 'dir' for a directory.
async function fingerprint(path: string): Promise<string | null> {
  try {
    const st = await fs.stat(path);
    if (st.isDirectory()) return 'dir';
    if (st.size > 4 * 1024 * 1024) return `${st.size}:${st.mtimeMs}`;
    return fingerprintText(await fs.readFile(path));
  } catch {
    return null;
  }
}

function startWatching(p: ProjectInfo) {
  watcher?.close();
  forgetChangesInBuilds();
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let flushing = Promise.resolve();
  const flush = async () => {
    if (current.project !== p) return;
    const batch = [...pending];
    pending.clear();
    const changed: string[] = []; // files whose content is new
    let relist = false; // a folder appeared or went: list the pages again
    for (const rel of batch) {
      const fp = await fingerprint(join(p.root, rel));
      if (fp === 'dir') {
        relist = true;
        continue;
      }
      if (fp === null) {
        if (p.files.some((f) => f.startsWith(rel + '/'))) relist = true;
        if (fingerprints.delete(rel) || p.files.includes(rel)) changed.push(rel);
        continue;
      }
      if (fingerprints.get(rel) === fp) continue;
      fingerprints.set(rel, fp);
      changed.push(rel);
    }
    if (current.project !== p || (!changed.length && !relist)) return;

    // Pages: only re-read what changed, which matters in a folder of thousands.
    const before = new Set(p.files);
    let files = relist ? [...new Set([...(await listDocuments(p.root)), ...(await existing(p.root, builtPages))])] : [...p.files];
    if (!relist) {
      for (const rel of changed.filter(isPage)) {
        const exists = fingerprints.has(rel);
        if (exists && !before.has(rel)) files.push(rel);
        if (!exists) files = files.filter((f) => f !== rel);
      }
      files.sort((a, b) => a.localeCompare(b));
    }
    const titles = Object.fromEntries(Object.entries(p.titles).filter(([f]) => files.includes(f)));
    const reread = new Set([...changed.filter(isPage), ...files.filter((f) => !before.has(f))]);
    for (const rel of reread) {
      if (!files.includes(rel)) continue;
      const title = await readTitle(join(p.root, rel));
      if (title) titles[rel] = title;
      else delete titles[rel];
    }
    if (current.project !== p) return;
    Object.assign(p, { files, titles });
    const pages = changed.filter((r) => isPage(r) && files.includes(r));
    toWindow('files-changed', { files, titles, changed: pages });
    refreshGit();
    // Our own saves request builds directly; these are changes made outside the app.
    if (changed.some((rel) => isBuildInput(rel.split('/').pop()!))) p.buildInputs = await buildInputsOf(p.root);
    for (const rel of changed) if (!rel.endsWith(SETTINGS_FILE)) buildFor(p, rel, true);
    // conf.py, editor settings and capabilities files change how pages are read.
    const settings = (rel: string) => /(^|\/)(conf\.py|\.mysteditor\.toml)$/.test(rel) || (rel.endsWith('.json') && isBuildInput(rel.split('/').pop()!));
    if (changed.some(settings)) await refreshProject(p);
  };
  const w = new FolderWatcher(p.root, unwatchedDir, (rel) => {
    // Hidden files are ignored, except the editor's own settings.
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if ((name.startsWith('.') && name !== SETTINGS_FILE) || UNWATCHED_DIRS.has(name)) return;
    pending.add(rel);
    clearTimeout(timer);
    // One flush at a time, so a slow one can't overlap the next.
    timer = setTimeout(() => (flushing = flushing.then(flush, flush)), 300);
  });
  watcher = w;
  w.start().catch((e) => console.warn('File watching unavailable:', e));
}

export function stopWatching() {
  watcher?.close();
}

// The project folder from the command line (`mysteditor ./docs`), if given.
function folderFromArgs(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  for (const a of args) {
    try {
      if (statSync(a).isDirectory()) return a;
    } catch {
      // not a folder
    }
  }
  return process.env.MYSTEDITOR_PROJECT ?? null;
}

export function registerWorkspaceIpc() {
  ipcMain.handle('initial-project', async () => {
    const folder = folderFromArgs() ?? (await loadSettings()).lastProject;
    if (!folder) return null;
    try {
      return await useProject(folder);
    } catch {
      return null;
    }
  });
  ipcMain.handle('choose-project', async () => {
    const result = await dialog.showOpenDialog(current.win!, {
      title: 'Open documentation folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : useProject(result.filePaths[0]);
  });
  ipcMain.handle('open-project', (_e, folder: string) => useProject(folder));
  // Recent folders that are still there, for the welcome screen.
  ipcMain.handle('recent-folders', async () => {
    const out: string[] = [];
    for (const folder of (await loadSettings()).recent ?? []) {
      try {
        if ((await fs.stat(folder)).isDirectory()) out.push(folder);
      } catch {
        // gone (or on a drive that isn't there now)
      }
    }
    return out;
  });
}
