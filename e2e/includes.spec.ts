// A page included with {include} previews as all of what it brings in, from the build.
import { expect, test } from '@playwright/test';
import { venvPython } from '../src/main/sphinx/environment.js';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const repo = join(import.meta.dirname, '..');
const shared = process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx');

function prepare(project: string) {
  const env = { ...process.env, UV_CACHE_DIR: join(shared, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(shared, 'python'), UV_PYTHON_PREFERENCE: 'only-managed' };
  const uv = join(repo, 'resources', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
  execFileSync(uv, ['venv', '-q', '--python', '3.12', join(project, '.venv')], { env });
  execFileSync(uv, ['pip', 'install', '-q', '--python', venvPython(join(project, '.venv')), 'sphinx', 'myst-parser'], { env });
  const docs = join(project, 'docs');
  mkdirSync(join(docs, '_snippets'));
  writeFileSync(join(docs, '_snippets', 'shared.md'), 'Shared intro paragraph.\n\n:::{note}\nShared note.\n:::\n\n- One\n- Two\n');
  appendFileSync(join(docs, 'conf.py'), 'exclude_patterns = ["_snippets"]\n');
  appendFileSync(join(docs, 'index.md'), '\n```{include} _snippets/shared.md\n```\n\nAfter the include.\n');
}

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-ext', prepare });
  await ctx.page.getByRole('button', { name: 'Use Project .venv' }).click();
  await expect(ctx.page.locator('.chip-button', { hasText: /problem/ })).toBeVisible({ timeout: 120_000 });
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('an included page previews whole: its text, notes and lists', async () => {
  const { page } = ctx;
  const card = page.locator('.card-directive', { hasText: 'include' });
  const frame = card.frameLocator('iframe.card-preview:not(.card-preview-next)');
  await expect(frame.locator('p').first()).toHaveText('Shared intro paragraph.');
  await expect(frame.locator('.admonition')).toContainText('Shared note.');
  await expect(frame.locator('li')).toHaveText(['One', 'Two']);
  // Not the page's own blocks after it.
  await expect(frame.getByText('After the include.')).toHaveCount(0);
});
