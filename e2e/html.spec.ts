// HTML written in pages shows as what it does (line breaks, lists, bold), safely,
// and is saved exactly as written.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const PAGE = `# HTML page

First line<br>second line, with <b>bold</b>, <i>italic</i> and H<sub>2</sub>O.

| Item | Notes |
| --- | --- |
| A | one<br>two |
| B | <ul><li>first</li><li>second <b>point</b></li></ul> |
| C | <ol><li>alpha</li><li>beta</li></ol> |

<ul>
<li>Block one</li>
<li>Block <b>two</b></li>
</ul>

<div onclick="window.hacked = 1"><script>window.hacked = 2</script>Safe text <img src="nope.png" onerror="window.hacked = 3"></div>
`;

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ prepare: (project) => writeFileSync(join(project, 'docs', 'html.md'), PAGE) });
  await ctx.page.getByRole('button', { name: 'HTML page' }).click();
  await expect(ctx.page.locator('.prose h1')).toHaveText('HTML page');
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('shows line breaks, formatting and lists, in text and tables', async () => {
  const { page } = ctx;
  const para = page.locator('.prose p', { hasText: 'First line' });
  await expect(para.locator('.html-br br')).toHaveCount(1);
  await expect(para.locator('strong')).toHaveText('bold');
  await expect(para.locator('em')).toHaveText('italic');
  await expect(para.locator('sub')).toHaveText('2');
  await expect(para).not.toContainText('<b>');

  const cells = page.locator('.prose td');
  await expect(cells.nth(1).locator('.html-br br')).toHaveCount(1);
  await expect(cells.nth(3).locator('.html-li-marker')).toHaveText(['•', '•']);
  await expect(cells.nth(3).locator('strong')).toHaveText('point');
  await expect(cells.nth(5).locator('.html-li-marker')).toHaveText(['1.', '2.']);

  // An HTML block shows as rendered HTML, minus anything that could run.
  const blocks = page.locator('.card-html .html-rendered');
  await expect(blocks.first().locator('li')).toHaveText(['Block one', 'Block two']);
  await expect(blocks.nth(1)).toContainText('Safe text');
  await expect(blocks.locator('script')).toHaveCount(0);
  await expect(blocks.locator('[onclick], [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
  await page.screenshot({ path: test.info().outputPath('html.png') });

  // Editing near HTML leaves it exactly as written.
  await page.locator('.prose p', { hasText: 'First line' }).getByText('O.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Done.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(readFileSync(join(ctx.project, 'docs', 'html.md'), 'utf8')).toBe(PAGE.replace('H<sub>2</sub>O.', 'H<sub>2</sub>O. Done.'));
});

test('a list in a table cell: new items on Enter, made from its lines by the list button', async () => {
  const { page } = ctx;
  const file = () => readFileSync(join(ctx.project, 'docs', 'html.md'), 'utf8');
  const saved = () => expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  const cells = page.locator('.prose td');
  // Enter at the end of an item: a new one, typed in.
  await cells.nth(5).getByText('beta').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('gamma');
  await expect(cells.nth(5).locator('.html-li-marker')).toHaveText(['1.', '2.', '3.']);
  await saved();
  expect(file()).toContain('| C | <ol><li>alpha</li><li>beta</li><li>gamma</li></ol> |');
  // A cell of lines made a list, by the bulleted list button.
  await cells.nth(1).getByText('one').click();
  await page.getByRole('button', { name: /^Bulleted list/ }).click();
  await expect(cells.nth(1).locator('.html-li-marker')).toHaveText(['•', '•']);
  await saved();
  expect(file()).toContain('| A | <ul><li>one</li><li>two</li></ul> |');
});
