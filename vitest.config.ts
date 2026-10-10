import { defineConfig } from 'vitest/config';

// Unit tests for the web app (src/**) and the Electron main process
// (electron/**, run in Node with `electron` mocked per test).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'scripts/**/*.test.{ts,mjs}'],
    exclude: ['**/node_modules/**', 'dist/**', 'dist-single/**', 'dist-electron/**', 'release/**', '.claude/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
