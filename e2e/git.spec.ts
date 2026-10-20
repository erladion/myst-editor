// Git from the app: cloning, committing, pushing, getting the latest version, and
// answering git's sign-in questions. Uses local repositories and a local HTTP server,
// so it works with any git host and needs no network.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@x' } });

// A bare "server" repository holding the e2e fixture project.
function serverRepo() {
  const work = mkdtempSync(join(tmpdir(), 'mysteditor-git-e2e-'));
  const seed = join(work, 'seed');
  cpSync(join(import.meta.dirname, 'fixture'), seed, { recursive: true });
  sh(seed, 'init', '-b', 'main');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-m', 'Initial docs');
  const remote = join(work, 'widget-docs.git');
  sh(work, 'clone', '--bare', seed, remote);
  return { work, remote, seed };
}

let ctx: App;
// Keep the developer's own git identity out of the test.
const isolated = (work: string) => {
  const config = join(work, 'gitconfig');
  writeFileSync(config, '');
  return { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
};

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('clones a repository, then commits and pushes an edit', async () => {
  const { work, remote } = serverRepo();
  ctx = await launch({ noProject: true, env: isolated(work) });
  const { page } = ctx;

  await page.getByRole('button', { name: 'Get from a repository…' }).click();
  const clone = page.getByRole('dialog', { name: 'Clone a repository' });
  await clone.getByLabel('Repository link').fill(remote);
  await clone.getByLabel('Save in').fill(work);
  await expect(clone).toContainText(`As ${work}/widget-docs`);
  await clone.getByRole('button', { name: 'Get repository' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
  await expect(page.locator('.chip-button', { hasText: 'main · no changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click(); // no Sphinx here

  // Edit, then commit and push from the changes panel.
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Python 3.12 is recommended.');
  await expect(page.locator('.chip-button', { hasText: 'main · 1 change' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.chip-button', { hasText: '1 change' }).click();

  const panel = page.getByRole('dialog', { name: 'Changes' });
  await expect(panel.getByRole('list', { name: 'Changed files' })).toContainText('Widget documentation — docs/index.md');
  await panel.getByLabel('What did you change?').fill('Recommend Python 3.12');
  await panel.getByRole('button', { name: 'Commit and push' }).click();

  // Git doesn't know who we are yet; the commit goes ahead once we've said.
  const who = page.getByRole('dialog', { name: 'Who is committing' });
  await who.getByLabel('Name').fill('Wendy Writer');
  await who.getByLabel('Email').fill('wendy@example.com');
  await who.getByRole('button', { name: 'Continue' }).click();
  await expect(panel).toContainText('Committed and pushed.');
  expect(sh(remote, 'log', '--format=%s|%an <%ae>', 'main')).toBe('Recommend Python 3.12|Wendy Writer <wendy@example.com>\nInitial docs|Dev <dev@x>\n');
  await expect(page.locator('.chip-button', { hasText: 'main · no changes' })).toBeVisible();
});

test('gets the latest version from the server', async () => {
  const { work, remote, seed } = serverRepo();
  // Open a clone of the server repository.
  const prepare = (project: string) => {
    rmSync(project, { recursive: true, force: true });
    sh(work, 'clone', remote, project);
  };
  ctx = await launch({ prepare, env: isolated(work) });
  const { page } = ctx;
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
  await page.getByRole('button', { name: 'Not now' }).click();

  // A colleague pushes a change.
  sh(seed, 'remote', 'add', 'origin', remote);
  writeFileSync(join(seed, 'docs', 'index.md'), '# Widget documentation\n\nRewritten by a colleague.\n');
  sh(seed, 'commit', '-am', 'Colleague');
  sh(seed, 'push', 'origin', 'HEAD:main');

  // No name or email is needed just to get the latest version.
  await page.locator('.chip-button', { hasText: 'main' }).click();
  const panel = page.getByRole('dialog', { name: 'Changes' });
  await panel.getByRole('button', { name: 'Get latest' }).click();
  await expect(panel).toContainText('Up to date with the server.');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.prose')).toContainText('Rewritten by a colleague.');
});

test('asks for a username and password when the server wants them, and sends them', async () => {
  // A server that only says "sign in, please" (HTTP Basic), recording what it gets.
  const seen: string[] = [];
  const server = createServer((req, res) => {
    if (req.headers.authorization) seen.push(Buffer.from(req.headers.authorization.replace(/^Basic /, ''), 'base64').toString());
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="docs"' }).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const work = mkdtempSync(join(tmpdir(), 'mysteditor-askpass-e2e-'));
  try {
    ctx = await launch({ noProject: true, env: isolated(work) });
    const { page } = ctx;
    await page.getByRole('button', { name: 'Get from a repository…' }).click();
    const clone = page.getByRole('dialog', { name: 'Clone a repository' });
    await clone.getByLabel('Repository link').fill(`http://127.0.0.1:${port}/team/docs.git`);
    await clone.getByLabel('Save in').fill(work);
    await clone.getByRole('button', { name: 'Get repository' }).click();

    const ask = page.getByRole('dialog', { name: 'Git needs your answer' });
    await expect(ask).toContainText('Username');
    await ask.getByLabel('Answer').fill('wendy');
    await ask.getByRole('button', { name: 'OK' }).click();
    await expect(ask).toContainText('Password');
    await expect(ask.getByLabel('Answer')).toHaveAttribute('type', 'password');
    await ask.getByLabel('Answer').fill('s3cret');
    await ask.getByRole('button', { name: 'OK' }).click();

    // The server rejected them (it always does), and the writer is told so plainly.
    await expect(clone.getByRole('alert')).toContainText('didn’t accept the sign-in');
    expect(seen).toContain('wendy:s3cret');
  } finally {
    server.close();
  }
});
