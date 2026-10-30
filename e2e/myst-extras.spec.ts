// MyST's optional syntax and common extension directives, as the editor shows and
// edits them: substitutions, attributes, field lists, amsmath, toggles and rubrics,
// list tables, and front matter.
import { expect, test } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const PAGE = `---
title: Extras
orphan: true
---

# Extras

:author: The team

Made for {{ product }}, with [a span]{.note} in it.

{#start}
The first paragraph.

\\begin{equation}
E = mc^2
\\end{equation}

\`\`\`{rubric} Further reading
\`\`\`

\`\`\`{toggle}
Hidden text.
\`\`\`

\`\`\`{list-table}
:header-rows: 1

* - Plan
  - Notes
* - Basic
  - - one
    - two
\`\`\`
`;

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'docs', 'extras.md'), 'utf8');
test.beforeEach(async () => {
  ctx = await launch({
    prepare: (project) => {
      appendFileSync(join(project, 'docs', 'conf.py'), 'myst_enable_extensions += ["substitution", "attrs_inline", "attrs_block", "fieldlist", "amsmath"]\nextensions += ["sphinx_togglebutton"]\nmyst_substitutions = {"product": "Widget Pro"}\n');
      writeFileSync(join(project, 'docs', 'extras.md'), PAGE);
    },
  });
  await ctx.page.getByRole('button', { name: 'Not now' }).click();
  await ctx.page.getByRole('button', { name: 'Extras', exact: true }).click();
  await expect(ctx.page.locator('.prose h1')).toHaveText('Extras');
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
  await expect(page.locator('.prose .role-value')).toHaveText('Widget Pro');
  await expect(page.locator('.prose .text-attrs')).toHaveText('a span');
  await expect(page.locator('.card-frontmatter')).toContainText('title, orphan');
  await expect(page.locator('.prose table.field-list')).toContainText('author');
  await expect(page.locator('.prose .math-block .katex').first()).toBeVisible();
  await expect(page.locator('.directive-rubric .directive-arg')).toHaveValue('Further reading');
  await expect(page.locator('.directive-toggle .directive-body')).toHaveText('Hidden text.');
  await expect(page.locator('.prose table:not(.field-list) th')).toHaveText(['Plan', 'Notes']);
  await expect(page.locator('.prose td .cell-blocks li')).toHaveText(['one', 'two']);
  expect(file()).toBe(PAGE);
});

test('edits them, each where it is', async () => {
  const { page } = ctx;
  // In the list table's cell, and in the toggle.
  await page.locator('.prose td').getByText('two').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and three');
  await page.locator('.directive-toggle').getByText('Hidden text.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Shown on a click.');
  await saved();
  expect(file()).toBe(PAGE.replace('    - two', '    - two and three').replace('Hidden text.', 'Hidden text. Shown on a click.'));
  // The front matter, in its form.
  await page.locator('.card-frontmatter').dblclick();
  const dialog = page.getByRole('dialog', { name: 'Page settings' });
  await dialog.getByLabel('title').fill('More extras');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('---\ntitle: More extras\norphan: true\n---');
});
