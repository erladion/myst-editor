import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // Bundle dependencies: the packaged app ships without node_modules.
    build: { externalizeDeps: false, rollupOptions: { input: 'src/main/index.ts' } },
  },
  preload: {
    // Sandboxed preload scripts must be CommonJS.
    build: {
      rollupOptions: {
        input: 'src/preload/index.ts',
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    // markdown-it imports Node's punycode; use the browser-compatible package instead.
    resolve: { alias: { punycode: 'punycode/punycode.es6.js' } },
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
    plugins: [react()],
  },
});
