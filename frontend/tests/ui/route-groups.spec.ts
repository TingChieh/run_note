import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
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

test('sorting asks the server and keeps the URL clean', async ({ page }) => {
  const requests = await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  const total = page.getByTestId('page-meta');
  await expect(total).toHaveText('共 1 条常跑路线');
  await expect(total, '结果数量变化会通过实时区域播报').toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: '最近跑过' }).click();
  await expect.poll(() => requests.some(url => url.searchParams.get('sort') === 'recent')).toBe(true);
  await expect(page).toHaveURL(/\/routes$/);
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

test('sort buttons use Editorial Receipt underline tabs with a selected item', async ({ page }) => {
  await fixture(page); await loginRunner(page);
  await page.goto('/routes');
  await expect(page.locator('.editorial-page.routes-shell')).toBeVisible();
  const group = page.getByRole('group', { name: '排序方式' });
  await expect(group).toHaveClass(/underline-tabs/);
  await expect(group).not.toHaveClass(/settings-tabs/);
  await expect(group).not.toHaveClass(/compact-switch/);
  await expect(page.getByTestId('route-card').first()).toBeVisible();
  const selected = group.getByRole('button', { name: '跑得最多' }), other = group.getByRole('button', { name: '最近跑过' });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(other).toHaveAttribute('aria-pressed', 'false');
  await expect(group.locator('.rn-moving-copy')).toHaveCount(0);
});

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`/routes and /routes/[id] render cleanly without overflow at ${width}x${height} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height });
      await fixture(page); await loginRunner(page);
      await page.goto('/routes');
      await expect(page.locator('.editorial-page.routes-shell')).toBeVisible();
      await expect(page.getByTestId('route-card').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.goto(`/routes/${id}`);
      await expect(page.locator('.editorial-page.route-detail-shell')).toBeVisible();
      await expect(page.getByTestId('route-detail-ready')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

// PR #169 follow-up: the 标题 column must absorb long titles instead of widening the table, so 日期/距离/用时/配速
// stay on screen without horizontal scrolling at every width.
const sixCharTitle = '周末环湖晨跑';
const longTitle = '沿江晨跑'.repeat(30);

async function detailWithTitle(page: Page, title: string) {
  // The first row is the widest realistic case: two-digit distance, an hour-long duration and a minute-range pace.
  const rows = runs.map((run, index) =>
    index === 0
      ? { ...run, title, distance_m: '12345.000', duration_seconds: '3723.000', avg_pace_seconds_per_km: '375.000' }
      : { ...run, title },
  );
  await page.route(`**/api/v1/showcase/routes/groups/${id}`, route =>
    route.fulfill({ json: { data: { ...item, runs: rows }, error: null } }),
  );
}

for (const title of [sixCharTitle, longTitle]) {
  const label = title === sixCharTitle ? '六字标题' : '120 字标题';
  for (const width of [320, 390, 768, 1440] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${label} keeps every run-table column visible at ${width}px (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        await fixture(page);
        await detailWithTitle(page, title);
        await loginRunner(page);
        await page.goto(`/routes/${id}`);
        await expect(page.getByTestId('route-detail-ready')).toBeVisible();
        await expect(page.getByTestId('route-run-row')).toHaveCount(2);

        const metrics = await page.locator('.table-wrap').evaluate((wrap) => {
          const box = wrap.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            scrollWidth: wrap.scrollWidth,
            clientWidth: wrap.clientWidth,
            cells: [...wrap.querySelectorAll('tbody tr:first-child > td')].map((cell) => {
              const rect = cell.getBoundingClientRect();
              return {
                left: rect.left,
                right: rect.right,
                scrollWidth: cell.scrollWidth,
                clientWidth: cell.clientWidth,
                text: (cell.textContent ?? '').trim(),
              };
            }),
          };
        });

        expect(metrics.cells).toHaveLength(5);
        expect(metrics.scrollWidth, '表格不产生横向滚动').toBeLessThanOrEqual(metrics.clientWidth + 1);
        for (const [index, cell] of metrics.cells.entries()) {
          expect(cell.left, `第 ${index + 1} 列不越过表格左缘`).toBeGreaterThanOrEqual(metrics.left - 1);
          expect(cell.right, `第 ${index + 1} 列不越过表格右缘`).toBeLessThanOrEqual(metrics.right + 1);
          expect(cell.right, `第 ${index + 1} 列在视口内`).toBeLessThanOrEqual(width);
        }
        // 日期(0)、标题(1)、距离(2)、用时(3)、配速(4) must wrap or fit inside their own column.
        for (const index of [0, 1, 2, 3, 4]) {
          const cell = metrics.cells[index]!;
          expect(cell.text.length, `第 ${index + 1} 列有内容`).toBeGreaterThan(0);
          expect(cell.scrollWidth, `第 ${index + 1} 列文本完整可见`).toBeLessThanOrEqual(cell.clientWidth + 1);
        }
        const outDir = process.env.RUNNOTE_ROUTES_SCREENSHOTS;
        if (outDir) {
          await page.screenshot({
            path: join(outDir, `route-table-${label}-${width}-${scheme}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
      });
    }
  }
}
