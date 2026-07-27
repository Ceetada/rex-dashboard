import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL, never a mock or an
 * in-memory substitute.
 *
 * The behaviour under test is transaction isolation and row locking. No
 * substitute reproduces that: a mocked version of the double-spend test passes
 * against a broken implementation, which makes it worse than no test at all.
 */
export default defineConfig({
  resolve: {
    alias: { '@evas/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    // These serialise on a shared database, so running files in parallel would
    // have them fighting over the same rows.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
