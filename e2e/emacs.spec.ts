// Emacs keys, switched on from the toolbar, in both views.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'guide', 'install.md'), 'utf8');
const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
const keys = async (page: Page, ...combos: string[]) => {
  for (const k of combos) await page.keyboard.press(k);
};
// Edit → Emacs Keys.
const emacsKeys = () => ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('emacs-keys')!.click());
test.beforeEach(async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Installing Widget' }).click();
  await emacsKeys();
  // The menu ticks the item, leaves Emacs' keys alone and shows the Emacs ones.
  await expect.poll(() => ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('emacs-keys')!.checked)).toBe(true);
  await expect
    .poll(() => ctx.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('go-to-page')!;
      return [item.label, item.registerAccelerator];
    }))
    .toEqual(['Go to Page…    C-x b', false]);
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('moves, kills and yanks, marks a region, and formats in the formatted view', async () => {
  const { page } = ctx;
  const line = page.locator('.prose > p').first(); // "Install the package with pip:"
  await line.click();
  await keys(page, 'Control+a');
  await page.keyboard.type('Now ');
  await keys(page, 'Control+e');
  await page.keyboard.type(' Or uv.');
  await expect(line).toHaveText('Now Install the package with pip: Or uv.');

  // C-a C-k kills the line, C-y yanks it back (twice).
  await keys(page, 'Control+a', 'Control+k');
  await expect(line).toHaveText('');
  await keys(page, 'Control+y', 'Control+y');
  await expect(line).toHaveText('Now Install the package with pip: Or uv.Now Install the package with pip: Or uv.');
  // C-/ undoes (edits close together are one step, so pause first, as typing would).
  await page.waitForTimeout(700);
  await page.keyboard.type('X');
  await page.waitForTimeout(700);
  await keys(page, 'Control+/');
  await expect(line).toHaveText('Now Install the package with pip: Or uv.Now Install the package with pip: Or uv.');
  await keys(page, 'Control+a', 'Control+k');
  await page.keyboard.type('Now Install the package with pip: Or uv.');

  // C-SPC sets the mark: moving selects; C-c C-s b makes it bold.
  await keys(page, 'Control+a', 'Control+Space', 'Control+f', 'Control+f', 'Control+f');
  await keys(page, 'Control+c');
  await expect(page.locator('.emacs-echo')).toHaveText('C-c-');
  await keys(page, 'Control+s', 'b');
  await expect(page.locator('.emacs-echo')).toHaveCount(0);
  await expect(line.locator('strong')).toHaveText('Now');

  // C-x C-s saves now.
  await keys(page, 'Control+x', 'Control+s');
  await saved(page);
  expect(file()).toContain('**Now** Install the package with pip: Or uv.');

  // C-s finds; C-g closes the find bar.
  await keys(page, 'Control+s');
  await expect(page.getByRole('search', { name: 'Find in page' })).toBeVisible();
  await keys(page, 'Control+g');
  await expect(page.getByRole('search', { name: 'Find in page' })).toHaveCount(0);
});

test('the same keys in the Markdown view, and the usual ones back when off', async () => {
  const { page } = ctx;
  await page.locator('.prose p', { hasText: 'Install the package' }).click();
  await keys(page, 'Control+c', 'm'); // the Markdown view
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-line', { hasText: 'Install the package' }).click();
  await keys(page, 'Control+a', 'Control+k');
  await expect(page.locator('.cm-line', { hasText: 'Install the package' })).toHaveCount(0);
  await keys(page, 'Control+y');
  await expect(page.locator('.cm-line', { hasText: 'Install the package with pip:' })).toHaveCount(1);
  await keys(page, 'Control+e');
  await page.keyboard.type(' Or uv.');
  await keys(page, 'Control+s');
  await expect(page.locator('.cm-search')).toBeVisible();
  await keys(page, 'Escape', 'Control+x', 'Control+s');
  await saved(page);
  expect(file()).toContain('Install the package with pip: Or uv.\n');

  // Off again: Ctrl+/ goes back to the formatted view, and Ctrl+B is bold.
  await emacsKeys();
  await expect.poll(() => ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('emacs-keys')!.checked)).toBe(false);
  await page.locator('.cm-content').click();
  await keys(page, 'Control+/');
  await expect(page.locator('.prose')).toBeVisible();
  await page.locator('.prose p', { hasText: 'Install the package' }).click();
  await keys(page, 'End', 'Control+b');
  await page.keyboard.type('bold');
  await expect(page.locator('.prose p strong', { hasText: 'bold' })).toBeVisible();
});
