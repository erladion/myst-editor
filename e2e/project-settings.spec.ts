// File → Project Settings: turning conditional content on and off, and its settings,
// written into the project's .mysteditor.toml.
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const page = () => ctx.page;
const toml = () => readFileSync(join(ctx.project, 'docs', '.mysteditor.toml'), 'utf8');

async function openSettings() {
  await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('project-settings')!.click());
  return page().getByRole('dialog', { name: 'Project settings' });
}

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('turns conditional content off and on, keeping its settings', async () => {
  ctx = await launch({ fixture: 'fixture-ext' });
  await page().getByRole('button', { name: 'Not now' }).click();
  const original = toml();
  const pageText = readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
  await expect(page().locator('.cond-start').first()).toBeVisible();

  let dialog = await openSettings();
  await expect(dialog).toContainText('Saved in docs/.mysteditor.toml, so they apply to everyone');
  await expect(dialog.getByRole('checkbox', { name: 'Conditional content' })).toBeChecked();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('capabilities.json');
  await expect(dialog.getByLabel('Where the list is in the file')).toHaveValue('product.capabilities');
  await expect(dialog).toContainText('3 capabilities: CapabilityX, CapabilityY, CapabilityZ');
  await page().screenshot({ path: test.info().outputPath('settings.png') });
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).uncheck();
  await expect(dialog.getByLabel('Capabilities file')).toBeHidden();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Off: the markers are plain comments again, and the tools for them are gone.
  expect(toml()).toBe(original.replace('key = "product.capabilities"\n', 'key = "product.capabilities"\nenabled = false\n'));
  await expect(page().locator('.cond-start')).toHaveCount(0);
  await page().locator('.prose').getByText('Closing words.').click();
  await expect(page().getByRole('button', { name: 'Condition…' })).toHaveCount(0);

  dialog = await openSettings();
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).check();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('capabilities.json');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(toml()).toBe(original);
  await expect(page().locator('.cond-start').first()).toBeVisible();
  expect(readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8')).toBe(pageText);
});

test('changes the markers and colours', async () => {
  ctx = await launch({ fixture: 'fixture-ext' });
  await page().getByRole('button', { name: 'Not now' }).click();
  const original = toml();
  const z = page().locator('.cond-start').nth(1);
  const colour = () => z.evaluate((e) => getComputedStyle(e).color);
  const before = await colour();

  const dialog = await openSettings();
  await expect(dialog.getByLabel('Colour of CapabilityZ')).toHaveValue('');
  await dialog.getByLabel('Colour of CapabilityZ').selectOption('olive');
  await dialog.getByLabel('Blocks: start').fill('only');
  await expect(dialog.getByText('<!-- only: X -->')).toBeVisible();
  await dialog.getByLabel('Blocks: start').fill('if');
  await dialog.getByLabel('In a line: end').fill('if');
  await expect(dialog.getByText('Each marker needs its own keyword')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('In a line: end').fill('endif-inline');
  await dialog.getByRole('checkbox', { name: 'Capability names are case sensitive' }).uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  expect(toml()).toBe(
    original.replace('key = "product.capabilities"\n', 'key = "product.capabilities"\ncase_sensitive = false\n').replace('\n[tables]', '\n[conditions.colors]\nCapabilityZ = "olive"\n\n[tables]'),
  );
  await expect.poll(colour).not.toBe(before);
});

test('sets up conditional content in a project without settings', async () => {
  ctx = await launch();
  await page().getByRole('button', { name: 'Not now' }).click();
  const settings = join(ctx.project, 'docs', '.mysteditor.toml');
  const caps = join(ctx.project, 'docs', 'products.json');
  // The file dialog, answered.
  await ctx.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, caps);

  const dialog = await openSettings();
  await expect(dialog).toContainText('Saved in docs/.mysteditor.toml (a new file)');
  await expect(dialog.getByRole('checkbox', { name: 'Conditional content' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).check();
  await dialog.getByRole('button', { name: 'New…' }).click();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('products.json');
  await expect(dialog).toContainText('No capabilities in it yet');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(readFileSync(settings, 'utf8')).toBe('[conditions]\ncapabilities = "products.json"\n');
  expect(readFileSync(caps, 'utf8')).toBe('{\n  "capabilities": []\n}\n');

  // Now the toolbar offers conditions, and new capabilities go into the new file.
  await page().locator('.prose p').first().click();
  await page().getByRole('button', { name: 'Condition…' }).click();
  const cond = page().getByRole('dialog', { name: /condition/i });
  await cond.getByRole('button', { name: 'New capability…' }).click();
  await cond.getByLabel('New capability').fill('Cloud');
  await cond.getByLabel('New capability').press('Enter');
  await expect.poll(() => readFileSync(caps, 'utf8')).toBe('{\n  "capabilities": [\n    "Cloud"\n  ]\n}\n');
  expect(existsSync(settings)).toBe(true);
});
