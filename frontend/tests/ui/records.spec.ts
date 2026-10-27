import { expect, test, type Locator, type Page } from '@playwright/test';

const box = async (locator: Locator) => { const value = await locator.boundingBox(); expect(value).not.toBeNull(); return value!; };
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const RECORDS = '**/api/v1/showcase/statistics/records**';

// Synthetic fixture (tests/fixtures/ui-api.mjs): 22 months 2025-01..2026-10, 2026 is the partial year
// with 265 km and +52 km against the same period of 2025; the 5K best is 5:30, there is no 10K yet.

test('the records page opens with the hero banner and a plain-language summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/records');
  await expect(page.getByRole('heading', { name: '个人记录', level: 1 })).toBeVisible();
  await expect(page.getByTestId('records-ready')).toBeVisible();

  const banner = page.getByTestId('records-banner');
  await expect(banner).toHaveAccessibleName('最佳成绩');
  await expect(banner.getByRole('link', { name: '查看全部个人记录' })).toHaveCount(0);
  const [a, b, c] = [await box(page.getByTestId('records-banner-5km')), await box(page.getByTestId('records-banner-10km')), await box(page.getByTestId('records-banner-total'))];
  for (const other of [b, c]) expect(Math.abs(a.y - other.y)).toBeLessThanOrEqual(1);
  expect(c.x).toBeGreaterThan(b.x);
  await expect(page.getByTestId('records-banner-5km')).toContainText('5:30');

  const summary = page.getByTestId('records-summary');
  await expect(summary).toHaveText('今年已跑 265 km，比去年同期多 52 km');
  // The summary sits right below the banner, before the monthly card.
  const [bannerBox, summaryBox, monthlyBox] = [await box(banner), await box(summary), await box(page.getByTestId('records-monthly'))];
  expect(summaryBox.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
  expect(monthlyBox.y).toBeGreaterThanOrEqual(summaryBox.y + summaryBox.height);
  // No year form or comparison chart any more.
  await expect(page.getByLabel('对比年份')).toHaveCount(0);
  await expect(page.getByTestId('records-chart-compare')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the monthly card switches between distance and pace and keeps a full data table', async ({ page }) => {
  await page.goto('/records');
  const chart = page.getByTestId('records-chart-monthly');
  await expect(chart).toHaveAttribute('data-ready', 'true');
  await expect(chart).toHaveAttribute('role', 'img');
  const card = page.getByTestId('records-monthly');
  await expect(card.getByRole('heading', { name: '月度里程与配速' })).toBeVisible();
  const group = card.getByRole('group', { name: '月度指标' });
  const distance = group.getByRole('button', { name: '里程' }), pace = group.getByRole('button', { name: '配速' });
  await expect(distance).toHaveAttribute('aria-pressed', 'true');
  await expect(pace).toHaveAttribute('aria-pressed', 'false');

  const table = page.getByTestId('records-chart-monthly-table');
  await expect(table.locator('tbody tr')).toHaveCount(22);
  await expect(table.locator('thead th')).toHaveText(['月份', '里程', '活动次数', '配速']);
  await expect(table.locator('tbody tr').first()).toContainText('2025-01');
  await expect(table.locator('tbody tr').last()).toContainText('2026-10');

  await pace.click();
  await expect(pace).toHaveAttribute('aria-pressed', 'true');
  await expect(distance).toHaveAttribute('aria-pressed', 'false');
  await expect(table.locator('thead th')).toHaveText(['月份', '配速', '活动次数', '里程']);
  await expect(table.locator('tbody tr')).toHaveCount(22);
  await expect(chart).toHaveAttribute('data-ready', 'true');
  await expect(chart).toHaveAccessibleName(/月度配速/);
});

test('the yearly review lists the latest year first with honest change labels', async ({ page }) => {
  await page.goto('/records');
  const years = page.getByTestId('records-years');
  await expect(years.getByText('一年一年看')).toBeVisible();
  const rows = years.locator('[data-testid^="records-year-"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'records-year-2026');
  const current = page.getByTestId('records-year-2026'), first = page.getByTestId('records-year-2025');
  await expect(current).toContainText('进行中');
  await expect(current).toContainText('较去年同期 +52 km');
  await expect(current).toContainText('265 km');
  await expect(first).not.toContainText('较');
  await expect(first).not.toContainText('进行中');
  await expect(years.locator('details tbody tr')).toHaveCount(2);
  await expect(years.locator('details thead th')).toHaveText(['年份', '次数', '里程', '活动天数', '平均配速', '变化']);
});

test('the training rhythm shows 26 weekly dots and 7 weekday bars', async ({ page }) => {
  await page.goto('/records');
  const rhythm = page.getByTestId('records-rhythm');
  await expect(rhythm.getByText('跑得有多勤')).toBeVisible();
  const dots = rhythm.getByTestId('records-week-dot'), bars = rhythm.getByTestId('records-weekday-bar');
  await expect(dots).toHaveCount(26);
  await expect(bars).toHaveCount(7);
  await expect(dots.first()).toHaveAttribute('title', /5 月 4 日/);
  await expect(dots.first()).toHaveAttribute('aria-label', /没有跑步/);
  await expect(dots.nth(3)).toHaveAttribute('aria-label', /跑了 3 天/);
  // Levels: 0 days, 1–2, 3–4, 5+ (fixture weeks cycle 0..3 and the latest week has 5).
  for (const [index, level] of [[0, '0'], [1, '1'], [2, '1'], [3, '2'], [25, '3']] as const) await expect(dots.nth(index)).toHaveAttribute('data-level', level);
  await expect(dots.nth(25)).toHaveAttribute('aria-label', /跑了 5 天/);
  // Each dot keeps its list item; the image role sits on the dot inside it.
  await expect(rhythm.getByRole('list', { name: '最近 26 周每周跑步天数' }).getByRole('listitem')).toHaveCount(26);
  await expect(bars.last()).toHaveAttribute('aria-label', '周日 跑了 6 次');
  await expect(bars.last()).toHaveAttribute('data-peak', 'true');
  for (let i = 0; i < 6; i++) await expect(bars.nth(i)).toHaveAttribute('data-peak', 'false');
  await expect(rhythm).toContainText('有 19 周出门跑过；周日跑得最多');
});

test('the yearly and rhythm cards sit side by side only when each gets at least 28rem', async ({ page }) => {
  await page.goto('/records');
  const [years, rhythm] = [await box(page.getByTestId('records-years')), await box(page.getByTestId('records-rhythm'))];
  expect(Math.abs(years.y - rhythm.y)).toBeLessThanOrEqual(1);
  expect(rhythm.x).toBeGreaterThan(years.x + years.width - 1);
  // 1100px with the sidebar leaves the row too narrow for two 28rem cards.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => (await box(page.getByTestId('records-rhythm'))).y).toBeGreaterThan((await box(page.getByTestId('records-years'))).y + 10);
});

test('an account without any run shows the empty state without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(RECORDS, route => route.continue({ url: `${route.request().url()}?empty=1` }));
  await page.goto('/records');
  await expect(page.getByTestId('records-empty')).toBeVisible();
  await expect(page.getByTestId('records-ready')).toHaveCount(0);
  await expect(page.getByTestId('records-banner-total')).toContainText('还没有跑步记录');
  await expect(page.getByTestId('records-summary')).toContainText('还没有跑步');
  await expect(page.getByTestId('records-chart-monthly')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a failed read can be retried', async ({ page }) => {
  let calls = 0;
  await page.route(RECORDS, route => { calls++; return calls === 1 ? route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '服务暂时不可用' } } }) : route.fallback(); });
  await page.goto('/records');
  const error = page.getByTestId('records-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('服务暂时不可用');
  await error.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(error).toHaveCount(0);
  expect(calls).toBe(2);
});

test('an expired session leaves the page for the login screen', async ({ page }) => {
  await page.route(RECORDS, route => route.fulfill({ status: 401, json: { data: null, error: { message: '会话已过期' } } }));
  await page.goto('/records');
  await expect(page).toHaveURL(/\/admin\?reason=expired&next=%2Frecords$/);
});

test('navigation lists the records entry and the phone layout does not overflow', async ({ page }) => {
  await page.goto('/records');
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '个人记录' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByTestId('records-chart-monthly')).toHaveAttribute('data-ready', 'true');
  await noOverflow(page);
  for (const summary of await page.locator('.records-page details > summary').all()) await summary.click();
  await expect(page.locator('.records-page details[open]')).toHaveCount(3);
  await noOverflow(page);
  const [years, rhythm] = [await box(page.getByTestId('records-years')), await box(page.getByTestId('records-rhythm'))];
  expect(rhythm.y).toBeGreaterThanOrEqual(years.y + years.height - 1);
  expect(Math.abs(years.width - rhythm.width)).toBeLessThanOrEqual(1);
});
