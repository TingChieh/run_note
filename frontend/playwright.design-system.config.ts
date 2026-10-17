import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'design-system.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5193', channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light', reducedMotion: 'reduce', timezoneId: 'UTC'
  },
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 0 } },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.showcase.config.ts',
    url: 'http://127.0.0.1:5193', reuseExistingServer: false
  }
});
