// Definition lists: terms and descriptions, edited as text, saved as written but for
// what changed.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const PAGE = '# Terms\n\nAPI\n: How programs talk.\n\nSDK\n: Tools for building with it.\n';

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ prepare: (project) => writeFileSync(join(project, 'docs', 'terms.md'), PAGE) });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  await ctx.page.getByRole('button', { name: 'Terms' }).click();
  await expect(ctx.page.locator('.prose h1')).toHaveText('Terms');
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('shows terms and descriptions, and Enter goes from a term to its description', async () => {
  const { page } = ctx;
  await expect(page.locator('.prose dt')).toHaveText(['API', 'SDK']);
  await expect(page.locator('.prose dd')).toHaveText(['How programs talk.', 'Tools for building with it.']);
  await page.locator('.prose dt', { hasText: 'API' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(' Over a network.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(readFileSync(join(ctx.project, 'docs', 'terms.md'), 'utf8')).toBe(PAGE.replace('How programs talk.', 'How programs talk. Over a network.'));
});
