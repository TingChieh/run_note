import base from './playwright.ui.config';
export default {
  ...base,
  testMatch: ['showcase.spec.ts'],
  webServer: [
    { command: 'node tests/fixtures/ui-api.mjs', url: 'http://127.0.0.1:8191/api/health', reuseExistingServer: false },
    {
      command: 'node scripts/start-node-local.mjs',
      url: 'http://127.0.0.1:5191/admin',
      env: { INTERNAL_API_BASE_URL: 'http://127.0.0.1:8191', HOST: '127.0.0.1', PORT: '5191' },
      reuseExistingServer: false,
    },
  ],
};
