// AsciiDoc blocks shown as what they say and edited in forms: the document header,
// attribute lines, tables of values and tables in cells, a video, and a description
// that's a list.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

const PAGE = `= Cards
Doc Writer <doc@example.com>
:toc:
:description: The cards

.Parts of an atom
[square#atoms]
* Proton
* Neutron

See <<atoms>>.

,===
Artist,Track

Baauer,Harlem Shake
,===

[cols="1,2a"]
|===
|Outer
|
!===
! Inner ! cell
!===
|===

.A walkthrough
video::RvRhUHTV_8k[youtube]

Dairy::
* Milk
* Eggs
`;

let ctx: App;
const file = () => readFileSync(join(ctx.project, 'cards.adoc'), 'utf8');
test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-adoc', prepare: (project) => writeFileSync(join(project, 'cards.adoc'), PAGE) });
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
  await expect(page.locator('.card-document-header table.attribute-entries th')).toHaveText(['Author', 'toc', 'description']);
  await expect(page.locator('.card-block-attributes .chip')).toHaveText(['Title: Parts of an atom', 'Square bullets', 'Id: atoms']);
  await expect(page.locator('.prose table:not(.field-list)').first().locator('th')).toHaveText(['Artist', 'Track']);
  await expect(page.locator('.prose td table td')).toHaveText(['Inner', 'cell']);
  await expect(page.locator('.card-media')).toContainText('A video on YouTube: RvRhUHTV_8k');
  await expect(page.locator('.prose dd li')).toHaveText(['Milk', 'Eggs']);
  expect(file()).toBe(PAGE);
});

test('edits them in their forms, and in place', async () => {
  const { page } = ctx;
  // The header: an attribute removed, another added.
  await page.locator('.card-document-header').dblclick();
  let dialog = page.getByRole('dialog', { name: 'Document header' });
  await dialog.getByRole('button', { name: 'Remove toc' }).click();
  await dialog.getByLabel('Another attribute').fill('sectnums');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('Doc Writer <doc@example.com>\n:description: The cards\n:sectnums:\n');

  // The list's attribute lines: another title.
  await page.locator('.card-block-attributes').dblclick();
  dialog = page.getByRole('dialog', { name: 'Block attributes' });
  await dialog.getByLabel('Title').fill('Particles');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(file()).toContain('.Particles\n[square#atoms]\n');

  // A value in the table of values, one in the table in a cell, an item of the description's list.
  await page.locator('.prose td').getByText('Harlem Shake').click();
  await page.keyboard.press('End');
  await page.keyboard.type(', remix');
  await page.locator('.prose td table td').getByText('cell').click();
  await page.keyboard.press('End');
  await page.keyboard.type('s');
  await page.locator('.prose dd li').getByText('Eggs').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and cheese');
  await saved();
  expect(file()).toContain('Baauer,"Harlem Shake, remix"\n');
  expect(file()).toContain('! Inner ! cells\n');
  expect(file()).toContain('Dairy::\n* Milk\n* Eggs and cheese\n');
});
