import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // argon2 + PGlite (WASM) are slower than pure unit tests
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
