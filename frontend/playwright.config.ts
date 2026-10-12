import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.RUNNOTE_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})
  },
  webServer: {
    command: process.env.RUNNOTE_E2E_BASE_URL ? `pnpm dev --port ${new URL(process.env.RUNNOTE_E2E_BASE_URL).port}` : 'pnpm dev',
    url: process.env.RUNNOTE_E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
