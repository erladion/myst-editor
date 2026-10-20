// Pasting a picture into a page saves it next to the page and puts it in the text.
import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const images = () => readdirSync(join(ctx.project, 'docs', 'guide', 'images'));
test.beforeEach(async () => {
  ctx = await launch();
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  await ctx.page.getByRole('button', { name: 'guide' }).click();
  await ctx.page.getByRole('button', { name: 'Installing Widget' }).click();
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

// A 1×1 PNG on the clipboard, as a screenshot tool leaves it, optionally with text.
const paste = (page: Page, selector: string, text = '') =>
  page.locator(selector).evaluate((el, text) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    if (text) data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

test('pastes a screenshot into a page', async () => {
  const { page } = ctx;
  await page.locator('.prose').getByText('Settings live in').click();
  await page.keyboard.press('End');
  await paste(page, '.prose');
  await expect(page.locator('.prose img[src*="screenshot-"]')).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  const [name] = images();
  expect(name).toMatch(/^screenshot-\d{4}-\d\d-\d\d-\d{6}\.png$/);
  expect(file('guide/install.md')).toContain(`Settings live in \`widget.toml\`.![](images/${name})`);

  // With text on the clipboard too (copied from a document), the text is pasted.
  await paste(page, '.prose', ' and more');
  await expect(page.locator('.prose')).toContainText('and more');
  expect(images()).toHaveLength(1);
});

test('pastes a screenshot in the Markdown view', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await paste(page, '.cm-content');
  await expect(page.locator('.cm-content')).toContainText('![](images/screenshot-');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(file('guide/install.md')).toMatch(/!\[\]\(images\/screenshot-[\d-]+\.png\)$/);
});

test('drops a picture where it lands', async () => {
  const { page } = ctx;
  const target = page.locator('.prose p', { hasText: 'Install the package with pip:' });
  const box = (await target.boundingBox())!;
  await target.evaluate((el, { x, y }) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'architecture.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x: box.x + box.width - 2, y: box.y + box.height / 2 });
  await expect(page.locator('.prose img[src*="architecture"]')).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(images()).toEqual(['architecture.png']);
  expect(file('guide/install.md')).toContain('Install the package with pip:![](images/architecture.png)');
});
