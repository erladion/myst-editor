import { defineConfig } from 'vitest/config';

// Tests that run real tools (uv, Sphinx) and may download packages.
export default defineConfig({
  test: { globalSetup: ['test/global-setup.ts'], include: ['test/integration/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000 },
});
