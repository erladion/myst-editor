// Editing Markdown tables, including merged cells written the project's way.
import { expect, test, type Page } from '@playwright/test';
import { diffLines } from 'diff';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const fixture = (name: string) => readFileSync(join(import.meta.dirname, name, 'docs', 'index.md'), 'utf8');
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');

function changes(original: string) {
  const removed: string[] = [];
  const added: string[] = [];
  for (const part of diffLines(original, file())) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.removed) removed.push(...lines);
    if (part.added) added.push(...lines);
  }
  return { removed, added };
}

async function saved(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

const cell = (page: Page, text: string) => page.locator('.prose td, .prose th').filter({ hasText: new RegExp(`^${text}$`) });

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test.describe('with span roles configured', () => {
  const original = fixture('fixture-ext');

  test.beforeEach(async () => {
    ctx = await launch({ fixture: 'fixture-ext' });
    await ctx.page.getByRole('button', { name: 'Not now' }).click();
  });

  test('edits a cell, changing only its line', async () => {
    const { page } = ctx;
    await cell(page, 'Free').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await saved(page);
    expect(changes(original)).toEqual({ removed: ['| Basic | Free  |'], added: ['| Basic | Free! |'] });
  });

  test('Tab moves between cells and Enter adds a row at the bottom', async () => {
    const { page } = ctx;
    await cell(page, 'Basic').click();
    // The table toolbar shows once the editor has the click: keys pressed sooner can
    // land before it, and End is then lost (Playwright is quicker than any writer).
    await expect(page.getByRole('button', { name: 'Row below' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Free');
    await page.keyboard.press('End');
    await page.keyboard.type(' tier');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Pro');
    await saved(page);
    expect(changes(original)).toEqual({
      removed: ['| Plan  | Price |', '|-------|-------|', '| Basic | Free  |'],
      added: ['| Plan  | Price     |', '|-------|-----------|', '| Basic | Free tier |', '|       | Pro       |'],
    });
  });

  test('merges selected cells into a {colspan}, and splits it again', async () => {
    const { page } = ctx;
    // Add a row so there are two cells side by side to merge.
    await cell(page, 'Free').click();
    await page.getByRole('button', { name: 'Row below' }).click();
    await expect(page.locator('.prose tr')).toHaveCount(3);
    // Drag across the header cells to select them. Where they are is found as the
    // mouse gets there (the new row may scroll the page on a slow machine).
    await cell(page, 'Plan').hover({ position: { x: 10, y: 10 } });
    await page.mouse.down();
    await cell(page, 'Price').hover({ position: { x: 10, y: 10 } });
    await page.mouse.up();
    await expect(page.locator('.prose .selectedCell')).toHaveCount(2);
    await page.getByRole('button', { name: 'Merge cells' }).click();
    await saved(page);
    // The covered cell stays empty, padded to its column like the rest of the table.
    expect(file()).toContain('| {colspan}`2` Plan Price |      |\n|-------------------------|------|\n| Basic                   | Free |');
    await expect(page.locator('.prose th[colspan="2"]')).toHaveText('Plan Price');

    await page.locator('.prose th[colspan="2"]').click();
    await page.getByRole('button', { name: 'Split cell' }).click();
    await saved(page);
    expect(file()).not.toContain('{colspan}');
  });

  test('aligns a column', async () => {
    const { page } = ctx;
    await cell(page, 'Free').click();
    await page.getByRole('button', { name: 'Align column right' }).click();
    await saved(page);
    expect(changes(original)).toEqual({ removed: ['|-------|-------|'], added: ['|-------|------:|'] });
  });

  test('deletes a row from the Delete menu', async () => {
    const { page } = ctx;
    await cell(page, 'Free').click();
    await page.getByRole('button', { name: 'Delete ▾' }).click();
    await page.getByRole('menuitem', { name: 'Delete row' }).click();
    await saved(page);
    // "Basic" was the widest text in its column, so the column narrows with it.
    expect(changes(original)).toEqual({
      removed: ['| Plan  | Price |', '|-------|-------|', '| Basic | Free  |'],
      added: ['| Plan | Price |', '|------|-------|'],
    });
  });

  test('inserts a new table', async () => {
    const { page } = ctx;
    await page.locator('.prose').getByText('Closing words.').click();
    await page.getByRole('button', { name: 'Insert ▾' }).click();
    await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
    await page.keyboard.type('Name');
    await saved(page);
    expect(file()).toContain('Closing words.\n\n| Name | Column 2 | Column 3 |\n| ---- | -------- | -------- |\n|      |          |          |\n|      |          |          |\n');
  });
});

test('without span roles, merging is explained instead of offered', async () => {
  ctx = await launch();
  const { page } = ctx;
  await cell(page, 'blue').locator('code').click();
  await expect(page.getByRole('toolbar', { name: 'Table' })).toContainText('Merging cells needs span roles in .mysteditor.toml');
  await expect(page.getByRole('button', { name: 'Merge cells' })).toHaveCount(0);
});
