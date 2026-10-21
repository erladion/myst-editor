// A page's history: the app's own earlier versions and its commits, and restoring one.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, workDir, type App } from './helpers';

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'guide', 'install.md'), 'utf8');
const original = readFileSync(join(import.meta.dirname, 'fixture', 'docs', 'guide', 'install.md'), 'utf8');
const menu = (id: string) => ctx.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

async function openInstall() {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Installing Widget' }).click();
}

test('restores the version from before an edit, and the restore can be undone', async () => {
  ctx = await launch();
  const { page } = ctx;
  await openInstall();
  await page.locator('.prose').getByText('Settings live in').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Oops, a mistake.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(file()).toContain('Oops, a mistake.');

  await page.getByRole('button', { name: 'History', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Page history' });
  await expect(dialog.getByRole('option')).toHaveText([/^Today .*Before your edits/]);
  // The only version: in it, everything was new.
  await expect(dialog.locator('.diff-del')).toHaveCount(0);
  await expect(dialog.locator('.diff-add').first()).toHaveText('+ # Installing Widget');
  // Compared with now: the old line, and the new one.
  await dialog.getByRole('tab', { name: 'Compared with now' }).click();
  await expect(dialog.locator('.diff-del')).toHaveText('− Settings live in `widget.toml`.');
  await expect(dialog.locator('.diff-add')).toHaveText('+ Settings live in `widget.toml`. Oops, a mistake.');
  await dialog.getByRole('tab', { name: 'This version', exact: true }).click();
  await expect(dialog.locator('.history-preview h1')).toHaveText('Installing Widget');

  await dialog.getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('dialog', { name: 'Restore this version' }).getByRole('button', { name: 'Restore' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(file).toBe(original);
  await expect(page.locator('.prose')).not.toContainText('Oops');

  // The version with the mistake is in the history now, so the restore can be undone.
  await menu('page-history');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  // The newest version: what it changed from the one before (the mistake).
  await expect(dialog.locator('.diff-del')).toHaveText('− Settings live in `widget.toml`.');
  await expect(dialog.locator('.diff-add')).toHaveText('+ Settings live in `widget.toml`. Oops, a mistake.');
  await dialog.getByRole('tab', { name: 'Compared with now' }).click();
  await expect(dialog.locator('.diff-del')).toHaveText('− Settings live in `widget.toml`. Oops, a mistake.');
  await expect(dialog.locator('.diff-add')).toHaveText('+ Settings live in `widget.toml`.');
});

test('lists the page’s commits, with who and why', async () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: join(workDir(), 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } });
  ctx = await launch({
    prepare: (project) => {
      writeFileSync(join(workDir(), 'empty-gitconfig'), '');
      git(project, 'init', '-q', '-b', 'main');
      git(project, '-c', 'user.name=Wendy Writer', '-c', 'user.email=w@x', 'add', '.');
      git(project, '-c', 'user.name=Wendy Writer', '-c', 'user.email=w@x', 'commit', '-qm', 'First version');
      const path = join(project, 'docs', 'guide', 'install.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('Install the package with pip:', 'Install the package with pip or uv:'));
      git(project, '-c', 'user.name=Rob Reviewer', '-c', 'user.email=r@x', 'commit', '-qam', 'Mention uv');
    },
  });
  const { page } = ctx;
  await openInstall();
  // From the Markdown view's bar too.
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Page history' });
  await expect(dialog.getByRole('option')).toHaveText([/Mention uv — Rob Reviewer/, /First version — Wendy Writer/]);
  // Each commit shows its own change, not every change since.
  await expect(dialog.locator('.diff-del')).toHaveText('− Install the package with pip:');
  await expect(dialog.locator('.diff-add')).toHaveText('+ Install the package with pip or uv:');
  await dialog.getByRole('tab', { name: 'Compared with now' }).click();
  await expect(dialog).toContainText('The page is the same now as in this version.');
  await expect(dialog.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
  await dialog.getByRole('tab', { name: 'Changes in this version' }).click();
  await dialog.getByRole('option', { name: /First version/ }).click();
  await expect(dialog.locator('.diff-del')).toHaveCount(0); // the first: all of it added
  await expect(dialog.locator('.diff-add', { hasText: 'Install the package with pip:' })).toHaveCount(1);
  await expect(dialog.locator('.diff-add', { hasText: 'or uv' })).toHaveCount(0); // that came later
  await dialog.getByRole('tab', { name: 'Compared with now' }).click();
  await expect(dialog.locator('.diff-add')).toHaveText('+ Install the package with pip or uv:');
  await dialog.getByRole('tab', { name: 'This version', exact: true }).click();
  await expect(dialog.locator('.history-preview')).toContainText('Install the package with pip:');
});
