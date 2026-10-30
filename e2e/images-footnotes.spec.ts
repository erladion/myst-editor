// MyST's {image} as a picture, and footnotes: their text edited where it is, a new
// one from the Insert menu.
import { expect, test } from '@playwright/test';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const PAGE = 'guide/configure.md';
const file = () => readFileSync(join(ctx.project, 'docs', PAGE), 'utf8');
const ADDED = '\n```{image} ../images/diagram.svg\n:alt: The parts\n:width: 120px\n```\n\nSee the notes[^1].\n\n[^1]: The first note.\n';

test.beforeEach(async () => {
  ctx = await launch({ prepare: (project) => appendFileSync(join(project, 'docs', PAGE), ADDED) });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  await ctx.page.getByRole('button', { name: 'guide' }).click();
  await ctx.page.getByRole('button', { name: 'Configuring Widget' }).click();
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

async function waitForSave() {
  await expect(ctx.page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

test('an {image} shows as its picture, at its width', async () => {
  const image = ctx.page.locator('.directive-image');
  await expect(image.locator('.directive-preview img')).toHaveAttribute('alt', 'The parts');
  await expect.poll(() => image.locator('.directive-preview img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  expect(await image.locator('.directive-preview img').evaluate((i: HTMLImageElement) => i.style.width)).toBe('120px');
  await expect(image.locator('.directive-body')).toBeHidden();
});

test('a footnote’s text is edited where it is; a new one goes to the end of the page', async () => {
  const { page } = ctx;
  const note = page.locator('.footnote-def');
  await expect(note.locator('.footnote-label')).toHaveText('1');
  await note.getByText('The first note.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Really.');
  await waitForSave();
  expect(file()).toContain('[^1]: The first note. Really.\n');
  // Pointed at, its reference says what it says.
  await page.locator('.footnote-ref').hover();
  await expect(page.locator('.footnote-ref')).toHaveAttribute('title', /The first note\. Really\./);
  // A new one: its number where the cursor is, its text at the end.
  await page.locator('.prose').getByText('See the notes').click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Footnote…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert footnote' });
  await dialog.getByLabel('Footnote').fill('The second note.');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave();
  expect(file()).toContain('See the notes[^1].[^2]\n');
  expect(file().trimEnd().endsWith('[^2]: The second note.')).toBe(true);
});
