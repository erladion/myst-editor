// Git for the open folder: the prompts git needs answered, the background check of the
// server, the lock that keeps commands from tripping over each other, and telling the
// window about the repository's state. The window's requests are in ipc.ts.
import { app } from 'electron';
import { relative, sep } from 'node:path';
import { Git, GitError } from './git.js';
import { AskPass } from './askpass.js';
import type { GitInfo } from '../../shared/git.js';
import { current, toWindow } from '../state.js';

// Git and the prompts it needs answered (see askpass.ts).
let askpass: AskPass | null = null;
export const git = new Git(() => askpass?.env() ?? { GIT_TERMINAL_PROMPT: '0' });
const pendingQuestions = new Map<number, (answer: string | null) => void>();
let questionId = 0;

function askWriter(question: string): Promise<string | null> {
  if (!current.win) return Promise.resolve(null);
  const id = ++questionId;
  toWindow('askpass', { id, question });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingQuestions.delete(id);
      resolve(null);
    }, 5 * 60_000);
    pendingQuestions.set(id, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

export function answerQuestion(id: number, answer: string | null) {
  pendingQuestions.get(id)?.(answer);
  pendingQuestions.delete(id);
}

export async function startAskPass() {
  askpass = new AskPass(app.getPath('userData'), askWriter);
  await askpass.start().catch((e) => {
    console.warn('Git prompts unavailable:', e);
    askpass = null;
  });
}

export function stopAskPass() {
  askpass?.stop();
}

// What a folder's git state holds besides the repository: the last background check,
// and a clash with set-aside edits being settled (nothing on disk says so once the
// files are settled; see Git.continue).
export const session: { lastCheck: { at: number; error: string | null } | null; finishing: GitInfo['operation'] } = { lastCheck: null, finishing: null };

// A newly opened folder starts afresh.
export function resetGit() {
  session.finishing = null;
  session.lastCheck = null;
}

export async function gitInfo(): Promise<GitInfo> {
  const { project } = current;
  const available = !!(await git.available());
  const repoRoot = project && available ? await git.repoRoot(project.root) : null;
  if (!project || !repoRoot) return { available, repoRoot: null, prefix: '', status: null, identity: null, operation: null, checked: null };
  const [status, identity] = await Promise.all([git.status(repoRoot).catch(() => null), git.identity(repoRoot)]);
  const prefix = relative(repoRoot, project.root).split(sep).join('/');
  const operation = status ? await git.operation(repoRoot, status) : null;
  return { available, repoRoot, prefix, status, identity, operation: operation ?? session.finishing, checked: session.lastCheck };
}

// The background check of the server (git fetch), so "N new on the server" is true:
// every few minutes, and when the window comes back to the front. Skipped while the
// writer is doing something with git.
const CHECK_EVERY_MS = 3 * 60_000;
let gitBusy = false;
let checking = false;
export async function checkServer() {
  const { project } = current;
  if (gitBusy || checking || !project) return;
  const root = await git.repoRoot(project.root);
  if (!root || gitBusy) return;
  const status = await git.status(root).catch(() => null);
  if (!status?.upstream) return;
  checking = true;
  try {
    await exclusive(() => git.fetch(root));
    session.lastCheck = { at: Date.now(), error: null };
  } catch (e) {
    session.lastCheck = { at: Date.now(), error: e instanceof Error ? e.message : String(e) };
  } finally {
    checking = false;
  }
  refreshGit();
}

// Git commands that change the repository take turns: two at once (a background
// check fetching while the writer gets the latest, say) can trip over git's locks.
let gitLock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const turn = gitLock.then(fn, fn);
  gitLock = turn.catch(() => {});
  return turn;
}
setInterval(() => void checkServer(), CHECK_EVERY_MS).unref();
let lastFocusCheck = 0;
export function checkOnFocus() {
  if (Date.now() - lastFocusCheck < 60_000) return;
  lastFocusCheck = Date.now();
  void checkServer();
}

// A git action the writer started: no background check meanwhile, and the window
// hears about the result.
export async function gitAction<T>(fn: (root: string) => Promise<T>): Promise<T> {
  gitBusy = true;
  try {
    const root = await requireRepo();
    return await exclusive(() => fn(root));
  } finally {
    gitBusy = false;
    refreshGit();
  }
}

let gitTimer: NodeJS.Timeout | undefined;
// Tell the window about the repository's state, soon (several changes → one update).
export function refreshGit() {
  clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => toWindow('git-info', await gitInfo()), 400);
}

export async function requireRepo(): Promise<string> {
  const root = current.project && (await git.repoRoot(current.project.root));
  if (!root) throw new Error('This folder isn’t part of a git repository.');
  return root;
}

// Errors cross IPC as plain messages; GitError's is already written for the writer.
export function plain<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    throw new Error(e instanceof GitError ? e.message : e instanceof Error ? e.message : String(e));
  });
}
