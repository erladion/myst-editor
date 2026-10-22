// End-to-end tests for the Sphinx integration. The first run downloads Python and
// the fixture's docs packages (shared between runs via MYSTEDITOR_SPHINX_DATA).
import { expect, test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.beforeEach(async () => {
  ctx = await launch();
});

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

async function allowAndBuild() {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 180_000 });
}

test('asks before running Sphinx, and remembers a refusal for the session', async () => {
  const { page } = ctx;
  await expect(page.locator('.banner.info')).toContainText('conf.py');
  await expect(page.locator('.banner.info')).toContainText('docs/requirements.txt');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.banner.info')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview off' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
});

test('builds the project: contents, resolved references, problems and preview', async () => {
  const { page } = ctx;
  await allowAndBuild();

  // The sidebar follows the toctree.
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation', 'Installing Widget', 'Configuring Widget']);
  // Entries with pages under them fold away.
  const toggle = page.getByRole('button', { name: 'Hide the pages in Widget documentation' });
  await toggle.click();
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation']);
  await page.getByRole('button', { name: 'Show the pages in Widget documentation' }).click();
  await expect(page.locator('.tree .page')).toHaveText(['Widget documentation', 'Installing Widget', 'Configuring Widget']);

  // {ref}`configuration` shows the section's title from the build.
  await expect(page.locator('.role-ref', { hasText: 'Configuration' })).toBeVisible();

  // The unknown directive is reported and marked on its block.
  await expect(page.locator('.chip-button', { hasText: '1 problem' })).toBeVisible();
  await expect(page.locator('.card-directive.has-problem')).toBeVisible();
  await page.locator('.chip-button', { hasText: '1 problem' }).click();
  await expect(page.locator('.problem')).toContainText("Unknown directive type: 'company-callout'");

  // The preview shows the page as Sphinx built it.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('.preview iframe');
  await expect(preview.locator('h1')).toHaveText(/Widget documentation/);
});

test('the preview scrolls along with the page', async () => {
  // A longer page.
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  const parts = Array.from({ length: 30 }, (_, i) => `## Part ${i + 1}\n\n${'Some words to fill the page. '.repeat(30)}\n`).join('\n');
  ctx = await launch({ prepare: (project) => appendFileSync(join(project, 'docs', 'index.md'), `\n${parts}`) });
  const { page } = ctx;
  await allowAndBuild();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('.preview iframe');
  await expect(preview.locator('h1')).toHaveText(/Widget documentation/);
  const topIn = (heading: string, where: typeof preview) =>
    where.locator('h2', { hasText: heading }).evaluate((el) => Math.round(el.getBoundingClientRect().top));

  await page.locator('.prose h2', { hasText: 'Part 20' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  // Part 20 is at the top of the preview too.
  await expect.poll(() => topIn('Part 20', preview)).toBeLessThan(60);
  expect(await topIn('Part 20', preview)).toBeGreaterThan(-20);
  // And the end with the end.
  await page.locator('.scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect
    .poll(() => preview.locator('html').evaluate(() => Math.round(document.documentElement.scrollHeight - innerHeight - scrollY)))
    .toBeLessThan(2);
});

test('the Markdown view shows warnings on their lines and the built page', async () => {
  const { page } = ctx;
  await allowAndBuild();
  await page.getByRole('button', { name: 'Markdown' }).click();
  // Clicking the problem goes to its line, which carries the warning in the gutter.
  await page.locator('.chip-button', { hasText: '1 problem' }).click();
  await page.locator('.problem').click();
  await expect(page.locator('.cm-activeLine')).toHaveText(':::{company-callout}');
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(1);
  await page.getByRole('button', { name: 'As built' }).click();
  await expect(page.frameLocator('.advanced-preview iframe').locator('h1')).toHaveText(/Widget documentation/);
});

test('a broken cross-reference is flagged after the next build', async () => {
  const { page } = ctx;
  await allowAndBuild();
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Cross-reference…' }).click();
  await page.getByRole('combobox', { name: 'Target', exact: true }).fill('no-such-section');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  // Not found in the build: flagged straight away, then reported by Sphinx.
  await expect(page.locator('.role-broken', { hasText: 'no-such-section' })).toBeVisible();
  await expect(page.locator('.chip-button', { hasText: '2 problems' })).toBeVisible({ timeout: 60_000 });
  await page.locator('.chip-button', { hasText: '2 problems' }).click();
  await expect(page.locator('.problem', { hasText: "undefined label: 'no-such-section'" })).toBeVisible();
});

test('autocompletes cross-reference targets from the build', async () => {
  const { page } = ctx;
  await allowAndBuild();
  await page.locator('.prose').getByText('Welcome to the').click();
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Cross-reference…' }).click();
  const options = page.locator('datalist#suggest-target option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveAttribute('value', 'configuration');
  await page.getByLabel('Refers to').selectOption('doc');
  await expect(options).toHaveCount(3);
});
