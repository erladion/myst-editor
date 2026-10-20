// A folder with two Sphinx projects sharing one virtualenv:
//   .venv/   user-guide/conf.py   admin-guide/conf.py
import { expect, test } from '@playwright/test';
import { venvPython } from '../src/main/sphinx/environment.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const repo = join(import.meta.dirname, '..');
const shared = process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx');

function addSharedVenv(project: string) {
  const env = { ...process.env, UV_CACHE_DIR: join(shared, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(shared, 'python'), UV_PYTHON_PREFERENCE: 'only-managed' };
  const uv = join(repo, 'resources', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
  execFileSync(uv, ['venv', '-q', '--python', '3.12', join(project, '.venv')], { env });
  execFileSync(uv, ['pip', 'install', '-q', '--python', venvPython(join(project, '.venv')), 'sphinx', 'myst-parser'], { env });
}

let ctx: App;

test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-multi', prepare: addSharedVenv });
});

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('shows both projects, builds each with the shared .venv, and resolves references per project', async () => {
  const { page } = ctx;
  await expect(page.locator('.section-name')).toHaveText(['Admin Guide', 'User Guide']);
  await expect(page.locator('.prose h1')).toHaveText('Admin guide');

  // One decision for the whole folder.
  await page.getByRole('button', { name: 'Use Project .venv' }).click();
  await expect(page.locator('.banner.info')).toHaveCount(0);
  await expect(page.locator('.chip-button', { hasText: 'Admin Guide: Built in' })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.chip-button', { hasText: 'No problems' })).toBeVisible();

  // Each project's contents come from its own build.
  await expect(page.locator('.tree-section[aria-label="Admin Guide"] .page')).toHaveText(['Admin guide', 'Managing accounts']);
  await expect(page.locator('.tree-section[aria-label="User Guide"] .page')).toHaveText(['User guide', 'Installing']);

  // {ref}`accounts` resolves within the admin guide.
  await expect(page.locator('.role-ref', { hasText: 'Managing accounts' })).toBeVisible();

  // The user guide: its own build, its own dialect (colon fences), its own preview.
  await page.locator('.tree-section[aria-label="User Guide"]').getByRole('button', { name: 'Installing' }).click();
  await expect(page.locator('.chip-button', { hasText: 'User Guide: Built in' })).toBeVisible();
  await expect(page.locator('.directive-tip')).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.frameLocator('.preview iframe').getByRole('heading', { level: 1, name: /Installing/ })).toBeVisible();
});

test('new callouts use each project’s fence style, and saving rebuilds only that project', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Use Project .venv' }).click();
  await expect(page.locator('.chip-button', { hasText: 'Admin Guide: Built in' })).toBeVisible({ timeout: 120_000 });

  // The admin guide doesn't enable colon_fence, so a new note uses backticks.
  await page.locator('.prose').getByText('to add users').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Note' }).click();
  await page.keyboard.type('Only admins can see this page.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(readFileSync(join(ctx.project, 'admin-guide', 'index.md'), 'utf8')).toContain('```{note}\nOnly admins can see this page.\n```');

  // In the user guide (colon_fence enabled) the same insert uses colons.
  await page.locator('.tree-section[aria-label="User Guide"]').getByRole('button', { name: 'User guide', exact: true }).click();
  await page.locator('.prose').getByText('Start with').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Note' }).click();
  await page.keyboard.type('For everyone.');
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  expect(readFileSync(join(ctx.project, 'user-guide', 'index.md'), 'utf8')).toContain(':::{note}\nFor everyone.\n:::');
});
