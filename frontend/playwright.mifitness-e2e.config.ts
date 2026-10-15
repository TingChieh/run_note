import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// Supply process-only test variables; this config never reads the project's .env.
const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error('Mi Fitness E2E requires an explicitly allowed isolated TEST_DATABASE_URL');
const target = new URL(value), name = target.pathname.slice(1);
const identity = `${target.hostname}:${target.port || '5432'}/${name}`;
if (!name.endsWith('_test') || !(process.env.TEST_DATABASE_ALLOWED_TARGETS ?? '').split(',').map(value => value.trim()).includes(identity)) throw new Error('Mi Fitness E2E refuses an unapproved database target');
const origin = 'http://127.0.0.1:5296';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'mifitness-import.spec.ts', workers: 1,
  use: { baseURL: origin, channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: [
    {
      command: `.venv/bin/python -c 'import uvicorn; from app.main import create_app; from app.core.config import Settings; uvicorn.run(create_app(Settings(_env_file=None)), host="127.0.0.1", port=8296)'`,
      cwd: resolve('../backend'), url: 'http://127.0.0.1:8296/api/v1/health/ready', reuseExistingServer: false,
      env: { DATABASE_URL: value, APP_ENV: 'test', SITE_ORIGIN: origin, AUTH_RATE_HASH_KEY: randomBytes(48).toString('hex') }
    },
    { command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5296', url: origin + '/login', reuseExistingServer: false, env: { INTERNAL_API_BASE_URL: 'http://127.0.0.1:8296' } }
  ]
});
