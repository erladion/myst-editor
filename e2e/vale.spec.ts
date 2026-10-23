// Vale's remarks, when it's installed and set up for the project (here a stand-in).
import { expect, test } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const stub = join(import.meta.dirname, 'vale-stub.mjs');

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

async function openInstall() {
  const { page } = ctx;
  await page.getByRole('button', { name: 'guide' }).click();
  await page.getByRole('button', { name: 'Installing Widget' }).click();
  await expect(page.locator('.prose h1')).toHaveText('Installing Widget');
}

test('Vale’s remarks are underlined, and a correction can be picked', async () => {
  ctx = await launch({
    env: { MYSTEDITOR_VALE: stub },
    prepare: (project) => {
      writeFileSync(join(project, '.vale.ini'), '[*.md]\nBasedOnStyles = Vale\n');
      appendFileSync(join(project, 'docs', 'guide', 'install.md'), '\nWe **utilize** the widgte here.\n');
    },
  });
  const { page } = ctx;
  await openInstall();
  await expect(page.locator('.prose .vale-warning')).toHaveText('utilize');
  await expect(page.locator('.prose .vale-error')).toHaveText('widgte');
  await expect(page.locator('.vale-chip')).toHaveText('Style: 2 remarks');

  // A click shows what Vale says, and its corrections.
  await page.locator('.prose .vale-error').click();
  const popup = page.getByRole('dialog', { name: 'Style check' });
  await expect(popup).toContainText("Did you really mean 'widgte'?");
  await popup.getByRole('button', { name: 'widget', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
  const file = () => readFileSync(join(ctx.project, 'docs', 'guide', 'install.md'), 'utf8');
  expect(file()).toContain('\nWe **utilize** the widget here.\n');
  await expect(page.locator('.vale-chip')).toHaveText('Style: 1 remark');

  // The status bar goes to the next one.
  await page.locator('.vale-chip').click();
  await expect(popup).toContainText("Use 'use' instead of 'utilize'.");
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);

  // In the Markdown view too, on the word.
  await page.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.locator('.cm-lintRange-warning')).toHaveText('utilize');
  // And still underlined back in the formatted view.
  await page.getByRole('button', { name: '← Formatted editing' }).click();
  await expect(page.locator('.prose .vale-warning')).toHaveText('utilize');
});

test('without a Vale configuration the editor is as before', async () => {
  ctx = await launch({ env: { MYSTEDITOR_VALE: stub }, prepare: (project) => appendFileSync(join(project, 'docs', 'guide', 'install.md'), '\nWe utilize it.\n') });
  const { page } = ctx;
  await openInstall();
  await expect(page.locator('.save-status')).toHaveText('All changes saved');
  // Time for a check to have come back.
  await page.waitForTimeout(1500);
  await expect(page.locator('.prose .vale')).toHaveCount(0);
  await expect(page.locator('.vale-chip')).toHaveCount(0);
});

test('a word Vale gets wrong can be accepted, into its vocabulary', async () => {
  ctx = await launch({
    env: { MYSTEDITOR_VALE: stub },
    prepare: (project) => {
      writeFileSync(join(project, '.vale.ini'), 'StylesPath = styles\n\n[*.md]\nBasedOnStyles = Vale\n');
      appendFileSync(join(project, 'docs', 'guide', 'install.md'), '\nWe utilize the widgte here.\n');
    },
  });
  const { page, project } = ctx;
  await openInstall();
  await expect(page.locator('.vale-chip')).toHaveText('Style: 2 remarks');
  await page.locator('.prose .vale-error').click();
  await page.getByRole('dialog', { name: 'Style check' }).getByRole('button', { name: 'Accept “widgte”' }).click();
  // No vocabulary yet: the configuration gets one, and the word goes in its list.
  await expect(page.locator('.toast')).toHaveText('“widgte” accepted: added to styles/config/vocabularies/Project/accept.txt (and Vocab = Project to .vale.ini).');
  expect(readFileSync(join(project, '.vale.ini'), 'utf8')).toBe('StylesPath = styles\n\nVocab = Project\n[*.md]\nBasedOnStyles = Vale\n');
  expect(readFileSync(join(project, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt'), 'utf8')).toBe('widgte\n');
  await expect(page.locator('.vale-chip')).toHaveText('Style: 1 remark');
  await expect(page.locator('.prose .vale-error')).toHaveCount(0);

  // From the Markdown view too; the list grows.
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.locator('.cm-lintRange-warning').hover();
  await page.getByRole('button', { name: 'Accept “utilize”' }).click();
  await expect(page.locator('.vale-chip')).toHaveText('Style: no remarks');
  expect(readFileSync(join(project, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt'), 'utf8')).toBe('widgte\nutilize\n');
});

test('hovering shows the remark, in dark mode too', async () => {
  ctx = await launch({
    env: { MYSTEDITOR_VALE: stub },
    prepare: (project) => {
      writeFileSync(join(project, '.vale.ini'), '[*.md]\nBasedOnStyles = Vale\n');
      appendFileSync(join(project, 'docs', 'guide', 'install.md'), '\nWe utilize the widgte here.\n');
    },
  });
  const { app, page } = ctx;
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('theme-dark')!.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openInstall();
  const dark = 'rgb(23, 25, 29)'; // --bg in dark mode
  const background = (l: ReturnType<typeof page.locator>) => l.evaluate((el) => getComputedStyle(el).backgroundColor);

  // The formatted view: on hover, and gone when the mouse leaves.
  await page.locator('.prose .vale-error').hover();
  const popup = page.getByRole('dialog', { name: 'Style check' });
  await expect(popup).toContainText("Did you really mean 'widgte'?");
  expect(await background(popup)).toBe(dark);
  await page.locator('.prose h1').hover();
  await expect(popup).toHaveCount(0);

  // The Markdown view's tooltip.
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.locator('.cm-lintRange-error').hover();
  const tooltip = page.locator('.cm-tooltip-lint');
  await expect(tooltip).toContainText("Did you really mean 'widgte'?");
  expect(await background(page.locator('.cm-tooltip', { has: tooltip }))).toBe(dark);
  expect(await background(tooltip.locator('.cm-diagnosticAction').first())).not.toBe('rgb(68, 68, 68)'); // CodeMirror's own
});
