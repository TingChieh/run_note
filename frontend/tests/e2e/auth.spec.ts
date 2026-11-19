import { spawnSync } from 'node:child_process';
import type { BrowserContext, Page } from '@playwright/test';
import { openAccountMenu } from '../fixtures/top-navigation';
import { expect, login, newContext, owner, test } from './support/fixtures';

async function logout(page: Page) {
  // The button turns into "退出中…" at once; wait for the real response and the reload after it.
  const done = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout'));
  const reloaded = page.waitForEvent('load');
  await (await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true }).click();
  expect((await done).status()).toBe(200);
  await reloaded;
}

async function signedIn(context: BrowserContext): Promise<string | null> {
  const response = await context.request.get('/api/v1/auth/session');
  return response.status() === 200 ? (await response.json()).data.user.email : null;
}

test('private pages redirect anonymous requests on the server, uncached', async ({ page, request }) => {
  for (const path of ['/settings', '/workspace/activities', '/admin/users', '/wellbeing']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(303);
    expect(response.headers().location).toBe(`/admin?next=${encodeURIComponent(path)}`);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/admin\?next=%2Fsettings$/);
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByText('请登录后继续', { exact: false })).toBeVisible();
});

test('login rejects a wrong password, ignores an off-site next, sets a protected cookie, and logout needs CSRF and Origin', async ({
  page,
  context,
  baseURL,
  member,
}) => {
  await page.goto('/admin?next=//evil.example');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
  await page.getByLabel('邮箱', { exact: true }).fill(member.email);
  await page.getByLabel('密码', { exact: true }).fill('Incorrect-password-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确');
  expect(await signedIn(context)).toBeNull();

  await page.getByLabel('密码', { exact: true }).fill(member.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/`);
  const cookie = (await context.cookies()).find((item) => item.name === 'run_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('run_session');
  await page.reload();
  expect(await signedIn(context)).toBe(member.email);

  const token: string = (await (await context.request.get('/api/v1/auth/csrf')).json()).data.csrf_token;
  const rejected: Record<string, string>[] = [
    { Origin: baseURL!, 'X-CSRF-Token': 'invalid' },
    { Origin: 'https://evil.example', 'X-CSRF-Token': token },
    { 'X-CSRF-Token': token },
  ];
  for (const headers of rejected) {
    expect((await context.request.post('/api/v1/auth/logout', { headers, data: {} })).status()).toBe(403);
  }
  expect(await signedIn(context)).toBe(member.email);

  await page.goto('/workspace/settings');
  await logout(page);
  expect(await signedIn(context)).toBeNull();
  await page.goto('/workspace/settings');
  await expect(page).toHaveURL(/\/admin\?next=%2Fworkspace%2Fsettings$/);
});

test('two accounts never see each other in server-rendered pages, and a logout in another tab is not undone by a stale check', async ({
  page,
  browser,
  baseURL,
  member,
}) => {
  await login(page, owner, '/settings');
  const other = await newContext(browser, baseURL);
  const memberPage = await other.newPage();
  await login(memberPage, member, '/workspace/settings');
  const [ownerHtml, memberHtml] = await Promise.all([
    page
      .context()
      .request.get('/settings')
      .then((r) => r.text()),
    other.request.get('/workspace/settings').then((r) => r.text()),
  ]);
  expect(ownerHtml).toContain(owner.email);
  expect(ownerHtml).not.toContain(member.email);
  expect(memberHtml).toContain(member.email);
  expect(memberHtml).not.toContain(owner.email);

  // Hold the second tab's identity check while the first tab logs out; the queued re-check must
  // win over the stale successful response.
  const second = await page.context().newPage();
  await second.goto('/settings');
  await expect(second.locator('header')).toHaveAttribute('data-auth-ready', 'true');
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const received = new Promise<void>((resolve) => (captured = resolve));
  let first = true;
  await second.route('**/api/v1/auth/session', async (route) => {
    const response = await route.fetch();
    if (first) {
      first = false;
      captured();
      await held;
    }
    await route.fulfill({ response });
  });
  await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  await received;
  await logout(page);
  release();
  await expect(second).toHaveURL(/\/admin\?reason=changed$/);
  await expect(second.locator('body')).not.toContainText(owner.email);
  expect(await signedIn(other)).toBe(member.email);
  await other.close();
});

test('a session that expired in the database signs the browser out of private pages', async ({
  page,
  context,
  member,
}) => {
  await login(page, member, '/workspace/settings');
  const token = (await context.cookies()).find((item) => item.name === 'run_session')!.value;
  const expired = spawnSync('.venv/bin/python', ['-m', 'tests.e2e_accounts', 'expire-session'], {
    cwd: '../backend',
    env: { ...process.env, RUNNOTE_TEST_SESSION: token },
    encoding: 'utf8',
  });
  expect(expired.status, expired.stderr).toBe(0);
  await page.reload();
  await expect(page).toHaveURL(/\/admin\?next=%2Fworkspace%2Fsettings$/);
  expect(await signedIn(context)).toBeNull();
});

test('without JavaScript the login form cannot submit credentials into a URL', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
  await expect(page.locator('form')).toHaveAttribute('method', 'POST');
  await expect(page.getByRole('alert')).toContainText('JavaScript');
  await context.close();
});
