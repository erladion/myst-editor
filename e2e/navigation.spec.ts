// Getting around: Go to page, the outline, and coming back to where you were.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const menu = (id: string) => ctx.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
// A long page, to scroll.
const prepare = (project: string) =>
  writeFileSync(join(project, 'docs', 'guide', 'long.md'), '# Long page\n\n' + Array.from({ length: 120 }, (_, i) => `## Part ${i + 1}\n\nText of part ${i + 1}.\n`).join('\n'));
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('goes to a page by typing part of its title', async () => {
  ctx = await launch({ prepare });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await menu('go-to-page');
  const dialog = page.getByRole('dialog', { name: 'Go to page' });
  await dialog.getByLabel('Page to go to').fill('conf');
  await expect(dialog.getByRole('option')).toHaveText([/^Configuring Widget/]);
  await page.keyboard.press('Enter');
  await expect(page.locator('.prose h1')).toHaveText('Configuring Widget');

  // Next time, the page just visited comes first.
  await menu('go-to-page');
  await expect(dialog.getByRole('option').first()).toHaveText(/^Configuring Widget/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.prose h1')).not.toHaveText('Configuring Widget');
});

test('the outline jumps to a heading and follows the cursor, in both views', async () => {
  ctx = await launch({ prepare });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Long page' }).click();
  await menu('outline');
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button', { name: 'Part 1', exact: true })).toBeVisible();
  await outline.getByRole('button', { name: 'Part 80', exact: true }).click();
  await expect(page.locator('.prose h2', { hasText: /^Part 80$/ })).toBeInViewport();
  await expect(outline.locator('[aria-current="location"]')).toHaveText('Part 80');

  await page.getByRole('button', { name: 'Markdown' }).click();
  await outline.getByRole('button', { name: 'Part 3', exact: true }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Part 3');
  // The outline stays open, and is remembered.
  await page.getByRole('button', { name: '← Formatted editing' }).click();
  await expect(outline).toBeVisible();
});

test('comes back to the last page, scrolled where it was, and lists recent folders', async () => {
  ctx = await launch({ prepare });
  let { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Long page' }).click();
  await page.locator('.workarea > .scroll').evaluate((el) => (el.scrollTop = 2000));
  await page.waitForTimeout(500); // remembered a moment after scrolling stops
  await ctx.app.close();

  ctx = await launch({ again: ctx });
  page = ctx.page;
  await expect(page.locator('.prose h1')).toHaveText('Long page');
  await expect.poll(() => page.locator('.workarea > .scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(1900);
  await ctx.app.close();

  // Without a folder to reopen, the welcome screen offers the recent ones.
  const settingsFile = join(dirname(ctx.project), 'user-data', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  delete settings.lastProject;
  writeFileSync(settingsFile, JSON.stringify(settings));
  ctx = await launch({ again: ctx, noProject: true });
  page = ctx.page;
  const recent = page.getByRole('region', { name: 'Recent folders' });
  await recent.getByRole('button', { name: /^project/ }).click();
  await expect(page.locator('.prose h1')).toHaveText('Long page');
});
