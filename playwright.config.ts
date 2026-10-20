import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // CI starts cold: the first Sphinx build downloads Python and Sphinx.
  timeout: process.env.CI ? 240_000 : 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
