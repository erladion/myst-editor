// Project settings (.mysteditor.toml): conditional content and declared directives.
import { expect, test } from '@playwright/test';
import { diffLines } from 'diff';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
const page = () => ctx.page;
const file = () => readFileSync(join(ctx.project, 'docs', 'index.md'), 'utf8');
const original = readFileSync(join(import.meta.dirname, 'fixture-ext', 'docs', 'index.md'), 'utf8');

// Lines removed from / added to the original page.
function changes() {
  const removed: string[] = [];
  const added: string[] = [];
  for (const part of diffLines(original, file())) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.removed) removed.push(...lines);
    if (part.added) added.push(...lines);
  }
  return { removed, added: added.filter((l) => l !== '') };
}

async function saved() {
  await expect(page().locator('.save-status')).toHaveText('All changes saved', { timeout: 10_000 });
}

test.beforeEach(async () => {
  ctx = await launch({ fixture: 'fixture-ext' });
  await page().getByRole('button', { name: 'Not now' }).click(); // no Sphinx needed here
});

test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('shows conditional content, nesting and inline conditions', async () => {
  await expect(page().locator('.cond-start').first()).toContainText(/Shown only when\s*CapabilityX or CapabilityY/);
  await expect(page().locator('.cond-start').nth(1)).toContainText('CapabilityZ');
  await expect(page().locator('.cond-in.cond-d1', { hasText: 'Only for X or Y.' })).toBeVisible();
  await expect(page().locator('.cond-in.cond-d2', { hasText: 'Nested for Z.' })).toBeVisible();
  await expect(page().locator('.cond-pill-start')).toHaveText('if CapabilityX');
  await expect(page().locator('.cond-inline')).toHaveText('fast');

  // Each condition has its own colour; a nested block shows a stripe of each.
  const color = (l: ReturnType<ReturnType<typeof page>['locator']>) => l.evaluate((e) => getComputedStyle(e).color);
  const [xOrY, z, inlineX] = await Promise.all([color(page().locator('.cond-start').first()), color(page().locator('.cond-start').nth(1)), color(page().locator('.cond-pill-start'))]);
  expect(new Set([xOrY, z, inlineX]).size).toBe(3);
  const stripes = await page().locator('.cond-in.cond-d2', { hasText: 'Nested for Z.' }).evaluate((e) => getComputedStyle(e, '::before').backgroundImage);
  expect(stripes).toContain(xOrY); // outer
  expect(stripes).toContain(z); // inner
  await page().screenshot({ path: test.info().outputPath('colours.png') });
  expect(file()).toBe(original);
});

test('makes a paragraph conditional, edits the condition, and removes it', async () => {
  await page().locator('.prose').getByText('Closing words.').click();
  await page().getByRole('button', { name: 'Condition…' }).click();
  const dialog = page().getByRole('dialog', { name: 'Make conditional' });
  await dialog.getByRole('checkbox', { name: 'CapabilityY' }).check();
  await dialog.getByRole('checkbox', { name: 'CapabilityZ' }).check();
  await expect(dialog.locator('#condition-help')).toHaveText(/Shown when CapabilityY or CapabilityZ/);
  await dialog.getByRole('button', { name: 'Make conditional' }).click();
  await saved();
  expect(changes()).toEqual({ removed: [], added: ['<!-- if: CapabilityY or CapabilityZ -->', '<!-- endif -->'] });

  // Edit it: only the marker line changes.
  const marker = page().locator('.cond-start', { hasText: 'CapabilityY or CapabilityZ' });
  await marker.hover();
  await marker.getByRole('button', { name: 'Edit…' }).click();
  const edit = page().getByRole('dialog', { name: 'Edit condition' });
  await edit.getByLabel('Condition', { exact: true }).fill('CapabilityY and not Typo');
  await expect(edit.locator('#condition-help')).toHaveText('Not in capabilities.json: Typo');
  await edit.getByLabel('Condition', { exact: true }).fill('CapabilityY and not CapabilityX');
  await edit.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(changes().added).toEqual(['<!-- if: CapabilityY and not CapabilityX -->', '<!-- endif -->']);

  // Remove it: the page is back to the original.
  const edited = page().locator('.cond-start', { hasText: 'not CapabilityX' });
  await edited.hover();
  await edited.getByRole('button', { name: 'Remove' }).click();
  await saved();
  expect(file()).toBe(original);
});

test('wraps selected words in an inline condition', async () => {
  const words = page().locator('.prose p', { hasText: 'Everyone sees this.' });
  // Select "sees" by double-clicking it.
  await words.getByText('Everyone sees this.').dblclick({ position: { x: 90, y: 10 } });
  await page().getByRole('button', { name: 'Condition…' }).click();
  const dialog = page().getByRole('dialog', { name: 'Make conditional' });
  await dialog.getByRole('checkbox', { name: 'CapabilityX' }).check();
  await dialog.getByRole('button', { name: 'Make conditional' }).click();
  await saved();
  const { added } = changes();
  expect(added).toHaveLength(1);
  expect(added[0]).toMatch(/<!-- if-inline: CapabilityX -->\w+<!-- endif-inline -->/);
});

test('"View as" dims what a capability set would not see', async () => {
  await page().getByRole('button', { name: 'View as ▾' }).click();
  await page().getByRole('checkbox', { name: 'CapabilityX' }).check();
  // Z is nested and off (with its own markers); X or Y is on.
  await expect(page().locator('.cond-in.cond-off', { hasText: 'Nested for Z.' })).toBeVisible();
  await expect(page().locator('.cond-start.cond-off')).toContainText('CapabilityZ');
  await expect(page().locator('.cond-in:not(.cond-off)', { hasText: 'Only for X or Y.' })).toBeVisible();
  await expect(page().locator('.cond-inline:not(.cond-off)')).toHaveText('fast');
  await page().getByRole('checkbox', { name: 'CapabilityX' }).uncheck();
  await page().getByRole('checkbox', { name: 'CapabilityZ' }).check();
  // Without X or Y, the outer condition hides its nested content too.
  await expect(page().locator('.cond-in.cond-off', { hasText: 'Only for X or Y.' })).toBeVisible();
  await expect(page().locator('.cond-inline.cond-off')).toHaveText('fast');
  expect(file()).toBe(original);
});

test('declared directives and roles: labels, option forms, links', async () => {
  const callout = page().locator('.directive-company-callout');
  await expect(callout.locator('.directive-label')).toHaveText('Internal note');
  await expect(callout).toHaveClass(/tone-warning/);
  await expect(page().locator('.role-custom')).toHaveText('JiraDOCS-42');

  await callout.hover();
  await callout.getByRole('button', { name: /Options/ }).click();
  const dialog = page().getByRole('dialog', { name: 'Internal note options' });
  await dialog.getByLabel('Audience').selectOption('partners');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await saved();
  expect(changes()).toEqual({ removed: [':audience: internal'], added: [':audience: partners'] });

  // Declared directives are offered in the Insert menu, with their defaults.
  await page().locator('.prose').getByText('Closing words.').click();
  await page().keyboard.press('End');
  await page().keyboard.press('Enter');
  await page().getByRole('button', { name: 'Insert ▾' }).click();
  await page().getByRole('menuitem', { name: 'Internal note' }).click();
  await page().keyboard.type('New note.');
  await saved();
  expect(file()).toContain('Closing words.\n\n:::{company-callout}\n:audience: internal\n\nNew note.\n:::\n');
});

test('settings reload when .mysteditor.toml changes, and mistakes are reported', async () => {
  const settings = join(ctx.project, 'docs', '.mysteditor.toml');
  writeFileSync(settings, readFileSync(settings, 'utf8').replace('label = "Internal note"', 'label = "Team note"'));
  await expect(page().locator('.directive-company-callout .directive-label')).toHaveText('Team note');

  writeFileSync(settings, readFileSync(settings, 'utf8') + '\n[directives.broken]\nbody = "html"\n');
  const chip = page().getByRole('button', { name: 'Settings: 1 problem' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page().locator('.log-text')).toHaveText('docs/.mysteditor.toml: [directives.broken] body must be "markdown", "text" or "none"');
});
