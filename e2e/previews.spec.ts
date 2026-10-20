// Cards show what the project's Sphinx build makes of blocks the editor can't render
// itself: custom directives and tables.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const repo = join(import.meta.dirname, '..');
const shared = process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx');

function addVenv(project: string) {
  const env = { ...process.env, UV_CACHE_DIR: join(shared, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(shared, 'python'), UV_PYTHON_PREFERENCE: 'only-managed' };
  const uv = join(repo, 'resources', 'uv', 'uv');
  execFileSync(uv, ['venv', '-q', '--python', '3.12', join(project, '.venv')], { env });
  execFileSync(uv, ['pip', 'install', '-q', '--python', join(project, '.venv', 'bin', 'python'), 'sphinx', 'myst-parser'], { env });
}

let ctx: App;

test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-ext', prepare: addVenv });
  await ctx.page.getByRole('button', { name: 'Use Project .venv' }).click();
  await expect(ctx.page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 120_000 });
});

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('a custom directive the editor doesn’t know shows as the build renders it', async () => {
  const { page } = ctx;
  const card = page.locator('.card-directive', { hasText: 'product-matrix' });
  await expect(card.locator('.card-badge')).toBeVisible();
  const frame = card.frameLocator('iframe.card-preview');
  await expect(frame.locator('.rubric')).toHaveText('Product availability');
  await expect(frame.locator('li')).toHaveText(['Basic: available', 'Pro: available']);
  // The frame sizes itself to the content.
  expect((await card.locator('iframe.card-preview').boundingBox())!.height).toBeGreaterThan(40);
  // Clean build: the extension provides the {jira} role too.
  await expect(page.locator('.chip-button', { hasText: 'No problems' })).toBeVisible();
});

test('tables are previewed from the build, and update after editing', async () => {
  const { page } = ctx;
  const card = page.locator('.card-table');
  await expect(card.frameLocator('iframe.card-preview').locator('td').first()).toHaveText('Basic');

  await card.dblclick();
  const dialog = page.getByRole('dialog', { name: 'Edit table' });
  const source = dialog.locator('textarea');
  await source.fill((await source.inputValue()).trimEnd() + '\n| Pro   | Paid  |\n');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.card-table').frameLocator('iframe.card-preview').locator('td')).toHaveText(['Basic', 'Free', 'Pro', 'Paid'], {
    timeout: 30_000,
  });
});

test('a previewed card hides its own view; condition markers are never previewed', async () => {
  const { page } = ctx;
  await expect(page.locator('.card-directive', { hasText: 'product-matrix' }).locator('.card-fallback')).toBeHidden();
  await expect(page.locator('.cond-start').first()).toBeVisible();
  await expect(page.locator('.cond-start iframe')).toHaveCount(0);
});
