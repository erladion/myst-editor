// An Antora component: pages in modules, contents from its navigation file, resource
// IDs for cross-references, pictures and includes; built with Asciidoctor as Antora
// would build it.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-antora' });
  // Its start page first.
  await expect(ctx.page.locator('.prose h1')).toHaveText('Welcome');
  await expect(ctx.page.locator('.chip-button', { hasText: /Built in/ })).toBeVisible({ timeout: 30_000 });
});
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const file = (rel: string) => readFileSync(join(ctx.project, rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture-antora', rel), 'utf8');
const NAV = 'modules/ROOT/nav.adoc';

test('its contents are its navigation, its references resource IDs', async () => {
  const { page } = ctx;
  // The navigation, its heading, and the page it doesn't list.
  await expect(page.locator('.sidebar .page')).toContainText(['The Shop', 'Welcome', 'Installing', 'Reference', 'Not in the navigation']);
  await page.getByRole('button', { name: 'Show the pages in Reference' }).click();
  await expect(page.getByRole('button', { name: 'Users', exact: true })).toBeVisible();
  // {product} from antora.yml; xrefs from the module's pages, to another module's.
  await expect(page.locator('.prose .role-value')).toHaveText('ShopKeeper');
  await expect(page.locator('.role-ref', { hasText: 'the roles' })).not.toHaveClass(/role-broken/);
  await page.getByRole('button', { name: 'Installing', exact: true }).click();
  await expect(page.locator('.prose h1')).toHaveText('Installing');
  await expect(page.locator('.role-ref', { hasText: 'Linux' })).not.toHaveClass(/role-broken/);
  await expect(page.locator('.role-ref', { hasText: 'nowhere' })).toHaveClass(/role-broken/);
  // Built: the example included, the start page's picture and partial.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('iframe.preview-frame, .preview iframe').first();
  await expect(preview.locator('pre')).toHaveText('curl example.com | sh');
  await page.getByRole('button', { name: 'Welcome', exact: true }).click();
  await expect(preview.locator('h1')).toHaveText('Welcome');
  await expect(preview.locator('.admonitionblock')).toContainText('Ask us anything.');
  await expect(preview.locator('a', { hasText: 'the roles' })).toHaveAttribute('href', '../../admin/pages/users.html#roles');
  await expect.poll(() => preview.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // In the editor too, from the module's images.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(() => page.locator('.prose img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // Ctrl+click: the page in the other module.
  await page.locator('.role-ref', { hasText: 'the roles' }).click({ modifiers: ['Control'] });
  await expect(page.locator('.prose h1')).toHaveText('Users');
});

test('moving a page moves its item in the navigation, with the pages under it', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Installing', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect.poll(() => file(NAV)).toBe('* xref:index.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[]\n');
  // A page it didn't list, dragged in under the heading.
  const row = (title: string) => page.locator('.toc-row', { has: page.getByRole('button', { name: title, exact: true }) });
  await row('Not in the navigation').dragTo(row('Reference'), { targetPosition: { x: 60, y: 14 } });
  await expect.poll(() => file(NAV)).toBe('* xref:index.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n** xref:unlisted.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[]\n');
});

test('a new page goes into the navigation; a renamed one is referred to by its new name', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title').fill('Upgrading');
  await expect(dialog).toContainText('Saved as modules/ROOT/pages/upgrading.adoc');
  await expect(dialog.getByLabel('Add to the table of contents of')).toHaveValue(NAV);
  await dialog.getByRole('button', { name: 'Create page' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Upgrading');
  await expect.poll(() => file(NAV)).toBe(`${original(NAV)}* xref:upgrading.adoc[]\n`);

  await page.getByRole('button', { name: 'Installing', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename or move…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename page' });
  await rename.getByLabel('Title').fill('Setting up');
  await rename.getByLabel('Folder').selectOption('modules/ROOT/pages/topic');
  await rename.getByRole('button', { name: 'From the title' }).click();
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Setting up');
  // Its xrefs are from the module's pages: they stay as they were.
  await expect.poll(() => file('modules/ROOT/pages/topic/setting-up.adoc')).toBe(original('modules/ROOT/pages/install.adoc').replace('= Installing', '= Setting up'));
  await expect.poll(() => file(NAV)).toContain('* xref:topic/setting-up.adoc[]\n');
  expect(file('modules/ROOT/pages/index.adoc')).toContain('See xref:topic/setting-up.adoc[] and');
  expect(file('modules/ROOT/pages/topic/linux.adoc')).toContain('Back to xref:topic/setting-up.adoc[installing].');
});

test('cross-references are offered by resource ID', async () => {
  const { page } = ctx;
  await page.getByRole('button', { name: 'Installing', exact: true }).click();
  await page.locator('.prose p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+K');
  const dialog = page.getByRole('dialog', { name: 'Insert cross-reference' });
  await dialog.getByLabel('Refers to').selectOption('page');
  // From the module's pages, and another module's with its name.
  await expect(dialog.locator('datalist option[value="admin:users.adoc"]')).toHaveCount(1);
  await expect(dialog.locator('datalist option[value="index.adoc"]')).toHaveCount(1);
  await dialog.getByLabel('Target').fill('admin:users.adoc');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => file('modules/ROOT/pages/install.adoc')).toContain('xref:nowhere.adoc[nowhere].xref:admin:users.adoc[]'.replace('nowhere.adoc', 'missing.adoc'));
});
