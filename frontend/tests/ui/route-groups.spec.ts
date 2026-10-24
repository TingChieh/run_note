import { expect, test, type Page } from '@playwright/test';
import { loginRunner, installActivities } from '../fixtures/activities';
import { installBasemaps } from '../fixtures/basemaps';

const id = '11111111-1111-4111-8111-111111111111';
const shape = [[[121.47, 31.23], [121.474, 31.23], [121.474, 31.233], [121.47, 31.233], [121.47, 31.23]]];
const item = { id, run_count: 3, first_date: '2025-01-01', last_date: '2025-02-01', median_distance_m: '1200.000', best_duration_seconds: '360.000', avg_duration_seconds: '380.000', best_pace_seconds_per_km: '300.000', avg_pace_seconds_per_km: '316.667', shape };
const runs = [
  { activity_id: id, title: '周末环湖', activity_date: '2025-02-01', distance_m: '1200.000', duration_seconds: '360.000', avg_pace_seconds_per_km: '300.000', coverage: 0.96 },
  { activity_id: '22222222-2222-4222-8222-222222222222', title: '晨跑', activity_date: '2025-01-01', distance_m: '1200.000', duration_seconds: '400.000', avg_pace_seconds_per_km: '333.333', coverage: 1 },
];

async function fixture(page: Page, scenario: 'ready' | 'empty' | 'building' | 'error' = 'ready') {
  const requests: URL[] = [];
  await installActivities(page);
  await installBasemaps(page);
  await page.route('**/api/v1/showcase/routes/groups?**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (scenario === 'error') return route.fulfill({ status: 503, json: { data: null, error: { message: '路线暂不可用，请重试' } } });
    const items = scenario === 'empty' || scenario === 'building' ? [] : [item];
    return route.fulfill({ json: { data: { items, total: items.length, limit: 20, offset: 0, building: scenario === 'building' }, error: null } });
  });
  await page.route(`**/api/v1/showcase/routes/groups/${id}`, route => route.fulfill({ json: { data: { ...item, runs }, error: null } }));
  return requests;
}

test('lists routes with counts and best time, and links to the detail', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  const card = page.getByTestId('route-card').first();
  await expect(card).toContainText('3 次');
  await expect(card).toContainText('6:00');
  await card.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/routes/${id}$`));
  await expect(page.getByTestId('route-detail-ready')).toBeVisible();
  await expect(page.getByTestId('route-run-row')).toHaveCount(2);
});

test('sorting asks the server and keeps the choice in the URL', async ({ page }) => {
  const requests = await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  await page.getByRole('button', { name: '最近跑过' }).click();
  await expect.poll(() => requests.some(url => url.searchParams.get('sort') === 'recent')).toBe(true);
  await expect(page).toHaveURL(/sort=recent/);
});

test('shows the empty state', async ({ page }) => {
  await fixture(page, 'empty'); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByText('还没有跑过两次以上的路线')).toBeVisible();
});

test('shows the building state while routes are being grouped', async ({ page }) => {
  await fixture(page, 'building'); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-building')).toBeVisible();
});

test('shows an error with a retry', async ({ page }) => {
  await fixture(page, 'error'); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByText('路线暂不可用，请重试')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible();
});

test('works in dark mode and on a phone width without horizontal scroll', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
