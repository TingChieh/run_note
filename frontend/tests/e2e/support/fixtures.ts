import {
  expect,
  request,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Shared setup for real-backend browser tests (playwright.config.ts).
// - `owner`: the synthetic site owner provisioned offline before the backend starts.
// - `member`: a fresh managed account per test, created by the owner through the admin API, so
//   tests never share data and the closed registration API is never needed.
// - Every context refuses third-party requests: the basemap must degrade to the local background
//   without blocking tracks, and no request may leave the machine.
// - An uncaught page error fails the test.

export interface Account {
  email: string;
  username: string;
  password: string;
}

export const owner: Account = JSON.parse(process.env.RUNNOTE_E2E_OWNER ?? 'null');
if (!owner) throw new Error('RUNNOTE_E2E_OWNER is set by playwright.config.ts; run through it');

const local = (url: URL) => url.hostname === '127.0.0.1' || url.hostname === 'localhost';

export async function offline(context: BrowserContext): Promise<BrowserContext> {
  await context.route(
    (url) => !local(url),
    (route) => route.abort(),
  );
  return context;
}

/** A second browser profile with the same offline rule. */
export async function newContext(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  return offline(await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }));
}

/** Sign in through the real /admin form (the only login page) and land on `next`. */
export async function login(page: Page, account: Account, next: string): Promise<void> {
  await page.goto(`/admin?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
  await page.getByLabel('邮箱', { exact: true }).fill(account.email);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === next);
  await expect(page.locator('header')).toHaveAttribute('data-auth-ready', 'true');
}

export async function csrfToken(api: APIRequestContext): Promise<string> {
  const response = await api.get('/api/v1/auth/csrf');
  expect(response.status()).toBe(200);
  return (await response.json()).data.csrf_token;
}

/** A same-origin write with the CSRF token, as the frontend sends it. */
export async function write(api: APIRequestContext, method: string, path: string, data?: unknown) {
  const token = await csrfToken(api);
  return api.fetch(path, { method, headers: { 'X-CSRF-Token': token }, ...(data === undefined ? {} : { data }) });
}

export async function apiSession(baseURL: string, account: Account): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await write(api, 'POST', '/api/v1/auth/login', { email: account.email, password: account.password });
  expect(response.status(), await response.text()).toBe(200);
  return api;
}

export const test = base.extend<{ member: Account; pageErrors: string[] }, { ownerApi: APIRequestContext }>({
  ownerApi: [
    async ({}, use, workerInfo) => {
      const api = await apiSession(workerInfo.project.use.baseURL!, owner);
      await use(api);
      await api.dispose();
    },
    { scope: 'worker' },
  ],
  member: async ({ ownerApi }, use) => {
    const id = randomBytes(5).toString('hex');
    const account = { email: `member-${id}@example.com`, username: `m_${id}`, password: `Synthetic-e2e-member-${id}` };
    const created = await write(ownerApi, 'POST', '/api/v1/admin/users', {
      ...account,
      display_name: `成员 ${id}`,
      timezone: 'Asia/Shanghai',
    });
    expect(created.status(), await created.text()).toBe(201);
    await use(account);
  },
  context: async ({ context }, use) => {
    await use(await offline(context));
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
