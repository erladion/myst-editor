// Toolbar → Changes: what changed since the last commit, marked in the page.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@x', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@x' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('marks words and blocks changed since the last commit, until it’s committed', async () => {
  ctx = await launch({
    env,
    prepare: (dir) => {
      writeFileSync(join(dir, 'docs', 'index.md'), '# Guide\n\nThe quick fox jumps.\n\nThis goes away.\n\nThe end.\n');
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'First');
    },
  });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  // A word changed, a paragraph removed, one added.
  await page.locator('.prose').getByText('The quick fox jumps.').click();
  await page.keyboard.press('End');
  for (let i = 0; i < 'jumps.'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('leaps.');
  await page.locator('.prose').getByText('This goes away.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.locator('.prose').getByText('The end.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A new paragraph.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.prose .chg-ins')).toHaveText(['leaps']); // the full stop stayed
  await expect(page.locator('.prose .chg-del')).toHaveText(['jumps']);
  await expect(page.locator('.prose .chg-del-block')).toHaveText('This goes away.');
  await expect(page.locator('.prose .chg-added')).toHaveText('A new paragraph.');
  await expect(page.getByRole('button', { name: /^Changes \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
  // Not part of the page: the file is as edited.
  await page.screenshot({ path: test.info().outputPath('changes.png') });

  // Committed: nothing changed since.
  git(ctx.project, 'commit', '-q', '-am', 'Second');
  await page.getByRole('button', { name: /^Changes/ }).click(); // off
  await page.getByRole('button', { name: 'Changes', exact: true }).click(); // on again, as now committed
  await expect(page.getByRole('button', { name: 'Changes (0)' })).toBeVisible();
  await expect(page.locator('.prose .chg-ins, .prose .chg-del, .prose .chg-added')).toHaveCount(0);
});

test('outside a repository, all of the page is new', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  const button = page.getByRole('button', { name: /^Changes \(\d+\)$/ });
  await expect(button).toHaveAttribute('title', 'This folder isn’t a git repository: everything is new.');
  await expect(page.locator('.prose > .chg-added').first()).toBeVisible();
});
