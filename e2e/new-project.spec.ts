// File → New Project (or the start screen's New project…): a Sphinx project, made and
// opened.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('makes a project with a first page, as a git repository, and opens it', async () => {
  // Who commits, whatever this computer's git says.
  ctx = await launch({ noProject: true, env: { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@x' } });
  const { page } = ctx;
  const parent = join(ctx.project, '..');
  await page.getByRole('button', { name: 'New project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Title').fill('Product manual');
  await dialog.getByLabel('Save in').fill(parent);
  await expect(dialog.getByLabel('Folder name')).toHaveAttribute('placeholder', 'product-manual');
  await dialog.getByRole('button', { name: 'Create project' }).click();

  await expect(page.locator('.prose h1')).toHaveText('Product manual');
  await expect(page.locator('.tree, .sidebar').first()).toContainText('Getting started');
  const dir = join(parent, 'product-manual');
  expect(readFileSync(join(dir, 'docs', 'conf.py'), 'utf8')).toContain('project = "Product manual"');
  expect(existsSync(join(dir, 'docs', 'getting-started.md'))).toBe(true);
  const log = execFileSync('git', ['log', '--oneline', '--', '.'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: join(parent, 'gitconfig') } });
  expect(log).toContain('New documentation: Product manual');

  // Not over a folder with files in it.
  await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('new-project')!.click());
  await dialog.getByLabel('Title').fill('Product manual');
  await dialog.getByLabel('Save in').fill(parent);
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByRole('alert')).toContainText('There’s a folder called product-manual there already');
});
