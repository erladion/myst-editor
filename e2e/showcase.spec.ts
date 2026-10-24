// The README's picture of the app (.github/showcase.png), made from the sample project
// in fixture-showcase. Only when asked: SHOWCASE=1 npx playwright test showcase
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.skip(!process.env.SHOWCASE, 'makes the README picture; set SHOWCASE=1');
test.setTimeout(300_000);

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('showcase', async () => {
  ctx = await launch({ fixture: 'fixture-showcase', folder: 'harbor-docs' });
  const { page, app } = ctx;
  const theme = process.env.SHOWCASE_THEME === 'dark' ? 'dark' : 'light';
  await app.evaluate(({ BrowserWindow, Menu }, theme) => {
    Menu.getApplicationMenu()!.getMenuItemById(`theme-${theme}`)!.click();
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1440, 880);
    win.center();
  }, theme);
  // Playwright reports light to pages unless told otherwise (the built page follows it).
  await page.emulateMedia({ colorScheme: theme });
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 240_000 });

  await page.locator('.tree .page', { hasText: 'Deploy your first service' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Deploy your first service');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('.preview iframe[title="Sphinx preview"]');
  await expect(preview.locator('h1')).toHaveText(/Deploy your first service/, { timeout: 60_000 });

  // The cursor in a sentence, as when writing.
  await page.locator('.prose p').first().click();
  await page.keyboard.press('End');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(import.meta.dirname, '..', '.github', theme === 'dark' ? 'showcase-dark.png' : 'showcase.png') });
});
