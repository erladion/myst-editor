// The window's requests about pages and files: reading and saving pages, creating,
// renaming and deleting them, their earlier versions, images, search and Vale.
import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { firstHeading, IMAGE_EXTENSIONS, placeImage, readDocument, resolveInside, saveImage, searchPages, writeDocument } from './project.js';
import { Snapshots } from './history.js';
import { accept as acceptWithVale, lint as lintWithVale } from './vale.js';
import type { PageVersion } from '../shared/git.js';
import { current, requireProject, toWindow } from './state.js';
import { builtPages, fingerprints, fingerprintText, pagesChanged } from './workspace.js';
import { buildFor } from './sphinx/service.js';
import { git, refreshGit } from './git/service.js';

// Earlier versions of pages, kept by the app (see history.ts). Made when first needed:
// the data folder may be set at start (MYSTEDITOR_USER_DATA).
let kept: Snapshots | null = null;
export const snapshots = () => (kept ??= new Snapshots(join(app.getPath('userData'), 'history')));

export function registerFileIpc() {
  // Images pasted or dropped into a page: a file on disk (referenced where it is if
  // it's in the folder, else copied in), or bytes (a pasted screenshot).
  ipcMain.handle('add-image-file', (_e, page: string, path: string) => {
    if (!IMAGE_EXTENSIONS.includes(path.split('.').pop()?.toLowerCase() ?? '')) throw new Error(`Not an image file: ${path}`);
    return placeImage(requireProject().root, page, path);
  });
  ipcMain.handle('add-image-data', (_e, page: string, name: string, bytes: Uint8Array) => saveImage(requireProject().root, page, name, bytes));
  ipcMain.handle('choose-image', async (_e, page: string) => {
    const p = requireProject();
    const pagePath = resolveInside(p.root, page);
    const result = await dialog.showOpenDialog(current.win!, {
      title: 'Choose an image',
      defaultPath: dirname(pagePath),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
    });
    return result.canceled ? null : placeImage(p.root, page, result.filePaths[0]);
  });
  ipcMain.handle('vale-lint', (_e, rel: string) => lintWithVale(resolveInside(requireProject().root, rel)));
  ipcMain.handle('vale-accept', (_e, rel: string, word: string) => acceptWithVale(resolveInside(requireProject().root, rel), String(word)));
  ipcMain.handle('search-pages', (_e, query: string, caseSensitive: boolean) => {
    const p = requireProject();
    return searchPages(p.root, p.files, String(query), !!caseSensitive);
  });

  ipcMain.handle('read-file', (_e, rel: string) => readDocument(requireProject(), rel));
  ipcMain.handle('write-file', async (_e, rel: string, text: string) => {
    // The page as it was, as an earlier version (see history.ts).
    const before = await readDocument(requireProject(), rel).catch(() => null);
    if (before !== null && before !== text) await snapshots().keep(requireProject().root, rel, before).catch(() => {});
    fingerprints.set(rel, fingerprintText(text));
    await writeDocument(requireProject(), rel, text);
    // A changed heading is a new title for the sidebar and dialogs.
    const p = requireProject();
    const title = firstHeading(text);
    if ((title ?? undefined) !== p.titles[rel]) {
      p.titles = { ...p.titles };
      if (title) p.titles[rel] = title;
      else delete p.titles[rel];
      toWindow('files-changed', { files: p.files, titles: p.titles, changed: [] });
    }
    buildFor(p, rel, false);
    refreshGit();
  });
  // A new page; refuses to replace a file that exists.
  ipcMain.handle('create-page', async (_e, rel: string, text: string) => {
    const p = requireProject();
    if (!rel.endsWith('.md')) throw new Error('Pages are Markdown files ending in .md');
    const path = resolveInside(p.root, rel);
    await fs.mkdir(dirname(path), { recursive: true });
    try {
      await fs.writeFile(path, text, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`There’s already a file called ${rel}`);
      throw e;
    }
    fingerprints.set(rel, fingerprintText(text));
    await pagesChanged(p, [...p.files, rel], rel);
    buildFor(p, rel, false);
  });
  // Rename or move a page's file (its references are the window's job). Refuses to
  // replace another file.
  ipcMain.handle('rename-page', async (_e, from: string, to: string) => {
    const p = requireProject();
    if (!to.endsWith('.md')) throw new Error('Pages are Markdown files ending in .md');
    const source = resolveInside(p.root, from);
    const target = resolveInside(p.root, to);
    if (source === target) return;
    // On Windows and macOS a change of case alone is the same file: allow that.
    if (existsSync(target) && source.toLowerCase() !== target.toLowerCase()) throw new Error(`There’s already a file called ${to}`);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.rename(source, target);
    const fp = fingerprints.get(from);
    fingerprints.delete(from);
    if (fp) fingerprints.set(to, fp);
    if (builtPages.delete(from)) builtPages.add(to);
    await snapshots().rename(p.root, from, to).catch(() => {});
    await pagesChanged(p, [...p.files.filter((f) => f !== from), to], to);
    buildFor(p, from, false);
    buildFor(p, to, false);
  });
  // Delete a page: to the trash, or for good (when the trash isn't available).
  ipcMain.handle('delete-page', async (_e, rel: string, permanently: boolean) => {
    const p = requireProject();
    const path = resolveInside(p.root, rel);
    if (permanently) await fs.rm(path);
    // MYSTEDITOR_TRASH=none: act as if there's no trash (tests, which shouldn't fill
    // the desktop's).
    else if (process.env.MYSTEDITOR_TRASH === 'none') return { trashed: false };
    else {
      try {
        await shell.trashItem(path);
      } catch {
        return { trashed: false };
      }
    }
    fingerprints.delete(rel);
    builtPages.delete(rel);
    await pagesChanged(p, p.files.filter((f) => f !== rel));
    buildFor(p, rel, false);
    return { trashed: true };
  });

  // A page's earlier versions: the app's snapshots and its commits, newest first.
  ipcMain.handle('page-history', async (_e, rel: string): Promise<PageVersion[]> => {
    const p = requireProject();
    const saved: PageVersion[] = (await snapshots().list(p.root, rel)).map((s) => ({ kind: 'saved', id: s.id, date: s.date }));
    const repo = await git.repoRoot(p.root);
    const commits: PageVersion[] = repo
      ? (await git.fileHistory(repo, relative(repo, join(p.root, rel)).split(sep).join('/'))).map((c) => ({
          kind: 'commit',
          id: c.commit,
          date: c.date,
          author: c.author,
          message: c.message,
          body: c.body,
          path: c.path,
        }))
      : [];
    return [...saved, ...commits].sort((a, b) => b.date.localeCompare(a.date));
  });
  ipcMain.handle('page-version', async (_e, rel: string, version: PageVersion): Promise<string | null> => {
    const p = requireProject();
    if (version.kind === 'saved') return snapshots().read(p.root, rel, version.id);
    const repo = await git.repoRoot(p.root);
    return repo && version.path ? git.fileAt(repo, version.id, version.path) : null;
  });
  // Keep the page as it is now before replacing it with an older version.
  ipcMain.handle('snapshot-page', async (_e, rel: string) => {
    const p = requireProject();
    await snapshots().keep(p.root, rel, await readDocument(p, rel), { force: true });
  });
}
