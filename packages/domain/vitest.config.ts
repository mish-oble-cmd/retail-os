import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // phases-overview.md standing exit criteria: domain coverage ≥ 90%
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
