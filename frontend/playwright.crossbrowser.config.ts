import { defineConfig, devices } from '@playwright/test';

const webServer = [
  { command: 'node tests/fixtures/ui-api.mjs', url: 'http://127.0.0.1:8191/api/health', reuseExistingServer: false },
  { command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5191', url: 'http://127.0.0.1:5191/admin', env: { INTERNAL_API_BASE_URL: 'http://127.0.0.1:8191' }, reuseExistingServer: false },
];

export default defineConfig({
  testDir: './tests/ui',
  testMatch: ['crossbrowser-glass.spec.ts'],
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5191' },
  webServer,
  projects: [
    { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
  ],
});
