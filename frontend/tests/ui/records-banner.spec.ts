import { expect, test, type Locator, type Page } from '@playwright/test';

const box = async (locator: Locator) => { const value = await locator.boundingBox(); expect(value).not.toBeNull(); return value!; };
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test('the records banner sits after the milestone section as a full-width row with three equal columns', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByTestId('records-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAccessibleName('个人记录');
  const milestone = await box(page.locator('.milestone-section'));
  const frame = await box(banner);
  expect(Math.abs(frame.x - milestone.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.width - milestone.width)).toBeLessThanOrEqual(1);
  expect(frame.y).toBeGreaterThanOrEqual(milestone.y + milestone.height);
  // DOM order: milestone section, banner, then the activity explorer.
  const order = await page.evaluate(() => {
    const [milestones, records, explorer] = ['.milestone-section', '[data-testid="records-banner"]', 'section[aria-label="运动足迹"]'].map(selector => document.querySelector(selector)!);
    return [milestones.compareDocumentPosition(records), records.compareDocumentPosition(explorer)].every(value => value & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);

  const five = page.getByTestId('records-banner-5km'), ten = page.getByTestId('records-banner-10km'), total = page.getByTestId('records-banner-total');
  const [a, b, c] = [await box(five), await box(ten), await box(total)];
  for (const other of [b, c]) {
    expect(Math.abs(a.width - other.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - other.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - other.y)).toBeLessThanOrEqual(1);
  }
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  expect(c.x).toBeGreaterThan(b.x + b.width - 1);

  await expect(five).toContainText('5:30');
  await expect(five).toContainText('3 月 5 日，5.0 km，用了 27:30');
  await expect(five).toContainText('共跑过 4 次 5K 级');
  await expect(five.getByTestId('records-banner-gain-5km')).toHaveAttribute('role', 'img');
  await expect(five.getByTestId('records-banner-gain-5km')).toHaveAccessibleName('首次配速 6:12，最佳配速 5:30，快了 42 秒每公里');
  await expect(five).toContainText('比第一次快了 42 秒 / km');
  await expect(ten).toContainText('还没有 10K 记录');
  await expect(ten).toContainText('9.0–12.0 km');
  await expect(page.getByTestId('records-banner-gain-10km')).toHaveCount(0);
  await expect(ten).not.toContainText('共跑过');
  // Whole-history overview from `totals` (synthetic fixture: 44 runs, 451 km, 42 days, since 2025-01).
  await expect(total).toHaveAccessibleName('跑步总览');
  await expect(total).toContainText('451');
  await expect(total).toContainText('共 44 次 · 42 个活动日');
  await expect(total).toContainText('从 2025 年 1 月开始');
  await expect(total).toContainText('平均配速 5:47 /km');

  const link = banner.getByRole('link', { name: '查看全部个人记录' });
  await expect(link).toHaveAttribute('href', '/records');
  // The duplicated feature entrances are gone; the sidebar remains the way around.
  await expect(page.getByRole('navigation', { name: '功能入口' })).toHaveCount(0);
});

test('on a phone the three columns stack without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const five = page.getByTestId('records-banner-5km'), ten = page.getByTestId('records-banner-10km'), total = page.getByTestId('records-banner-total');
  await expect(total).toBeVisible();
  const [a, b, c] = [await box(five), await box(ten), await box(total)];
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(c.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
  for (const other of [b, c]) {
    expect(Math.abs(a.x - other.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - other.width)).toBeLessThanOrEqual(1);
  }
  await noOverflow(page);
});

test('without any run the banner still shows all three columns with invitations', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', route => route.continue({ url: `${route.request().url()}?empty=1` }));
  await page.goto('/');
  await expect(page.getByTestId('records-banner-5km')).toContainText('还没有 5K 记录');
  await expect(page.getByTestId('records-banner-5km')).toContainText('4.0–7.5 km');
  await expect(page.getByTestId('records-banner-10km')).toContainText('还没有 10K 记录');
  await expect(page.getByTestId('records-banner-total')).toContainText('还没有跑步记录');
  await expect(page.getByTestId('records-banner-total')).not.toContainText('平均配速');
  await expect(page.getByTestId('records-banner').getByRole('img')).toHaveCount(0);
});

test('a failing records request shows an error with retry in the banner place and leaves the dashboard intact', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/showcase/statistics/records**', route => fail
    ? route.fulfill({ status: 503, json: { data: null, error: { message: '暂时无法读取，请重试' } } })
    : route.fallback());
  await page.goto('/');
  const slot = page.getByTestId('records-banner-slot');
  await expect(slot.getByRole('alert')).toContainText('个人记录暂时读不到');
  await expect(slot).toContainText('暂时无法读取，请重试');
  await expect(page.getByTestId('annual-distance')).toBeVisible();
  await expect(page.getByRole('region', { name: '运动目标' })).toBeVisible();
  fail = false;
  await slot.getByRole('button', { name: '重试读取个人记录' }).click();
  await expect(page.getByTestId('records-banner-5km')).toContainText('5:30');
  await expect(page.getByTestId('records-banner-slot')).toHaveCount(0);
});

test('an expired session on the records request leaves the dashboard for the login screen', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', route => route.fulfill({ status: 401, json: { data: null, error: { message: '会话已过期' } } }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/admin\?reason=expired&next=%2Fdashboard$/);
});

test('the entrance count-up never leaves wrong values: final before it plays, after it plays and with reduced motion', async ({ page }) => {
  // Short viewport: the banner starts below the fold, so the animation has not run yet.
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.goto('/');
  const banner = page.getByTestId('records-banner');
  const fivePace = banner.getByTestId('records-banner-5km').locator('.figure strong'), total = banner.getByTestId('records-banner-total').locator('.figure strong');
  await expect(banner).toHaveAccessibleName('个人记录');
  await expect(banner).not.toHaveClass(/play/);
  await expect(fivePace).toHaveText('5:30');
  await expect(total).toHaveText('451');
  await banner.scrollIntoViewIfNeeded();
  await expect(banner).toHaveClass(/play/);
  await expect(fivePace).toHaveText('5:30');
  await expect(total).toHaveText('451');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await banner.scrollIntoViewIfNeeded();
  await expect(fivePace).toHaveText('5:30');
  await expect(banner).not.toHaveClass(/play/);
  await expect(banner.getByTestId('records-banner-gain-5km').locator('.segment')).toHaveCSS('transform', 'none');
});

// The banner switches layout by its own width (container query, 54rem of content width), not by the viewport. With the left sidebar gone (top navigation, shell breakpoint 800px) the content column is the viewport minus
// two page paddings, so the two-column-plus-strip layout now covers roughly 700-980px viewports; measured: 1000px and wider already give three columns (tested at 1440 above), 640px stacks.
for (const width of [800, 900, 960]) {
  test(`at a mid-width viewport (${width}px) 5K and 10K sit side by side above a full-width totals strip`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const five = page.getByTestId('records-banner-5km'), ten = page.getByTestId('records-banner-10km'), total = page.getByTestId('records-banner-total');
    await expect(total).toBeVisible();
    const [a, b, c] = [await box(five), await box(ten), await box(total)];
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    expect(Math.abs(c.x - a.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.x + c.width - (b.x + b.width))).toBeLessThanOrEqual(1);
    // The strip keeps every fact on one line next to the figure.
    await expect(total).toContainText('共 44 次 · 42 个活动日');
    expect(c.height).toBeLessThan(a.height);
    await noOverflow(page);
  });
}

test('a gain smaller than half a second says "almost as fast", not "still the first run"', async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/records**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const five = body.data.personal_bests[0];
    five.first.avg_pace_seconds_per_km = '330.400';
    five.pace_gain_seconds_per_km = '0.400';
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  const five = page.getByTestId('records-banner-5km');
  await expect(five).toContainText('和第一次几乎一样快');
  await expect(five).not.toContainText('最快的一次仍是第一次');
  await expect(page.getByTestId('records-banner-gain-5km')).toHaveCount(0);
});
