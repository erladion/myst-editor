// Choosing where Sphinx builds get Python from, and working without internet.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, workDir, type App } from './helpers';

const repo = join(import.meta.dirname, '..');
const shared = process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx');

// A hand-made docs environment in the project, as an admin would set up offline.
function addVenv(project: string) {
  const env = { ...process.env, UV_CACHE_DIR: join(shared, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(shared, 'python'), UV_PYTHON_PREFERENCE: 'only-managed' };
  const uv = join(repo, 'resources', 'uv', 'uv');
  execFileSync(uv, ['venv', '-q', '--python', '3.12', join(project, '.venv')], { env });
  execFileSync(uv, ['pip', 'install', '-q', '--python', join(project, '.venv', 'bin', 'python'), '-r', join(project, 'docs', 'requirements.txt')], { env });
}

let ctx: App;

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('offers a Python environment found in the project and builds with it', async () => {
  ctx = await launch({ prepare: addVenv });
  const { page } = ctx;
  await expect(page.locator('.banner.info')).toContainText('Found Project .venv on this computer');
  await page.getByRole('button', { name: 'Use Project .venv' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 120_000 });
  await page.locator('.chip-button', { hasText: /Built in/ }).click();
  await expect(page.getByRole('dialog', { name: 'Sphinx' })).toContainText(join(ctx.project, '.venv', 'bin', 'python'));
});

test('without internet, says so and lets the writer pick an environment on the computer', async () => {
  // A fresh data folder, so the private environment would need downloading.
  ctx = await launch({ prepare: addVenv, env: { UV_OFFLINE: '1', MYSTEDITOR_SPHINX_DATA: mkdtempSync(join(workDir(), 'mysteditor-offline-')) } });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Download packages' }).click();
  const chip = page.getByRole('button', { name: 'Offline — choose Python…' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  await expect(page.getByRole('dialog', { name: 'Sphinx' })).toContainText('can’t reach the internet');
  await page.getByRole('button', { name: 'Change Python environment…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Python environment' });
  // Offline, the environment found on the computer is suggested.
  await expect(dialog.getByRole('radio', { name: /Project \.venv/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Use this environment' }).click();
  await expect(page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 120_000 });
});
