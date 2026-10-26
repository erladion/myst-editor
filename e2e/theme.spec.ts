// View → Appearance: light, dark, or as the system is; remembered.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launch } from './helpers';

test('switches to dark and back, and remembers the choice', async () => {
  const { app, page, project } = await launch();
  const choose = (id: string) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await choose('theme-dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background()).toBe('rgb(23, 25, 29)');
  const settings = () => {
    try {
      return JSON.parse(readFileSync(join(dirname(project), 'user-data', 'settings.json'), 'utf8'));
    } catch {
      return {}; // not written yet
    }
  };
  await expect.poll(() => settings().theme).toBe('dark');

  await choose('theme-light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background()).toBe('rgb(255, 255, 255)');
  await expect.poll(() => settings().theme).toBe('light');
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
});

test('the cursor shows in dark mode, in the Markdown view too', async () => {
  const { app, page } = await launch();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('theme-dark')!.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.prose p').first().click();
  expect(await page.locator('.prose').evaluate((e) => getComputedStyle(e).caretColor)).toBe('rgb(230, 232, 235)');
  await page.keyboard.press('Control+/');
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-cursor').first()).toHaveCSS('border-left-color', 'rgb(230, 232, 235)');
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
});
