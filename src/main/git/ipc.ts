// The window's git requests: cloning, committing, branches, getting the latest and
// settling clashes, discarding changes. See service.ts for what they share.
import { app, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ConflictFile } from '../../shared/git.js';
import { readDocument } from '../project.js';
import { current, requireProject, toWindow } from '../state.js';
import { rereadAfterCheckout } from '../workspace.js';
import { snapshots } from '../files.js';
import { answerQuestion, checkServer, git, gitAction, gitInfo, plain, refreshGit, requireRepo, session } from './service.js';

export function registerGitIpc() {
  ipcMain.handle('git-info', () => gitInfo());
  ipcMain.handle('choose-folder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog(current.win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('default-clone-folder', () => app.getPath('documents'));
  ipcMain.handle('git-clone', (_e, url: string, parent: string) => plain(() => git.clone(url, parent, (line) => toWindow('git-progress', line))));
  ipcMain.handle('git-commit', (_e, paths: string[], message: string, push: boolean) =>
    plain(() =>
      gitAction(async (root) => {
        await git.commit(root, paths, message);
        if (push) await git.push(root);
      }),
    ),
  );
  ipcMain.handle('git-branches', () => plain(async () => git.branches(await requireRepo())));
  // Switching branch changes the files under the app: the page list and the projects'
  // settings are read again before answering, so the window has them when it reopens
  // a page.
  ipcMain.handle('git-switch', (_e, branch: string, leave: boolean) =>
    plain(() =>
      gitAction(async (root) => {
        session.finishing = await git.switchTo(root, branch, leave);
        await rereadAfterCheckout();
        return session.finishing;
      }),
    ),
  );
  ipcMain.handle('git-create-branch', (_e, name: string, base: string | null) =>
    plain(() =>
      gitAction(async (root) => {
        await git.createBranch(root, name, base);
        await rereadAfterCheckout();
      }),
    ),
  );
  // Check the server now (the Changes panel was opened).
  ipcMain.handle('git-check', () => checkServer());
  ipcMain.handle('git-push', () => plain(() => gitAction((root) => git.push(root))));
  // Get the latest: rebase onto the server, setting uncommitted edits aside meanwhile.
  ipcMain.handle('git-get-latest', () => plain(() => gitAction(async (root) => (session.finishing = await git.getLatest(root)))));
  ipcMain.handle('git-conflicts', () =>
    plain(async (): Promise<ConflictFile[]> => {
      const root = await requireRepo();
      const status = await git.status(root);
      const files: ConflictFile[] = [];
      for (const c of status.changes.filter((x) => x.kind === 'conflict')) {
        const text = await fs.readFile(join(root, c.path), 'utf8').catch(() => null);
        // Only text git marked up can be settled spot by spot.
        files.push({ path: c.path, text: text !== null && !text.includes('\0') && text.includes('<<<<<<<') ? text : null });
      }
      return files;
    }),
  );
  ipcMain.handle('git-resolve', (_e, path: string, text: string | null) => plain(() => gitAction((root) => git.resolve(root, path, text))));
  ipcMain.handle('git-take-side', (_e, path: string, side: 'server' | 'yours') =>
    plain(() => gitAction(async (root) => git.takeSide(root, path, side, (await git.operation(root)) ?? session.finishing))),
  );
  ipcMain.handle('git-continue', () => plain(() => gitAction(async (root) => (session.finishing = await git.continue(root, session.finishing)))));
  ipcMain.handle('git-abort', () =>
    plain(() =>
      gitAction(async (root) => {
        await git.abort(root);
        session.finishing = null;
      }),
    ),
  );
  // Throw away a file's uncommitted changes; a page's text is kept in its history first.
  ipcMain.handle('git-discard', (_e, path: string) =>
    plain(() =>
      gitAction(async (root) => {
        const p = requireProject();
        const rel = relative(p.root, join(root, path)).split(sep).join('/');
        if (!rel.startsWith('..') && rel.endsWith('.md')) {
          const now = await readDocument(p, rel).catch(() => null);
          if (now !== null) await snapshots().keep(p.root, rel, now, { force: true });
        }
        await git.discard(root, path);
      }),
    ),
  );
  // A file as last committed (relative to the repository root), to show what changed.
  ipcMain.handle('git-committed', async (_e, path: string) => {
    const root = await requireRepo();
    return git.fileAt(root, 'HEAD', path);
  });
  ipcMain.handle('git-set-identity', (_e, name: string, email: string, global: boolean) =>
    plain(async () => git.setIdentity(await requireRepo(), name, email, global).finally(refreshGit)),
  );
  ipcMain.on('askpass-answer', (_e, id: number, answer: string | null) => answerQuestion(id, typeof answer === 'string' ? answer : null));
}
