// An Asciidoctor project: a book whose main document includes its chapters. Built
// with Asciidoctor in the background; contents from its includes; conditions as ifdef.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-adoc-book' });
  await expect(ctx.page.locator('.prose h1')).toHaveText('Widget Book');
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const file = (rel: string) => readFileSync(join(ctx.project, rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture-adoc-book', rel), 'utf8');

async function waitForSave(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

async function built(page: Page) {
  await expect(page.locator('.chip-button', { hasText: /Built in/ })).toBeVisible({ timeout: 30_000 });
}

test('builds the book: its contents, references and preview', async () => {
  const { page } = ctx;
  await built(page);
  // {product}, as the main document's header sets it.
  await expect(page.locator('.prose .role-value')).toHaveText('Widget');
  await expect(page.locator('.prose p').first()).toHaveText('Intro to Widget.');
  // An include's card: the chapter it brings in, as built.
  const card = page.locator('.card-directive', { hasText: 'chapters/install.adoc' });
  const included = card.frameLocator('iframe.card-preview:not(.card-preview-next)');
  await expect(included.locator('h2').first()).toHaveText('Installing');
  await expect(included.getByText('You need a computer.')).toBeVisible();
  // The chapters under the book, in their includes' order.
  await expect(page.locator('.sidebar .page')).toContainText(['Widget Book', 'Installing', 'Using']);
  await page.getByRole('button', { name: 'Using', exact: true }).click();
  await expect(page.locator('.prose h1')).toHaveText('Using');
  // <<requirements>> is in another chapter of the book; the xref's anchor is nowhere.
  await expect(page.locator('.role-ref', { hasText: 'Requirements' })).not.toHaveClass(/role-broken/);
  await expect(page.locator('.role-ref', { hasText: 'a missing anchor' })).toHaveClass(/role-broken/);
  // The chapter as Asciidoctor built it.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('iframe.preview-frame, .preview iframe').first();
  await expect(preview.locator('h1')).toHaveText('Using');
  // Its picture, from the book's folder (it isn't copied into the build).
  await expect.poll(() => preview.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('a new chapter goes into the book', async () => {
  const { page } = ctx;
  await built(page);
  await page.getByRole('button', { name: 'Installing', exact: true }).click();
  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title').fill('Upgrading');
  await expect(dialog).toContainText('Saved as chapters/upgrading.adoc');
  await expect(dialog.getByLabel('Add to the table of contents of')).toHaveValue('index.adoc');
  await dialog.getByRole('button', { name: 'Create page' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Upgrading');
  expect(file('chapters/upgrading.adoc')).toBe('= Upgrading\n');
  await expect.poll(() => file('index.adoc')).toBe(`${original('index.adoc')}\ninclude::chapters/upgrading.adoc[leveloffset=+1]\n`);
});

test('conditions are ifdef', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Installing', exact: true }).click();
  await expect(page.locator('.cond-start')).toContainText(/Shown only when\s*Cloud/);
  await page.locator('.prose').getByText('You need a computer.').click();
  await page.getByRole('button', { name: 'Condition…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make conditional' });
  // What ifdef can't say is refused.
  await dialog.getByLabel('Condition', { exact: true }).fill('Cloud and not Desktop');
  await expect(dialog.locator('#condition-help')).toContainText('AsciiDoc can’t write');
  await dialog.getByLabel('Condition', { exact: true }).fill('');
  await dialog.getByRole('checkbox', { name: 'Desktop' }).check();
  await dialog.getByRole('button', { name: 'Make conditional' }).click();
  await waitForSave(page);
  expect(file('chapters/install.adoc')).toBe(original('chapters/install.adoc').replace('You need a computer.\n', 'ifdef::Desktop[]\nYou need a computer.\nendif::[]\n'));
});
