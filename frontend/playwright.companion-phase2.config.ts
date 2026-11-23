import { defineConfig } from '@playwright/test';
import base from './playwright.ui.config.ts';

const useProdBuild = process.env.COMPANION_USE_PROD_BUILD === '1';
const apiPort = Number(process.env.UI_API_PORT ?? 8191);
const webPort = Number(process.env.UI_WEB_PORT ?? 5191);

export default defineConfig({
  ...base,
  testMatch: ['companion-phase2.spec.ts'],
  ...(useProdBuild
    ? {
        webServer: [
          {
            command: 'node tests/fixtures/ui-api.mjs',
            url: `http://127.0.0.1:${apiPort}/api/health`,
            env: { UI_API_PORT: String(apiPort) },
            reuseExistingServer: false,
          },
          {
            command: 'node build/index.js',
            url: `http://127.0.0.1:${webPort}/admin`,
            env: {
              HOST: '127.0.0.1',
              PORT: String(webPort),
              ORIGIN: `http://127.0.0.1:${webPort}`,
              INTERNAL_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
            },
            reuseExistingServer: false,
          },
        ],
      }
    : {}),
});
