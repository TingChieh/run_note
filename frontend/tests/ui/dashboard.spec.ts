import { expect, test, type Page } from '@playwright/test';
import { loginRunner, sampleActivity } from '../fixtures/activities';
const empty = { activity_count: 0, distance_m: 0, duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0, activity_days: 0, pace_eligible_count: 0, pace_eligible_distance_m: 0, avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' };
const populated = { ...empty, activity_count: 2, distance_m: '10246.912', duration_sum_seconds: 1800, known_duration_count: 1, missing_duration_count: 1, activity_days: 2, pace_eligible_count: 1, pace_eligible_distance_m: '5123.456', avg_pace_seconds_per_km: '351.3', quality_warning_count: 1 };
async function fixture(page: Page) {
  const state = { cumulativeFailures: 0, summaryFailures: 0, calendarFailures: 0, trendFailures: 0, dayFailures: 0, expired: false };
  await page.route('**/api/v1/statistics/**', async route => {
    const url = new URL(route.request().url()); const year = Number(url.searchParams.get('year') ?? url.searchParams.get('date_from')?.slice(0,4) ?? '2026');
    const summary = year === 2026 ? populated : empty;
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: { data, error: status >= 400 ? { message: '统计暂时不可用' } : null } });
    if (state.expired) return send(null,401);
    if (url.pathname.endsWith('/summary')) { if (!url.searchParams.has('date_from') && state.cumulativeFailures-- > 0) return send(null,503); if (url.searchParams.has('date_from') && state.summaryFailures-- > 0) return send(null,503); return send(summary); }
    if (url.pathname.endsWith('/calendar')) {
      if (state.calendarFailures-- > 0) return send(null,503);
      const days = [];
      for (let d = new Date(`${year}-01-01T00:00:00Z`); d.getUTCFullYear() === year; d = new Date(+d + 86400000)) {
        const date = d.toISOString().slice(0,10), active = year === 2026 && ['2026-10-12','2026-10-13'].includes(date);
        days.push({ date, activity_count: active ? 1 : 0, distance_m: active ? '5123.456' : 0, duration_sum_seconds: date === '2026-10-13' ? 1800 : null, known_duration_count: date === '2026-10-13' ? 1 : 0, missing_duration_count: date === '2026-10-12' ? 1 : 0 });
      }
      return send({ year, metric: url.searchParams.get('metric'), days, activity_count: summary.activity_count, distance_m: summary.distance_m, date_assignment: 'activity_local_date' });
    }
    if (state.trendFailures-- > 0) return send(null,503);
    const from = `${year}-01-01`, to = `${year+1}-01-01`, period = url.searchParams.get('period');
    // Contiguous contract buckets, with the actual totals in the October bucket.
    const buckets = []; let cursor = new Date(`${from}T00:00:00Z`);
    while (cursor.getUTCFullYear() === year) {
      const start = cursor.toISOString().slice(0,10);
      const end = new Date(cursor);
      if (period === 'month') end.setUTCMonth(end.getUTCMonth()+1,1); else end.setUTCDate(end.getUTCDate() + ((8-end.getUTCDay())%7 || 7));
      const capped = end.toISOString().slice(0,10) > to ? to : end.toISOString().slice(0,10);
      buckets.push({ ...(start <= '2026-10-13' && capped > '2026-10-13' ? summary : empty), bucket_start:start, bucket_end:capped, is_partial: period === 'week' && (start === from || capped === to) });
      cursor = new Date(`${capped}T00:00:00Z`);
    }
    return send({ period, date_from:from, date_to:to, week_start:'monday', date_assignment:'activity_local_date', buckets });
  });
  await page.route(/\/api\/v1\/activities\?/, route => {
    if (state.dayFailures-- > 0) return route.fulfill({status:503,json:{error:{message:'当天读取失败'}}});
    return route.fulfill({json:{data:{items:[sampleActivity],total:1,limit:20,offset:0},error:null}});
  });
  return state;
}
async function capture(page: Page, name: string) {
  await page.evaluate(async () => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0,0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({path:`test-results/dashboard-${name}.png`,fullPage:false});
}
test('populated dashboard: hierarchy, disclosure, calendar keyboard, date and chart controls', async ({page}) => {
  await fixture(page); await loginRunner(page); await page.goto('/dashboard?year=2026');
  await expect(page.getByTestId('annual-distance')).toHaveText('10.2 km');
  await expect(page.getByTestId('annual-count')).toHaveText('2 次');
  await expect(page.getByText('已知耗时合计')).toBeHidden();
  await page.getByText('统计口径与数据质量', {exact:true}).click();
  await expect(page.getByText(/未知 1 次/).first()).toBeVisible();
  await page.getByText('统计口径与数据质量', {exact:true}).click();
  const day = page.getByRole('button',{name:/2026-10-13，/});
  await day.focus(); await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button',{name:/2026-10-12，/})).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:/2026-10-13 的活动/})).toBeVisible();
  await expect(page.getByRole('link',{name:/河畔晨跑/})).toBeVisible();
  await expect(page).toHaveURL(/day=2026-10-13/);
  await page.getByLabel('日历维度').selectOption('count');
  await expect(page).toHaveURL(/metric=count/);
  await expect(day).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByLabel('趋势周期').selectOption('week'); await expect(page.locator('canvas')).toBeVisible();
  await page.getByLabel('趋势指标').selectOption('pace');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByLabel('趋势周期').selectOption('month');
  await page.getByLabel('趋势指标').selectOption('distance');
  await page.getByRole('button',{name:'收起当天记录'}).click();
  await page.setViewportSize({width:1440,height:1380}); await capture(page,'desktop-data');
  const email = page.getByTestId('current-user');
  await expect(email).toHaveAttribute('title','runner.with.a.long.email.address@example.com');
  expect(await email.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    // ECharts resizes its canvas in ResizeObserver after the viewport changes.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `Dashboard fits ${width}px after chart resize` }).toBe(true);
    expect(await day.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(18);
  }
  await page.setViewportSize({width:390,height:1100}); await page.locator('.calendar-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; }); await capture(page,'mobile-data');
  await page.getByRole('heading',{name:'运动趋势',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/dashboard-mobile-trend.png',fullPage:false});
});
test('empty years, leap year, year controls, compact import guidance and reload', async ({page}) => {
  await fixture(page); await loginRunner(page); await page.goto('/dashboard?year=2025');
  await expect(page.getByTestId('trend-empty')).toBeVisible(); await expect(page.locator('canvas')).toHaveCount(0);
  await capture(page,'desktop-empty');
  await page.getByRole('button',{name:'上一年',exact:true}).click();
  await expect(page.getByRole('button',{name:/2024-02-29，/})).toHaveCount(1);
  await page.getByRole('button',{name:'下一年',exact:true}).click();
  await expect(page).toHaveURL(/year=2025/); await page.reload();
  await expect(page.getByLabel('年份',{exact:true})).toHaveValue('2025');
  await page.setViewportSize({width:390,height:1100}); await capture(page,'mobile-empty');
  await page.getByTestId('trend-empty').scrollIntoViewIfNeeded(); await page.screenshot({path:'test-results/dashboard-mobile-empty-trend.png',fullPage:false});
  await page.getByTestId('trend-empty').getByRole('link',{name:'导入 GPX'}).click(); await expect(page).toHaveURL(/\/activities$/);
});
test('statistics and date errors have independent retries; session expiry redirects', async ({page}) => {
  const state = await fixture(page); state.cumulativeFailures=1; state.summaryFailures=1; state.calendarFailures=1; state.trendFailures=1;
  await loginRunner(page); await page.goto('/dashboard?year=2026');
  await expect(page.getByRole('button',{name:'重新读取统计',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'重新读取趋势',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重试累计统计',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试累计统计',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'重新读取统计',exact:true}).click();
  await expect(page.getByTestId('annual-distance')).toHaveText('10.2 km');
  await expect(page.locator('canvas')).toBeVisible();
  state.dayFailures=1; await page.getByRole('button',{name:/2026-10-13，/}).click();
  await page.getByRole('button',{name:'重试当天活动'}).click(); await expect(page.getByRole('link',{name:/河畔晨跑/})).toBeVisible();
  state.trendFailures=1; await page.getByLabel('趋势周期').selectOption('week');
  await page.getByRole('button',{name:'重新读取趋势'}).click(); await expect(page.locator('canvas')).toBeVisible();
  state.expired=true; await page.getByRole('button',{name:'上一年',exact:true}).click(); await expect(page).toHaveURL(/login\?reason=expired/);
});

test('year input, boundaries, URL date restore and slow previous-year response', async ({page}) => {
  await fixture(page); await loginRunner(page);
  await page.goto('/dashboard?year=2026&day=2026-10-13&metric=count&period=week');
  await expect(page.getByRole('link',{name:/河畔晨跑/})).toBeVisible();
  await expect(page.getByLabel('日历维度')).toHaveValue('count');
  await expect(page.getByLabel('趋势周期')).toHaveValue('week');
  await page.getByLabel('年份',{exact:true}).fill('abc'); await page.getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('1900–2100');
  await page.getByLabel('年份',{exact:true}).fill('1900'); await page.getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('button',{name:'上一年',exact:true})).toBeDisabled();
  await page.getByLabel('年份',{exact:true}).fill('2100'); await page.getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('button',{name:'下一年',exact:true})).toBeDisabled();
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/v1/statistics/calendar?year=2025&metric=count', async route => { entered(); await held; await route.fallback(); });
  await page.getByLabel('年份',{exact:true}).fill('2025'); await page.getByRole('button',{name:'查看',exact:true}).click();
  await started; await expect(page.getByRole('status').filter({hasText:'正在读取 2025'})).toBeVisible();
  await page.getByRole('button',{name:'下一年',exact:true}).click();
  await expect(page.getByTestId('annual-distance')).toHaveText('10.2 km'); release();
  await expect(page.getByRole('heading',{name:'2026 年运动日历',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/2026-10-13，/})).toHaveCount(1);
  await expect(page.getByRole('button',{name:/2025-10-13，/})).toHaveCount(0);
});
