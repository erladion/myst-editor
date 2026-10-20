// The git service against real git and local repositories (no network needed).
import { describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git, isCloneUrl, repoName, explain } from '../../src/main/git/git.js';
import { AskPass } from '../../src/main/git/askpass.js';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } });

// A "server" repository with one page, plus a scratch dir.
function server() {
  const work = mkdtempSync(join(tmpdir(), 'mysteditor-git-'));
  const remote = join(work, 'docs.git');
  sh(work, 'init', '--bare', '-b', 'main', remote);
  const seed = join(work, 'seed');
  sh(work, 'clone', remote, seed);
  writeFileSync(join(seed, 'index.md'), '# Docs\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-m', 'First');
  sh(seed, 'push', 'origin', 'HEAD:main');
  return { work, remote, seed };
}

const git = new Git(() => ({ GIT_TERMINAL_PROMPT: '0' }));

// Run a program without blocking this process (the askpass server lives here).
function runAsync(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (status) => resolve({ status, stdout }));
  });
}

describe('Git', () => {
  it('clones, reports changes, commits chosen files, pushes and fast-forwards', async () => {
    const { work, remote, seed } = server();
    const progress: string[] = [];
    const dest = await git.clone(remote, work, (l) => progress.push(l));
    expect(dest).toBe(join(work, 'docs'));
    expect(await git.repoRoot(dest)).toBe(dest);

    await git.setIdentity(dest, 'Writer', 'writer@example.com', false);
    expect(await git.identity(dest)).toEqual({ name: 'Writer', email: 'writer@example.com' });

    writeFileSync(join(dest, 'index.md'), '# Docs\n\nMore.\n');
    writeFileSync(join(dest, 'new page.md'), '# New\n');
    writeFileSync(join(dest, 'scratch.txt'), 'not for commit\n');
    let status = await git.status(dest);
    expect(status).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
    expect(status.changes.map((c) => [c.path, c.kind]).sort()).toEqual([
      ['index.md', 'modified'],
      ['new page.md', 'added'],
      ['scratch.txt', 'added'],
    ]);

    await git.commit(dest, ['index.md', 'new page.md'], 'Add a page');
    status = await git.status(dest);
    expect(status.ahead).toBe(1);
    expect(status.changes.map((c) => c.path)).toEqual(['scratch.txt']);
    await git.push(dest);
    expect(sh(remote, 'log', '--format=%s %an', 'main')).toBe('Add a page Writer\nFirst T\n');

    // Someone else pushes; "get latest" fast-forwards.
    sh(seed, 'pull', 'origin', 'main');
    writeFileSync(join(seed, 'index.md'), '# Docs\n\nMore.\n\nFrom a colleague.\n');
    sh(seed, 'commit', '-am', 'Colleague');
    sh(seed, 'push', 'origin', 'HEAD:main');
    await git.pull(dest);
    expect(readFileSync(join(dest, 'index.md'), 'utf8')).toContain('From a colleague.');
  });

  it('explains a pull that can’t be fast-forwarded', async () => {
    const { work, remote, seed } = server();
    const dest = await git.clone(remote, work, () => {});
    await git.setIdentity(dest, 'W', 'w@x', false);
    writeFileSync(join(dest, 'index.md'), '# Mine\n');
    await git.commit(dest, ['index.md'], 'Mine');
    writeFileSync(join(seed, 'other.md'), '# Theirs\n');
    sh(seed, 'add', '.');
    sh(seed, 'commit', '-m', 'Theirs');
    sh(seed, 'push', 'origin', 'HEAD:main');
    await expect(git.pull(dest)).rejects.toThrow(/Both your copy and the server have new commits/);
  });

  it('refuses links that could be read as git options', async () => {
    const { work } = server();
    await expect(git.clone('--upload-pack=touch /tmp/x', work, () => {})).rejects.toThrow(/doesn’t look like a repository link/);
  });
});

describe('AskPass', () => {
  it('answers git’s question through the app, and only with the right token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mysteditor-askpass-'));
    const asked: string[] = [];
    const askpass = new AskPass(dir, async (q) => {
      asked.push(q);
      return 'secret-passphrase';
    });
    await askpass.start();
    try {
      // Run the helper the way git would: the program in GIT_ASKPASS, question as argument.
      const env = { ...process.env, ...askpass.env() } as NodeJS.ProcessEnv;
      const helper = env.GIT_ASKPASS!;
      // process.execPath is Node here; in the app it is Electron, run as Node.
      const r = await runAsync(helper, ['Password for https://example.com:'], env);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('secret-passphrase\n');
      expect(asked).toEqual(['Password for https://example.com:']);

      const wrong = await runAsync(helper, ['Password:'], { ...env, MYSTEDITOR_ASKPASS_TOKEN: 'guess' });
      expect(wrong.status).toBe(1);
      expect(asked).toHaveLength(1);
    } finally {
      askpass.stop();
    }
  });
});

describe('helpers', () => {
  it('recognises repository links', () => {
    for (const ok of ['https://github.com/a/b.git', 'git@github.com:a/b.git', 'ssh://git@host/a/b', '/srv/git/b.git']) expect(isCloneUrl(ok)).toBe(true);
    for (const bad of ['', '-o x', 'ext::sh -c touch% /tmp/x', 'not a url']) expect(isCloneUrl(bad)).toBe(false);
    expect(repoName('git@github.com:erladion/myst-editor.git')).toBe('myst-editor');
    expect(repoName('https://example.com/docs/')).toBe('docs');
  });

  it('explains common failures in plain words', () => {
    expect(explain('fatal: Authentication failed for ...')).toMatch(/didn’t accept the sign-in/);
    expect(explain('ssh: Could not resolve hostname x: Name or service not known')).toMatch(/couldn’t be reached/);
    expect(explain(' ! [rejected]  main -> main (fetch first)')).toMatch(/Get the latest version first/);
  });
});
