import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

// Real-backend browser tests (tests/e2e) against an isolated, allow-listed *_test database at the
// migration head. Both servers are started here from process variables only; the backend never
// reads the project's .env. The site owner is provisioned offline by backend/tests/e2e_accounts.py;
// every other account is created by that owner through the admin API (tests/e2e/support).
//
//   TEST_DATABASE_URL=postgresql+psycopg://…/<name>_test TEST_DATABASE_ALLOWED_TARGETS=host:port/<name>_test \
//     pnpm test:e2e            (or: python3 scripts/verify.py --e2e --test-db <name>_test)
const database = process.env.TEST_DATABASE_URL;
if (!database) throw new Error('E2E requires TEST_DATABASE_URL naming an allow-listed *_test database');
const target = new URL(database);
const name = target.pathname.slice(1);
const identity = `${target.hostname}:${target.port || '5432'}/${name}`;
const allowed = (process.env.TEST_DATABASE_ALLOWED_TARGETS ?? '').split(',').map((value) => value.trim());
if (!name.endsWith('_test') || !allowed.includes(identity)) {
  throw new Error('E2E refuses a database that is not an allow-listed *_test target');
}

// Worker processes evaluate this file again; the variables keep one identity for the whole run.
const run = (process.env.RUNNOTE_E2E_RUN ??= randomBytes(6).toString('hex'));
process.env.RUNNOTE_E2E_OWNER ??= JSON.stringify({
  email: `owner-${run}@example.com`,
  username: `owner_${run}`,
  password: `Synthetic-e2e-owner-${run}`,
});
const owner = JSON.parse(process.env.RUNNOTE_E2E_OWNER) as { email: string };
const api = 'http://127.0.0.1:8297';
const origin = 'http://127.0.0.1:5297';
const serve = `import uvicorn; from app.main import create_app; from app.core.config import Settings; uvicorn.run(create_app(Settings(_env_file=None)), host="127.0.0.1", port=8297)`;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: origin, channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: [
    {
      command: `.venv/bin/python -m tests.e2e_accounts && exec .venv/bin/python -c '${serve}'`,
      cwd: resolve(import.meta.dirname, '../backend'),
      url: `${api}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: database,
        TEST_DATABASE_URL: database,
        TEST_DATABASE_ALLOWED_TARGETS: process.env.TEST_DATABASE_ALLOWED_TARGETS ?? '',
        RUNNOTE_E2E_OWNER: process.env.RUNNOTE_E2E_OWNER,
        APP_ENV: 'test',
        SITE_ORIGIN: origin,
        SITE_OWNER_EMAIL: owner.email,
        AUTH_RATE_HASH_KEY: randomBytes(48).toString('hex'),
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5297',
      url: `${origin}/admin`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { INTERNAL_API_BASE_URL: api },
    },
  ],
});
