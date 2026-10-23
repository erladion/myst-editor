// What the writer does with pages as a whole: create, rename or move, move in the
// contents, delete, and put an earlier version back. Each keeps the tables of contents
// and links in step (see pages.ts), and says what it couldn't do.
import { useCallback, type RefObject } from 'react';
import type { SphinxState } from '../../../shared/sphinx';
import type { PageVersion } from '../../../shared/git';
import { projectFor } from '../../../shared/projects';
import type { Workspace } from '../workspace';
import type { DialogApi } from '../components/Dialogs';
import type { NewPage, PageRename } from '../components/PageDialogs';
import { when } from '../components/History';
import { addToContents, listingPages, moveInContents, removeFromContents, renameReferences, retitle, type ContentsMove } from '../pages';
import { landingPage, plainError } from './folder';

const api = window.myst;

// Closing the dialog each action came from, once it has done its part.
interface Closers {
  history: () => void;
  renaming: () => void;
  newPage: () => void;
}

export function usePageActions(
  ws: Workspace | null,
  dialogs: RefObject<DialogApi | null>,
  openPage: (path: string) => Promise<boolean>,
  buildStates: Record<string, SphinxState>,
  close: Closers,
) {
  // Delete a page: to the trash, and out of the tables of contents that list it.
  const deletePage = useCallback(
    async (path: string) => {
      if (!ws) return;
      const project = projectFor(ws.project.projects, path);
      const info = (project && buildStates[project.id]?.info) || null;
      const listing = await listingPages(ws, project, info, path);
      const title = ws.project.titles[path] ?? path;
      const ok = await dialogs.current!.confirm({
        title: 'Delete page',
        message:
          `Delete “${title}” (${path})? It goes to the trash, so it can be restored from there.` +
          (listing.length ? ` It will also be taken out of the table of contents of ${listing.map((p) => `“${ws.project.titles[p] ?? p}”`).join(', ')}.` : '') +
          ' Links to it from other pages will show as problems.',
        confirm: 'Delete page',
      });
      if (!ok) return;
      try {
        const { trashed } = await api.deletePage(path, false);
        if (!trashed) {
          const forGood = await dialogs.current!.confirm({
            title: 'No trash here',
            message: `This system has no trash to move “${title}” to. Delete it permanently instead? This can’t be undone (unless it’s committed in git).`,
            confirm: 'Delete permanently',
          });
          if (!forGood) return;
          await api.deletePage(path, true);
        }
      } catch (e) {
        dialogs.current?.notify(`Couldn’t delete ${path}: ${e instanceof Error ? e.message : e}`);
        return;
      }
      const failed = await removeFromContents(ws, project, listing, path);
      if (failed.length) dialogs.current?.notify(`Remove “${title}” from the contents of ${failed.join(', ')} yourself: those pages are open as Markdown or couldn’t be saved.`);
      const wasCurrent = ws.current === path;
      ws.close(path);
      if (wasCurrent) {
        const next = landingPage({ ...ws.project, files: ws.project.files.filter((f) => f !== path) });
        if (next) void openPage(next);
      }
    },
    [ws, dialogs, openPage, buildStates],
  );

  // Put an earlier version of a page back, keeping the page as it is now in its
  // history first, so this can be undone the same way.
  const restoreVersion = useCallback(
    async (path: string, text: string, version: PageVersion) => {
      if (!ws) return;
      const title = ws.project.titles[path] ?? path;
      const ok = await dialogs.current!.confirm({
        title: 'Restore this version',
        message: `Replace “${title}” with the version from ${when(version.date)}? The page as it is now is kept in its history, so you can go back to it.`,
        confirm: 'Restore',
      });
      if (!ok) return;
      try {
        await ws.save(path);
        await api.snapshotPage(path);
        if (!(await ws.restore(path, text))) throw new Error('it couldn’t be saved');
        close.history();
      } catch (e) {
        dialogs.current?.notify(`Couldn’t restore ${path}: ${plainError(e)}`);
      }
    },
    [ws, dialogs, close],
  );

  // Rename or move a page: its title, its file, and every reference to it.
  const renamePage = useCallback(
    async (from: string, { title, path }: PageRename) => {
      if (!ws) return;
      if (!(await ws.saveAll())) throw new Error('Some pages couldn’t be saved. Fix them first.');
      const project = projectFor(ws.project.projects, from);
      if (title !== (ws.project.titles[from] ?? '') && !(await ws.edit(from, (state) => retitle(state, title)))) throw new Error('The page is open as Markdown: change its heading there.');
      if (path !== from) {
        await api.renamePage(from, path);
        ws.close(from);
        const failed = await renameReferences(ws, project, from, path);
        if (failed.length) dialogs.current?.notify(`Update the links to it in ${failed.join(', ')} yourself: those pages are open as Markdown or couldn’t be saved.`);
      }
      close.renaming();
      await openPage(path);
    },
    [ws, dialogs, openPage, close],
  );

  // Move a page in the contents (dragged in the sidebar, or Move up / down).
  const moveInContentsOf = useCallback(
    async (move: ContentsMove) => {
      if (!ws) return 'No folder is open.';
      const problem = await moveInContents(ws, projectFor(ws.project.projects, move.to), move).catch((e) => String(e instanceof Error ? e.message : e));
      if (problem) dialogs.current?.notify(problem);
      return problem;
    },
    [ws, dialogs],
  );

  const createPage = useCallback(
    async ({ title, path, contents }: NewPage) => {
      if (!ws) return;
      await api.createPage(path, `# ${title}\n`);
      const project = projectFor(ws.project.projects, path);
      close.newPage();
      if (contents && !(await addToContents(ws, project, contents, path))) {
        dialogs.current?.notify(`Add the new page to the contents of ${contents} yourself: it’s open as Markdown or couldn’t be saved.`);
      }
      await openPage(path);
    },
    [ws, dialogs, openPage, close],
  );

  return { deletePage, restoreVersion, renamePage, moveInContentsOf, createPage };
}
