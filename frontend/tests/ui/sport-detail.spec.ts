import { test, expect, type Page } from '@playwright/test';
import {
  installActivities,
  loginRunner,
  sampleActivity,
  incompleteActivity,
  syntheticReplay,
} from '../fixtures/activities';
import { openGoalPanel } from '../fixtures/top-navigation';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/showcase/statistics/summary?**', (route) =>
    route.fulfill({ json: { data: { distance_m: 12500 }, error: null } }),
  );
});
async function ready(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });
}
async function capture(page: Page, name: string, scrollTo?: string) {
  if (scrollTo) await page.locator(scrollTo).scrollIntoViewIfNeeded();
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement)?.blur();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: `test-results/sport-detail-${name}.png` });
}
test('detail keeps a compact overview beside a spacious route and stays consistent on other routes', async ({
  page,
}) => {
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  await expect(page.getByTestId('sport-hero')).toContainText('河畔晨跑');
  await expect(page.getByTestId('sport-hero')).toContainText('2026-10-13');
  await expect(page.getByTestId('activity-distance')).toHaveText('5.1 km');
  const metrics = await page.getByRole('region', { name: '运动指标' }).boundingBox(),
    map = await page.getByRole('region', { name: '路线', exact: true }).boundingBox();
  expect(map!.x).toBeGreaterThan(metrics!.x + metrics!.width);
  expect(Math.abs(map!.y - metrics!.y)).toBeLessThan(2);
  expect(metrics!.width).toBeGreaterThanOrEqual(360);
  expect(metrics!.width).toBeLessThanOrEqual(420);
  expect(map!.width).toBeGreaterThan(metrics!.width * 1.5);
  const routeCanvas = page.locator('.route-map');
  const canvasBounds = await routeCanvas.boundingBox();
  expect(canvasBounds!.height).toBeGreaterThanOrEqual(520);
  expect(canvasBounds!.height).toBeLessThanOrEqual(580);
  const paceSection = page.getByTestId('activity-pace-section');
  await expect(paceSection).toBeVisible();
  await expect(page.getByTestId('activity-pace-chart')).toBeVisible();
  const paceBounds = await paceSection.boundingBox();
  expect(paceBounds!.y).toBeGreaterThan(canvasBounds!.y + canvasBounds!.height);
  await expect(page.getByTestId('activity-splits-bars')).toBeVisible();
  const splitsDetails = page.getByTestId('activity-splits-details');
  await expect(splitsDetails).toBeVisible();
  // Delete lives inside the 更多 popover menu, never directly on the first screen.
  await expect(page.getByRole('button', { name: '删除记录', exact: true })).toBeHidden();
  const sidebar = page.locator('.app-sidebar');
  expect(await sidebar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  // The bar's material depends on what is under it: compare like with like. Docked (scrolled to the top) it is a plain card; floating over the content it is the glass surface (the backdrop filter).
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(sidebar).not.toHaveAttribute('data-floating');
  const color = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(sidebar).toHaveAttribute('data-floating', '');
  await expect.poll(() => sidebar.evaluate((el) => getComputedStyle(el).backdropFilter)).not.toBe('none');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(sidebar).not.toHaveAttribute('data-floating');
  const active = page
    .getByRole('navigation', { name: '主要导航' })
    .getByRole('link', { name: '跑步记录', exact: true });
  await expect(active).toHaveAttribute('aria-current', 'page');
  await active.focus();
  expect(await active.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await capture(page, 'desktop');
  await splitsDetails.locator('summary').click();
  await expect(splitsDetails.locator('table')).toBeVisible();
  await splitsDetails.locator('summary').click();
  await page.getByText('数据质量与指标说明', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('有效轨迹点', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await ready(page);
  await active.click();
  await expect(page).toHaveURL(/\/activities(\?id=[0-9a-f-]+)?$/);
  await expect(page.locator('.sport-theme')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(sidebar).not.toHaveAttribute('data-floating');
  await expect.poll(() => sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(color);
});
test('sports detail fits phones with usable map, navigation and existing privacy controls', async ({ page }) => {
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const map = await page.locator('.route-map').boundingBox();
    expect(map!.height).toBeGreaterThanOrEqual(280);
    expect(map!.height).toBeLessThanOrEqual(500);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await ready(page);
  await capture(page, 'mobile');
  await capture(page, 'mobile-map', '.route-panel');
  // A detail page belongs to 记录: its tab is marked current (not the page itself) and stays keyboard reachable.
  const records = page.getByRole('navigation', { name: '底部导航' }).getByRole('link', { name: '记录', exact: true });
  await expect(records).toHaveAttribute('aria-current', 'true');
  await records.focus();
  expect(await records.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await expect(page.getByLabel('记录可见性')).toHaveCount(0);
});
test('full device metrics and route stay compact on short desktops and narrow phones', async ({ page }, testInfo) => {
  const state = await installActivities(page);
  Object.assign(state.records[0], { timer_seconds: '1740', avg_heart_rate_bpm: 178, calories_kcal: 320, steps: 5734 });
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  const leaders = page.locator('.stub-leaders .leader-row');
  await expect(leaders).toHaveCount(8);
  await expect(page.getByRole('region', { name: '运动指标' })).toContainText('178 bpm');
  await expect(page.getByRole('region', { name: '运动指标' })).toContainText('320 kcal');
  await expect(page.getByRole('region', { name: '运动指标' })).toContainText('5734 步');
  for (const height of [900, 720]) {
    await page.setViewportSize({ width: 1440, height });
    await expect(page.getByRole('status').filter({ hasText: '正在加载底图' })).toHaveCount(0);
    await ready(page);
    const stub = await page.getByRole('region', { name: '运动指标' }).boundingBox();
    const map = await page.locator('.route-map').boundingBox();
    expect(map!.x).toBeGreaterThan(stub!.x + stub!.width);
    expect(map!.height).toBeGreaterThanOrEqual(520);
    expect(map!.height).toBeLessThanOrEqual(580);
  }
  await page.locator('.detail-workspace').scrollIntoViewIfNeeded();
  await page
    .locator('.detail-workspace')
    .screenshot({ path: testInfo.outputPath('compact-detail-desktop.png'), animations: 'disabled' });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const stub = await page.getByRole('region', { name: '运动指标' }).boundingBox();
    const map = await page.locator('.route-map').boundingBox();
    if (width < 800) expect(map!.y).toBeLessThan(stub!.y);
    else if (width < 1024) expect(map!.y).toBeGreaterThan(stub!.y);
    else expect(map!.x).toBeGreaterThan(stub!.x + stub!.width);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ready(page);
  await page
    .locator('.detail-workspace')
    .screenshot({ path: testInfo.outputPath('compact-detail-mobile-dark.png'), animations: 'disabled' });
});
test('long titles, missing values, empty route and errors stay usable in the sample', async ({ page }) => {
  const state = await installActivities(page);
  state.records[1].title = '清晨出发沿着河岸的一次轻松跑步，长标题完整展示，不隐藏个人记录名称';
  await loginRunner(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/activities/${incompleteActivity.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(state.records[1].title);
  await expect(page.getByRole('status').filter({ hasText: '此活动没有路线。' })).toBeVisible();
  await expect(page.getByRole('region', { name: '运动指标' })).toContainText('—');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, 'mobile-missing');
  await page.getByText('数据质量与指标说明', { exact: true }).click();
  await expect(page.getByText('缺失时间点', { exact: true })).toBeVisible();
  state.detailFailures = 1;
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('alert')).toContainText('暂时无法读取');
  await page.getByRole('button', { name: '重新读取活动详情' }).click();
  await ready(page);
  await page.route(`**/api/v1/activities/${sampleActivity.id}`, async (route) => {
    // The following SSR request to /admin must observe the expired session too.
    await page.context().clearCookies({ name: 'run_session' });
    await route.fulfill({ status: 401, json: { error: { message: '登录已过期' } } });
  });
  await page.reload();
  await expect(page).toHaveURL(/admin\?reason=expired/);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByTestId('sport-hero')).toHaveCount(0);
  await expect(page.locator('.app-sidebar')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '跑量目标' })).toHaveCount(0);
});

test('capture sample with OpenFreeMap basemap or its visible fallback', async ({ page }) => {
  await installActivities(page);
  await page.unroute('**/*tile.openstreetmap.org/**');
  await page.unroute('https://tiles.openfreemap.org/**');
  // Synthetic exercise route only; the normal map tile mechanism remains unchanged.
  const points = [
    [121.548, 31.216],
    [121.55, 31.217],
    [121.553, 31.2175],
    [121.556, 31.218],
    [121.559, 31.2175],
    [121.562, 31.2155],
    [121.564, 31.213],
    [121.565, 31.21],
    [121.564, 31.207],
    [121.561, 31.205],
    [121.557, 31.2045],
    [121.553, 31.205],
    [121.55, 31.207],
    [121.548, 31.21],
    [121.547, 31.213],
    [121.548, 31.216],
  ];
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`, (route) =>
    route.fulfill({
      json: {
        data: {
          type: 'FeatureCollection',
          start: points[0],
          end: points[points.length - 1],
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: points },
              properties: { segment_index: 0, point_count: points.length },
            },
          ],
        },
        error: null,
      },
    }),
  );
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByRole('status').filter({ hasText: '正在加载底图' })).toHaveCount(0, { timeout: 15000 });
  const goal = await openGoalPanel(page);
  await goal.getByRole('button', { name: '设置', exact: true }).click();
  await goal.getByLabel('目标距离（km）').fill('50');
  await goal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(goal).toContainText('已完成 25%');
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(700);
  await capture(page, 'desktop-basemap');
  await page.setViewportSize({ width: 390, height: 900 });
  await ready(page);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(700);
  await capture(page, 'mobile-basemap');
  await capture(page, 'mobile-basemap-map', '.route-panel');
});

test('sidebar goals save separate periods, survive reload, reject invalid input and retry statistics', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-14T03:00:00Z') });
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);
  const widget = await openGoalPanel(page);
  await expect(widget).toContainText('12.5 km');
  await widget.getByRole('button', { name: '设置', exact: true }).click();
  await widget.getByLabel('目标距离（km）').fill('0');
  await widget.getByRole('button', { name: '保存', exact: true }).click();
  await expect(widget).toContainText('请输入大于0');
  await widget.getByLabel('目标距离（km）').fill('50');
  const verified = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/session'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await verified;
  await expect(widget.getByLabel('目标距离（km）')).toHaveValue('50');
  await widget.getByRole('button', { name: '保存', exact: true }).click();
  await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month');
  await expect(widget).toContainText('未设目标');
  await widget.getByRole('button', { name: '设置', exact: true }).click();
  await widget.getByLabel('目标距离（km）').fill('100');
  await widget.getByRole('button', { name: '保存', exact: true }).click();
  await widget.getByLabel('目标周期').selectOption('year');
  await expect(widget).toContainText('未设目标');
  await widget.getByText('今年 · 统计范围').click();
  await expect(widget).toContainText('2026-01-01 至 2026-10-15');
  await page.reload();
  await ready(page);
  await openGoalPanel(page);
  await expect(widget).toContainText('已完成 25%');
  await widget.getByLabel('目标周期').selectOption('month');
  await expect(widget).toContainText('已完成 13%');
  await page.route('**/api/v1/showcase/statistics/summary?**', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '统计失败' } } }),
  );
  await widget.getByLabel('目标周期').selectOption('year');
  await expect(widget.getByRole('alert')).toContainText('暂时无法读取');
  await page.unroute('**/api/v1/showcase/statistics/summary?**');
  await page.route('**/api/v1/showcase/statistics/summary?**', (route) =>
    route.fulfill({ json: { data: { distance_m: 0 }, error: null } }),
  );
  await widget.getByRole('button', { name: '重试跑量' }).click();
  await expect(widget).toContainText('0 km');
  // Phones have no goal ring in the shell (the bottom tab bar replaced the menu); goals stay on 今天 and in 目标与隐私.
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(widget).toBeHidden();
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
// The record and its route load separately; hold either one to see what the page does meanwhile.
async function hold(page: Page, pattern: RegExp) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(pattern, async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}
const recordPattern = new RegExp(`/api/v1/(showcase/)?activities/${sampleActivity.id}$`);
const routePattern = new RegExp(`/api/v1/(showcase/)?activities/${sampleActivity.id}/route$`);
test('on a phone the footer stays below the first screen while the record loads', async ({ page }) => {
  await installActivities(page);
  await loginRunner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const release = await hold(page, recordPattern);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByText('正在读取活动…')).toBeVisible();
  const footerTop = () => page.locator('.app-footer').evaluate((el) => el.getBoundingClientRect().top);
  // The loading state fills the screen, so the arriving record cannot push the footer off it (a layout shift).
  expect(await footerTop()).toBeGreaterThanOrEqual(844);
  release();
  await expect(page.getByTestId('sport-hero')).toBeVisible();
  expect(await footerTop()).toBeGreaterThanOrEqual(844);
});
test('the map library is fetched once the title is on screen, while the route is still on its way', async ({
  page,
}) => {
  await installActivities(page);
  await loginRunner(page);
  const mapLibrary: string[] = [];
  page.on('request', (request) => {
    if (/\/maplibre-gl\.js(\?|$)/.test(request.url())) mapLibrary.push(request.url());
  });
  const releaseRecord = await hold(page, recordPattern);
  const releaseRoute = await hold(page, routePattern);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByText('正在读取活动…')).toBeVisible();
  await page.waitForTimeout(300);
  // Nothing competes with the first paint of the page's own text on a slow connection.
  expect(mapLibrary).toEqual([]);
  releaseRecord();
  await expect(page.getByTestId('sport-hero')).toContainText('河畔晨跑');
  await expect.poll(() => mapLibrary.length).toBeGreaterThan(0);
  releaseRoute();
  await ready(page);
});

test('editorial receipt detail layout, more-menu delete, share dialog, chart and 4 viewports across light and dark', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await installActivities(page);
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  await ready(page);

  await expect(page.locator('.editorial-page.detail-page')).toBeVisible();
  // No colorful metric circle icons, no pill route tag, no narrative copy.
  await expect(page.locator('.metric-icon')).toHaveCount(0);
  await expect(page.locator('.route-tag')).toHaveCount(0);
  await expect(page.getByText('每一步，都算数')).toHaveCount(0);
  await expect(page.getByText('本次运动概览')).toHaveCount(0);
  await expect(page.getByText('本次运动轨迹')).toHaveCount(0);

  // Single receipt header + 64-88px primary distance figure + perforation + splits + pace chart.
  await expect(page.locator('.receipt-header')).toHaveCount(1);
  const figureSize = await page
    .locator('.stub-distance-num')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(figureSize).toBeGreaterThanOrEqual(64);
  expect(figureSize).toBeLessThanOrEqual(88);
  await expect(page.locator('.receipt-perforation').first()).toBeVisible();
  await expect(page.getByTestId('activity-splits-bars')).toBeVisible();
  await expect(page.getByTestId('activity-pace-chart')).toBeVisible();

  // Delete is tucked inside 更多 menu and opens native confirmation dialog with Escape recovery.
  const more = page.getByRole('button', { name: '更多', exact: true });
  await expect(page.getByRole('button', { name: '删除记录', exact: true })).toBeHidden();
  await more.click();
  const moreMenu = page.getByRole('group', { name: '更多操作' });
  await expect(moreMenu).toBeVisible();
  await moreMenu.getByRole('button', { name: '删除记录', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除这条跑步记录？' });
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deleteDialog).toBeHidden();
  await expect(more).toBeFocused();

  // Share menu opens poster dialog with glass overlay boundary intact.
  const share = page.getByRole('button', { name: '分享', exact: true });
  await share.click();
  await page.getByRole('button', { name: '生成分享图', exact: true }).click();
  const posterDialog = page.getByRole('dialog', { name: '生成分享图' });
  await expect(posterDialog).toBeVisible();
  await expect(posterDialog).toHaveAttribute('data-glass-overlay', '');
  await page.keyboard.press('Escape');
  await expect(posterDialog).toBeHidden();
  await expect(share).toBeFocused();

  // P3: clicking 添加备注 opens the editor on notes and Escape/cancel returns focus to 添加备注.
  const addNote = page.getByRole('button', { name: '添加备注', exact: true });
  await addNote.click();
  await expect(page.getByRole('textbox', { name: '备注' })).toBeFocused();
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(addNote).toBeFocused();

  // Visual matrix geometry check across 1440 / 768 / 390 / 320 in both light and dark themes.
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
    [320, 640],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        localStorage.setItem('runnote-theme', value);
        document.documentElement.dataset.theme = value;
        window.dispatchEvent(new Event('runnote-theme-change'));
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const stub = await page.getByRole('region', { name: '运动指标' }).boundingBox();
      const map = await page.locator('.route-map').boundingBox();
      const chart = await page.getByTestId('activity-pace-chart').boundingBox();
      expect(stub!.width).toBeGreaterThan(200);
      expect(map!.width).toBeGreaterThan(200);
      expect(chart!.width).toBeGreaterThan(200);
      expect(chart!.height).toBeGreaterThan(100);
    }
  }
  expect(errors).toEqual([]);
});

test('pace chart stays in loading state while route or replay is pending and only shows missing-track copy when replay lacks usable samples', async ({
  page,
}) => {
  const replayPattern = new RegExp(`/api/v1/(showcase/)?activities/${sampleActivity.id}/replay$`);
  const missingCopy = '此记录缺少可靠时间轨迹，暂无法绘制配速曲线。';
  await installActivities(page);
  await loginRunner(page);

  const releaseRoute = await hold(page, routePattern);
  const releaseReplay = await hold(page, replayPattern);
  await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByRole('heading', { name: sampleActivity.title, level: 1 })).toBeVisible();

  const paceSection = page.getByTestId('activity-pace-section');
  // While /route is still delayed, show loading state and never flash the final missing-track message.
  await expect(paceSection.getByText('正在读取配速曲线…')).toBeVisible();
  await expect(paceSection.getByText(missingCopy)).toHaveCount(0);

  // After /route resolves but while /replay is still pending, keep the loading state without flashing empty copy.
  releaseRoute();
  await ready(page);
  await expect(paceSection.getByText('正在读取配速曲线…')).toBeVisible();
  await expect(paceSection.getByText(missingCopy)).toHaveCount(0);

  // Once /replay resolves with real samples, show the chart and the splits basis note inside <details>.
  releaseReplay();
  await expect(page.getByTestId('activity-pace-chart')).toBeVisible();
  await expect(paceSection.getByText('正在读取配速曲线…')).toHaveCount(0);
  const splitsDetails = page.getByTestId('activity-splits-details');
  await splitsDetails.locator('summary').click();
  await expect(splitsDetails).toContainText('每公里分段由前端按回放轨迹的距离与移动时间采样推导');
  await expect(splitsDetails).toContainText('可能与服务端统计的总平均配速略有差异');

  // When /replay genuinely returns without usable pace samples (simulated track), show the final empty state.
  await page.route(replayPattern, (route) =>
    route.fulfill({ json: { data: syntheticReplay('simulated'), error: null } }),
  );
  await page.reload();
  await ready(page);
  await expect(paceSection.getByText(missingCopy)).toBeVisible();
  await expect(paceSection.getByText('正在读取配速曲线…')).toHaveCount(0);
});
