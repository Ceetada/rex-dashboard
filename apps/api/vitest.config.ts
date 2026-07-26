import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@evas/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: { provider: 'v8', reportsOnDirectory: false, exclude: ['**/*.spec.ts', 'dist/**'] },
  },
});
