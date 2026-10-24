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

test('works on a phone width without horizontal scroll, with the dark scheme applied', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('anonymous visitors see the list without being sent to the admin login', async ({ page }) => {
  await fixture(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toContainText('3 次');
  await expect(page).toHaveURL(/\/routes(?:\?.*)?$/);
  expect(page.url()).not.toContain('/admin');
});

test('anonymous visitors can open a route detail with its run table', async ({ page }) => {
  await fixture(page);
  await page.goto(`/routes/${id}`);
  await expect(page.getByTestId('route-detail-ready')).toBeVisible();
  await expect(page.getByTestId('route-run-row')).toHaveCount(2);
  expect(page.url()).not.toContain('/admin');
});

test('keeps polling after a transient error until the building banner clears', async ({ page }) => {
  let calls = 0;
  await installActivities(page); await installBasemaps(page);
  await page.route('**/api/v1/showcase/routes/groups?**', route => {
    calls += 1;
    if (calls === 2) return route.fulfill({ status: 503, json: { data: null, error: { message: '路线暂不可用，请重试' } } });
    const building = calls === 1;
    return route.fulfill({ json: { data: { items: building ? [] : [item], total: building ? 0 : 1, limit: 20, offset: 0, building }, error: null } });
  });
  await page.clock.install();
  await page.goto('/routes');
  await expect(page.getByTestId('route-building')).toBeVisible();
  await page.clock.fastForward(5000);
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByTestId('route-building')).toBeVisible();
  await page.clock.fastForward(5000);
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  await expect(page.getByTestId('route-building')).toHaveCount(0);
});

test('sort buttons use the shared glass segmented control with a selected item', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  const group = page.getByRole('group', { name: '排序方式' });
  await expect(group).toHaveClass(/settings-tabs/);
  await expect(group).not.toHaveClass(/compact-switch/);
  // The switch lives in the yellow page header footer, like the settings tabs.
  await expect(page.locator('.page-header .page-header-footer').getByRole('group', { name: '排序方式' })).toHaveCount(1);
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  const selected = group.getByRole('button', { name: '跑得最多' }), other = group.getByRole('button', { name: '最近跑过' });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(other).toHaveAttribute('aria-pressed', 'false');
  // The shared enhancer adds the glass lens inside the container; the page no longer styles the buttons itself.
  await expect(group).toHaveClass(/rn-liquid-navigation/);
  await expect(group.locator('.rn-moving-copy')).toHaveCount(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the selected sort button is visibly marked by the glass indicator (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fixture(page); await loginRunner(page);
    await page.goto('/routes');
    const group = page.getByRole('group', { name: '排序方式' });
    await expect(page.getByTestId('route-card').first()).toBeVisible();
    const selected = group.getByRole('button', { name: '跑得最多' }), other = group.getByRole('button', { name: '最近跑过' });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const outline = group.locator('.rn-moving-outline');
    await expect(outline).toHaveCount(1);
    const overlap = async () => {
      const [o, s, u] = await Promise.all([outline.boundingBox(), selected.boundingBox(), other.boundingBox()]);
      const area = (a: NonNullable<typeof o>, b: NonNullable<typeof o>) =>
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return { onSelected: area(o!, s!) / (s!.width * s!.height), onOther: area(o!, u!) / (u!.width * u!.height) };
    };
    // The spring animates to the selected item; wait until it covers the pressed button and not the other one.
    await expect.poll(async () => (await overlap()).onSelected).toBeGreaterThan(.8);
    expect((await overlap()).onOther).toBeLessThan(.2);
    const box = await outline.boundingBox();
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.height).toBeGreaterThan(20);
  });
}
