import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';

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
  // There is no sidebar column any more, so the row is only too narrow for two 28rem cards below roughly 940px.
  await page.setViewportSize({ width: 900, height: 900 });
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

const REPORT = '**/api/v1/statistics/report**';

function gate() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

test('anonymous public /records keeps the existing layout without period report UI or report requests', async ({ page }) => {
  const reportRequests: string[] = [];
  page.on('request', req => {
    if (req.url().includes('/statistics/report')) reportRequests.push(req.url());
  });
  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByTestId('period-report')).toHaveCount(0);
  expect(reportRequests).toEqual([]);
  expect((await page.request.get('/api/v1/statistics/report?period=year&year=2024')).status()).toBe(401);
  expect((await page.request.get('/api/v1/showcase/statistics/report?period=year&year=2024')).status()).toBe(404);
});

test('the period report switches between month and year for signed-in users and shows 2024, leap-day, and empty periods', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginRunner(page);
  await page.goto('/workspace/records');
  const card = page.getByTestId('period-report');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('period-report-ready')).toBeVisible();
  await expect(card.getByTestId('period-report-partial')).toHaveText('进行中');

  // Switch to 2024-01 (3 runs / 6 km / 1500 s = 25:00 / 375 s/km = 6:15 /km).
  const monthInput = card.getByLabel('选择月份', { exact: true });
  await monthInput.fill('2024-01');
  await expect(card.getByTestId('period-report-count')).toHaveText('3 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('6 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('25:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('6:15 /km');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-01-01 至 2024-01-31');
  await expect(card.getByTestId('period-report-footnote')).toContainText('缺少有效用时');

  // Step forward to leap month 2024-02 (1 run / 0 km / 0:00 / missing pace).
  await card.getByRole('button', { name: '下一个月' }).click();
  await expect(card.getByTestId('period-report-count')).toHaveText('1 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('0 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('0:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('—');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-02-01 至 2024-02-29');

  // Switch to yearly mode for 2024 (4 runs / 6 km / 25:00 / 6:15 /km).
  const mode = card.getByTestId('period-report-mode');
  await mode.getByRole('button', { name: '年度' }).click();
  await expect(mode.getByRole('button', { name: '年度' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByTestId('period-report-count')).toHaveText('4 次');
  await expect(card.getByTestId('period-report-distance')).toHaveText('6 km');
  await expect(card.getByTestId('period-report-duration')).toHaveText('25:00');
  await expect(card.getByTestId('period-report-pace')).toContainText('6:15 /km');
  await expect(card.getByTestId('period-report-range')).toContainText('2024-01-01 至 2024-12-31');

  // Step to empty year 2023.
  await card.getByRole('button', { name: '上一年' }).click();
  await expect(card.getByTestId('period-report-empty')).toBeVisible();
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');

  // Jump back to current year (partial).
  await card.getByRole('button', { name: '回到今年' }).click();
  await expect(card.getByTestId('period-report-ready')).toBeVisible();
  await expect(card.getByTestId('period-report-partial')).toHaveText('进行中');
  expect(errors).toEqual([]);
});

test('in-flight switches keep heading, aria-label, dates and data consistent across non-empty, empty, error/retry and out-of-order responses', async ({ page }) => {
  await loginRunner(page);
  await page.goto('/workspace/records');
  const card = page.getByTestId('period-report');
  await expect(card.getByTestId('period-report-ready')).toBeVisible();

  // Start at non-empty 2024-01.
  await card.getByLabel('选择月份', { exact: true }).fill('2024-01');
  await expect(card.getByTestId('period-report-count')).toHaveText('3 次');

  // 1) Delayed non-empty -> non-empty (2024-01 -> 2024 year): retained January heading, aria-label, dates & metrics stay aligned.
  const annualGate = gate();
  let holdAnnual = true;
  const annualHandler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const url = new URL(route.request().url());
    if (holdAnnual && url.searchParams.get('period') === 'year' && url.searchParams.get('year') === '2024') {
      holdAnnual = false;
      await annualGate.pending;
    }
    return route.fallback();
  };
  await page.route(REPORT, annualHandler);
  await card.getByTestId('period-report-mode').getByRole('button', { name: '年度' }).click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  const range = card.getByTestId('period-report-range');
  await expect(range.locator('.period-name')).toHaveText('2024 年 1 月');
  await expect(range).toContainText('2024-01-01 至 2024-01-31');
  await expect(card.getByTestId('period-report-refreshing')).toHaveText('正在读取 2024 年…');
  await expect(card.getByTestId('period-report-metrics')).toHaveAttribute('aria-label', '2024 年 1 月跑步报告核心指标');
  await expect(card.getByTestId('period-report-count')).toHaveText('3 次');
  await expect(card.getByTestId('period-report-ready')).toHaveCSS('opacity', '1');
  annualGate.release();
  await expect(card).toHaveAttribute('aria-busy', 'false');
  await expect(range.locator('.period-name')).toHaveText('2024 年');
  await expect(range).toContainText('2024-01-01 至 2024-12-31');
  await expect(card.getByTestId('period-report-metrics')).toHaveAttribute('aria-label', '2024 年跑步报告核心指标');
  await expect(card.getByTestId('period-report-count')).toHaveText('4 次');
  await page.unroute(REPORT, annualHandler);

  // 2) Delayed empty -> non-empty (2023 -> 2024): empty heading & range stay 2023 until 2024 resolves.
  await card.getByRole('button', { name: '上一年' }).click();
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');
  const emptyToFilledGate = gate();
  let hold2024 = true;
  const emptyToFilledHandler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const url = new URL(route.request().url());
    if (hold2024 && url.searchParams.get('period') === 'year' && url.searchParams.get('year') === '2024') {
      hold2024 = false;
      await emptyToFilledGate.pending;
    }
    return route.fallback();
  };
  await page.route(REPORT, emptyToFilledHandler);
  await card.getByRole('button', { name: '下一年' }).click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(range.locator('.period-name')).toHaveText('2023 年');
  await expect(card.getByTestId('period-report-empty')).toContainText('2023 年没有跑步记录');
  await expect(card.getByTestId('period-report-empty')).toHaveCSS('opacity', '1');
  await expect(card.getByTestId('period-report-refreshing')).toHaveText('正在读取 2024 年…');
  emptyToFilledGate.release();
  await expect(card.getByTestId('period-report-ready')).toBeVisible();
  await expect(range.locator('.period-name')).toHaveText('2024 年');
  await expect(card.getByTestId('period-report-count')).toHaveText('4 次');
  await page.unroute(REPORT, emptyToFilledHandler);

  // 3) Out-of-order rapid switches (2024 -> 2025 slow -> 2026 fast; late 2025 must not overwrite 2026).
  const slow2025 = gate();
  const raceHandler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('period') === 'year' && url.searchParams.get('year') === '2025') {
      await slow2025.pending;
    }
    return route.fallback();
  };
  await page.route(REPORT, raceHandler);
  const yearSelect = card.getByLabel('选择年份', { exact: true });
  await yearSelect.selectOption('2025');
  await expect(card.getByTestId('period-report-refreshing')).toHaveText('正在读取 2025 年…');
  await yearSelect.selectOption('2026');
  await expect(card).toHaveAttribute('aria-busy', 'false');
  await expect(range.locator('.period-name')).toHaveText('2026 年');
  await expect(card.getByTestId('period-report-count')).toHaveText('20 次');
  slow2025.release();
  await page.waitForTimeout(200);
  await expect(range.locator('.period-name')).toHaveText('2026 年');
  await expect(card.getByTestId('period-report-count')).toHaveText('20 次');
  await expect(card.getByTestId('period-report-metrics')).toHaveAttribute('aria-label', '2026 年跑步报告核心指标');
  await page.unroute(REPORT, raceHandler);
});

test('the period report handles loading, retryable error, and 401 without breaking the page', async ({ page }) => {
  await loginRunner(page);
  const initialGate = gate();
  let calls = 0;
  await page.route(REPORT, async route => {
    calls++;
    if (calls === 1) {
      await initialGate.pending;
      return route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '报告服务暂时不可用' } } });
    }
    return route.fallback();
  });
  await page.goto('/workspace/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByTestId('period-report-loading')).toBeVisible();
  initialGate.release();
  const error = page.getByTestId('period-report-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('报告服务暂时不可用');
  // Rest of the records page remains unaffected.
  await expect(page.getByTestId('records-monthly')).toBeVisible();
  await error.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('period-report-ready')).toBeVisible();
  await expect(error).toHaveCount(0);
  expect(calls).toBe(2);

  // 401 on subsequent report request redirects to login.
  await page.route(REPORT, route => route.fulfill({ status: 401, json: { data: null, error: { message: '会话已过期' } } }));
  await page.getByTestId('period-report-mode').getByRole('button', { name: '年度' }).click();
  await expect(page).toHaveURL(/\/admin\?reason=expired&next=%2Fworkspace%2Frecords$/);
});

test('the period report renders cleanly across desktop, tablet, and mobile in light and dark themes', async ({ page }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await loginRunner(page);
  for (const [width, height, theme] of [[1440, 900, 'light'], [1440, 900, 'dark'], [768, 1024, 'light'], [768, 1024, 'dark'], [390, 844, 'light'], [390, 844, 'dark']] as const) {
    await page.setViewportSize({ width, height });
    await page.addInitScript(t => localStorage.setItem('runnote-theme', t), theme);
    await page.goto('/workspace/records');
    await expect(page.getByTestId('period-report-ready')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await noOverflow(page);
  }
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
