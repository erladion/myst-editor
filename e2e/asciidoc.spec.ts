// AsciiDoc pages: shown as formatted content, edited, and saved as they were written
// but for what was edited.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-adoc' });
  await ctx.page.getByRole('button', { name: 'Installation Guide' }).click();
  await expect(ctx.page.locator('.prose h1')).toHaveText('Installation Guide');
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const file = (rel: string) => readFileSync(join(ctx.project, rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture-adoc', rel), 'utf8');

// Lines removed from / added to the original fixture file.
function changes(rel: string) {
  const before = original(rel).split('\n');
  const after = file(rel).split('\n');
  return { removed: before.filter((l) => !after.includes(l)), added: after.filter((l) => !before.includes(l)) };
}

async function waitForSave(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

test('shows an AsciiDoc page as formatted content, and leaves it as it is', async () => {
  const { page } = ctx;
  await expect(page.locator('.prose h2')).toHaveText(['Requirements', 'Installing']);
  await expect(page.locator('.prose strong').first()).toHaveText('Widget');
  await expect(page.locator('.directive-note .directive-kind')).toHaveValue('note');
  await expect(page.locator('.prose .target')).toContainText('requirements');
  await expect(page.locator('.prose ul li').first()).toContainText('A supported operating system');
  await expect(page.locator('.prose ol li')).toHaveCount(2);
  await expect(page.locator('.code-block code')).toHaveText('./install.sh');
  await expect(page.locator('.code-block .code-lang')).toHaveValue('bash');
  await expect(page.locator('.prose table th')).toHaveText(['System', 'Version']);
  await expect(page.locator('.prose table td').first()).toHaveText('Linux');
  // A definition list: terms and what they mean.
  await expect(page.locator('.prose dt')).toHaveText(['CPU', 'Memory']);
  await expect(page.locator('.prose dd')).toHaveText(['Any 64-bit processor', '4 GB']);
  await expect(page.locator('.role-ref')).toHaveCount(2);
  // Highlighted text, a role on monospace, a link that opens a new window: shown, kept.
  await expect(page.locator('.prose mark')).toHaveText('care');
  await expect(page.locator('.prose code.text-role')).toHaveText('install.sh');
  await expect(page.locator('.prose a', { hasText: 'the site' })).toBeVisible();
  // A picture with a caption: a figure, showing it; with no description, a check says so.
  const figure = page.locator('.directive-figure');
  await expect(figure.locator('.directive-body')).toHaveText('The parts');
  await expect.poll(() => figure.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /to check/ })).toBeVisible();
  await expect(page.locator('.statusbar .dialect')).toHaveText('AsciiDoc');
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  expect(file('guide.adoc')).toBe(original('guide.adoc'));
});

test('typing saves only the lines typed in', async () => {
  const { page } = ctx;
  await page.locator('.prose').getByText('It covers Linux and macOS.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And Windows.');
  await page.locator('.prose').getByText('The installer checks').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Twice.');
  await waitForSave(page);
  expect(changes('guide.adoc')).toEqual({
    removed: ['It covers Linux and macOS.', 'NOTE: The installer checks the requirements for you.'],
    added: ['It covers Linux and macOS. And Windows.', 'NOTE: The installer checks the requirements for you. Twice.'],
  });
});

test('callouts from the Insert menu, and changing their type', async () => {
  const { page } = ctx;
  await page.locator('.prose').getByText('It covers Linux and macOS.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  // AsciiDoc's callouts and blocks, and not MyST's.
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Caution', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'New in version…' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Table of contents', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Tip', exact: true }).click();
  await page.keyboard.type('Keep the installer.');
  await waitForSave(page);
  expect(changes('guide.adoc').added).toEqual(['TIP: Keep the installer.']);

  await page.locator('.directive-tip .directive-kind').selectOption('warning');
  await waitForSave(page);
  expect(changes('guide.adoc').added).toEqual(['WARNING: Keep the installer.']);
});

test('the source view shows the AsciiDoc', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'AsciiDoc', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'AsciiDoc source' });
  await expect(source).toContainText('= Installation Guide');
  await expect(page.getByRole('toolbar', { name: 'AsciiDoc view' })).toBeVisible();
});

test('Ctrl+click on a cross-reference opens the page', async () => {
  const { page } = ctx;
  await page.locator('.role-ref', { hasText: 'the other page' }).click({ modifiers: ['Control'] });
  await expect(page.locator('.prose h1')).toHaveText('Other Page');
});

test('a condition Asciidoctor evaluates is shown readably, and edited in a form', async () => {
  const { page } = ctx;
  const card = page.locator('.card', { hasText: 'Only when {sectnumlevels} == 3' });
  await expect(card).toBeVisible();
  await expect(page.locator('.card', { hasText: 'End of the condition' })).toBeVisible();
  await card.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Condition' });
  await dialog.getByLabel('Expression').fill('{sectnumlevels} >= 2');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await waitForSave(page);
  expect(changes('guide.adoc')).toEqual({ removed: ['ifeval::[{sectnumlevels} == 3]'], added: ['ifeval::[{sectnumlevels} >= 2]'] });
});
