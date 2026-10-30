// MyST blocks shown as cards, and the forms they're edited with: a toctree, link
// targets, a literalinclude's lines, code tabs, definition lists of blocks, stub
// columns, a video, and values over lines in front matter.
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const PAGE = `---
html_meta:
  description: |
    One.
    Two.
---

# Cards

\`\`\`{toctree}
:maxdepth: 2

guide/install
\`\`\`

See [the site][site].

[site]: https://example.com "The site"

\`\`\`{literalinclude} examples/hello.py
:lines: 2-3
:linenos:
\`\`\`

::::{tab-set-code}
\`\`\`python
print("hi")
\`\`\`
::::

Term

: First paragraph.

  - one
  - two

\`\`\`{video} media/missing.mp4
\`\`\`

\`\`\`{list-table}
:stub-columns: 1

* - Name
  - Widget
\`\`\`
`;

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'cards.md'), 'utf8');
test.beforeEach(async () => {
  ctx = await launch({
    prepare: (project) => {
      mkdirSync(join(project, 'docs', 'examples'), { recursive: true });
      writeFileSync(join(project, 'docs', 'examples', 'hello.py'), 'import sys\ndef hello():\n    print("hello")\n# end\n');
      writeFileSync(join(project, 'docs', 'cards.md'), PAGE);
    },
  });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  await ctx.page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(ctx.page.locator('.prose h1')).toHaveText('Cards');
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

async function saved() {
  await expect(ctx.page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

test('shows each as what it is', async () => {
  const { page } = ctx;
  await expect(page.locator('.card-toc .toc-entries li')).toHaveCount(1);
  await expect(page.locator('.card-definitions table.link-targets')).toContainText('https://example.com');
  await expect(page.locator('.card-literalinclude .included-line')).toHaveText(['def hello():', '    print("hello")']);
  await expect(page.locator('.card-literalinclude .included-line').first()).toHaveAttribute('data-n', '1');
  await expect(page.locator('.directive-tab-set-code pre')).toContainText('print("hi")');
  await expect(page.locator('.prose dd li')).toHaveText(['one', 'two']);
  await expect(page.locator('.prose table.stub-columns-1 td').first()).toHaveCSS('font-weight', '600');
  await expect(page.locator('.card-media')).toContainText('Can’t play media/missing.mp4');
  expect(file()).toBe(PAGE);
});

test('edits them in their forms, and in place', async () => {
  const { page } = ctx;
  // The toctree: another page, and no depth.
  await page.locator('.card-toc').dblclick();
  let dialog = page.getByRole('dialog', { name: 'Table of contents' });
  await dialog.getByLabel('Depth').fill('');
  await dialog.getByLabel('Pages').fill('guide/install\nguide/configure');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('```{toctree}\nguide/install\nguide/configure\n```');
  await expect(page.locator('.card-toc .toc-entries li')).toHaveCount(2);

  // The link target: another address, its title kept.
  await page.locator('.card-definitions').dblclick();
  dialog = page.getByRole('dialog', { name: 'Link target' });
  await dialog.getByLabel('[site]').fill('https://example.org');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('[site]: https://example.org "The site"');

  // The front matter's value over lines, in a box of lines.
  await page.locator('.card-frontmatter').dblclick();
  dialog = page.getByRole('dialog', { name: 'Page settings' });
  await dialog.getByLabel('html_meta.description').fill('One.\nThree.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('  description: |\n    One.\n    Three.\n---');

  // In a definition's list: that line only.
  await page.locator('.prose dd li').getByText('two').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and three');
  await saved();
  expect(file()).toContain(': First paragraph.\n\n  - one\n  - two and three\n');

  // A card with a form offers its source too.
  await page.locator('.card-toc').getByRole('button', { name: 'Source…' }).click();
  await expect(page.getByRole('dialog')).toContainText('{toctree}');
});
