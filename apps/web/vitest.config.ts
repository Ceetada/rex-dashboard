import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js compiles JSX with the automatic runtime; vitest needs telling
  // separately or `React is not defined` at render time.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@evas/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
