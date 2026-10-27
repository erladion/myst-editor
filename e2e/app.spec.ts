// End-to-end tests: drive the built app like a writer and check the files on disk.
import { expect, test, type Page } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;

test.beforeEach(async () => {
  ctx = await launch();
});

test.afterEach(async () => {
  // Quit without the unsaved-changes prompt, which some tests leave open on purpose.
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const file = (rel: string) => readFileSync(join(ctx.project, 'docs', rel), 'utf8');
const original = (rel: string) => readFileSync(join(import.meta.dirname, 'fixture', 'docs', rel), 'utf8');

// Lines removed from / added to the original fixture file.
function changes(rel: string) {
  const before = original(rel).split('\n');
  const after = file(rel).split('\n');
  return { removed: before.filter((l) => !after.includes(l)), added: after.filter((l) => !before.includes(l)) };
}

async function waitForSave(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

async function clickEndOf(page: Page, text: string) {
  await page.locator('.prose').getByText(text, { exact: false }).first().click();
  await page.keyboard.press('End');
}

async function openPage(page: Page, title: string) {
  const folder = page.getByRole('button', { name: 'guide' });
  if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click();
  await page.getByRole('button', { name: title }).click();
  await expect(page.locator('.prose h1')).toHaveText(title);
}

test('renders a Sphinx page as formatted content', async () => {
  const { page } = ctx;
  await expect(page.locator('.prose h1')).toHaveText('Widget documentation');
  await expect(page.locator('.directive-note .directive-kind')).toHaveValue('note');
  await expect(page.locator('.toc-entries a')).toHaveText(['Installing Widget', 'Configuring Widget']);
  await expect(page.locator('.role-ref').first()).toHaveText(/Installing Widget/);
  await expect(page.locator('.math-block .katex-display')).toBeVisible();
  await expect(page.locator('.inline-math .katex')).toBeVisible();
  const img = page.locator('.directive-figure img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.card-directive .card-label')).toHaveText('company-callout');
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  // Nothing is written just by opening a page.
  expect(file('index.md')).toBe(original('index.md'));
});

test('typing in a callout saves only that line', async () => {
  const { page } = ctx;
  await clickEndOf(page, 'Widgets require Python');
  await page.keyboard.type(' Python 3.12 is recommended.');
  await waitForSave(page);
  expect(changes('index.md')).toEqual({
    removed: ['Widgets require Python 3.10 or newer.'],
    added: ['Widgets require Python 3.10 or newer. Python 3.12 is recommended.'],
  });
});

test('inserting a callout from the menu', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Warning' }).click();
  await page.keyboard.type('Back up your settings first.');
  await waitForSave(page);
  expect(file('guide/install.md')).toBe(original('guide/install.md') + '\n:::{warning}\nBack up your settings first.\n:::\n');
});

test('the standard directives are in the Insert menu', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  const insert = async (name: string) => {
    await page.getByRole('button', { name: 'Insert ▾' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await clickEndOf(page, 'Settings live in');
  await insert('Raw HTML');
  await page.keyboard.type('<br>');
  await insert('Table of contents');
  await expect(page.locator('.prose .card').filter({ hasText: 'Table of contents' })).toBeVisible();
  // One that needs its argument asks for it.
  await insert('New in version…');
  const dialog = page.getByRole('dialog', { name: 'New in version' });
  await dialog.getByLabel('Version').fill('2.1');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await page.keyboard.type('Settings can be reloaded.');
  // And a callout inside it, which gets the longer fence.
  await insert('Hint');
  await page.keyboard.type('Ctrl+R');
  await waitForSave(page);
  expect(file('guide/install.md')).toBe(
    original('guide/install.md') +
      '\n:::{raw} html\n<br>\n:::\n\n:::{toctree}\n:maxdepth: 2\n:::\n\n' +
      '::::{versionadded} 2.1\nSettings can be reloaded.\n\n:::{hint}\nCtrl+R\n:::\n::::\n',
  );
});

test('a figure gets a name to refer to it by, which its card can change', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Figure…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert figure' });
  await dialog.getByLabel('Image file').fill('images/parts.png');
  await dialog.getByLabel('Caption').fill('How the parts fit together');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  // Named from the caption, when no name is given.
  expect(file('guide/install.md')).toContain(':name: fig-how-the-parts-fit-together\n');
  await page.getByRole('button', { name: '#fig-how-the-parts-fit-together' }).click();
  const naming = page.getByRole('dialog', { name: 'Name of the figure' });
  await naming.getByLabel('Name').fill('fig-parts');
  await naming.getByRole('button', { name: 'Save' }).click();
  await waitForSave(page);
  expect(file('guide/install.md')).toContain(':name: fig-parts\n');
  expect(file('guide/install.md')).not.toContain('fig-how-the-parts');
  // The cross-reference dialog says figures can be referred to by it.
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Cross-reference…' }).click();
  await expect(page.getByRole('dialog', { name: 'Insert cross-reference' })).toContainText('A section, figure or table (by its name)');
});

test('shortcuts for headings, lists and inserting, all listed in Help', async () => {
  const { page, app } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Before you start');
  await page.keyboard.press('Control+Alt+2');
  await page.keyboard.press('Enter');
  // A heading made normal text again, as in Word.
  await page.keyboard.type('Just text');
  await page.keyboard.press('Control+Alt+3');
  await page.keyboard.press('Control+Shift+N');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+L');
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // out of the list, and a new one (another marker, so it stays apart)
  await page.keyboard.press('Control+Shift+8');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Alt+N');
  await page.keyboard.type('Noted.');
  await waitForSave(page);
  expect(file('guide/install.md')).toBe(original('guide/install.md') + '\n## Before you start\n\nJust text\n\n- First\n\n* Second\n\n:::{note}\nNoted.\n:::\n');
  // Those with a dialog open it.
  await page.keyboard.press('Control+Shift+K');
  await expect(page.getByRole('dialog', { name: 'Insert cross-reference' })).toBeVisible();
  await page.keyboard.press('Escape');
  // The Insert menu shows them, and Help lists them all.
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await expect(page.getByRole('menuitem', { name: /^Figure…/ })).toContainText('Ctrl+Shift+G');
  await page.keyboard.press('Escape');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('shortcuts')!.click());
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help.getByRole('row', { name: 'Callout (note) Ctrl+Alt+N' })).toBeVisible();
  await expect(help.getByRole('row', { name: 'Normal text Ctrl+Shift+N, Ctrl+Alt+0' })).toBeVisible();
  await expect(help.getByRole('row', { name: 'Heading Ctrl+Alt+2' })).toBeVisible();
});

test('referring to an image adds a link target before it, once', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Image…' }).click();
  const image = page.getByRole('dialog', { name: 'Insert image' });
  await image.getByLabel('Image file').fill('images/settings.png');
  await image.getByLabel('Description').fill('The settings dialog');
  await image.getByRole('button', { name: 'Insert' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('See ');
  const refer = async () => {
    await page.keyboard.press('Control+Shift+K');
    const dialog = page.getByRole('dialog', { name: 'Insert cross-reference' });
    await dialog.getByLabel('Refers to').selectOption('page');
    return dialog;
  };
  let dialog = await refer();
  const suggestion = (label: string) => dialog.locator('datalist option[value="img-the-settings-dialog"]', { hasText: label });
  await expect(suggestion('Image: The settings dialog (gets a name)')).toHaveCount(1);
  await dialog.getByLabel('Target').fill('img-the-settings-dialog');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await page.keyboard.type(' and ');
  dialog = await refer();
  await expect(dialog.locator('datalist option[value="img-the-settings-dialog"]')).toHaveText('Image: The settings dialog'); // it has a target now
  await dialog.getByLabel('Target').fill('img-the-settings-dialog');
  await dialog.getByLabel('Link text').fill('the dialog');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  expect(file('guide/install.md')).toBe(
    original('guide/install.md') +
      '\n(img-the-settings-dialog)=\n![The settings dialog](images/settings.png)\n\nSee {ref}`The settings dialog <img-the-settings-dialog>` and {ref}`the dialog <img-the-settings-dialog>`\n',
  );
});

test('referring to a figure without a name gives it one', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Figure…' }).click();
  const figure = page.getByRole('dialog', { name: 'Insert figure' });
  await figure.getByLabel('Image file').fill('images/flow.png');
  await figure.getByLabel('Caption').fill('How it flows');
  await figure.getByLabel('Name').fill('');
  await figure.getByRole('button', { name: 'Insert' }).click();
  // Its name taken out, as if it never had one.
  await page.getByRole('button', { name: '#fig-how-it-flows' }).click();
  const naming = page.getByRole('dialog', { name: 'Name of the figure' });
  await naming.getByLabel('Name').fill('');
  await naming.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: '# Name' })).toBeVisible();

  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' See ');
  await page.keyboard.press('Control+Shift+K');
  const dialog = page.getByRole('dialog', { name: 'Insert cross-reference' });
  await dialog.getByLabel('Refers to').selectOption('page');
  await expect(dialog.locator('datalist option[value="fig-how-it-flows"]')).toHaveText('Figure: How it flows (gets a name)');
  await dialog.getByLabel('Target').fill('fig-how-it-flows');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  // Named, and referred to by it: its caption is the link's text.
  expect(file('guide/install.md')).toContain('See {ref}`fig-how-it-flows`');
  expect(file('guide/install.md')).toContain(':name: fig-how-it-flows\n');
  await expect(page.getByRole('button', { name: '#fig-how-it-flows' })).toBeVisible();
});

test('referring to a figure on another page names it there', async () => {
  const { page } = ctx;
  // A figure without a name on another page, as it was written.
  appendFileSync(join(ctx.project, 'docs', 'guide', 'configure.md'), '\n:::{figure} ../images/diagram.svg\nThe settings screen\n:::\n');
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' See ');
  await page.keyboard.press('Control+Shift+K');
  const dialog = page.getByRole('dialog', { name: 'Insert cross-reference' });
  await dialog.getByLabel('Refers to').selectOption('page');
  await expect(dialog.locator('datalist option[value="fig-the-settings-screen"]')).toHaveText('Figure: The settings screen — Configuring Widget (gets a name)');
  await dialog.getByLabel('Target').fill('fig-the-settings-screen');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  expect(file('guide/install.md')).toContain('See {ref}`fig-the-settings-screen`');
  await expect.poll(() => file('guide/configure.md')).toContain(':::{figure} ../images/diagram.svg\n:name: fig-the-settings-screen\n\nThe settings screen\n:::\n');
});

test('referring to an anchor before a paragraph, on another page', async () => {
  const { page } = ctx;
  // A link target before a paragraph: Sphinx gives a link to it no title, and doesn't list it.
  appendFileSync(join(ctx.project, 'docs', 'guide', 'configure.md'), '\n(before-you-start)=\nCheck the license file is in place before anything else.\n');
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' See ');
  await page.keyboard.press('Control+Shift+K');
  const dialog = page.getByRole('dialog', { name: 'Insert cross-reference' });
  await dialog.getByLabel('Refers to').selectOption('anchor');
  await expect(dialog.locator('datalist option[value="before-you-start"]')).toHaveText('Check the license file is in place before anything else. — Configuring Widget');
  await dialog.getByLabel('Target').fill('before-you-start');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  // With words of its own: the anchor's name, as words.
  expect(file('guide/install.md')).toContain('See {ref}`before you start <before-you-start>`');
});

test('inserting an image, and a link target for a heading', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' See ');
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Image…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image' });
  await expect(dialog.getByRole('button', { name: 'Choose…' })).toBeVisible();
  await dialog.getByLabel('Image file').fill('../images/diagram.svg');
  await dialog.getByLabel('Description').fill('The flow');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(page.locator('.prose img[alt="The flow"]')).toBeVisible();
  await waitForSave(page);
  expect(changes('guide/install.md')).toEqual({
    removed: ['Settings live in `widget.toml`.'],
    added: ['Settings live in `widget.toml`. See ![The flow](../images/diagram.svg)'],
  });

  // A target for the page's heading, labelled from its title.
  await page.locator('.prose h1').click();
  await page.getByRole('button', { name: 'Insert ▾' }).click();
  await page.getByRole('menuitem', { name: 'Link target…' }).click();
  const target = page.getByRole('dialog', { name: 'Insert link target' });
  await expect(target.getByLabel('Label')).toHaveValue('installing-widget');
  await target.getByRole('button', { name: 'Insert' }).click();
  await waitForSave(page);
  expect(file('guide/install.md').startsWith('(installing-widget)=\n# Installing Widget\n')).toBe(true);
});

test('bold and italic from the keyboard and Markdown shortcuts', async () => {
  const { page } = ctx;
  await openPage(page, 'Installing Widget');
  await clickEndOf(page, 'Settings live in');
  await page.keyboard.type(' Keep it ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('short');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' and *simple* now.');
  await waitForSave(page);
  expect(changes('guide/install.md')).toEqual({
    removed: ['Settings live in `widget.toml`.'],
    added: ['Settings live in `widget.toml`. Keep it **short** and *simple* now.'],
  });
});

test('changing a callout type rewrites only its header', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  await page.locator('.directive-kind').selectOption('tip');
  await waitForSave(page);
  expect(changes('guide/configure.md')).toEqual({ removed: [':::{warning}'], added: [':::{tip}'] });
});

test('table of contents entries open their page', async () => {
  const { page } = ctx;
  await page.locator('.toc-entries a', { hasText: 'Configuring Widget' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Configuring Widget');
  await expect(page.locator('.page.current')).toHaveText('Configuring Widget');
});

test('editing the Markdown source directly, with a live preview', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  await page.getByRole('button', { name: 'Markdown' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source' });
  await expect(source).toContainText('# Configuring Widget');
  // The formatting toolbar gives way to the Markdown view's bar.
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);

  await source.click();
  await page.keyboard.press('Control+End');
  // Spacing the formatted editor would tidy up is saved exactly as typed. (No final
  // Enter: in a list, the Markdown editor would start the next item.)
  await page.keyboard.type('\n*   Restarting   takes a few seconds.');
  await expect(page.locator('.live-preview li')).toHaveText('Restarting takes a few seconds.');
  await waitForSave(page);
  expect(file('guide/configure.md')).toBe(original('guide/configure.md') + '\n*   Restarting   takes a few seconds.');

  // Clicking a block in the preview goes to its source.
  await page.locator('.live-preview h1').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('# Configuring Widget');

  // Back to formatted editing (Ctrl+/), with the edit in place.
  await page.keyboard.press('Control+/');
  await expect(page.locator('.live-preview')).toHaveCount(0);
  await expect(page.locator('.prose li')).toHaveText('Restarting takes a few seconds.');
  // Ctrl+/ switched views; it didn't comment out a line.
  expect(file('guide/configure.md')).not.toContain('<!--');
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
});

test('reloads a page changed on disk', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  writeFileSync(join(ctx.project, 'docs', 'guide', 'configure.md'), '# Configuring Widget\n\nChanged in another editor.\n');
  await expect(page.locator('.prose')).toContainText('Changed in another editor.');
});

test('refuses to silently save a change that would not read back', async () => {
  const { page } = ctx;
  await openPage(page, 'Configuring Widget');
  // A hard line break inside a heading can't be written in Markdown.
  await page.locator('.prose h1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('subtitle');
  await expect(page.locator('.banner.warning')).toContainText('can’t be saved safely');
  await page.waitForTimeout(1500);
  expect(file('guide/configure.md')).toBe(original('guide/configure.md'));
});
