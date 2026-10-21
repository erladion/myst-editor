import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['test/global-setup.ts'], include: ['test/*.test.ts'] },
});
