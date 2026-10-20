// Reordering pages in the contents by dragging them (or Move up / down).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture', 'docs', rel), 'utf8');
test.beforeEach(async () => {
  ctx = await launch();
  await ctx.page.getByRole('button', { name: 'Allow' }).click();
  await expect(ctx.page.locator('.tree .page')).toHaveText(['Widget documentation', 'Installing Widget', 'Configuring Widget'], { timeout: 180_000 });
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const row = (title: string) => ctx.page.locator('.toc-row', { has: ctx.page.getByRole('button', { name: title, exact: true }) });

test('drags a page before another, and moves it back down', async () => {
  const { page } = ctx;
  await row('Configuring Widget').dragTo(row('Installing Widget'), { targetPosition: { x: 60, y: 3 } });
  // Shown at once, and only the two lines swap in the file.
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation', 'Configuring Widget', 'Installing Widget']);
  await expect.poll(() => file('index.md')).toBe(original('index.md').replace('guide/install\nguide/configure\n', 'guide/configure\nguide/install\n'));

  await page.getByRole('button', { name: 'Configuring Widget', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation', 'Installing Widget', 'Configuring Widget']);
  await expect.poll(() => file('index.md')).toBe(original('index.md'));
});

test('drags a page into another page’s contents', async () => {
  const { page } = ctx;
  await row('Configuring Widget').dragTo(row('Installing Widget'), { targetPosition: { x: 60, y: 14 } });
  // Installing Widget had no table of contents: it gets one, listing the page.
  await expect.poll(() => file('guide/install.md')).toBe(original('guide/install.md') + '\n```{toctree}\nconfigure\n```\n');
  await expect.poll(() => file('index.md')).toBe(original('index.md').replace('guide/configure\n', ''));
  // It shows inside at once (the page it went into opens), and stays there after the build.
  await expect(page.getByRole('button', { name: 'Hide the pages in Installing Widget' })).toBeVisible();
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation', 'Installing Widget', 'Configuring Widget']);
  await expect(row('Configuring Widget')).toHaveCSS('padding-left', '28px'); // one level deeper
  await expect(page.locator('.chip-button', { hasText: /Built in/ })).toBeVisible({ timeout: 60_000 });
  await expect(row('Configuring Widget')).toHaveCSS('padding-left', '28px');
  // The top page can't be dragged.
  await expect(row('Widget documentation')).toHaveAttribute('draggable', 'false');
});
