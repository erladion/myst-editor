// Pages in the contents can always be opened, wherever they are in the folder.
import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type App } from './helpers';

let ctx: App;
test.afterEach(async () => {
  await ctx.app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await ctx.app.close().catch(() => {});
});

test('a page in a folder the scan skips is still a page once Sphinx builds it', async () => {
  ctx = await launch({
    prepare: (project) => {
      // dist/ usually holds packaging output, so the folder scan skips it, but here
      // the guide keeps its packaging section there.
      mkdirSync(join(project, 'docs', 'dist', 'linux'), { recursive: true });
      writeFileSync(join(project, 'docs', 'dist', 'linux', 'index.md'), '# Linux packages\n\nUse the RPM.\n');
      const index = join(project, 'docs', 'index.md');
      writeFileSync(index, readFileSync(index, 'utf8').replace('guide/configure\n', 'guide/configure\ndist/linux/index\n'));
    },
  });
  const { page } = ctx;
  await page.getByRole('button', { name: 'Allow' }).click();
  const entry = page.locator('.tree .page', { hasText: 'Linux packages' });
  await expect(entry).toBeVisible({ timeout: 180_000 });
  await expect(entry).toBeEnabled();
  await entry.click();
  await expect(page.locator('.prose h1')).toHaveText('Linux packages');
});
