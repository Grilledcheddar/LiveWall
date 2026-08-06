import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.LIVEWALL_TEST_URL ?? 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
  },
});
