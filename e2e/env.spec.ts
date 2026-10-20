// Environment variables for Sphinx builds: the project's, and the writer's own.
import { expect, test } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('builds with the project’s variables and the writer’s own, which win', async () => {
  ctx = await launch({
    prepare: (project) => {
      // conf.py leaves pages out depending on the environment.
      appendFileSync(
        join(project, 'docs', 'conf.py'),
        '\nimport os\nexclude_patterns = [p for p, v in [("guide/configure.md", "HIDE_CONFIGURE"), ("guide/install.md", "HIDE_INSTALL")] if os.environ.get(v) == "1"]\n',
      );
      writeFileSync(join(project, 'docs', '.mysteditor.toml'), '[sphinx.env]\nHIDE_CONFIGURE = "1"\n');
    },
  });
  const { page, project } = ctx;
  await page.getByRole('button', { name: 'Allow' }).click();
  const contents = page.locator('.tree .page');
  await expect(contents).toHaveText(['Widget documentation', 'Installing Widget'], { timeout: 180_000 });

  // The project's variable is listed; the writer overrides it and adds another.
  await page.locator('.chip-button', { hasText: /Built in/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Sphinx' });
  await expect(dialog.getByRole('region', { name: 'Environment variables' })).toContainText('HIDE_CONFIGURE1 (from .mysteditor.toml)');
  await dialog.getByRole('button', { name: 'Edit variables…' }).click();
  await dialog.getByRole('button', { name: 'Use another value' }).click();
  await dialog.getByLabel('Value').fill('0');
  await dialog.getByRole('button', { name: '+ Add a variable' }).click();
  await dialog.getByLabel('Name').nth(1).fill('HIDE INSTALL');
  await expect(dialog.getByRole('button', { name: 'Save and rebuild' })).toBeDisabled();
  await dialog.getByLabel('Name').nth(1).fill('HIDE_INSTALL');
  await dialog.getByLabel('Value').nth(1).fill('1');
  await dialog.getByRole('button', { name: 'Save and rebuild' }).click();
  await expect(dialog.getByRole('region', { name: 'Environment variables' })).toContainText('HIDE_CONFIGURE0 (yours, instead of the project’s)');
  await page.keyboard.press('Escape');

  await expect(contents).toHaveText(['Widget documentation', 'Configuring Widget'], { timeout: 60_000 });
  const settings = JSON.parse(readFileSync(join(dirname(project), 'user-data', 'settings.json'), 'utf8'));
  expect(Object.values(settings.sphinxEnv)).toEqual([{ HIDE_CONFIGURE: '0', HIDE_INSTALL: '1' }]);
});
