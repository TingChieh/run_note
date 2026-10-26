import { expect, test } from '@playwright/test';

test('records page shows bests, charts and data-table fallbacks', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByRole('heading', { name: '个人记录', level: 1 })).toBeVisible();
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByTestId('pb-5km')).toContainText('5:30 /km');
  await expect(page.getByTestId('pb-5km')).toContainText('共 4 次');
  await expect(page.getByTestId('pb-10km')).toContainText('还没有符合条件的 10K 记录');
  for (const id of ['monthly', 'pace', 'weekly', 'weekday', 'compare']) await expect(page.getByTestId(`records-chart-${id}`)).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('records-chart-monthly-table').locator('tbody tr')).toHaveCount(12);
  await expect(page.getByTestId('records-chart-weekly-table').locator('tbody tr')).toHaveCount(26);
  await expect(page.getByTestId('records-compare-distance')).toContainText('+210 km');
  await expect(page.getByTestId('records-compare-pace')).toContainText('—');
});

test('changing years asks the server and validates the inputs', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await page.getByLabel('年份', { exact: true }).fill('2024');
  await page.getByLabel('对比年份', { exact: true }).fill('2024');
  await page.getByRole('button', { name: '查看' }).click();
  await expect(page.getByTestId('records-year-message')).toHaveText('对比年份不能与年份相同');
  const request = page.waitForRequest(r => r.url().includes('year=2024') && r.url().includes('compare_year=2023'));
  await page.getByLabel('对比年份', { exact: true }).fill('2023');
  await page.getByRole('button', { name: '查看' }).click();
  await request;
  await expect(page.getByTestId('records-ready')).toContainText('2024 年 vs 2023 年同期');
});

test('a year without any run shows the empty state', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await page.getByLabel('年份', { exact: true }).fill('1999');
  await page.getByLabel('对比年份', { exact: true }).fill('1998');
  await page.getByRole('button', { name: '查看' }).click();
  await expect(page.getByTestId('records-empty')).toBeVisible();
});

test('an expired session leaves the page for the login screen', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', route => route.fulfill({ status: 401, json: { data: null, error: { message: '会话已过期' } } }));
  await page.goto('/records');
  await expect(page).toHaveURL(/\/admin\?reason=expired/);
});

test('dashboard summary card links to the records page', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('records-card');
  await expect(card.getByTestId('records-card-5km')).toContainText('5:30 /km');
  await expect(card.getByTestId('records-card-10km')).toContainText('—');
  await expect(card.getByTestId('records-card-delta')).toContainText('+');
  await card.getByRole('link', { name: '查看全部' }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByTestId('records-ready')).toBeVisible();
});

test('navigation lists the records entry and the mobile layout does not overflow', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '个人记录' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('records-ready')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a failing records request leaves the rest of the dashboard intact and can be retried', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', route => route.fulfill({ status: 503, json: { data: null, error: { message: '暂时无法读取，请重试' } } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '数据汇总', level: 1 })).toBeVisible();
  const card = page.getByTestId('records-card');
  await expect(card).toContainText('暂时无法读取，请重试');
  await expect(card.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(page.getByTestId('annual-distance')).toBeVisible();
});
