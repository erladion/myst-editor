// Adding a page (into a table of contents) and deleting one (out of them).
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture', 'docs', rel), 'utf8');
test.beforeEach(async () => {
  // No desktop trash in tests: deleting asks to delete for good instead.
  ctx = await launch({ env: { MYSTEDITOR_TRASH: 'none' } });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('adds a page to a folder and to the contents, then deletes it again', async () => {
  const { page } = ctx;
  // Next to "Installing Widget", in docs/guide.
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Installing Widget' }).click();
  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title').fill('Upgrading Widget');
  await expect(dialog).toContainText('Saved as docs/guide/upgrading-widget.md');
  await expect(dialog.getByLabel('Add to the table of contents of')).toHaveValue('docs/index.md');
  await dialog.getByRole('button', { name: 'Create page' }).click();

  await expect(page.locator('.prose h1')).toHaveText('Upgrading Widget');
  expect(file('guide/upgrading-widget.md')).toBe('# Upgrading Widget\n');
  // Only the new entry was added to the contents.
  await expect.poll(() => file('index.md')).toBe(original('index.md').replace('guide/configure\n', 'guide/configure\nguide/upgrading-widget\n'));
  await expect(page.locator('.card-toc')).toHaveCount(0); // the new page is open, not index

  // A name that's taken is refused.
  await page.getByRole('button', { name: 'New page' }).click();
  await dialog.getByLabel('Title').fill('Upgrading Widget');
  await expect(dialog).toContainText('a page with that name exists already');
  await expect(dialog.getByRole('button', { name: 'Create page' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Delete it from the sidebar: it leaves the folder and the contents.
  await page.getByRole('button', { name: 'Upgrading Widget' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete page…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete page' });
  await expect(confirm).toContainText('taken out of the table of contents of “Widget documentation”');
  await confirm.getByRole('button', { name: 'Delete page' }).click();
  await page.getByRole('dialog', { name: 'No trash here' }).getByRole('button', { name: 'Delete permanently' }).click();
  await expect.poll(() => existsSync(join(ctx.project, 'docs', 'guide', 'upgrading-widget.md'))).toBe(false);
  await expect.poll(() => file('index.md')).toBe(original('index.md'));
  await expect(page.getByRole('button', { name: 'Upgrading Widget' })).toHaveCount(0);
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
});
