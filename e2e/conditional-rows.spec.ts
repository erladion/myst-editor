// Table rows between condition markers: one table in the editor, rows tinted with
// their condition, "View as" dimming them, and conditions set from the table toolbar.
import { expect, test, type Page } from '@playwright/test';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const page = () => ctx.page;
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
const saved = () => expect(page().locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
const shot = (name: string) => process.env.ROW_SHOTS && plans(page()).screenshot({ path: join(process.env.ROW_SHOTS, name) });

const TABLE = `
## Plans

| Plan       | Price  | Support |
|------------|--------|---------|
| Basic      | Free   | Forum   |
<!-- if: CapabilityX -->
| Pro        | 10 EUR | Email   |
| Team       | 50 EUR | Email   |
<!-- if: CapabilityY -->
| Enterprise | Ask us | Phone   |
<!-- endif -->
<!-- endif -->
| Community  | Free   | Forum   |
`;

test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-ext', prepare: (project) => appendFileSync(join(project, 'docs', 'index.md'), TABLE) });
  await page().getByRole('button', { name: 'Not now' }).click();
  await page().locator('.prose h2', { hasText: 'Plans' }).scrollIntoViewIfNeeded();
});

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const plans = (p: Page) => p.locator('.prose table', { hasText: 'Enterprise' });

test('rows in conditions are part of the table, tinted and labelled', async () => {
  const table = plans(page());
  await expect(table.locator('tr')).toHaveCount(6);
  await expect(table.locator('tr.cond-row')).toHaveCount(3);
  await expect(table.locator('.cond-row-label')).toHaveCount(2);
  await expect(table.locator('.cond-row-label').first()).toHaveAttribute('data-cond', 'CapabilityX');
  await expect(table.locator('.cond-row-label').nth(1)).toHaveAttribute('data-cond', 'CapabilityY');
  await shot('1-table.png');
  if (process.env.ROW_SHOTS) {
    await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('theme-dark')!.click());
    await expect(page().locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot('5-dark.png');
    await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('theme-light')!.click());
  }

  // View as CapabilityY alone: X's rows dim, and so does Enterprise (inside X).
  await page().getByRole('button', { name: 'View as ▾' }).click();
  await page().getByRole('checkbox', { name: 'CapabilityY' }).check();
  await page().locator('.prose h2', { hasText: 'Plans' }).click();
  await expect(table.locator('tr.cond-off')).toHaveCount(3);
  await shot('2-view-as.png');
});

test('a row condition is set, edited and removed from the table toolbar', async () => {
  const table = plans(page());
  await table.getByText('Community').click();
  await page().getByRole('button', { name: 'Row condition…' }).click();
  const dialog = page().getByRole('dialog', { name: 'Make conditional' });
  await dialog.getByRole('checkbox', { name: 'CapabilityZ' }).check();
  if (process.env.ROW_SHOTS) await page().screenshot({ path: join(process.env.ROW_SHOTS, '3-dialog.png') });
  await dialog.getByRole('button', { name: 'Make conditional' }).click();
  await saved();
  expect(file()).toContain('<!-- endif -->\n<!-- if: CapabilityZ -->\n| Community  | Free   | Forum   |\n<!-- endif -->\n');
  await shot('4-new-condition.png');

  // Edited: only its marker line changes.
  await table.getByText('Community').click();
  await page().getByRole('button', { name: 'Row condition…' }).click();
  const edit = page().getByRole('dialog', { name: 'Edit condition' });
  await edit.getByLabel('Condition', { exact: true }).fill('CapabilityZ or CapabilityY');
  await edit.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('<!-- if: CapabilityZ or CapabilityY -->\n| Community  | Free   | Forum   |\n');

  // Removed: the table is as it was.
  await table.getByText('Community').click();
  await page().getByRole('button', { name: 'Row condition…' }).click();
  await page().getByRole('dialog', { name: 'Edit condition' }).getByRole('button', { name: 'Remove' }).click();
  await saved();
  expect(file()).toContain(TABLE);
});
