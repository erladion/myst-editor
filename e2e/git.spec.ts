// Git from the app: cloning, committing, pushing, getting the latest version, and
// answering git's sign-in questions. Uses local repositories and a local HTTP server,
// so it works with any git host and needs no network.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { launch, workDir, type App } from './helpers';

// An empty git config, so the developer's own settings stay out of it (Git for Windows
// doesn't take NUL as a config file).
const emptyConfig = join(workDir(), 'empty-gitconfig');
writeFileSync(emptyConfig, '');
const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@x' } });

// A bare "server" repository holding the e2e fixture project.
function serverRepo() {
  const work = mkdtempSync(join(workDir(), 'mysteditor-git-e2e-'));
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
  await expect(clone).toContainText(`As ${join(work, 'widget-docs')}`);
  await clone.getByRole('button', { name: 'Get repository' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
  await expect(page.locator('.chip-button', { hasText: 'no changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click(); // no Sphinx here

  // Edit, then commit and push from the changes panel.
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Python 3.12 is recommended.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });
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
  await expect(page.locator('.chip-button', { hasText: 'no changes' })).toBeVisible();
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
  await page.locator('.chip-button', { hasText: 'no changes' }).click();
  const panel = page.getByRole('dialog', { name: 'Changes' });
  // Background checks of the server running at the same moment (opening the panel
  // starts one) must wait their turn rather than trip over git's locks.
  await Promise.all([
    ...Array.from({ length: 3 }, () => page.evaluate(() => window.myst.gitCheck())),
    panel.getByRole('button', { name: 'Get latest' }).click(),
  ]);
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
  const work = mkdtempSync(join(workDir(), 'mysteditor-askpass-e2e-'));
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

// The writer's clone of the server, open in the app, and a colleague's clone.
async function team() {
  const { work, remote } = serverRepo();
  const colleague = join(work, 'colleague');
  sh(work, 'clone', '-q', remote, colleague);
  const prepare = (project: string) => {
    rmSync(project, { recursive: true, force: true });
    sh(work, 'clone', '-q', remote, project);
    sh(project, 'config', 'user.name', 'Wendy Writer');
    sh(project, 'config', 'user.email', 'wendy@example.com');
  };
  ctx = await launch({ prepare, env: isolated(work) });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  const push = (file: string, from: string, to: string, message: string) => {
    const path = join(colleague, 'docs', file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
    sh(colleague, 'commit', '-qam', message);
    sh(colleague, 'push', '-q');
  };
  const log = () => sh(ctx.project, 'log', '--format=%s').trim().split('\n');
  return { push, log, file: (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8') };
}

const panel = () => ctx.page.getByRole('dialog', { name: 'Changes' });

test('notices a colleague’s push, and puts the writer’s commit on top of it', async () => {
  const { push, log, file } = await team();
  const { page } = ctx;
  // The writer commits an edit, without pushing.
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Use 3.12.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.chip-button', { hasText: '1 change' }).click();
  await panel().getByLabel('What did you change?').fill('Recommend 3.12');
  await panel().getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(panel()).toContainText('Committed.');
  await panel().getByRole('button', { name: 'Close' }).click();

  // A colleague pushes; the app notices at its next check of the server (every few
  // minutes; here, straight away).
  push('guide/install.md', 'Install the package with pip:', 'Install the package with pip or uv:', 'Mention uv');
  await page.evaluate(() => window.myst.gitCheck());
  const chip = page.locator('.chip-button.has-news');
  await expect(chip).toContainText('↓1 new', { timeout: 15_000 });
  await chip.click();
  await panel().getByRole('button', { name: 'Get latest (1 new)' }).click();
  await expect(panel()).toContainText('Up to date with the server.');
  expect(log()).toEqual(['Recommend 3.12', 'Mention uv', 'Initial docs']);
  expect(file('guide/install.md')).toContain('with pip or uv:');
});

test('settles a clash spot by spot', async () => {
  const { push, log, file } = await team();
  const { page } = ctx;
  push('index.md', 'Widgets require Python 3.10 or newer.', 'Widgets require Python 3.11 or newer.', 'Require 3.11');
  // The writer changes the same line and commits.
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Use 3.12.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.chip-button', { hasText: '1 change' }).click();
  await panel().getByLabel('What did you change?').fill('Recommend 3.12');
  await panel().getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(panel()).toContainText('Committed.');
  await panel().getByRole('button', { name: /^Get latest/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Settle what clashed' });
  const spot = dialog.getByRole('group', { name: 'Place 1' });
  await expect(spot.locator('.conflict-side').first()).toContainText('Widgets require Python 3.10 or newer. Use 3.12.');
  await expect(spot.locator('.conflict-side').nth(1)).toContainText('Widgets require Python 3.11 or newer.');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
  await spot.getByLabel('Keep both').check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Settle what clashed' })).toHaveCount(0);
  expect(log()).toEqual(['Recommend 3.12', 'Require 3.11', 'Initial docs']);
  expect(file('index.md')).toContain('Widgets require Python 3.11 or newer.\nWidgets require Python 3.10 or newer. Use 3.12.\n');
  await expect(page.locator('.prose')).toContainText('Widgets require Python 3.11 or newer.');
  await expect(page.locator('.chip-button', { hasText: 'no changes' })).toBeVisible();
});

test('shows what changed in a file, and discards it', async () => {
  const { file } = await team();
  const { page } = ctx;
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Use 3.12.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.chip-button', { hasText: '1 change' }).click();
  await panel().getByRole('button', { name: 'Show changes' }).click();
  await expect(panel().locator('.diff-add')).toHaveText('+ Widgets require Python 3.10 or newer. Use 3.12.');
  await panel().getByRole('button', { name: 'Discard…' }).click();
  await page.getByRole('dialog', { name: 'Discard changes' }).getByRole('button', { name: 'Discard changes' }).click();
  await expect(panel()).toContainText('Discarded your changes');
  expect(file('index.md')).not.toContain('Use 3.12.');
  await panel().getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.prose')).not.toContainText('Use 3.12.');
});

test('switches branch, leaving uncommitted changes on the branch they belong to', async () => {
  const { work, remote, seed } = serverRepo();
  // A colleague's feature branch on the server.
  sh(seed, 'remote', 'add', 'origin', remote);
  sh(seed, 'switch', '-q', '-c', 'feature-uv');
  writeFileSync(join(seed, 'docs', 'index.md'), '# Widget documentation\n\nThe uv edition.\n');
  sh(seed, 'commit', '-qam', 'uv edition');
  sh(seed, 'push', '-q', 'origin', 'feature-uv');
  const prepare = (project: string) => {
    rmSync(project, { recursive: true, force: true });
    sh(work, 'clone', '-q', remote, project);
    sh(project, 'config', 'user.name', 'Wendy Writer');
    sh(project, 'config', 'user.email', 'wendy@example.com');
  };
  ctx = await launch({ prepare, env: isolated(work) });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  // Work in progress on main.
  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Draft.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });

  await page.locator('.git-branch').click();
  const dialog = page.getByRole('dialog', { name: 'Branches' });
  await expect(dialog.getByRole('list', { name: 'Your branches' })).toContainText('mainyou’re on this one');
  await dialog.getByRole('list', { name: 'Branches on the server' }).getByRole('button', { name: /feature-uv/ }).click();
  await expect(dialog).toContainText('You have 1 uncommitted change on main');
  await dialog.getByRole('button', { name: 'Switch to feature-uv' }).click();
  await expect(page.locator('.git-branch')).toHaveText(/feature-uv/);
  await expect(page.locator('.prose')).toContainText('The uv edition.');
  await expect(page.locator('.chip-button', { hasText: 'no changes' })).toBeVisible();

  // Back on main, the draft is back.
  await page.locator('.git-branch').click();
  await dialog.getByRole('list', { name: 'Your branches' }).getByRole('button', { name: /^main/ }).click();
  await expect(page.locator('.git-branch')).toHaveText(/main/);
  await expect(page.locator('.prose')).toContainText('Widgets require Python 3.10 or newer. Draft.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible();
});

test('starts a new branch from the server’s main, and pushes it', async () => {
  const { work, remote } = serverRepo();
  const prepare = (project: string) => {
    rmSync(project, { recursive: true, force: true });
    sh(work, 'clone', '-q', remote, project);
    sh(project, 'config', 'user.name', 'Wendy Writer');
    sh(project, 'config', 'user.email', 'wendy@example.com');
  };
  ctx = await launch({ prepare, env: isolated(work) });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.git-branch').click();
  const dialog = page.getByRole('dialog', { name: 'Branches' });
  await dialog.getByRole('button', { name: 'New branch…' }).click();
  await dialog.getByLabel('Name').fill('install guide: v2');
  await expect(dialog).toContainText('As install-guide-v2');
  await expect(dialog.getByLabel('Start from the latest main on the server')).toBeChecked();
  await dialog.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('.git-branch')).toHaveText(/install-guide-v2/);

  await page.locator('.prose').getByText('Widgets require Python').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' New.');
  await expect(page.locator('.chip-button', { hasText: '1 change' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.chip-button', { hasText: '1 change' }).click();
  await panel().getByLabel('What did you change?').fill('Start the guide');
  await panel().getByRole('button', { name: 'Commit and push' }).click();
  await expect(panel()).toContainText('Committed and pushed.');
  expect(sh(remote, 'log', '--format=%s', 'install-guide-v2').trim().split('\n')).toEqual(['Start the guide', 'Initial docs']);
});
