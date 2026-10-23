// The app's own title bar: the menus of the application menu, drawn in the page.
import { expect, test } from '@playwright/test';
import { launch, type App } from './helpers';

let ctx: App;

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const top = (name: string) => ctx.page.locator('.titlebar-menu > button', { hasText: name });
const item = (name: string) => ctx.page.locator('.titlebar-items button', { hasText: name });

test('the menus are in the title bar, and do what the menu does', async () => {
  ctx = await launch();
  const { app, page } = ctx;
  await expect(page.locator('.titlebar-menu > button')).toHaveText(['File', 'Edit', 'View', 'Help']);
  await expect(page.locator('.titlebar-title')).toHaveText('project — MyST Editor');

  // An item runs its command.
  await top('Edit').click();
  await expect(item('Search All Pages…').locator('.titlebar-shortcut')).toHaveText('Ctrl+Shift+F');
  await item('Search All Pages…').click();
  await expect(page.locator('.titlebar-items')).toHaveCount(0);
  await expect(page.locator('.search-panel')).toBeVisible();
  await page.keyboard.press('Escape');

  // Submenus, and radio items that show the choice.
  await top('View').click();
  await item('Appearance').hover();
  await page.locator('.titlebar-submenu button', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await top('View').click();
  await item('Appearance').hover();
  await expect(page.locator('.titlebar-submenu button', { hasText: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.titlebar-items')).toHaveCount(0);

  // Edit → Copy copies what's selected in the page: the menu leaves the focus there.
  await page.locator('.prose').getByText('Welcome to the').dblclick();
  const selected = await page.evaluate(() => getSelection()!.toString());
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await top('Edit').click();
  await item('Copy').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
});

test('the keyboard: F10 opens the menus, arrows move through them', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('F10');
  await expect(page.locator('.titlebar-menu.open > button')).toHaveText('File');
  await expect(page.locator('.titlebar-items button:focus')).toContainText('Open Folder…');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.titlebar-menu.open > button')).toHaveText('Edit');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.titlebar-menu.open > button')).toHaveText('Help');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'About MyST Editor' })).toBeVisible();
});

test('with the system’s title bar, there is none in the page', async () => {
  ctx = await launch({ env: { MYSTEDITOR_SYSTEM_TITLE_BAR: '1' } });
  await expect(ctx.page.locator('.prose')).toBeVisible();
  await expect(ctx.page.locator('.titlebar')).toHaveCount(0);
});
