// The command palette (Ctrl+Shift+P, or M-x with Emacs keys): any command by its name.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('finds editing commands and the menus’ items by a few letters', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette.getByRole('combobox', { name: 'Command' })).toBeFocused();
  await page.keyboard.type('warn call');
  await expect(palette.getByRole('option').first()).toContainText('InsertWarning callout');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await page.keyboard.type('Careful.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(file()).toContain(':::{warning}\nCareful.\n:::\n');

  // A menu item, with its shortcut shown; chosen with the arrow keys.
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('dark');
  const dark = palette.getByRole('option', { name: /View › Appearance\s*Dark/ });
  await expect(dark).toBeVisible();
  await dark.click();
  await expect.poll(() => ctx.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');

  // Nothing that fits: said so. In a table, its commands too.
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('zzzz');
  await expect(palette).toContainText('No command has those words.');
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('M-x opens it when Emacs keys are on', async () => {
  ctx = await launch();
  const { page, app } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('emacs-keys')!.click());
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('Alt+x');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option', { name: /Command Palette…/ })).toContainText('M-x');
});
