import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity, incompleteActivity } from '../fixtures/activities';
import { openAccountMenu, openGoalPanel } from '../fixtures/top-navigation';

async function installMilestones(page: import('@playwright/test').Page) {
  const state = { provinceFailures: 0, streakFailures: 0, year: null as number | null };
  await installActivities(page);
  await page.clock.setFixedTime(new Date('2026-10-14T06:00:00Z'));
  await page.route('**/api/v1/showcase/statistics/summary**', (route) => {
    const from = new URL(route.request().url()).searchParams.get('date_from') ?? '';
    const to = new URL(route.request().url()).searchParams.get('date_to') ?? '';
    const futureIncluded = to > '2026-10-15';
    const current = from.startsWith('2026');
    const count = current ? 2 : 1,
      distance = current ? '10246.912' : '5000';
    return route.fulfill({
      json: {
        data: {
          activity_count: count,
          distance_m: futureIncluded ? '20246.912' : distance,
          duration_sum_seconds: 1800,
          known_duration_count: 1,
          missing_duration_count: count - 1,
          activity_days: count,
          pace_eligible_count: 1,
          pace_eligible_distance_m: '5123.456',
          avg_pace_seconds_per_km: '351.3',
          quality_warning_count: 1,
          date_assignment: 'activity_local_date',
        },
        error: null,
      },
    });
  });
  await page.route('**/api/v1/showcase/statistics/streaks', (route) =>
    state.streakFailures-- > 0
      ? route.fulfill({ status: 503, json: { error: { message: '连续记录读取失败' } } })
      : route.fulfill({
          json: {
            data: {
              today: '2026-10-14',
              current_days: 2,
              longest_days: 5,
              current_weeks: 2,
              longest_weeks: 7,
              week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${12 + i}`, active: i < 2 })),
            },
            error: null,
          },
        }),
  );
  await page.route('**/api/v1/showcase/footprints/global**', (route) => {
    const year = new URL(route.request().url()).searchParams.get('year');
    state.year = year === null ? null : Number(year);
    if (state.provinceFailures-- > 0)
      return route.fulfill({ status: 503, json: { error: { message: '全球足迹读取失败' } } });
    return route.fulfill({
      json: {
        data: {
          year: state.year,
          activity_count: 4,
          located_activity_count: 4,
          region_count: 3,
          city_count: 3,
          countries: [
            {
              code: 'CHN',
              name: '中国',
              activity_count: 3,
              distance_m: 28500,
              region_count: 2,
              city_count: 2,
              bounds: [120.0, 21.9, 122.0, 31.8],
              regions: [
                {
                  code: 'CN-310000',
                  name: '上海市',
                  short_name: '上海',
                  activity_count: 2,
                  distance_m: 18500,
                  bounds: [120.85, 30.68, 122.0, 31.87],
                  center: [121.47, 31.23],
                  cities: [
                    {
                      code: '310000',
                      name: '上海市',
                      short_name: '上海',
                      activity_count: 2,
                      distance_m: 18500,
                      lon: 121.47,
                      lat: 31.23,
                    },
                  ],
                },
                {
                  code: 'CN-710000',
                  name: '台湾省',
                  short_name: '台湾',
                  activity_count: 1,
                  distance_m: 10000,
                  bounds: [120.0, 21.9, 122.0, 25.3],
                  center: [121.0, 23.6],
                  cities: [
                    {
                      code: 'GN-1668341',
                      name: '台北',
                      short_name: '台北',
                      activity_count: 1,
                      distance_m: 10000,
                      lon: 121.56,
                      lat: 25.03,
                    },
                  ],
                },
              ],
            },
            {
              code: 'JPN',
              name: '日本',
              activity_count: 1,
              distance_m: 6200,
              region_count: 1,
              city_count: 1,
              bounds: [139.0, 35.4, 140.0, 35.9],
              regions: [
                {
                  code: 'JP-13',
                  name: '东京都',
                  short_name: '东京都',
                  activity_count: 1,
                  distance_m: 6200,
                  bounds: [139.0, 35.4, 140.0, 35.9],
                  center: [139.7, 35.69],
                  cities: [
                    {
                      code: 'GN-1850147',
                      name: '东京',
                      short_name: '东京',
                      activity_count: 1,
                      distance_m: 6200,
                      lon: 139.69,
                      lat: 35.69,
                    },
                  ],
                },
              ],
            },
          ],
          region_features: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  code: 'CN-310000',
                  name: '上海市',
                  short_name: '上海',
                  country_code: 'CHN',
                  activity_count: 2,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [121, 31],
                      [122, 31],
                      [122, 32],
                      [121, 32],
                      [121, 31],
                    ],
                  ],
                },
              },
              {
                type: 'Feature',
                properties: {
                  code: 'CN-710000',
                  name: '台湾省',
                  short_name: '台湾',
                  country_code: 'CHN',
                  activity_count: 1,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [120.5, 22],
                      [121.9, 22],
                      [121.9, 25.2],
                      [120.5, 25.2],
                      [120.5, 22],
                    ],
                  ],
                },
              },
              {
                type: 'Feature',
                properties: {
                  code: 'JP-13',
                  name: '东京都',
                  short_name: '东京都',
                  country_code: 'JPN',
                  activity_count: 1,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [139.1, 35.5],
                      [139.9, 35.5],
                      [139.9, 35.9],
                      [139.1, 35.9],
                      [139.1, 35.5],
                    ],
                  ],
                },
              },
            ],
          },
        },
        error: null,
      },
    });
  });
  return state;
}

test('goal save actions pop from the edit button and fold back with reduced-motion support', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('year-km')).toHaveText('10.2');
  for (const overview of [true, false]) {
    const widget = overview ? page.getByRole('region', { name: '运动目标' }) : await openGoalPanel(page);
    const actions = overview
      ? widget.locator('.goal-card').first().locator('.goal-actions')
      : widget.locator('.goal-actions');
    const reveal = actions.locator('.goal-save-reveal');
    await expect(reveal).toHaveCount(1);
    // Restoring motion preferences also transitions hidden controls; let that reset finish.
    await expect
      .poll(() => reveal.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
      .toBeCloseTo(0.08, 3);
    const record = () =>
      reveal.evaluate((el) => {
        const samples: number[] = [];
        const scales: number[] = [];
        (el as HTMLElement & { opacitySamples: number[]; scaleSamples: number[] }).opacitySamples = samples;
        (el as HTMLElement & { scaleSamples: number[] }).scaleSamples = scales;
        const observed = new Set<string>();
        const recordTransition = (event: Event) => {
          const property = (event as TransitionEvent).propertyName;
          if (property !== 'opacity' && property !== 'transform') return;
          const animation = el
            .getAnimations()
            .find((item) => item instanceof CSSTransition && item.transitionProperty === property);
          if (!animation?.effect) return;
          // Inspect an actual interpolated frame without depending on the renderer's frame rate.
          animation.pause();
          const duration = Number(animation.effect.getComputedTiming().duration);
          if (property === 'opacity') {
            animation.currentTime = duration / 2;
            samples.push(Number(getComputedStyle(el).opacity));
          } else {
            animation.currentTime = 0;
            scales.push(new DOMMatrix(getComputedStyle(el).transform).a);
            animation.currentTime = duration * 0.7;
            scales.push(new DOMMatrix(getComputedStyle(el).transform).a);
          }
          observed.add(property);
          if (observed.size === 2) el.removeEventListener('transitionrun', recordTransition);
          requestAnimationFrame(() => animation.play());
        };
        el.addEventListener('transitionrun', recordTransition);
      });
    const hasIntermediateFrame = () =>
      reveal.evaluate((el) =>
        (el as HTMLElement & { opacitySamples: number[] }).opacitySamples.some((value) => value > 0.02 && value < 0.98),
      );
    await record();
    await actions.getByRole('button', { name: overview ? '设置年度目标' : '设置', exact: true }).click();
    await expect(reveal).toHaveCSS('opacity', '1');
    expect(await hasIntermediateFrame()).toBe(true);
    const scales = await reveal.evaluate((el) => (el as HTMLElement & { scaleSamples: number[] }).scaleSamples);
    expect(scales[0]).toBeLessThan(0.2);
    expect(scales[1]).toBeGreaterThan(1);
    const input = widget.getByLabel(overview ? '年度目标距离（km）' : '目标距离（km）', { exact: true });
    await expect(input).toBeFocused();
    await record();
    await actions.getByRole('button', { name: overview ? '取消年度目标' : '取消', exact: true }).click();
    await expect(reveal).toHaveCSS('opacity', '0');
    expect(await hasIntermediateFrame()).toBe(true);
    await expect(reveal).toHaveAttribute('inert', '');
    await expect(input).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await actions.getByRole('button', { name: overview ? '设置年度目标' : '设置', exact: true }).click();
    await expect(reveal).toHaveCSS('transition-duration', '0s');
    await expect(reveal).toHaveCSS('opacity', '1');
    await input.press('Escape');
    await expect(reveal).toHaveCSS('opacity', '0');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
});

test('goal editors replace the target in place without growing cards and Escape cancels drafts', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/dashboard');
  const goals = page.getByRole('region', { name: '运动目标' });
  await expect(goals.getByTestId('year-km')).toHaveText('10.2');
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/running-goals/')) writes.push(request.url());
  });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [period, title] of [
      ['year', '年度目标'],
      ['month', '月度目标'],
      ['week', '周目标'],
    ]) {
      const card = goals.locator('.goal-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const before = (await card.boundingBox())!;
      const valueBefore = (await card.locator('.goal-value').boundingBox())!;
      await card.getByRole('button', { name: `设置${title}`, exact: true }).click();
      const input = card.getByLabel(`${title}距离（km）`, { exact: true });
      await expect(input).toBeFocused();
      await input.fill('100000');
      expect((await card.boundingBox())!.height).toBeCloseTo(before.height, 0);
      // Sample both rectangles in one frame; focus/scroll anchoring can move the viewport.
      const { inputBox, valueNow } = await input.evaluate((element) => ({
        inputBox: element.getBoundingClientRect().toJSON(),
        valueNow: element.closest('.goal-value')!.getBoundingClientRect().toJSON(),
      }));
      expect(inputBox.y).toBeGreaterThanOrEqual(valueNow.y - 1);
      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(valueNow.y + valueNow.height + 1);
      expect(valueNow.height).toBeCloseTo(valueBefore.height, 0);
      if (width === 1440 || width === 390) {
        await input.press('Tab');
        await card.screenshot({ path: `test-results/inline-${period}-${width}.png` });
        if (period === 'year') {
          await page.emulateMedia({ colorScheme: 'dark' });
          await card.screenshot({ path: `test-results/inline-year-blurred-dark-${width}.png` });
          await page.emulateMedia({ colorScheme: 'light' });
        }
        await input.focus();
      }
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await expect(card.getByRole('button', { name: `设置${title}`, exact: true })).toBeFocused();
      await expect(goals.getByTestId(`${period}-km`)).toHaveText('10.2');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes).toHaveLength(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sidebar = await openGoalPanel(page);
  await expect(sidebar.locator('.goal-distance')).toBeVisible();
  const before = (await sidebar.boundingBox())!;
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  const input = sidebar.getByLabel('目标距离（km）', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('35');
  expect((await sidebar.boundingBox())!.height).toBeCloseTo(before.height, 0);
  await input.press('Tab');
  await sidebar.screenshot({ path: 'test-results/inline-sidebar.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await sidebar.screenshot({ path: 'test-results/inline-sidebar-blurred-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await input.focus();
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(sidebar).toContainText('/ 35 km');
  await expect(goals).toContainText('/ 35 km');
  await sidebar.getByRole('button', { name: '调整', exact: true }).click();
  await input.fill('55');
  await input.press('Escape');
  await expect(sidebar).toContainText('/ 35 km');
  expect(writes).toHaveLength(1);
});

for (const area of ['overview', 'sidebar'] as const) {
  test(`${area} goal editor keeps focus and draft when pending statistics arrive`, async ({ page }) => {
    await installMilestones(page);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/api/v1/showcase/statistics/summary**', async (route) => {
      await pending;
      await route.fallback();
    });
    try {
      await loginRunner(page);
      await page.goto('/dashboard');
      const overview = area === 'overview';
      const widget = overview ? page.getByRole('region', { name: '运动目标' }) : await openGoalPanel(page);
      await widget.getByRole('button', { name: overview ? '设置年度目标' : '设置', exact: true }).click();
      const input = widget.getByLabel(overview ? '年度目标距离（km）' : '目标距离（km）', { exact: true });
      await expect(input).toBeFocused();
      await input.fill('22');
      finish();
      if (overview) await expect(widget.getByTestId('year-km')).toHaveText('10.2');
      else await expect(widget.locator('.goal-distance strong')).toHaveText('10.2 km');
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('22');
      await input.press('Enter');
      await expect(input).toHaveCount(0);
      await expect(widget).toContainText('/ 22 km');
    } finally {
      finish();
    }
  });
}

test('home has real period goals, streaks, province lighting and a private wall preview', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/');
  const goals = page.getByRole('region', { name: '运动目标' });
  await expect(goals.getByRole('heading', { name: '年度目标' })).toBeVisible();
  await expect(goals.getByTestId('year-km')).toHaveText('10.2');
  await goals.getByRole('button', { name: '设置年度目标' }).click();
  await goals.getByLabel('年度目标距离（km）').fill('20');
  await goals.getByRole('button', { name: '保存年度目标' }).click();
  await expect(goals.getByRole('progressbar', { name: '年度目标进度' })).toHaveAttribute('value', /^51\.2/);
  await expect(page.getByRole('region', { name: '连续记录' })).toContainText('最长 5 天 / 7 周');
  const map = page.getByRole('region', { name: '足迹地图' });
  const summary = map.getByTestId('global-summary');
  await expect(summary.locator('dt')).toHaveText(['省/州', '城市']);
  await expect(summary.locator('dd')).toHaveText(['3', '3']);
  const countryRail = map.getByRole('group', { name: '已点亮国家或地区' });
  await expect(countryRail.getByRole('button', { name: /全部/ })).toHaveCount(0);
  await expect(countryRail).toContainText('中国');
  await expect(countryRail).toContainText('日本');
  await expect(countryRail).not.toContainText('台湾');
  const regionRail = map.getByRole('group', { name: '中国已点亮省/州' });
  await expect(regionRail).toContainText('上海');
  await expect(regionRail).toContainText('台湾');
  await regionRail.getByRole('button', { name: /台湾/ }).click();
  await expect(map.getByRole('group', { name: '台湾已点亮城市' })).toContainText('台北');
  await expect(map.getByTestId('global-focus')).toHaveText(/^台湾\s+1 次活动\s+10 km$/);
  await expect(regionRail.getByRole('button', { name: /台湾/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(regionRail.getByRole('button', { name: /上海/ })).toHaveAttribute('aria-pressed', 'false');
  await map.getByRole('group', { name: '台湾已点亮城市' }).getByRole('button', { name: /台北/ }).click();
  await expect(map.getByTestId('global-focus')).toHaveText(/^台湾 · 台北\s+1 次活动\s+10 km$/);
  await countryRail.getByRole('button', { name: /日本/ }).click();
  await expect(map.getByRole('group', { name: '东京都已点亮城市' })).toContainText('东京');
  await countryRail.getByRole('button', { name: /中国/ }).click();
  // Opens in 3D; the last choice is remembered on this device.
  await expect(map.getByRole('button', { name: '切换为 2D 平面地图' })).toBeVisible();
  await map.getByRole('button', { name: '切换为 2D 平面地图' }).click();
  await expect(map.getByRole('button', { name: '切换为 3D 地球' })).toBeVisible();
  await map.getByRole('button', { name: '切换为 3D 地球' }).click();
  await expect(map.getByRole('button', { name: '切换为 2D 平面地图' })).toBeVisible();
  await map.getByRole('button', { name: '切换为 2D 平面地图' }).click();
  await expect(map.getByRole('button', { name: '切换为 3D 地球' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('runnote-footprint-view'))).toBe('mercator');
  const resetBtn = map.getByRole('button', { name: '回到全局' });
  await expect(resetBtn).toBeDisabled();
  const canvasBox = (await map.getByTestId('global-map-ready').boundingBox())!;
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, -240);
  await expect(resetBtn).toBeEnabled();
  await resetBtn.click();
  await expect(resetBtn).toBeDisabled();
  await expect(map.getByRole('status')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: '运动足迹', exact: true })
      .getByRole('button', { name: '选择运动 河畔晨跑', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /导入/ })).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) {
      await page.evaluate(async () => {
        (document.activeElement as HTMLElement)?.blur();
        scrollTo(0, 0);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await page.screenshot({ path: `test-results/milestones-home-${width}.png`, fullPage: false });
      await goals.screenshot({ path: `test-results/milestones-goals-${width}.png` });
      await map.screenshot({ path: `test-results/milestones-provinces-${width}.png` });
      const wall = page.getByRole('region', { name: '运动足迹', exact: true });
      await wall.getByRole('button', { name: '选择运动 河畔晨跑', exact: true }).scrollIntoViewIfNeeded();
      await expect(wall.getByRole('img', { name: /河畔晨跑的路线轮廓/ })).toBeVisible();
      await wall.screenshot({ path: `test-results/milestones-wall-${width}.png` });
    }
  }
  await page.reload();
  await expect(map.getByRole('button', { name: '切换为 3D 地球' })).toBeVisible();
  await expect(goals).toContainText('/ 20 km');
  await page.getByRole('button', { name: '上一年', exact: true }).click();
  await expect(map.getByTestId('global-summary').locator('dd').first()).toHaveText('3');
  await expect(map).toContainText('上海');
  await expect(map).toContainText('全部时间');
});

test('footprint map names the visited place under the pointer', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/dashboard');
  const map = page.getByRole('region', { name: '足迹地图' });
  await expect(map.getByTestId('global-map-ready')).toBeVisible();

  // Choosing a region flies the camera to centre it, so the stage centre is over that region.
  await map.getByRole('group', { name: '中国已点亮省/州' }).getByRole('button', { name: /台湾/ }).click();
  const box = (await map.getByTestId('global-map-ready').boundingBox())!;
  let jitter = 0;
  await expect
    .poll(
      async () => {
        jitter = jitter ? 0 : 1;
        await page.mouse.move(box.x + box.width / 2 + jitter, box.y + box.height / 2);
        return (await map.getByTestId('global-hover').allTextContents()).join('');
      },
      { timeout: 5000 },
    )
    .toMatch(/台湾\s*1 次活动/);
  await page.mouse.move(box.x - 40, box.y - 40);
  await expect(map.getByTestId('global-hover')).toHaveCount(0);
});

test('the four goal cards share one size on desktop and the page carries no footnote under them', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dashboard');
  const goals = page.getByRole('region', { name: '运动目标' });
  await expect(goals.getByRole('progressbar')).toHaveCount(3);
  await expect(goals.getByRole('region', { name: '连续记录' })).toContainText('最长 5 天 / 7 周');
  const sizes = await goals.locator('.goal-card').evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return [Math.round(box.width), Math.round(box.height)];
    }),
  );
  expect(sizes).toHaveLength(4);
  expect(new Set(sizes.map((size) => size[0])).size).toBe(1);
  expect(new Set(sizes.map((size) => size[1])).size).toBe(1);
  await expect(page.locator('.milestone-section')).not.toContainText('当前周期截至今天');
});

test('goals sync with sidebar and province/streak failures can retry independently', async ({ page }) => {
  const state = await installMilestones(page);
  state.provinceFailures = 1;
  state.streakFailures = 1;
  await loginRunner(page);
  await page.goto('/dashboard');
  // A failed read is missing data, not zero.
  await expect(page.getByTestId('global-summary').locator('dd')).toHaveText(['—', '—']);
  await page.getByRole('button', { name: '重试足迹地图' }).click();
  await expect(page.getByTestId('global-summary').locator('dd').first()).toHaveText('3');
  await page.getByRole('button', { name: '重试连续记录' }).click();
  await expect(page.getByRole('region', { name: '连续记录' })).toContainText('最长 5 天 / 7 周');
  const sidebar = await openGoalPanel(page);
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  await sidebar.getByLabel('目标距离（km）').fill('35');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('region', { name: '运动目标' })).toContainText('/ 35 km');
  await expect(sidebar.locator('#goal-feedback')).toHaveCount(0);
  await expect(page.getByText(/目标已保存|仅保存在此浏览器/)).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openGoalPanel(page);
  await expect(sidebar).toContainText('/ 35 km');
  await expect(page.getByRole('region', { name: '运动目标' })).toContainText('/ 35 km');
});

test('failed goal saves preserve the confirmed target and input until a successful retry', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/dashboard');
  const sidebar = await openGoalPanel(page);
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  await sidebar.getByLabel('目标距离（km）').fill('5');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sidebar).toContainText('/ 5 km');
  await page.route('**/api/v1/me/running-goals/week', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '目标暂时无法保存' } } }),
  );
  await sidebar.getByRole('button', { name: '调整', exact: true }).click();
  await sidebar.getByLabel('目标距离（km）').fill('15');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sidebar.getByRole('alert')).toHaveText('目标暂时无法保存');
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveValue('15');
  await expect(sidebar).toContainText('/ 5 km');
  await page.unroute('**/api/v1/me/running-goals/week');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveCount(0);
  await expect(sidebar.locator('#goal-feedback')).toHaveCount(0);
  await expect(sidebar).toContainText('/ 15 km');
  const goals = page.getByRole('region', { name: '运动目标' });
  await expect(goals).toContainText('/ 15 km');
  await goals.getByRole('button', { name: '调整周目标' }).click();
  await goals.getByLabel('周目标距离（km）').fill('20');
  await goals.getByRole('button', { name: '保存周目标' }).click();
  await openGoalPanel(page);
  await expect(sidebar).toContainText('/ 20 km');
  await expect(goals.locator('.goal-feedback')).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await openGoalPanel(page);
  await sidebar.screenshot({ path: 'test-results/running-goals-backend.png' });
});

test('statistics retry cannot discard a goal draft while saving', async ({ page }) => {
  await installMilestones(page);
  await page.route('**/api/v1/showcase/statistics/summary**', (route) =>
    route.fulfill({ status: 503, json: { error: { message: '统计暂不可用' } } }),
  );
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/v1/me/running-goals/week', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { message: '目标暂时无法保存' } } });
  });
  await loginRunner(page);
  await page.goto('/dashboard');
  const sidebar = await openGoalPanel(page);
  await sidebar.getByRole('button', { name: '设置', exact: true }).click();
  await sidebar.getByLabel('目标距离（km）').fill('15');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: '保存中…' })).toBeDisabled();
  const retry = sidebar.getByRole('button', { name: '重试跑量' });
  try {
    await expect(retry).toBeDisabled();
  } finally {
    finish();
  }
  await expect(sidebar.getByRole('alert').filter({ hasText: '目标暂时无法保存' })).toBeVisible();
  await expect(sidebar.getByLabel('目标距离（km）')).toHaveValue('15');
  await expect(retry).toBeEnabled();
});

test('sidebar and home goals exclude future records consistently', async ({ page }) => {
  await installMilestones(page);
  await loginRunner(page);
  await page.goto('/dashboard');
  const sidebar = await openGoalPanel(page);
  for (const period of ['week', 'month', 'year']) {
    await sidebar.getByLabel('目标周期').selectOption(period);
    await expect(sidebar.locator('.goal-distance strong')).toHaveText('10.2 km');
    await expect(page.getByTestId(`${period}-km`)).toHaveText('10.2');
  }
});

test('detail route retry also refreshes the footprint card without duplicate reads', async ({ page }) => {
  await installMilestones(page);
  let reads = 0;
  await page.route('**/api/v1/showcase/activities/*/route', async (route) => {
    reads++;
    if (reads <= 2) return route.fulfill({ status: 503, json: { error: { message: '路线暂不可用' } } });
    return route.fallback();
  });
  await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`);
  const card = page.getByRole('region', { name: '本次足迹卡片' });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('img', { name: /路线轮廓/ })).toHaveCount(0);
  expect(reads).toBe(1);
  await page.getByRole('button', { name: '重新读取路线' }).click();
  if (reads === 2) await page.getByRole('button', { name: '重新读取路线' }).click();
  await expect(card.getByRole('img', { name: /路线轮廓/ })).toBeVisible();
  expect(reads).toBe(3);
});

test.describe('province map mobile touch and pinch gestures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function readView(canvas: import('@playwright/test').Locator) {
    return canvas.evaluate((el) => ({
      mode: el.dataset.viewMode ?? '',
      alt: Number(el.dataset.viewAlt),
      yaw: Number(el.dataset.viewYaw),
      pitch: Number(el.dataset.viewPitch),
      panX: Number(el.dataset.viewPanX),
      panY: Number(el.dataset.viewPanY),
      gesture: el.dataset.viewGesture ?? '',
    }));
  }

  async function waitIdleFrame(page: import('@playwright/test').Page) {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  }

  async function touchPinch(
    cdp: import('@playwright/test').CDPSession,
    page: import('@playwright/test').Page,
    pts0: [{ x: number; y: number }, { x: number; y: number }],
    pts1: [{ x: number; y: number }, { x: number; y: number }],
    options: { steps?: number; release?: boolean; cancel?: boolean } = {},
  ) {
    const steps = options.steps ?? 8;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(pts0[0].x), y: Math.round(pts0[0].y), id: 1 },
        { x: Math.round(pts0[1].x), y: Math.round(pts0[1].y), id: 2 },
      ],
    });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: Math.round(pts0[0].x + (pts1[0].x - pts0[0].x) * t),
            y: Math.round(pts0[0].y + (pts1[0].y - pts0[0].y) * t),
            id: 1,
          },
          {
            x: Math.round(pts0[1].x + (pts1[1].x - pts0[1].x) * t),
            y: Math.round(pts0[1].y + (pts1[1].y - pts0[1].y) * t),
            id: 2,
          },
        ],
      });
      await page.waitForTimeout(16);
    }
    if (options.cancel) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    } else if (options.release !== false) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await waitIdleFrame(page);
  }

  async function setupMobileMap(page: import('@playwright/test').Page) {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await installMilestones(page);
    await loginRunner(page);
    await page.goto('/dashboard');
    const map = page.getByRole('region', { name: '足迹地图' });
    await expect(map.getByTestId('global-summary').locator('dd').first()).toHaveText('3');
    const stage = map.locator('[data-testid="global-map-loading"], [data-testid="global-map-ready"]');
    await stage.scrollIntoViewIfNeeded();
    const canvas = map.getByTestId('global-map-ready');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    await waitIdleFrame(page);
    const box = (await canvas.boundingBox())!;
    return { map, canvas, box, errors };
  }

  test('supports 3D pinch zoom in/out, continuous gestures, midpoint pan, 1-finger drag, pointer changes, boundaries, cancel, and scroll isolation', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    const { map, canvas, box, errors } = await setupMobileMap(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const resetBtn = map.getByRole('button', { name: '回到全局' });
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const v0 = await readView(canvas);
    expect(v0.mode).toBe('globe');
    expect(v0.gesture).toBe('idle');

    // 1. Pinch out (zoom in) + continuous pinch back in without lifting
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 25), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 25), y: Math.round(cy), id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      const half = 25 + (100 - 25) * (i / 8);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(cx - half), y: Math.round(cy), id: 1 },
          { x: Math.round(cx + half), y: Math.round(cy), id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await waitIdleFrame(page);
    const vZoomIn = await readView(canvas);
    expect(vZoomIn.gesture).toBe('pinch');
    expect(vZoomIn.alt).toBeLessThan(v0.alt * 0.45);
    await expect(resetBtn).toBeEnabled();

    // Continuous pinch back in (zoom out) without releasing
    for (let i = 1; i <= 8; i++) {
      const half = 100 - (100 - 35) * (i / 8);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(cx - half), y: Math.round(cy), id: 1 },
          { x: Math.round(cx + half), y: Math.round(cy), id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const vZoomOut = await readView(canvas);
    expect(vZoomOut.gesture).toBe('idle');
    expect(vZoomOut.alt).toBeGreaterThan(vZoomIn.alt * 1.8);
    // Lifting pinch fingers must not accidentally select a province/city
    await expect(
      map.getByRole('group', { name: '中国已点亮省/州' }).getByRole('button', { name: /台湾/ }),
    ).toHaveAttribute('aria-pressed', 'false');

    // 2. Two-finger midpoint displacement rotates globe
    const beforeMidPan = await readView(canvas);
    await touchPinch(
      cdp,
      page,
      [
        { x: cx - 35, y: cy },
        { x: cx + 35, y: cy },
      ],
      [
        { x: cx + 25, y: cy - 20 },
        { x: cx + 95, y: cy - 20 },
      ],
    );
    const afterMidPan = await readView(canvas);
    expect(Math.abs(afterMidPan.yaw - beforeMidPan.yaw)).toBeGreaterThan(0.05);
    expect(Math.abs(afterMidPan.pitch - beforeMidPan.pitch)).toBeGreaterThan(0.01);

    // 3. Mid-gesture pointer change: 2 fingers -> lift 1 -> drag with remaining 1 -> lift
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 40), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 40), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 60), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 60), y: Math.round(cy), id: 2 },
      ],
    });
    await waitIdleFrame(page);
    const beforeDrop = await readView(canvas);
    expect(beforeDrop.gesture).toBe('pinch');
    // Lift finger 2, keep finger 1
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: Math.round(cx + 60), y: Math.round(cy), id: 2 }],
    });
    await waitIdleFrame(page);
    const afterDrop = await readView(canvas);
    expect(afterDrop.gesture).toBe('drag');
    expect(Math.abs(afterDrop.yaw - beforeDrop.yaw)).toBeLessThan(0.01);
    // Drag remaining finger smoothly (move further in 2 steps so yaw delta is unmistakable even at zoomed-in alt)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(cx + 20), y: Math.round(cy + 25), id: 1 }],
    });
    await page.waitForTimeout(16);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(cx + 80), y: Math.round(cy + 40), id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const afterSingleDrag = await readView(canvas);
    expect(afterSingleDrag.gesture).toBe('idle');
    expect(Math.abs(afterSingleDrag.yaw - afterDrop.yaw)).toBeGreaterThan(0.02);

    // 3b. Collapse pinch span below MIN_PINCH_SPAN_PX (80px -> 2px) and recover (2px -> 6px -> 60px):
    // recovery spread must zoom IN (decrease alt), never jump backward
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 40), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 40), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 1), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 1), y: Math.round(cy), id: 2 },
      ],
    });
    await waitIdleFrame(page);
    const atTinySpan = await readView(canvas);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 3), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 3), y: Math.round(cy), id: 2 },
      ],
    });
    await waitIdleFrame(page);
    const afterTinyRecover = await readView(canvas);
    expect(afterTinyRecover.alt).toBeLessThanOrEqual(atTinySpan.alt);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 30), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 30), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const afterFullRecover = await readView(canvas);
    expect(afterFullRecover.alt).toBeLessThan(afterTinyRecover.alt);

    // 4. Boundary zoom clamp (min and max) + touchCancel recovery
    for (let k = 0; k < 2; k++) {
      await touchPinch(
        cdp,
        page,
        [
          { x: cx - 10, y: cy },
          { x: cx + 10, y: cy },
        ],
        [
          { x: cx - 160, y: cy },
          { x: cx + 160, y: cy },
        ],
      );
    }
    const minZoom1 = await readView(canvas);
    await touchPinch(
      cdp,
      page,
      [
        { x: cx - 10, y: cy },
        { x: cx + 10, y: cy },
      ],
      [
        { x: cx - 160, y: cy },
        { x: cx + 160, y: cy },
      ],
    );
    const minZoom2 = await readView(canvas);
    expect(Number.isFinite(minZoom2.alt)).toBe(true);
    expect(minZoom2.alt).toBeGreaterThan(0.01);
    expect(minZoom2.alt).toBeCloseTo(minZoom1.alt, 2);

    // Pinch in to max boundary, verify clamp, then cancel mid-gesture
    for (let k = 0; k < 3; k++) {
      await touchPinch(
        cdp,
        page,
        [
          { x: cx - 150, y: cy },
          { x: cx + 150, y: cy },
        ],
        [
          { x: cx - 15, y: cy },
          { x: cx + 15, y: cy },
        ],
      );
    }
    const maxZoom1 = await readView(canvas);
    await touchPinch(
      cdp,
      page,
      [
        { x: cx - 150, y: cy },
        { x: cx + 150, y: cy },
      ],
      [
        { x: cx - 15, y: cy },
        { x: cx + 15, y: cy },
      ],
      { cancel: true },
    );
    const afterCancel = await readView(canvas);
    expect(afterCancel.gesture).toBe('idle');
    expect(Number.isFinite(afterCancel.alt)).toBe(true);
    expect(afterCancel.alt).toBeCloseTo(maxZoom1.alt, 2);

    // 5. Mobile page scroll isolation inside vs outside canvas
    const scrollAfterMapGestures = await page.evaluate(() => ({
      scrollY: window.scrollY,
      vvScale: window.visualViewport?.scale ?? 1,
    }));
    expect(scrollAfterMapGestures.scrollY).toBe(scrollBefore);
    expect(scrollAfterMapGestures.vvScale).toBe(1);

    // 1-finger vertical swipe outside the map canvas must still scroll the page
    const headingBox = (await map.locator('.map-heading').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(headingBox.x + 80), y: Math.round(headingBox.y + 10), id: 1 }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(headingBox.x + 80), y: Math.round(headingBox.y + 10 + i * 30), id: 1 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const scrollAfterOutsideSwipe = await page.evaluate(() => window.scrollY);
    expect(scrollAfterOutsideSwipe).not.toBe(scrollBefore);
    expect(errors).toEqual([]);
  });

  test('supports 2D pinch zoom in/out, continuous gestures, off-center midpoint anchor, 1-finger drag, pointer changes, boundaries, and cancel', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    const { map, canvas, box, errors } = await setupMobileMap(page);
    await map.getByRole('button', { name: '切换为 2D 平面地图' }).click();
    await page.waitForTimeout(1250);
    await waitIdleFrame(page);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const resetBtn = map.getByRole('button', { name: '回到全局' });
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const v0 = await readView(canvas);
    expect(v0.mode).toBe('mercator');
    expect(v0.gesture).toBe('idle');

    // 1. Off-center pinch out (zoom in) then continuous pinch back in
    const anchorX = box.x + box.width * 0.7;
    const anchorY = box.y + box.height * 0.4;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(anchorX - 20), y: Math.round(anchorY), id: 1 },
        { x: Math.round(anchorX + 20), y: Math.round(anchorY), id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      const half = 20 + (90 - 20) * (i / 8);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(anchorX - half), y: Math.round(anchorY), id: 1 },
          { x: Math.round(anchorX + half), y: Math.round(anchorY), id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await waitIdleFrame(page);
    const vZoomIn = await readView(canvas);
    expect(vZoomIn.gesture).toBe('pinch');
    expect(vZoomIn.alt).toBeLessThan(v0.alt * 0.4);
    // Off-center anchor shifts pan toward the right-top pinch midpoint
    expect(vZoomIn.panX).toBeGreaterThan(v0.panX);
    await expect(resetBtn).toBeEnabled();

    // Continuous pinch back in without lifting
    for (let i = 1; i <= 8; i++) {
      const half = 90 - (90 - 25) * (i / 8);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(anchorX - half), y: Math.round(anchorY), id: 1 },
          { x: Math.round(anchorX + half), y: Math.round(anchorY), id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const vZoomOut = await readView(canvas);
    expect(vZoomOut.gesture).toBe('idle');
    expect(vZoomOut.alt).toBeGreaterThan(vZoomIn.alt * 2.0);

    // 2. Two-finger midpoint displacement pans 2D map
    const beforeMidPan = await readView(canvas);
    await touchPinch(
      cdp,
      page,
      [
        { x: cx - 35, y: cy },
        { x: cx + 35, y: cy },
      ],
      [
        { x: cx - 85, y: cy + 30 },
        { x: cx - 15, y: cy + 30 },
      ],
    );
    const afterMidPan = await readView(canvas);
    expect(afterMidPan.panX).toBeGreaterThan(beforeMidPan.panX);
    expect(afterMidPan.panY).toBeGreaterThan(beforeMidPan.panY);

    // 3. One-finger drag pans 2D map without scrolling page
    const beforeSingle = await readView(canvas);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(cx), y: Math.round(cy), id: 1 }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(cx + i * 12), y: Math.round(cy + i * 10), id: 1 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const afterSingle = await readView(canvas);
    expect(afterSingle.gesture).toBe('idle');
    expect(afterSingle.panX).toBeLessThan(beforeSingle.panX);

    // 3b. Mid-gesture pointer change in 2D: 2 fingers -> lift 1 -> drag remaining 1 -> lift
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 40), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 40), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 60), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 60), y: Math.round(cy), id: 2 },
      ],
    });
    await waitIdleFrame(page);
    const before2dDrop = await readView(canvas);
    expect(before2dDrop.gesture).toBe('pinch');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: Math.round(cx + 60), y: Math.round(cy), id: 2 }],
    });
    await waitIdleFrame(page);
    const after2dDrop = await readView(canvas);
    expect(after2dDrop.gesture).toBe('drag');
    expect(Math.abs(after2dDrop.panX - before2dDrop.panX)).toBeLessThan(0.005);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(cx + 20), y: Math.round(cy + 20), id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitIdleFrame(page);
    const after2dSingle = await readView(canvas);
    expect(after2dSingle.gesture).toBe('idle');
    expect(after2dSingle.panX).toBeLessThan(after2dDrop.panX);

    // 4. Boundary zoom clamp (min clamp reached, subsequent pinch stays clamped) + touchCancel
    for (let k = 0; k < 2; k++) {
      await touchPinch(
        cdp,
        page,
        [
          { x: cx - 15, y: cy },
          { x: cx + 15, y: cy },
        ],
        [
          { x: cx - 160, y: cy },
          { x: cx + 160, y: cy },
        ],
      );
    }
    const min2d1 = await readView(canvas);
    await touchPinch(
      cdp,
      page,
      [
        { x: cx - 15, y: cy },
        { x: cx + 15, y: cy },
      ],
      [
        { x: cx - 160, y: cy },
        { x: cx + 160, y: cy },
      ],
      { cancel: true },
    );
    const min2d2 = await readView(canvas);
    expect(min2d2.gesture).toBe('idle');
    expect(min2d2.alt).toBeCloseTo(min2d1.alt, 2);

    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);
    expect(errors).toEqual([]);
  });
});
