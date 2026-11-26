import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/mobile-offline',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4195',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/fixtures/mobile-static-server.mjs ../android/public 4195',
    url: 'http://127.0.0.1:4195/',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
