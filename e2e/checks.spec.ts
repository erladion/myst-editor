// Checks: images without descriptions, skipped heading levels, vague links, … — in
// the page, from the status bar's chip, and fixed from there.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
const saved = () => expect(ctx.page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('finds mistakes in the page, and fixes them', async () => {
  ctx = await launch({
    prepare: (dir) => writeFileSync(join(dir, 'docs', 'index.md'), '# Guide\n\nRead [here](guide/install.md) first.\n\n![](images/diagram.svg)\n\n### Too deep\n\nText.\n'),
  });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.prose .check-mark')).toHaveCount(3);
  await page.getByRole('button', { name: '3 to check' }).click();
  const panel = page.getByRole('region', { name: 'Checks' });
  await expect(panel).toContainText('The link says only “here”');
  await expect(panel).toContainText('This image has no description');
  await expect(panel).toContainText('“Too deep” skips a level: a subheading after a title.');

  // The heading: its level fixed at once.
  await panel.locator('.check', { hasText: 'skips a level' }).getByRole('button', { name: 'Fix the level' }).click();
  await expect(page.locator('.prose h2')).toHaveText('Too deep');
  // The image: a description asked for.
  await panel.locator('.check', { hasText: 'no description' }).getByRole('button', { name: 'Describe…' }).click();
  const describe = page.getByRole('dialog', { name: 'Describe the image' });
  await describe.getByLabel('Description').fill('How requests flow');
  await describe.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toBe('# Guide\n\nRead [here](guide/install.md) first.\n\n![How requests flow](images/diagram.svg)\n\n## Too deep\n\nText.\n');
  await expect(page.getByRole('button', { name: '1 to check' })).toBeVisible();

  // Every page of the folder, and a finding on another page opened.
  await panel.getByRole('button', { name: 'Check all pages' }).click();
  await expect(panel.getByLabel('All pages')).toContainText('All pages:');
});

test('the panel is made taller with its handle, and stays so', async () => {
  ctx = await launch({ prepare: (dir) => writeFileSync(join(dir, 'docs', 'index.md'), '# Guide\n\nRead [here](guide/install.md) first.\n') });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: '1 to check' }).click();
  const panel = page.getByRole('region', { name: 'Checks' });
  const scroll = page.locator('.scroll').first();
  const before = { panel: (await panel.boundingBox())!.height, page: (await scroll.boundingBox())!.height };
  const handle = panel.getByRole('separator', { name: 'Resize the panel' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 5 });
  await page.mouse.up();
  const after = { panel: (await panel.boundingBox())!.height, page: (await scroll.boundingBox())!.height };
  expect(after.panel).toBeGreaterThan(before.panel + 120);
  // The page above gave the room.
  expect(after.page).toBeLessThan(before.page - 120);
  // The arrow keys too.
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  expect((await panel.boundingBox())!.height).toBeCloseTo(after.panel - 20, -1);
  // Kept: open again, as tall.
  await panel.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '1 to check' }).click();
  expect((await panel.boundingBox())!.height).toBeCloseTo(after.panel - 20, -1);
});
