// File → Project Settings: turning conditional content on and off, and its settings,
// written into the project's .mysteditor.toml.
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const page = () => ctx.page;
const toml = () => readFileSync(join(ctx.project, 'docs', '.mysteditor.toml'), 'utf8');

async function openSettings() {
  await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('project-settings')!.click());
  return page().getByRole('dialog', { name: 'Project settings' });
}

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('turns conditional content off and on, keeping its settings', async () => {
  ctx = await launch({ fixture: 'fixture-ext' });
  await page().getByRole('button', { name: 'Not now' }).click();
  const original = toml();
  const pageText = readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
  await expect(page().locator('.cond-start').first()).toBeVisible();

  let dialog = await openSettings();
  await expect(dialog).toContainText('Saved in docs/.mysteditor.toml, so they apply to everyone');
  await expect(dialog.getByRole('checkbox', { name: 'Conditional content' })).toBeChecked();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('capabilities.json');
  await expect(dialog.getByLabel('Where the list is in the file')).toHaveValue('product.capabilities');
  await expect(dialog).toContainText('3 capabilities: CapabilityX, CapabilityY, CapabilityZ');
  await page().screenshot({ path: test.info().outputPath('settings.png') });
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).uncheck();
  await expect(dialog.getByLabel('Capabilities file')).toBeHidden();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Off: the markers are plain comments again, and the tools for them are gone.
  expect(toml()).toBe(original.replace('key = "product.capabilities"\n', 'key = "product.capabilities"\nenabled = false\n'));
  await expect(page().locator('.cond-start')).toHaveCount(0);
  await page().locator('.prose').getByText('Closing words.').click();
  await expect(page().getByRole('button', { name: 'Condition…' })).toHaveCount(0);

  dialog = await openSettings();
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).check();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('capabilities.json');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(toml()).toBe(original);
  await expect(page().locator('.cond-start').first()).toBeVisible();
  expect(readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8')).toBe(pageText);
});

test('changes the markers and colours', async () => {
  ctx = await launch({ fixture: 'fixture-ext' });
  await page().getByRole('button', { name: 'Not now' }).click();
  const original = toml();
  const z = page().locator('.cond-start').nth(1);
  const colour = () => z.evaluate((e) => getComputedStyle(e).color);
  const before = await colour();

  const dialog = await openSettings();
  await expect(dialog.getByLabel('Colour of CapabilityZ')).toHaveValue('');
  await dialog.getByLabel('Colour of CapabilityZ').selectOption('olive');
  await dialog.getByLabel('Blocks: start').fill('only');
  await expect(dialog.getByText('<!-- only: X -->')).toBeVisible();
  await dialog.getByLabel('Blocks: start').fill('if');
  await dialog.getByLabel('In a line: end').fill('if');
  await expect(dialog.getByText('Each marker needs its own keyword')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('In a line: end').fill('endif-inline');
  await dialog.getByRole('checkbox', { name: 'Capability names are case sensitive' }).uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  expect(toml()).toBe(
    original.replace('key = "product.capabilities"\n', 'key = "product.capabilities"\ncase_sensitive = false\n').replace('\n[tables]', '\n[conditions.colors]\nCapabilityZ = "olive"\n\n[tables]'),
  );
  await expect.poll(colour).not.toBe(before);
});

test('sets up conditional content in a project without settings', async () => {
  ctx = await launch();
  await page().getByRole('button', { name: 'Not now' }).click();
  const settings = join(ctx.project, 'docs', '.mysteditor.toml');
  const caps = join(ctx.project, 'docs', 'products.json');
  // The file dialog, answered.
  await ctx.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, caps);

  const dialog = await openSettings();
  await expect(dialog).toContainText('Saved in docs/.mysteditor.toml (a new file)');
  await expect(dialog.getByRole('checkbox', { name: 'Conditional content' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Conditional content' }).check();
  await dialog.getByRole('button', { name: 'New…' }).click();
  await expect(dialog.getByLabel('Capabilities file')).toHaveValue('products.json');
  await expect(dialog).toContainText('No capabilities in it yet');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(readFileSync(settings, 'utf8')).toBe('[conditions]\ncapabilities = "products.json"\n');
  expect(readFileSync(caps, 'utf8')).toBe('{\n  "capabilities": []\n}\n');

  // Now the toolbar offers conditions, and new capabilities go into the new file.
  await page().locator('.prose p').first().click();
  await page().getByRole('button', { name: 'Condition…' }).click();
  const cond = page().getByRole('dialog', { name: /condition/i });
  await cond.getByRole('button', { name: 'New capability…' }).click();
  await cond.getByLabel('New capability').fill('Cloud');
  await cond.getByLabel('New capability').press('Enter');
  await expect.poll(() => readFileSync(caps, 'utf8')).toBe('{\n  "capabilities": [\n    "Cloud"\n  ]\n}\n');
  expect(existsSync(settings)).toBe(true);
});

test('sets up the PDF: paper, cover, headers and footers', async () => {
  ctx = await launch({ fixture: 'fixture-showcase' });
  await page().getByRole('button', { name: 'Not now' }).click();
  const settings = join(ctx.project, 'docs', '.mysteditor.toml');
  // The file dialog, answered with each of these in turn.
  const pick = (name: string) =>
    ctx.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
    }, join(ctx.project, 'docs', '_static', name));

  const dialog = await openSettings();
  const show = (pane: string) => dialog.getByRole('tab', { name: pane }).click();
  await expect(dialog.getByRole('tab', { name: 'Conditional content' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Paper')).toBeHidden();
  await show('Headers and footers');
  await expect(dialog.getByLabel('Footer centre')).toHaveValue('{page}');
  await expect(dialog.getByLabel('Header right')).toHaveValue('{chapter}');
  await expect(dialog.getByRole('region', { name: 'PDF headers and footers' })).toContainText('{chapter}The title of the chapter the page is in');
  await show('Pages');
  await expect(dialog.getByLabel('Paper')).toHaveValue('A4');
  await dialog.getByLabel('Paper').selectOption('Letter');
  await show('Cover');
  // The cover's texts can't have page numbers: not offered there.
  await expect(dialog.getByRole('region', { name: 'PDF cover' })).toContainText('{version}The version: release in conf.py');
  await expect(dialog.getByRole('region', { name: 'PDF cover' })).not.toContainText('{page}');
  await pick('harbor-logo.svg');
  await dialog.getByRole('button', { name: 'Choose the logo' }).click();
  await expect(dialog.getByLabel('Logo', { exact: true })).toHaveValue('_static/harbor-logo.svg');
  await pick('cover.svg');
  await dialog.getByRole('button', { name: 'Choose the background' }).click();
  await expect(dialog.getByLabel('Background', { exact: true })).toHaveValue('_static/cover.svg');
  await dialog.getByLabel('Text colour').fill('#ffffff');
  await dialog.getByLabel('Title', { exact: true }).fill('Harbor manual');
  await dialog.getByLabel('At the foot').fill('© Harbor Labs');

  // A graphic: added at the top left, then dragged on the cover, then moved by a
  // number.
  await pick('badge.svg');
  await dialog.getByRole('button', { name: 'Add a graphic…' }).click();
  await expect(dialog.getByLabel('Graphic 1 x')).toHaveValue('20');
  const graphic = dialog.getByRole('img', { name: 'Graphic 1' });
  await expect(graphic).toBeVisible();
  await dialog.getByLabel('The cover', { exact: true }).scrollIntoViewIfNeeded();
  const box = (await graphic.boundingBox())!;
  const cover = (await dialog.getByLabel('The cover', { exact: true }).boundingBox())!;
  const mm = cover.width / 215.9; // Letter
  await page().mouse.move(box.x + 5, box.y + 5);
  await page().mouse.down();
  await page().mouse.move(box.x + 5 + 100 * mm, box.y + 5 + 150 * mm, { steps: 6 });
  await page().mouse.up();
  await expect(dialog.getByLabel('Graphic 1 x')).toHaveValue('120');
  await expect(dialog.getByLabel('Graphic 1 y')).toHaveValue('172');
  await graphic.press('ArrowLeft');
  await expect(dialog.getByLabel('Graphic 1 x')).toHaveValue('119');
  await dialog.getByLabel('Graphic 1 width').fill('35');

  // The title, dragged down 30 mm from its usual place; then made larger and centred.
  await expect(dialog.getByText('The usual place: drag it on the cover to move it')).toHaveCount(4);
  const title = (await dialog.getByLabel('The title', { exact: true }).boundingBox())!;
  await page().mouse.move(title.x + 10, title.y + 5);
  await page().mouse.down();
  await page().mouse.move(title.x + 10, title.y + 5 + 30 * mm, { steps: 6 });
  await page().mouse.up();
  await expect(dialog.getByLabel('Title x')).toHaveValue('20');
  const y = Number(await dialog.getByLabel('Title y').inputValue());
  await dialog.getByLabel('Title size').fill('36');
  await dialog.getByLabel('Title alignment').selectOption('center');
  // The logo moved by keys, then back where it was.
  await dialog.getByLabel('The logo', { exact: true }).press('ArrowRight');
  await expect(dialog.getByLabel('Logo x')).toHaveValue('21');
  await dialog.getByRole('button', { name: 'Put the logo back in its usual place' }).click();
  await expect(dialog.getByText('The usual place: drag it on the cover to move it')).toHaveCount(3);

  // Fonts: a file from the project, then its family for the text (and so the headings).
  await show('Fonts');
  await pick('fonts/KaTeX_SansSerif-Regular.ttf');
  await dialog.getByRole('button', { name: 'Add a font file…' }).click();
  await expect(dialog.locator('.pdf-font-file')).toContainText('_static/fonts/KaTeX_SansSerif-Regular.ttfKaTeX_SansSerif Regular');
  await dialog.getByLabel('Text', { exact: true }).fill('KaTeX_SansSerif');
  await expect(dialog.locator('.font-sample').first()).toHaveCSS('font-family', /KaTeX_SansSerif/);
  // The project's copy (the window has KaTeX's own for math, declared before it).
  const projectCopy = () =>
    page().evaluate(async () => {
      await document.fonts.load('16px KaTeX_SansSerif');
      return [...document.fonts].filter((f) => f.family === 'KaTeX_SansSerif').at(-1)?.status;
    });
  await expect.poll(projectCopy).toBe('loaded');
  await expect(dialog.locator('.font-sample').nth(1)).toHaveCSS('font-family', /KaTeX_SansSerif/);
  await dialog.getByLabel('Code', { exact: true }).fill('No Such Font');
  await expect(dialog.getByText('not found: the usual font is used instead')).toBeVisible();
  await dialog.getByLabel('Code', { exact: true }).fill('');

  await show('Headers and footers');
  await dialog.getByLabel('Header left').fill('{logo}');
  await dialog.getByLabel('Footer centre').fill('');
  await dialog.getByLabel('Footer right').fill('Page {page} of {pages}');
  await dialog.getByLabel('Show them on').selectOption('not-cover');
  await expect(dialog.getByText('slots with {page} or {pages} are left empty there')).toBeVisible();
  await show('Pages');
  await dialog.getByLabel('Page numbers').selectOption('cover');
  await dialog.getByLabel('Levels in the contents').selectOption('1');
  await show('Cover');
  await dialog.screenshot({ path: test.info().outputPath('cover.png') });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(readFileSync(settings, 'utf8')).toBe(
    '[pdf]\npaper = "Letter"\nlogo = "_static/harbor-logo.svg"\ntitle = "Harbor manual"\nnote = "© Harbor Labs"\ncover_background = "_static/cover.svg"\ncover_color = "#ffffff"\n' +
      'cover_images = [\n  { file = "_static/badge.svg", x = 119, y = 172, width = 35 },\n]\n' +
      'font = "KaTeX_SansSerif"\nfonts = ["_static/fonts/KaTeX_SansSerif-Regular.ttf"]\n' +
      'header = ["{logo}", "", "{chapter}"]\nfooter = ["", "", "Page {page} of {pages}"]\nheaders_on = "not-cover"\nnumbering = "cover"\ntoc_depth = 1\n' +
      `\n[pdf.cover.title]\nx = 20\ny = ${y}\nsize = 36\nalign = "center"\n`,
  );

  // Read back as saved; taking the graphic out takes the setting out.
  const again = await openSettings();
  await again.getByRole('tab', { name: 'Pages' }).click();
  await expect(again.getByLabel('Paper')).toHaveValue('Letter');
  await again.getByRole('tab', { name: 'Headers and footers' }).click();
  await expect(again.getByLabel('Footer right')).toHaveValue('Page {page} of {pages}');
  await again.getByRole('tab', { name: 'Cover' }).click();
  await expect(again.getByLabel('Graphic 1 y')).toHaveValue('172');
  await again.getByRole('button', { name: 'Remove graphic 1' }).click();
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(again).toBeHidden();
  expect(readFileSync(settings, 'utf8')).not.toContain('cover_images');
});
