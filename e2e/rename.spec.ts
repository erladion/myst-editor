// Renaming or moving a page updates the links and tables of contents pointing to it.
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture', 'docs', rel), 'utf8');
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('renames and moves a page, and everything pointing to it follows', async () => {
  ctx = await launch({
    // A link to it from another page, and a picture of its own.
    prepare: (project) => {
      const configure = join(project, 'docs', 'guide', 'configure.md');
      writeFileSync(configure, readFileSync(configure, 'utf8') + '\nFirst [install it](install.md).\n');
      const install = join(project, 'docs', 'guide', 'install.md');
      writeFileSync(install, readFileSync(install, 'utf8') + '\n![](../images/diagram.svg)\n');
    },
  });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Installing Widget' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename or move…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Rename page' });
  await expect(dialog.getByLabel('Title')).toHaveValue('Installing Widget');
  await dialog.getByLabel('Title').fill('Setting up Widget');
  await dialog.getByLabel('Folder').selectOption('docs');
  await dialog.getByRole('button', { name: 'From the title' }).click();
  await expect(dialog).toContainText('Becomes docs/setting-up-widget.md');
  await dialog.getByRole('button', { name: 'Rename' }).click();

  await expect(page.locator('.prose h1')).toHaveText('Setting up Widget');
  await expect(page.getByRole('button', { name: 'Setting up Widget' })).toBeVisible(); // in the sidebar
  expect(existsSync(join(ctx.project, 'docs', 'guide', 'install.md'))).toBe(false);
  await expect.poll(() => file('setting-up-widget.md')).toContain('# Setting up Widget\n');
  expect(file('setting-up-widget.md')).toContain('![](images/diagram.svg)'); // its own picture, from its new folder
  await expect.poll(() => file('index.md')).toBe(original('index.md').replace('{doc}`guide/install`', '{doc}`setting-up-widget`').replace('guide/install\n', 'setting-up-widget\n'));
  expect(file('guide/configure.md')).toContain('First [install it](../setting-up-widget.md).');
});

test('changing only the title keeps the file, and the sidebar shows it', async () => {
  ctx = await launch();
  const { page } = ctx;
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Configuring Widget' }).click();
  await page.getByRole('button', { name: 'Configuring Widget' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename or move…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename page' });
  await dialog.getByLabel('Title').fill('Settings');
  await expect(dialog).toContainText('Stays docs/guide/configure.md');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => file('guide/configure.md')).toBe(original('guide/configure.md').replace('# Configuring Widget', '# Settings'));
});
