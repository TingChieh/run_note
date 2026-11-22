import { expect, test } from '@playwright/test';
import { loginRunner } from '../fixtures/activities';

const storyUrl = '/workspace/records/story';
const storyApi = /\/api\/v1\/statistics\/annual-story\?/;

test('annual story requires auth and links from personal records and annual recap', async ({ page }) => {
  await page.goto(`${storyUrl}?year=2025`);
  await expect(page).toHaveURL(/\/admin\?next=/);

  await page.goto('/records');
  await expect(page.getByTestId('records-ready')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看年度故事' })).toHaveCount(0);

  await loginRunner(page);
  await page.goto('/records');
  await page.getByRole('button', { name: '年度', exact: true }).click();
  const recordsEntry = page.getByRole('link', { name: '查看年度故事' });
  await expect(recordsEntry).toHaveAttribute('href', /\/workspace\/records\/story\?year=\d{4}/);
  await recordsEntry.click();
  await expect(page.getByRole('heading', { name: /跑步年度故事/, level: 1 })).toBeVisible();

  // Also reachable from #15 recap annual slot without changing recap layout.
  await page.goto('/workspace/records/recap?period=year&year=2025');
  const recapEntry = page.getByTestId('recap-story-entry').getByRole('link', { name: '查看年度故事' });
  await expect(recapEntry).toHaveAttribute('href', '/workspace/records/story?year=2025');
  await recapEntry.click();
  await expect(page).toHaveURL(/\/workspace\/records\/story\?year=2025$/);
  await expect(page.getByTestId('story-prologue')).toContainText('1,042.68');
});

test('all six story beats, sticky stage sync, city focus, animation controls and reduced motion work cleanly', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto(`${storyUrl}?year=2025`);

  await expect(page.getByTestId('story-chapter-first')).toContainText('青岬海湾迎新慢跑');
  await expect(page.getByTestId('story-chapter-longest')).toContainText('21.42');
  await expect(page.getByTestId('story-chapter-best')).toContainText('刷新历史 PB');
  await expect(page.getByTestId('story-chapter-cities')).toContainText('桐溪市');
  await expect(page.getByTestId('story-chapter-frequent')).toContainText('29');

  // Sticky stage sync via chapter quick buttons and city click.
  await page.getByTestId('story-sticky-stage').getByRole('button', { name: '02' }).click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('桐溪秋日河滨半程挑战');

  await page
    .getByTestId('story-chapter-cities')
    .getByRole('button', { name: /桐溪市/ })
    .click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('桐溪市 · 云岭州');

  // Animation scrubber, speed buttons, and accessible table.
  const scrubber = page.getByLabel('年度足迹进度');
  await scrubber.fill('220');
  await scrubber.dispatchEvent('input');
  await expect(page.getByTestId('story-film-date')).toContainText('2025-');

  await page.getByRole('button', { name: '2x', exact: true }).click();
  await expect(page.getByRole('button', { name: '2x', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByText('查看全年各月足迹数据表').click();
  const tableRegion = page.getByRole('region', { name: '2025 年各月跑步次数与里程数据表' });
  await expect(tableRegion).toBeVisible();
  const table = tableRegion.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(13);
  await expect(table.locator('thead th[scope="col"]')).toHaveText(['月份', '跑步次数', '月里程 (km)']);
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(12);

  // Reduced motion settles immediately at full completion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '重头开始' }).click();
  await expect(page.getByTestId('story-film-km')).toContainText('1,042.68 km');
});

test('poster dialog generates 9:16 PNG, toggles privacy options, and restores focus on close', async ({ page }) => {
  await loginRunner(page);
  await page.goto(`${storyUrl}?year=2025`);

  const trigger = page.getByRole('button', { name: '生成海报' });
  await trigger.click();
  const dialog = page.getByTestId('story-poster-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('story-poster-privacy-note')).toContainText('抽象足迹轮廓');

  const img = page.getByTestId('story-poster-image');
  await expect(img).toBeVisible();
  const initialSrc = await img.getAttribute('src');
  expect(initialSrc).toMatch(/^blob:/);

  await dialog.getByLabel('隐藏具体城市名').check();
  await expect(img).not.toHaveAttribute('src', initialSrc!);

  await dialog.getByRole('button', { name: '深色暖炭' }).click();
  await expect(dialog.getByRole('button', { name: '保存 PNG' })).toBeEnabled();

  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('poster dialog invalidates stale unredacted poster on privacy change and blocks save/share on render failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data?: ShareData) => Promise<void>;
    };
    nav.canShare = () => true;
    nav.share = async () => {};
  });
  await loginRunner(page);
  await page.goto(`${storyUrl}?year=2025`);

  await page.getByRole('button', { name: '生成海报' }).click();
  const dialog = page.getByTestId('story-poster-dialog');
  const saveBtn = dialog.getByRole('button', { name: '保存 PNG' });
  const shareBtn = dialog.getByRole('button', { name: '系统分享' });
  await expect(dialog.getByTestId('story-poster-image')).toBeVisible();
  await expect(saveBtn).toBeEnabled();
  await expect(shareBtn).toBeEnabled();

  // Force the next PNG export to fail right before toggling privacy redaction.
  await page.evaluate(() => {
    const win = window as Window & { __origToBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    win.__origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(null);
    };
  });

  await dialog.getByLabel('隐藏具体城市名').check();
  await expect(dialog.getByText('无法生成年度故事海报 PNG')).toBeVisible();
  // Stale unredacted image must be gone and both save & share must be unavailable.
  await expect(dialog.getByTestId('story-poster-image')).toHaveCount(0);
  await expect(saveBtn).toBeDisabled();
  await expect(shareBtn).toHaveCount(0);

  // Restore toBlob and retry: new redacted poster succeeds and re-enables save & share.
  await page.evaluate(() => {
    const win = window as Window & { __origToBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    if (win.__origToBlob) HTMLCanvasElement.prototype.toBlob = win.__origToBlob;
  });
  await dialog.getByRole('button', { name: '重试生成' }).click();
  await expect(dialog.getByTestId('story-poster-image')).toBeVisible();
  await expect(saveBtn).toBeEnabled();
  await expect(shareBtn).toBeEnabled();
});

test('pending cities, building routes and cross-timezone first run never misreport no-data or wrong clock', async ({
  page,
}) => {
  await loginRunner(page);
  await page.goto(`${storyUrl}?year=2022`);

  // P3-3: first run was recorded in America/New_York at 2022-01-01T12:30:00Z -> local 07:30 (NOT Shanghai 20:30).
  const firstChapter = page.getByTestId('story-chapter-first');
  await expect(firstChapter).toContainText('2022-01-01 · 07:30');
  await expect(firstChapter).not.toContainText('20:30');
  await expect(firstChapter).toContainText('暂未匹配（计算中）');
  await expect(firstChapter).not.toContainText('无定位记录');

  // P2-1: prologue & chapter 04 & sticky stage must show pending/calculating, never no-GPS / indoor.
  await expect(page.getByTestId('story-prologue')).toContainText('待计算');
  await expect(page.getByTestId('story-prologue')).not.toContainText('无定位');
  const citiesChapter = page.getByTestId('story-chapter-cities');
  await expect(citiesChapter).toContainText('城市足迹正在后台计算');
  await expect(citiesChapter).toContainText('28 条带轨迹记录');
  await expect(citiesChapter).not.toContainText('室内');
  await expect(citiesChapter).not.toContainText('均无户外 GPS 定位');

  await page.getByTestId('story-sticky-stage').getByRole('button', { name: '04' }).click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('城市足迹计算中');
  await expect(page.getByTestId('story-sticky-stage')).not.toContainText('无户外定位记录');

  // P2-1: chapter 05 sticky stage must show building, never "每一次都是新出发".
  await page.getByTestId('story-sticky-stage').getByRole('button', { name: '05' }).click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('常跑路线归并中');
  await expect(page.getByTestId('story-sticky-stage')).not.toContainText('每一次都是新出发');
  await expect(page.getByTestId('story-sticky-stage')).not.toContainText('没有重复跑过');

  // Ready with tracks but zero matched cities: prologue, chapter 01, chapter 04, and stage align.
  await page.route(
    storyApi,
    async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.data.explored_cities = {
        ...json.data.explored_cities,
        status: 'ready',
        total_cities: 0,
        new_cities_count: 0,
        total_regions: 0,
        located_activity_count: 0,
        unlocated_activity_count: json.data.summary.activity_count,
        pending_activity_count: 0,
        items: [],
      };
      await route.fulfill({ response: res, json });
    },
    { times: 1 },
  );
  await page.goto(`${storyUrl}?year=2022`);
  await expect(page.getByTestId('story-prologue')).toContainText('暂无匹配城市记录');
  await expect(page.getByTestId('story-prologue')).not.toContainText('无定位');
  await expect(page.getByTestId('story-chapter-first')).toContainText('未匹配城市');
  await expect(page.getByTestId('story-chapter-cities')).toContainText('暂无匹配城市记录');
  await page.getByTestId('story-sticky-stage').getByRole('button', { name: '04' }).click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('暂无匹配城市记录');
  await expect(page.getByTestId('story-sticky-stage')).not.toContainText('无户外定位记录');

  // Prior-year pending (status="pending", pending_activity_count=0, total_cities>0): never says "0 条轨迹".
  await page.route(
    storyApi,
    async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.data.first_run = { ...json.data.first_run, city_name: null, has_track: true };
      json.data.explored_cities = {
        ...json.data.explored_cities,
        status: 'pending',
        new_cities_count: 0,
        pending_activity_count: 0,
        items: json.data.explored_cities.items.map((c: Record<string, unknown>) => ({ ...c, is_new: false })),
      };
      await route.fulfill({ response: res, json });
    },
    { times: 1 },
  );
  await page.goto(`${storyUrl}?year=2025`);
  await expect(page.getByTestId('story-chapter-first')).toContainText('未匹配城市');
  await expect(page.getByTestId('story-chapter-first')).not.toContainText('计算中');
  await expect(page.getByTestId('story-chapter-cities')).toContainText('往年城市足迹仍在后台计算');
  await expect(page.getByTestId('story-chapter-cities')).not.toContainText('0 条轨迹');
  await page.getByTestId('story-sticky-stage').getByRole('button', { name: '04' }).click();
  await expect(page.getByTestId('story-sticky-stage')).toContainText('往年城市记录仍在后台补全');
  await expect(page.getByTestId('story-sticky-stage')).not.toContainText('0 条轨迹');
});

test('partial, trackless fallback, empty, error recovery and 401 session expiry states', async ({ page }) => {
  await loginRunner(page);

  // 2026 partial + single city + pending city + building frequent route.
  await page.goto(`${storyUrl}?year=2026`);
  await expect(page.getByTestId('story-partial-pill')).toContainText('进行中');
  await expect(page.getByTestId('story-chapter-cities')).toContainText('后台计算');
  await expect(page.getByTestId('story-chapter-frequent')).toContainText('仍在归并中');

  // 2024 confirmed ready trackless fallback.
  await page.goto(`${storyUrl}?year=2024`);
  await expect(page.getByTestId('story-chapter-cities')).toContainText('无定位记录年度');
  await expect(page.getByTestId('story-chapter-frequent')).toContainText('每一次都是新出发');
  await expect(page.getByTestId('story-coverage')).toContainText('节律脉冲回放');

  // 2023 empty year.
  await page.goto(`${storyUrl}?year=2023`);
  await expect(page.getByText('2023 年还没有跑步记录')).toBeVisible();

  // 503 error + retry recovery.
  await page.route(
    storyApi,
    (route) =>
      route.fulfill({ status: 503, json: { data: null, error: { code: 'UNAVAILABLE', message: '故事服务暂不可用' } } }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '下一年' }).click();
  await expect(page.getByText('故事服务暂不可用')).toBeVisible();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByTestId('story-prologue')).toBeVisible();

  // 401 session expiry clears state and redirects to /admin.
  await page.route(storyApi, async (route) => {
    await page.context().clearCookies();
    await route.fulfill({ status: 401, json: { data: null } });
  });
  await page.getByRole('button', { name: '下一年' }).click();
  await expect(page).toHaveURL(/\/admin\?reason=expired&next=.*story/);
  await expect(page.getByTestId('story-prologue')).toHaveCount(0);
});

test('responsive viewports and light/dark themes have zero console errors and zero horizontal overflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await loginRunner(page);
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript((t) => window.localStorage.setItem('runnote-theme', t), theme);
      await page.goto(`${storyUrl}?year=2025`);
      await expect(page.getByTestId('story-prologue')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `overflow at ${vp.width}x${vp.height} ${theme}`).toBe(false);
    }
  }
  expect(errors).toEqual([]);
});
