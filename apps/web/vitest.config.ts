import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@evas/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  test: { globals: true, environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
