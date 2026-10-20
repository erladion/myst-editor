// End-to-end tests: drive the built app like a writer and check the files on disk.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.beforeEach(async () => {
  ctx = await launch();
});

test.afterEach(async () => {
  // Quit without the unsaved-changes prompt, which some tests leave open on purpose.
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture', 'docs', rel), 'utf8');

// Lines removed from / added to the original fixture file.
function changes(rel: string) {
  const before = original(rel).split('\n');
  const after = file(rel).split('\n');
  return { removed: before.filter((l) => !after.includes(l)), added: after.filter((l) => !before.includes(l)) };
}

async function waitForSave(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

async function clickEndOf(page: Page, text: string) {
  await page.locator('.prose').getByText(text, { exact: false }).first().click();
  await page.keyboard.press('End');
}

async function openPage(page: Page, title: string) {
  const folder = page.getByRole('button', { name: 'guide' });
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click();
  await page.getByRole('button', { name: title }).click();
  await expect(page.locator('.prose h1')).toHaveText(title);
}

test('renders a Sphinx page as formatted content', async () => {
  const { page } = ctx;
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
  await expect(page.locator('.directive-note .directive-kind')).toHaveValue('note');
  await expect(page.locator('.toc-entries a')).toHaveText(['Installing Widget', 'Configuring Widget']);
  await expect(page.locator('.role-ref').first()).toHaveText(/Installing Widget/);
  await expect(page.locator('.math-block .katex-display')).toBeVisible();
  await expect(page.locator('.inline-math .katex')).toBeVisible();
  const img = page.locator('.directive-figure img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.card-directive .card-label')).toHaveText('company-callout');
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  // Nothing is written just by opening a page.
  expect(file('index.md')).toBe(original('index.md'));
});

test('typing in a callout saves only that line', async () => {
  const { page } = ctx;
  await clickEndOf(page, 'Widgets require Python');
  await page.keyboard.type(' Python 3.12 is recommended.');
  await waitForSave(page);
  expect(changes('index.md')).toEqual({
    removed: ['Widgets require Python 3.10 or newer.'],
    added: ['Widgets require Python 3.10 or newer. Python 3.12 is recommended.'],
  });
});

test('inserting a callout from the menu', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Warning' }).click();
  await page.keyboard.type('Back up your settings first.');
  await waitForSave(page);
  expect(file('guide/install.md')).toBe(original('guide/install.md') + '\n:::{warning}\nBack up your settings first.\n:::\n');
});

test('bold and italic from the keyboard and Markdown shortcuts', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' Keep it ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('short');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' and *simple* now.');
  await waitForSave(page);
  expect(changes('guide/install.md')).toEqual({
    removed: ['Settings live in `widget.toml`.'],
    added: ['Settings live in `widget.toml`. Keep it **short** and *simple* now.'],
  });
});

test('changing a callout type rewrites only its header', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  await page.locator('.directive-kind').selectOption('tip');
  await waitForSave(page);
  expect(changes('guide/configure.md')).toEqual({ removed: [':::{warning}'], added: [':::{tip}'] });
});

test('table of contents entries open their page', async () => {
  const { page } = ctx;
  await page.locator('.toc-entries a', { hasText: 'Configuring Widget' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Configuring Widget');
  await expect(page.locator('.page.current')).toHaveText('Configuring Widget');
});

test('editing the Markdown source directly', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  await page.getByRole('button', { name: 'Markdown' }).click();
  const source = page.getByLabel('Markdown source');
  await expect(source).toHaveValue(original('guide/configure.md'));
  await source.fill(original('guide/configure.md') + '\nRestarting takes a few seconds.\n');
  await page.getByRole('button', { name: 'Back to editing' }).click();
  await expect(page.locator('.prose')).toContainText('Restarting takes a few seconds.');
  await waitForSave(page);
  expect(file('guide/configure.md')).toBe(original('guide/configure.md') + '\nRestarting takes a few seconds.\n');
});

test('reloads a page changed on disk', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  writeFileSync(join(ctx.project, 'docs', 'guide', 'configure.md'), '# Configuring Widget\n\nChanged in another editor.\n');
  await expect(page.locator('.prose')).toContainText('Changed in another editor.');
});

test('refuses to silently save a change that would not read back', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  // A hard line break inside a heading can't be written in Markdown.
  await page.locator('.prose h1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('subtitle');
  await expect(page.locator('.banner')).toContainText('can’t be saved safely');
  await page.waitForTimeout(1500);
  expect(file('guide/configure.md')).toBe(original('guide/configure.md'));
});
