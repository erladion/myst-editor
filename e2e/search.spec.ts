// Searching all pages, and the right-click menu.
import { expect, test } from '@playwright/test';
import { launch, type App } from './helpers';

let ctx: App;
const menu = (id: string) => ctx.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
test.beforeEach(async () => {
  ctx = await launch();
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('searches every page, and opens a result at its line with the matches shown', async () => {
  const { page } = ctx;
  await menu('search-pages');
  const panel = page.getByRole('region', { name: 'Search all pages' });
  await panel.getByLabel('Search for').fill('widget.toml');
  await expect(panel.locator('.search-summary')).toHaveText('2 matches in 2 pages');
  const results = panel.getByRole('group', { name: 'Installing Widget' });
  await expect(results.locator('.search-match').first()).toContainText('widget.toml');
  await results.locator('.search-match').first().click();

  await expect(page.locator('.prose h1')).toHaveText('Installing Widget');
  const bar = page.getByRole('search', { name: 'Find in page' });
  await expect(bar.getByLabel('Find')).toHaveValue('widget.toml');
  await expect(page.locator('.find-current')).toHaveText('widget.toml');
  // Unknown text: said plainly. Escape closes the search.
  await panel.getByLabel('Search for').fill('nothing like this anywhere');
  await expect(panel.locator('.search-summary')).toHaveText('No page has this.');
  await panel.getByLabel('Search for').press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Find a page' })).toBeVisible();
});

test('right-click offers cut, copy and paste where they apply', async () => {
  const { app, page } = ctx;
  const items = () =>
    app.evaluate(() => {
      const m = (globalThis as { lastContextMenu?: Electron.Menu }).lastContextMenu;
      return m ? m.items.filter((i) => i.type !== 'separator').map((i) => `${i.id}:${i.enabled}`) : [];
    });
  // Something to paste, and a selection in the page.
  await app.evaluate(({ clipboard }) => clipboard.writeText('from elsewhere'));
  // "Welcome" selected, wherever the window's size makes the line wrap.
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.prose p')].find((el) => el.textContent!.startsWith('Welcome to the'))!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 'Welcome'.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('Welcome');
  // Right-click on the selected word, as a writer would.
  const at = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect.poll(items).toEqual(['cut:true', 'copy:true', 'paste:true', 'selectall:true']);
  // What's selected is what Copy copies.
  const selected = 'Welcome';
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('');
    const m = (globalThis as { lastContextMenu?: Electron.Menu }).lastContextMenu!;
    m.getMenuItemById('copy')!.click();
    m.closePopup();
  });
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
});

test('on a misspelled word, right-click offers the spellchecker’s suggestions', async () => {
  const { app, page } = ctx;
  // A right-click on "Welcome", as Chromium reports one on a misspelled word.
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.prose p')].find((el) => el.textContent!.startsWith('Welcome to the'))!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 'Welcome'.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  const items = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.emit('context-menu', {}, { isEditable: true, selectionText: 'Welcome', misspelledWord: 'Welcome', dictionarySuggestions: ['Welcomed', 'Welcomes'], editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } });
    const m = (globalThis as { lastContextMenu?: Electron.Menu }).lastContextMenu!;
    m.closePopup();
    return m.items.map((i) => (i.type === 'separator' ? '—' : i.label));
  });
  // (Choosing one replaces the word Chromium marked: there's none here, without its
  // dictionary, which it downloads.)
  expect(items).toEqual(['Welcomed', 'Welcomes', 'Add “Welcome” to Dictionary', '—', 'Cut', 'Copy', 'Paste', '—', 'Select All']);
});
