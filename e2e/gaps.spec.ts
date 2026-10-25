// Getting past blocks that hold others: a callout inside a callout, a callout at the
// end (or start) of the page.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
const saved = () => expect(ctx.page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
const gap = () => ctx.page.locator('.ProseMirror-gapcursor');

async function open(text: string) {
  ctx = await launch({ prepare: (dir) => writeFileSync(join(dir, 'docs', 'index.md'), text) });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
}

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('arrows go past nested callouts at the end of the page, and typing starts a paragraph there', async () => {
  await open('# Title\n\n::::{note}\nOuter text.\n\n:::{warning}\nInner text.\n:::\n::::\n');
  const { page } = ctx;
  await page.locator('.prose').getByText('Inner text.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await expect(gap()).toHaveCount(1); // after the warning, in the note
  await page.keyboard.type('Inside the note');
  await page.keyboard.press('ArrowDown');
  await expect(gap()).toHaveCount(1); // after the note
  await page.keyboard.type('After the note');
  await saved();
  expect(file()).toBe('# Title\n\n::::{note}\nOuter text.\n\n:::{warning}\nInner text.\n:::\n\nInside the note\n::::\n\nAfter the note\n');
});

test('arrows go above a callout at the start of the page, and Enter starts a paragraph there', async () => {
  await open(':::{tip}\nFirst words.\n:::\n\nThe rest.\n');
  const { page } = ctx;
  await page.locator('.prose').getByText('First words.').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(gap()).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Before the tip');
  await saved();
  expect(file()).toBe('Before the tip\n\n:::{tip}\nFirst words.\n:::\n\nThe rest.\n');
});

test('a click below the last callout puts the cursor after it', async () => {
  await open('# Title\n\n:::{note}\nThe end.\n:::\n');
  const { page } = ctx;
  const note = (await page.locator('.prose .directive').last().boundingBox())!;
  await page.mouse.click(note.x + 40, note.y + note.height + 30);
  await expect(gap()).toHaveCount(1);
  await page.keyboard.type('Afterwards');
  await saved();
  expect(file()).toBe('# Title\n\n:::{note}\nThe end.\n:::\n\nAfterwards\n');
});
