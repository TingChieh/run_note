import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: ['basemaps.spec.ts', 'ui-shell.spec.ts', 'activities.spec.ts', 'dashboard.spec.ts', 'dashboard-explorer.spec.ts', 'footprints.spec.ts', 'p2.spec.ts', 'sport-detail.spec.ts', 'map-framing.spec.ts', 'footprint-card-deck.spec.ts', 'milestones.spec.ts', 'theme.spec.ts', 'liquid-glass.spec.ts', 'seo-routes.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5191', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: [
    { command: 'node tests/fixtures/ui-api.mjs', url: 'http://127.0.0.1:8191/api/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5191', url: 'http://127.0.0.1:5191/admin', env: { INTERNAL_API_BASE_URL: 'http://127.0.0.1:8191' }, reuseExistingServer: false }
  ]
});
