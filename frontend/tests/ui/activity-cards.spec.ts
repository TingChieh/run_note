import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

test('activity cards show private labels and only the highest real-distance achievement without nested controls', async ({ page }) => {
  const state = await installActivities(page);
  state.records = [
    { ...sampleActivity, distance_m: '9999', category: '轻松跑', tags: ['河畔', '清晨'] },
    { ...sampleActivity, id: '22222222-2222-4222-8222-222222222222', title: '尚未达成', distance_m: '4999.999', has_route: false },
    { ...sampleActivity, id: '33333333-3333-4333-8333-333333333333', title: '十公里', distance_m: '10000', has_route: false },
    { ...sampleActivity, id: '44444444-4444-4444-8444-444444444444', title: '二十公里', distance_m: '20000', has_route: false }
  ];
  await loginRunner(page); await page.goto('/activities');
  const card = page.locator('.activity-card').filter({ has: page.getByRole('heading', { name: sampleActivity.title, exact: true }) });
  await expect(card.getByRole('img', { name: `${sampleActivity.title}的路线轮廓` })).toBeVisible();
  const link = card.getByRole('link');
  await expect(link).toContainText('公开展示'); await expect(link).toContainText('配速');
  for (const label of ['轻松跑', '#河畔', '#清晨', '5 km 达成']) await expect(link.getByText(label, { exact: true })).toBeVisible();
  await expect(card.getByText('10 km 达成', { exact: true })).toHaveCount(0);
  const short = page.locator('.activity-card').filter({ has: page.getByRole('heading', { name: '尚未达成', exact: true }) });
  await expect(short.getByText('没有路线', { exact: true })).toBeVisible();
  await expect(short.getByText(/km 达成/)).toHaveCount(0);
  await expect(page.getByText('10 km 达成', { exact: true })).toBeVisible();
  await expect(page.getByText('20 km 达成', { exact: true })).toBeVisible();
  await expect(page.locator('.activity-card a button, .activity-card a input')).toHaveCount(0);
  const preview = await card.locator('.route-thumbnail').boundingBox();
  expect(preview!.width).toBeLessThanOrEqual(112);
  expect(preview!.height).toBeLessThanOrEqual(84);
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(300);
  await expect(card.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(card.getByRole('checkbox', { name: `选择 ${sampleActivity.title}`, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `编辑 ${sampleActivity.title}`, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: `删除 ${sampleActivity.title}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await card.locator('.route-thumbnail').boundingBox())!.width).toBeLessThanOrEqual(112);
  }
  await page.reload();
  await page.locator('.activity-card').first().scrollIntoViewIfNeeded();
  await expect(page.getByRole('img', { name: `${sampleActivity.title}的路线轮廓` })).toBeVisible();
  await page.getByRole('region', { name: '我的活动（4）', exact: true }).screenshot({ path: '.cache/activity-library/cards-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await page.locator('.activity-card').first().scrollIntoViewIfNeeded();
  await expect(page.getByRole('img', { name: `${sampleActivity.title}的路线轮廓` })).toBeVisible();
  await page.getByRole('region', { name: '我的活动（4）', exact: true }).screenshot({ path: '.cache/activity-library/cards-mobile-dark.png', animations: 'disabled' });
});

test('failed private route previews keep the card labels and activity navigation usable', async ({ page }) => {
  await installActivities(page);
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`, route => route.fulfill({ status: 503, json: { error: { message: '暂时不可用' } } }));
  await loginRunner(page); await page.goto('/activities');
  const card = page.locator('.activity-card').filter({ has: page.getByRole('heading', { name: sampleActivity.title, exact: true }) });
  await expect(card.getByText('路线暂不可用', { exact: true })).toBeVisible();
  await expect(card.getByText('5 km 达成', { exact: true })).toBeVisible();
  await expect(card.getByRole('link')).toHaveAttribute('href', `/activities/${sampleActivity.id}`);
});

test('activity route previews load only when their cards approach the viewport', async ({ page }) => {
  const state = await installActivities(page);
  state.records = Array.from({ length: 20 }, (_, index) => ({ ...sampleActivity, id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `路线 ${index + 1}` }));
  const distant = state.records[19];
  let distantLoads = 0;
  await page.route(`**/api/v1/showcase/activities/${distant.id}/route`, async route => { distantLoads++; await route.fallback(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginRunner(page); await page.goto('/activities');
  await page.locator('.activity-card').first().scrollIntoViewIfNeeded();
  await expect(page.getByRole('img', { name: '路线 1的路线轮廓' })).toBeVisible();
  expect(distantLoads).toBe(0);
  const last = page.locator('.activity-card').filter({ has: page.getByRole('heading', { name: distant.title, exact: true }) });
  await last.scrollIntoViewIfNeeded();
  await expect(last.getByRole('img', { name: `${distant.title}的路线轮廓` })).toBeVisible();
  expect(distantLoads).toBe(1);
});
