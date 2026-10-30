// Help → About shows the app's version.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('Help → About shows the version, and copies the details', async () => {
  ctx = await launch();
  const { app, page } = ctx;
  const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('about')!.click());
  const dialog = page.getByRole('dialog', { name: 'About Wysie' });
  await expect(dialog.locator('.about-version')).toHaveText(`Version ${version}`);
  await expect(dialog.locator('dt')).toContainText(['Electron', 'Chromium', 'Node', 'System']);
  await dialog.getByRole('button', { name: 'Copy details' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(new RegExp(`^Wysie ${version.replace(/\./g, '\\.')}\r?\nElectron: `)); // CRLF on Windows
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
