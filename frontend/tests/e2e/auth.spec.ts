import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const password = 'Synthetic-local-password-2026';
const identity = () => { const key = randomUUID().replaceAll('-', '').slice(0, 16); return { email: `${key}@example.com`, username: `u_${key}` }; };
async function register(page: Page, user: ReturnType<typeof identity>) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(user.email);
  await page.getByLabel('用户名', { exact: true }).fill(user.username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('current-user')).toContainText(user.email);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=logout$/);
  await expect(page.getByTestId('current-user')).toContainText('未登录');
}
async function login(page: Page, email: string, secret = password) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

test('anonymous direct SSR access is protected and external redirects are rejected', async ({ page, request }) => {
  for (const path of ['/settings', '/activities', '/dashboard']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toContain('/login?next=');
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
});

test('real registration, duplicate error, wrong password, login, refresh, logout and Cookie/CSRF security', async ({ page, context, baseURL }) => {
  const user = identity();
  await register(page, user);
  const cookie = (await context.cookies()).find(c => c.name === 'run_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('run_session');
  await page.screenshot({ path: 'test-results/auth-settings.png', fullPage: true });
  await page.reload();
  await expect(page.getByTestId('current-user')).toContainText(user.email);
  await page.getByRole('link', { name: '跑步记录', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  const csrf = await page.evaluate(async () => (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token);
  const denied = await context.request.post('/api/v1/auth/logout', { headers: { Origin: baseURL!, 'X-CSRF-Token': 'invalid' }, data: {} });
  expect(denied.status()).toBe(403);
  const wrongOrigin = await context.request.post('/api/v1/auth/logout', { headers: { Origin: 'https://evil.example', 'X-CSRF-Token': csrf }, data: {} });
  expect(wrongOrigin.status()).toBe(403);
  const absentOrigin = await context.request.post('/api/v1/auth/logout', { headers: { 'X-CSRF-Token': csrf }, data: {} });
  expect(absentOrigin.status()).toBe(403);
  await logout(page);
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(user.email);
  await page.getByLabel('用户名', { exact: true }).fill(identity().username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱已被注册');
  await page.goto('/login?next=//evil.example');
  await login(page, user.email, 'Incorrect-password-2026');
  await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确');
  await login(page, user.email);
  await expect(page).toHaveURL(/\/settings$/);
  await page.reload();
  await expect(page.getByTestId('current-user')).toContainText(user.email);
  await logout(page);
  expect((await context.cookies()).some(c => c.name === 'run_session')).toBe(false);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('two users, SSR requests and identity changes in another tab never reuse private state', async ({ browser, baseURL }) => {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const pa = await a.newPage(), pb = await b.newPage();
    const ua = identity(), ub = identity();
    await register(pa, ua); await register(pb, ub);
    const [ra, rb] = await Promise.all([a.request.get('/settings'), b.request.get('/settings')]);
    const [ha, hb] = await Promise.all([ra.text(), rb.text()]);
    expect(ha).toContain(ua.email); expect(ha).not.toContain(ub.email);
    expect(hb).toContain(ub.email); expect(hb).not.toContain(ua.email);
    const second = await a.newPage(); await second.goto('/settings');
    await expect(second.locator('header')).toHaveAttribute('data-auth-ready', 'true');
    // Hold A's successful identity response while another tab logs out.
    // The broadcast must queue a second check instead of accepting the stale response.
    let release!: () => void, captured!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const received = new Promise<void>(resolve => { captured = resolve; });
    let first = true;
    await second.route('**/api/v1/auth/session', async route => {
      const response = await route.fetch();
      if (first) { first = false; captured(); await held; }
      await route.fulfill({ response });
    });
    await second.evaluate(() => window.dispatchEvent(new Event('focus')));
    await received;
    await logout(pa);
    release();
    await expect(second).toHaveURL(/\/login\?reason=changed/);
    await expect(second.getByTestId('current-user')).not.toContainText(ua.email);
    await expect(pb.getByTestId('current-user')).toContainText(ub.email);
    await login(pa, ub.email);
    await expect(pa).toHaveURL(/\/settings$/);
    await expect(pa.getByTestId('current-user')).toContainText(ub.email);
    await expect(pa.locator('body')).not.toContainText(ua.email);
    // Back/forward cache must not resurrect A's page after switching to B.
    await pa.goBack(); await pa.goto('/settings');
    await expect(pa.locator('body')).not.toContainText(ua.email);
    await logout(pa); await logout(pb);
  } finally { await a.close(); await b.close(); }
});

test('a genuinely expired backend session clears the browser identity and redirects protected pages', async ({ page, context }) => {
  const user = identity(); await register(page, user);
  const token = (await context.cookies()).find(c => c.name === 'run_session')!.value;
  // Expire only this test-created session. No DDL, deletes, or database cleanup.
  const script = `from app.core.config import Settings\nfrom app.core.security import token_hash\nfrom sqlalchemy import create_engine,text\nimport os\ne=create_engine(Settings().database_url,hide_parameters=True)\nwith e.begin() as c:\n r=c.execute(text("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=:token"), {'token':token_hash(os.environ['RUNNOTE_TEST_SESSION'])})\n assert r.rowcount==1\ne.dispose()`;
  const result = spawnSync('.venv/bin/python', ['-c', script], { cwd: '../backend', env: { ...process.env, RUNNOTE_TEST_SESSION: token }, encoding: 'utf8' });
  expect(result.status, 'test session expiry injection succeeded').toBe(0);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByTestId('current-user')).toContainText('未登录');
  await expect(page.getByRole('status').last()).toContainText('登录');
});

 test('without JavaScript, auth forms cannot submit credentials into a URL', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: path === '/login' ? '登录' : '注册', exact: true })).toBeDisabled();
      await expect(page.locator('form')).toHaveAttribute('method', 'POST');
      await expect(page.getByRole('alert')).toContainText('JavaScript');
    }
  } finally { await context.close(); }
});
