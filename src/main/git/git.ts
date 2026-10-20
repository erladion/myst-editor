// Git through the system's own `git`, which brings HTTPS and SSH, the writer's keys
// and their credential helpers. Questions git or ssh ask go through AskPass.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitChange, GitStatus } from '../../shared/git.js';
import { run, type RunResult } from '../sphinx/run.js';

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

  private async git(args: string[], cwd: string, log?: (t: string) => void): Promise<RunResult> {
    return run('git', [...SAFE, ...args], {
      cwd,
      env: { ...process.env, ...this.env(), LC_ALL: 'C', ELECTRON_RUN_AS_NODE: undefined },
      log,
      timeoutMs: 30 * 60_000,
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
      return r.code === 0 ? r.output.trim() : null;
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
    const out = await this.checked(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root);
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
  async commit(root: string, paths: string[], message: string): Promise<void> {
    if (!paths.length) throw new GitError('Choose at least one changed file.', '');
    if (!message.trim()) throw new GitError('Write a short message saying what changed.', '');
    await this.checked(['add', '--all', '--', ...paths], root);
    await this.checked(['commit', '--only', '-m', message.trim(), '--', ...paths], root);
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
}

function changeKind(xy: string): GitChange['kind'] {
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  if (xy.includes('U')) return 'conflict';
  return 'modified';
}

// https://, ssh://, git://, file:// links, scp-style git@host:path, or a local path.
export function isCloneUrl(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith('-') || /\s/.test(u)) return false;
  return /^(https?|ssh|git|file):\/\/./.test(u) || /^[\w.-]+@[\w.-]+:./.test(u) || u.startsWith('/');
}

export function repoName(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? 'repository';
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
  const last = output.trim().split('\n').filter((l) => /^(fatal|error):/.test(l)).pop();
  return last ? last.replace(/^(fatal|error):\s*/, '') : 'Git reported a problem; see the details.';
}
