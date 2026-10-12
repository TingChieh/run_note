import { expect, test } from '@playwright/test';

test('browser reaches the real API through the frontend proxy', async ({ page }) => {
  const apiResponse = page.waitForResponse(response => response.url().endsWith('/api/health'));
  await page.goto('/');
  expect((await apiResponse).status()).toBe(200);
  await expect(page.getByTestId('health-status')).toContainText('均已就绪');
  await page.getByRole('navigation').getByRole('link', { name: '跑步记录' }).click();
  await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
  await expect(page.getByText('此页面为第一阶段占位。', { exact: false })).toBeVisible();
});

test('browser displays a database outage rather than a healthy status', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      data: null,
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: '数据库或迁移尚未就绪', details: [] },
      meta: { request_id: 'outage-test' }
    })
  }));
  await page.goto('/');
  await expect(page.getByTestId('health-status')).toContainText('检查未通过');
  await expect(page.getByTestId('health-status')).not.toContainText('均已就绪');
});
