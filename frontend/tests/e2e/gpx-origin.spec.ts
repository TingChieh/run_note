import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const password = 'Synthetic-GPX-check-2026';
const identity = () => {
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  return { email: `${id}@example.com`, username: `u_${id}` };
};

async function register(page: Page, user: ReturnType<typeof identity>) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(user.email);
  await page.getByLabel('用户名', { exact: true }).fill(user.username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
}

test('GPX upload works while forged Origin, missing CSRF and cross-user writes stay blocked', async ({ browser, baseURL }) => {
  const ownerContext = await browser.newContext({ baseURL });
  const otherContext = await browser.newContext({ baseURL });
  try {
    const ownerPage = await ownerContext.newPage();
    const otherPage = await otherContext.newPage();
    const owner = identity();
    const other = identity();
    await register(ownerPage, owner);
    const sessionCookie = (await ownerContext.cookies()).find(cookie => cookie.name === 'run_session');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');

    await ownerPage.goto('/activities');
    await ownerPage.locator('input[type="file"]').setInputFiles(
      resolve(process.cwd(), '../backend/tests/fixtures/gpx/equator-six.gpx')
    );
    await ownerPage.getByRole('button', { name: '导入 GPX', exact: true }).click();
    await expect(ownerPage.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible({ timeout: 15000 });
    const activityLink = ownerPage.getByRole('status').getByRole('link', { name: '查看活动与路线' });
    const activityPath = await activityLink.getAttribute('href');
    expect(activityPath).toMatch(/^\/activities\/[0-9a-f-]{36}$/i);
    await activityLink.click();
    await expect(ownerPage.getByTestId('activity-distance')).toBeVisible();
    await expect(ownerPage.getByTestId('route-map-ready')).toBeVisible({ timeout: 15000 });

    const csrf = await ownerPage.evaluate(async () => {
      const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
      return (await response.json()).data.csrf_token as string;
    });
    const file = {
      name: 'equator-six.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from('<gpx version="1.1" creator="RunNote synthetic"></gpx>')
    };
    const forgedOrigin = await ownerContext.request.post('/api/v1/gpx-imports', {
      headers: { Origin: 'https://attacker.invalid', 'X-CSRF-Token': csrf },
      multipart: { file }
    });
    expect(forgedOrigin.status()).toBe(403);

    const missingCsrf = await ownerContext.request.post('/api/v1/gpx-imports', {
      headers: { Origin: baseURL! },
      multipart: { file }
    });
    expect(missingCsrf.status()).toBe(403);

    await register(otherPage, other);
    const otherCsrf = await otherPage.evaluate(async () => {
      const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
      return (await response.json()).data.csrf_token as string;
    });
    const crossUserWrite = await otherContext.request.patch(`/api/v1${activityPath}`, {
      headers: { Origin: baseURL!, 'X-CSRF-Token': otherCsrf },
      data: { visibility: 'public' }
    });
    expect(crossUserWrite.status()).toBe(404);

    await expect(ownerPage.getByTestId('activity-distance')).toBeVisible();
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});
