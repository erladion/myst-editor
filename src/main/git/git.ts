// Git through the system's own `git`, which brings HTTPS and SSH, the writer's keys
// and their credential helpers. Questions git or ssh ask go through AskPass.
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Branches, GitChange, GitOperation, GitStatus } from '../../shared/git.js';
import { run, type RunResult } from '../sphinx/run.js';

export interface FileCommit {
  commit: string;
  author: string;
  date: string; // ISO 8601
  message: string; // the subject line
  body: string; // the rest of the message, if any
  path: string; // the file's path in that commit
}

export class GitError extends Error {
  constructor(
    message: string,
    public output: string,
  ) {
    super(message);
  }
}

// Options for every command: no `ext::` transport (it runs arbitrary commands), and
// paths printed as they are.
const SAFE = ['-c', 'protocol.ext.allow=never', '-c', 'core.quotepath=false'];

export class Git {
  constructor(private env: () => NodeJS.ProcessEnv) {}

  private async git(args: string[], cwd: string, log?: (t: string) => void, extraEnv: NodeJS.ProcessEnv = {}): Promise<RunResult> {
    return run('git', [...SAFE, ...args], {
      cwd,
      env: { ...process.env, ...this.env(), LC_ALL: 'C', ELECTRON_RUN_AS_NODE: undefined, ...extraEnv },
      log,
      timeoutMs: 30 * 60_000,
    });
  }

  // Only standard output, unshortened: for file contents and logs, where git's
  // messages on stderr mustn't mix in.
  private stdout(args: string[], cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        'git',
        [...SAFE, ...args],
        { cwd, env: { ...process.env, ...this.env(), LC_ALL: 'C', ELECTRON_RUN_AS_NODE: undefined }, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', timeout: 60_000 },
        (error, out) => resolve(error ? null : out),
      );
    });
  }

  private async checked(args: string[], cwd: string, log?: (t: string) => void): Promise<string> {
    const r = await this.git(args, cwd, log);
    if (r.code !== 0) throw new GitError(explain(r.output), r.output);
    return r.output;
  }

  async available(): Promise<string | null> {
    try {
      const r = await this.git(['--version'], process.cwd());
      return r.code === 0 ? r.output.trim() : null;
    } catch {
      return null;
    }
  }

  // The repository a folder is in, if any.
  async repoRoot(folder: string): Promise<string | null> {
    try {
      const r = await this.git(['rev-parse', '--show-toplevel'], folder);
      // Git for Windows prints C:/Users/…: make it a normal path for this system.
      return r.code === 0 ? resolve(r.output.trim()) : null;
    } catch {
      return null;
    }
  }

  async clone(url: string, into: string, onProgress: (line: string) => void): Promise<string> {
    if (!isCloneUrl(url)) throw new GitError('That doesn’t look like a repository link (https://…, ssh://… or git@host:path).', '');
    const name = repoName(url);
    const dest = join(into, name);
    if (existsSync(dest)) throw new GitError(`A folder named “${name}” already exists there.`, '');
    // Progress arrives on stderr, separated by carriage returns.
    await this.checked(['clone', '--progress', '--', url, dest], into, (t) => t.split(/[\r\n]/).forEach((l) => l.trim() && onProgress(l.trim())));
    return dest;
  }

  // Branch, upstream and changed files. Paths are relative to the repository root.
  async status(root: string): Promise<GitStatus> {
    // --no-optional-locks: reading the status doesn't take git's index lock, so it never
    // gets in the way of a commit or a rebase running at the same time.
    const out = await this.checked(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root);
    const status: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, changes: [] };
    const entries = out.split('\0');
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.startsWith('# branch.head ')) status.branch = e.slice(14) === '(detached)' ? null : e.slice(14);
      else if (e.startsWith('# branch.upstream ')) status.upstream = e.slice(18);
      else if (e.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(e);
        if (m) [status.ahead, status.behind] = [Number(m[1]), Number(m[2])];
      } else if (e.startsWith('1 ') || e.startsWith('u ')) {
        const parts = e.split(' ');
        status.changes.push({ path: parts.slice(e.startsWith('u ') ? 10 : 8).join(' '), kind: changeKind(parts[1]) });
      } else if (e.startsWith('2 ')) {
        // Renames: the new path, then the old one as the next entry.
        status.changes.push({ path: e.split(' ').slice(9).join(' '), kind: 'renamed', from: entries[++i] });
      } else if (e.startsWith('? ')) status.changes.push({ path: e.slice(2), kind: 'added' });
    }
    return status;
  }

  async identity(root: string): Promise<{ name: string; email: string } | null> {
    const get = async (key: string) => (await this.git(['config', '--get', key], root)).output.trim();
    const [name, email] = await Promise.all([get('user.name'), get('user.email')]);
    return name && email ? { name, email } : null;
  }

  async setIdentity(root: string, name: string, email: string, global: boolean) {
    const scope = global ? ['--global'] : [];
    await this.checked(['config', ...scope, 'user.name', name], root);
    await this.checked(['config', ...scope, 'user.email', email], root);
  }

  // Commit exactly these files (relative to the repository root).
  // A new repository on main, with everything in the folder as its first commit.
  async initWithEverything(dir: string, message: string): Promise<void> {
    await this.checked(['init', '-q'], dir);
    await this.checked(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir);
    await this.checked(['add', '--all'], dir);
    await this.checked(['commit', '-q', '-m', message], dir);
  }

  async commit(root: string, paths: string[], message: string): Promise<void> {
    if (!paths.length) throw new GitError('Choose at least one changed file.', '');
    if (!message.trim()) throw new GitError('Write a short message saying what changed.', '');
    await this.checked(['add', '--all', '--', ...paths], root);
    await this.checked(['commit', '--only', '-m', message.trim(), '--', ...paths], root);
  }

  // The commits that changed a file (relative to the repository root), newest first,
  // following renames: each with the path the file had then.
  async fileHistory(root: string, path: string, limit = 200): Promise<FileCommit[]> {
    // Each commit: its fields, the body (any number of lines) up to \x1d, then the
    // file's name in that commit (from --name-only).
    const out = await this.stdout(['log', '--follow', `--max-count=${limit}`, '--name-only', '--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1d', '--', path], root);
    if (out === null) return [];
    return out
      .split('\x1e')
      .slice(1)
      .map((record) => {
        const [header, names = ''] = record.split('\x1d');
        const [commit, author, date, message, body = ''] = header.split('\x1f');
        return { commit, author, date, message, body: body.trim(), path: names.split('\n').find((l) => l.trim())?.trim() ?? path };
      })
      .filter((c) => c.commit);
  }

  // A file as it was in a commit (null if it didn't exist there).
  async fileAt(root: string, commit: string, path: string): Promise<string | null> {
    if (commit !== 'HEAD' && !/^[0-9a-f]{7,64}$/i.test(commit)) return null;
    return this.stdout(['show', `${commit}:${path}`], root);
  }

  async push(root: string, log?: (t: string) => void): Promise<void> {
    const { upstream, branch } = await this.status(root);
    if (upstream) await this.checked(['push'], root, log);
    else if (branch) await this.checked(['push', '--set-upstream', 'origin', branch], root, log);
    else throw new GitError('Not on a branch, so there is nothing to push to.', '');
  }

  // Fast-forward only: never creates a merge a writer would have to resolve.
  async pull(root: string, log?: (t: string) => void): Promise<void> {
    await this.checked(['pull', '--ff-only'], root, log);
  }

  // Ask the server what's new, without asking the writer anything: a background check
  // must never pop up a sign-in prompt, so it just fails if one would be needed.
  async fetch(root: string): Promise<void> {
    const quiet = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: 'never' };
    const r = await this.git(['fetch', '--quiet', '--prune'], root, undefined, quiet);
    if (r.code !== 0) throw new GitError(explain(r.output), r.output);
  }

  // What's half done in the repository: a rebase stopped at conflicts, a merge (made
  // outside the app), or the writer's set-aside edits that clashed when put back.
  async operation(root: string, status?: GitStatus): Promise<GitOperation> {
    const path = async (p: string) => {
      const r = await this.git(['rev-parse', '--git-path', p], root);
      return r.code === 0 ? resolve(root, r.output.trim()) : null;
    };
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      const p = await path(dir);
      if (p && existsSync(p)) return 'rebase';
    }
    const merge = await path('MERGE_HEAD');
    if (merge && existsSync(merge)) return 'merge';
    const s = status ?? (await this.status(root));
    return s.changes.some((c) => c.kind === 'conflict') ? 'stash' : null;
  }

  // Get the latest from the server: the writer's own commits go on top of what's new
  // (a rebase), and uncommitted edits are set aside and put back (autostash). Returns
  // what's left to resolve, if anything clashed.
  async getLatest(root: string, log?: (t: string) => void): Promise<GitOperation> {
    const { upstream } = await this.status(root);
    if (!upstream) throw new GitError('This branch isn’t on the server yet, so there’s nothing new to get. Push it first.', '');
    const r = await this.git(['-c', 'merge.conflictStyle=merge', 'pull', '--rebase', '--autostash'], root, log, { GIT_EDITOR: 'true' });
    const op = await this.operation(root);
    if (op) return op;
    if (r.code !== 0) throw new GitError(explain(r.output), r.output);
    return null;
  }

  // A conflicted file settled: with this text, or deleted (null).
  async resolve(root: string, path: string, text: string | null): Promise<void> {
    if (text === null) await this.checked(['rm', '-q', '--', path], root);
    else {
      await fs.writeFile(join(root, path), text);
      await this.checked(['add', '--', path], root);
    }
  }

  // A conflicted file settled by taking one side whole (for pictures and the like).
  async takeSide(root: string, path: string, side: 'server' | 'yours', op: GitOperation): Promise<void> {
    // In a rebase or when putting set-aside edits back, git's "ours" is the server's
    // side; in a merge it's the writer's.
    const ours = op === 'merge' ? side === 'yours' : side === 'server';
    const r = await this.git(['checkout', ours ? '--ours' : '--theirs', '--', path], root);
    // The side chosen may not have the file at all: then it goes.
    if (r.code !== 0) await this.checked(['rm', '-q', '--', path], root);
    else await this.checked(['add', '--', path], root);
  }

  // Carry on once every conflict is settled. May stop again (the next commit of a
  // rebase can clash too). Returns what's left, if anything. `finishing` is what was
  // reported before: settled set-aside edits leave nothing to tell that apart by.
  async continue(root: string, finishing: GitOperation, log?: (t: string) => void): Promise<GitOperation> {
    const op = (await this.operation(root)) ?? finishing;
    const editor = { GIT_EDITOR: 'true' };
    if (op === 'rebase') {
      const r = await this.git(['-c', 'merge.conflictStyle=merge', 'rebase', '--continue'], root, log, editor);
      const next = await this.operation(root);
      if (!next && r.code !== 0) throw new GitError(explain(r.output), r.output);
      return next;
    }
    if (op === 'merge') {
      await this.checked(['commit', '--no-edit'], root, log);
      return this.operation(root);
    }
    if (op === 'stash') {
      // The writer's edits are back in the files: unstaged again, as they were, and the
      // copy git kept aside is no longer needed.
      await this.checked(['reset', '-q'], root);
      // Either the autostash of getting the latest, or changes left on this branch.
      const stashes = ((await this.stdout(['stash', 'list', '--format=%gd%x1f%gs'], root)) ?? '').split('\n').map((l) => l.split('\x1f'));
      const branch = (await this.status(root)).branch;
      const kept = stashes.find(([, s], i) => (i === 0 && s === 'autostash') || (branch && s?.endsWith(`: ${leftOn(branch)}`)));
      if (kept) await this.checked(['stash', 'drop', '-q', kept[0]], root);
      return this.operation(root);
    }
    return null;
  }

  // Give up on a rebase or merge: everything as it was before (set-aside edits too).
  async abort(root: string): Promise<void> {
    const op = await this.operation(root);
    if (op === 'rebase') await this.checked(['rebase', '--abort'], root);
    else if (op === 'merge') await this.checked(['merge', '--abort'], root);
  }

  // Local branches (with how they stand against the server) and the server's branches
  // that have no local branch yet. Newest first.
  async branches(root: string): Promise<Branches> {
    const refs = async (pattern: string) =>
      ((await this.stdout(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:iso-strict)%1f%(HEAD)', pattern], root)) ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\x1f'));
    const local = (await refs('refs/heads')).map(([name, upstream, track, date]) => ({
      name,
      upstream: upstream || null,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      gone: track.includes('gone'),
      date,
    }));
    const current = (await refs('refs/heads')).find((r) => r[4] === '*')?.[0] ?? null;
    const tracked = new Set(local.map((b) => b.upstream));
    const remote = (await refs('refs/remotes'))
      .map(([name, , , date]) => ({ name, branch: name.slice(name.indexOf('/') + 1), date }))
      .filter((r) => !r.name.endsWith('/HEAD') && r.name.includes('/') && !tracked.has(r.name) && !local.some((b) => b.name === r.branch));
    return { current, local, remote, base: await this.baseBranch(root) };
  }

  // The server's default branch (what origin/HEAD points at), else origin/main or master.
  async baseBranch(root: string): Promise<string | null> {
    const head = await this.stdout(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root);
    if (head?.trim()) return head.trim();
    for (const b of ['origin/main', 'origin/master']) {
      if ((await this.git(['rev-parse', '--verify', '--quiet', b], root)).code === 0) return b;
    }
    return null;
  }

  // Switch to a branch (a local one, or the server's as a new local one tracking it).
  // `leave`: uncommitted changes stay with the branch being left, set aside until the
  // writer comes back to it; otherwise they come along. Returns what's left to settle
  // if changes set aside on the new branch clash when put back.
  async switchTo(root: string, branch: string, leave: boolean): Promise<GitOperation> {
    const { branch: from, changes } = await this.status(root);
    if (leave && from && changes.length) await this.checked(['stash', 'push', '--include-untracked', '-m', leftOn(from)], root);
    const remote = (await this.branches(root)).remote.find((r) => r.name === branch);
    const r = await this.git(remote ? ['switch', '--track', remote.name] : ['switch', branch], root);
    if (r.code !== 0) {
      if (leave && from && changes.length) await this.git(['stash', 'pop', '--quiet'], root); // as it was
      if (/would be overwritten by checkout|commit your changes or stash them/i.test(r.output)) {
        throw new GitError('Your uncommitted changes clash with that branch. Leave them on this branch instead, or commit them first.', r.output);
      }
      throw new GitError(explain(r.output), r.output);
    }
    // Changes left on this branch earlier come back.
    const name = remote ? remote.branch : branch;
    const stashes = ((await this.stdout(['stash', 'list', '--format=%gd%x1f%gs'], root)) ?? '').split('\n').map((l) => l.split('\x1f'));
    const mine = stashes.find(([, subject]) => subject?.endsWith(`: ${leftOn(name)}`));
    if (!mine) return null;
    const applied = await this.git(['-c', 'merge.conflictStyle=merge', 'stash', 'apply', '--index', mine[0]], root);
    if (applied.code === 0) {
      await this.checked(['stash', 'drop', '--quiet', mine[0]], root);
      return null;
    }
    return this.operation(root);
  }

  // A new branch, starting from the latest of the server's default branch (`base`),
  // or from what's checked out now. Uncommitted changes come along.
  async createBranch(root: string, name: string, base: string | null): Promise<void> {
    if ((await this.git(['check-ref-format', '--branch', name], root)).code !== 0) throw new GitError(`“${name}” can’t be a branch name.`, '');
    if ((await this.git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], root)).code === 0) throw new GitError(`There’s a branch called “${name}” already.`, '');
    if (base) await this.fetch(root).catch(() => {}); // the latest, if the server can be reached
    const r = await this.git(['switch', '--create', name, ...(base ? ['--no-track', base] : [])], root);
    if (r.code !== 0) {
      if (/would be overwritten by checkout|commit your changes or stash them/i.test(r.output)) {
        throw new GitError(`Your uncommitted changes clash with ${base}. Commit them first, or start the branch from what you have now.`, r.output);
      }
      throw new GitError(explain(r.output), r.output);
    }
  }

  // Throw away uncommitted changes to a file: back to the last commit, or (for a file
  // that was never committed) gone.
  async discard(root: string, path: string): Promise<void> {
    const tracked = await this.git(['ls-files', '--error-unmatch', '--', path], root);
    if (tracked.code === 0) await this.checked(['restore', '--source=HEAD', '--staged', '--worktree', '--', path], root);
    else await fs.rm(join(root, path), { force: true });
  }
}


// The name of the stash holding changes left on a branch when switching away.
const leftOn = (branch: string) => `left on ${branch} (MyST Editor)`;

function changeKind(xy: string): GitChange['kind'] {
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  if (xy.includes('U')) return 'conflict';
  return 'modified';
}

// https://, ssh://, git://, file:// links, scp-style git@host:path, or a local path
// (/srv/docs.git, C:\repos\docs, \\server\share\docs).
export function isCloneUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith('-') || /\s/.test(u)) return false;
  return /^(https?|ssh|git|file):\/\/./.test(u) || /^[\w.-]+@[\w.-]+:./.test(u) || u.startsWith('/') || /^([a-z]:)?[\\/]/i.test(u) || u.startsWith('\\\\');
}

export function repoName(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? 'repository';
  return last.replace(/\.git$/, '') || 'repository';
}

// What went wrong, in plain words, for the common cases.
export function explain(output: string): string {
  const o = output.toLowerCase();
  if (/could not read username|authentication failed|permission denied \(publickey|terminal prompts disabled/.test(o)) {
    return 'The server didn’t accept the sign-in. Check your password or SSH key, and that you have access to the repository.';
  }
  if (/host key verification failed/.test(o)) return 'The server’s identity couldn’t be confirmed, so nothing was sent.';
  if (/could not resolve host|could not resolve hostname|network is unreachable|connection timed out|failed to connect/.test(o)) {
    return 'The server couldn’t be reached. Check the link and your network connection.';
  }
  if (/repository .* not found|does not appear to be a git repository|not found/.test(o)) return 'There’s no repository at that link, or you don’t have access to it.';
  if (/not possible to fast-forward|diverging branches|divergent/.test(o)) {
    return 'Both your copy and the server have new commits, so they can’t simply be combined. Ask someone familiar with git to merge them.';
  }
  if (/would be overwritten by merge|your local changes/.test(o)) {
    return 'Getting the latest version would overwrite changes you haven’t committed. Commit them first.';
  }
  if (/\[rejected\]|non-fast-forward|fetch first/.test(o)) return 'The server has newer commits. Get the latest version first, then push again.';
  if (/nothing to commit/.test(o)) return 'There’s nothing to commit.';
  if (/cannot lock ref|unable to create .*\.lock|index\.lock.*exists/.test(o)) {
    return 'Another git command was busy with the repository (perhaps in a terminal). Try again in a moment.';
  }
  const last = output.trim().split('\n').filter((l) => /^(fatal|error):/.test(l)).pop();
  return last ? last.replace(/^(fatal|error):\s*/, '') : 'Git reported a problem; see the details.';
}
