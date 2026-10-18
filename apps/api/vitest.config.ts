import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests start real containers (Redis, later Postgres) via Testcontainers.
    hookTimeout: 60_000,
    testTimeout: 15_000,
  },
});
