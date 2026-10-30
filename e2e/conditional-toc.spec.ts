// Conditional content among a toctree's entries, and a toctree inside a condition.
import { expect, test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

const TOCS = `
\`\`\`{toctree}
:caption: Inside

intro
<!-- if: CapabilityX -->
cloud
<!-- if: CapabilityZ -->
edge
<!-- endif -->
<!-- endif -->
last
\`\`\`

<!-- if: CapabilityY -->

\`\`\`{toctree}
:caption: Around

other
\`\`\`

<!-- endif -->
`;

test('conditions among a toctree’s entries are named and striped, and dimmed by "View as"', async () => {
  ctx = await launch({ fixture: 'fixture-ext', prepare: (project) => appendFileSync(join(project, 'docs', 'index.md'), TOCS) });
  const { page } = ctx;
  const inside = page.locator('.prose .card-toc', { hasText: 'Inside' });
  const around = page.locator('.prose .card-toc', { hasText: 'Around' });
  // The markers aren't pages: each condition is named, its entries striped.
  await expect(inside.locator('li')).toHaveText(['intro', /Shown only when\s*CapabilityX/, 'cloud', /Shown only when\s*CapabilityZ/, 'edge', 'last']);
  await expect(inside.locator('li.cond-in')).toHaveText(['cloud', 'edge']);
  await expect(inside.locator('li', { hasText: 'edge' })).toHaveClass(/cond-d2/);
  await expect(around).toHaveClass(/cond-in/);

  // View as CapabilityY alone: X's entries dim (Z's, inside X, too); the other toctree doesn't.
  await page.getByRole('button', { name: 'View as ▾' }).click();
  await page.getByRole('checkbox', { name: 'CapabilityY' }).check();
  await page.locator('.prose').getByText('Closing words.').click();
  await expect(inside.locator('li.cond-off')).toHaveText([/Shown only when\s*CapabilityX/, 'cloud', /Shown only when\s*CapabilityZ/, 'edge']);
  await expect(around).not.toHaveClass(/cond-off/);
  await inside.screenshot({ path: test.info().outputPath('toc-view-as.png') });

  // Edited, a toctree inside a condition keeps its stripe.
  await around.getByRole('button', { name: 'Source…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit {toctree} block' });
  await dialog.locator('textarea').fill('```{toctree}\n:caption: Around\n\nother\nmore\n```');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(around.locator('li')).toHaveText(['other', 'more']);
  await expect(around).toHaveClass(/cond-in/);
});
