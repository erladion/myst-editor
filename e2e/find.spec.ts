// Ctrl+F: find and replace in the formatted view; the Markdown view keeps its own search.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('finds, moves between matches, and replaces', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('Control+f');
  const bar = page.getByRole('search', { name: 'Find in page' });
  await bar.getByLabel('Find').fill('widget');
  // Starting from the first match after the cursor (the heading's is before it).
  await expect(bar.locator('.find-count')).toHaveText(/^\d+ of \d+$/);
  const [first, total] = (await bar.locator('.find-count').textContent())!.split(' of ').map(Number);
  expect(first).toBeGreaterThan(1);
  await expect(page.locator('.find-match')).toHaveCount(total);
  await expect(page.locator('.find-current')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(bar.locator('.find-count')).toHaveText(`${first + 1} of ${total}`);
  await page.keyboard.press('Shift+Enter');
  await expect(bar.locator('.find-count')).toHaveText(`${first} of ${total}`);
  await bar.getByRole('button', { name: 'Aa' }).click();
  await expect(bar.locator('.find-count')).not.toHaveText(new RegExp(` of ${total}$`)); // fewer with matching case

  await bar.getByRole('button', { name: 'Replace…' }).click();
  await bar.getByLabel('Find').fill('small components');
  await bar.getByLabel('Replace with').fill('tiny parts');
  await bar.getByRole('button', { name: 'Replace all' }).click();
  await expect(bar).toContainText('No matches');
  await bar.getByRole('button', { name: 'Close' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.find-match')).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8')).toContain('Widgets are tiny parts that do one');
  // Undo puts it back, like any edit.
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.prose')).toContainText('small components');
});

test('in the Markdown view, Ctrl+F is the source editor’s own search', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search')).toBeVisible();
  await expect(page.getByRole('search', { name: 'Find in page' })).toHaveCount(0);
});
