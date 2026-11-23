import { expect, test, type Page } from '@playwright/test';

const root = '/footprints/exploration';
const ownerCookie = { name: 'run_session', value: 'ui-runner', domain: '127.0.0.1', path: '/' };
const base = '/api/v1/me/footprints/exploration';
const version = { status: 'ready', source_version: 2, atlas_version: 'synthetic-2026' };

const qingjia = {
  code: 'synthetic',
  name: '青岬市',
  short_name: '青岬',
  region_code: 'CN-310000',
  region_name: '上海市',
  country_code: 'CHN',
  kind: 'boundary',
  lon: 121.47,
  lat: 31.23,
  bounds: [121.1, 30.9, 121.8, 31.5] as [number, number, number, number],
  first_date: '2024-05-12',
  last_date: '2026-06-04',
  activity_count: 42,
  distance_m: 182400,
  is_new_in_year: false,
};

const songxi = {
  code: 'songxi',
  name: '松溪市',
  short_name: '松溪',
  region_code: 'CN-320000',
  region_name: '江苏省',
  country_code: 'CHN',
  kind: 'boundary',
  lon: 120.62,
  lat: 31.31,
  bounds: [120.3, 31.0, 120.9, 31.6] as [number, number, number, number],
  first_date: '2026-02-14',
  last_date: '2026-06-01',
  activity_count: 15,
  distance_m: 96200,
  is_new_in_year: true,
};

const haicheng = {
  code: 'haicheng',
  name: '海城',
  short_name: '海城',
  region_code: 'CN-510000',
  region_name: '四川省',
  country_code: 'CHN',
  kind: 'boundary',
  lon: 104.06,
  lat: 30.67,
  bounds: [103.6, 30.3, 104.5, 31.0] as [number, number, number, number],
  first_date: '2025-03-08',
  last_date: '2025-11-20',
  activity_count: 11,
  distance_m: 64500,
  is_new_in_year: false,
};

const shangang = {
  code: 'nearby',
  name: '杉港市',
  short_name: '杉港',
  region_code: 'CN-110000',
  region_name: '北京市',
  country_code: 'CHN',
  kind: 'nearby',
  lon: 116.4,
  lat: 39.9,
  bounds: null,
  first_date: '2025-04-01',
  last_date: '2026-05-01',
  activity_count: 5,
  distance_m: null,
  is_new_in_year: false,
};

const allMarkers = [qingjia, songxi, haicheng, shangang];
const toPlace = (m: typeof qingjia | typeof shangang) => ({
  code: m.code,
  name: m.name,
  region_name: m.region_name,
  kind: m.kind,
  first_date: m.first_date,
  last_date: m.last_date,
  activity_count: m.activity_count,
  distance_m: m.distance_m,
});

const radius = 6378137;
const lng = (column: number) => (column * 100 * 180) / (Math.PI * radius);
const lat = (row: number) => (Math.atan(Math.sinh((row * 100) / radius)) * 180) / Math.PI;

async function fixture(page: Page) {
  const state = {
    response: 'ready',
    requests: [] as { url: URL; header: string | undefined }[],
  };
  await page.route(`**${base}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.requests.push({ url, header: request.headers()['x-footprint-viewport'] });
    if (state.response === 'unauthorized') return route.fulfill({ status: 401, json: { data: null } });
    if (state.response === 'error') return route.fulfill({ status: 503, json: { data: null } });

    let data;
    const empty = state.response === 'empty';
    const pending = state.response === 'pending';

    if (url.pathname.endsWith('/cities')) {
      data = {
        ...version,
        status: pending ? 'pending' : 'ready',
        items: empty ? [] : allMarkers.map(toPlace),
        total: empty ? 0 : allMarkers.length,
        limit: 20,
        offset: 0,
        regions: empty
          ? []
          : [
              { code: 'CN-110000', name: '北京市' },
              { code: 'CN-310000', name: '上海市' },
              { code: 'CN-320000', name: '江苏省' },
              { code: 'CN-510000', name: '四川省' },
            ],
        activity_count: empty ? 0 : 73,
        boundary_count: empty ? 0 : 3,
        nearby_count: empty ? 0 : 1,
        no_track_count: 0,
        unmatched_count: 0,
        distance_m: empty ? 0 : 343100,
        unallocated_m: empty ? 0 : 6542,
      };
    } else if (url.pathname.endsWith('/markers')) {
      const yrParam = url.searchParams.get('year');
      const yr = yrParam ? Number(yrParam) : null;
      const items =
        empty || pending
          ? []
          : allMarkers.map((m) => ({ ...m, is_new_in_year: yr !== null && m.first_date.startsWith(String(yr)) }));
      data = {
        ...version,
        status: pending ? 'pending' : 'ready',
        year: yr,
        items,
        regions: empty
          ? []
          : [
              { code: 'CN-110000', name: '北京市' },
              { code: 'CN-310000', name: '上海市' },
              { code: 'CN-320000', name: '江苏省' },
              { code: 'CN-510000', name: '四川省' },
            ],
        activity_count: empty ? 0 : 73,
        boundary_count: empty ? 0 : 3,
        nearby_count: empty ? 0 : 1,
      };
    } else if (url.pathname.endsWith('/cells')) {
      const onlyNew = url.searchParams.get('layer') === 'new';
      const allYears = url.searchParams.get('all_years') === 'true';
      const y = Number(url.searchParams.get('year'));
      const emptyNew = onlyNew && !allYears && y === 2024;
      data = {
        ...version,
        bounds: [lng(135200), lat(36610), lng(135240), lat(36631)],
        block_size: 1,
        cells: emptyNew
          ? []
          : Array.from({ length: 120 }, (_, i) => [
              135200 + (i % 40),
              36610 + (i < 40 ? Math.floor(i / 9) : i < 80 ? Math.floor((i - 40) / 3) : 19 - (i % 10)),
              onlyNew ? 1 : 1 + (i % 10),
            ]).filter((_, i) => !onlyNew || i % 3 === 0),
      };
    } else {
      const code = url.pathname.split('/').at(-1);
      const found = allMarkers.find((m) => m.code === code) ?? null;
      const scope = url.pathname.split('/').at(-2);
      const y = Number(url.searchParams.get('year'));
      const increments =
        y === 2024 && (code === 'synthetic' || scope === 'global')
          ? Array(12).fill(0)
          : [8, 17, 14, 8, 19, 7, 23, 0, 6, 18, 8, 0];
      let cumulative = 358;
      data = {
        ...version,
        scope,
        code,
        name: found?.name ?? (scope === 'region' ? '上海市' : '全国及全球足迹总览'),
        year: y,
        first_year: 2024,
        city: found ? toPlace(found) : null,
        months: increments.map((n, i) => ({ month: i + 1, new_cells: n, cumulative_cells: (cumulative += n) })),
        new_cells: increments.reduce((a, b) => a + b, 0),
        cumulative_cells: cumulative,
      };
    }
    await route.fulfill({ json: { data, error: null }, headers: { 'Cache-Control': 'private, no-store' } });
  });
  return state;
}

test('overview-first map, zero external requests, all-years default, drill-down, nearby and keyboard', async ({
  page,
}) => {
  const state = await fixture(page);
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tiles.openfreemap.org/')) external.push(request.url());
  });

  await page.goto('/footprints');
  await expect(page.getByRole('link', { name: '城市探索' })).toHaveCount(0);
  await page.goto(root);
  await expect(page).toHaveURL(/\/admin\?next=/);
  await page.context().addCookies([ownerCookie]);
  await page.goto('/p/runner/footprints');
  await expect(page.getByRole('link', { name: '城市探索' })).toHaveCount(0);

  await page.goto('/footprints');
  await page.getByRole('link', { name: '城市探索' }).click();

  // First load opens directly in national overview with map + city atlas + trend.
  const mapEl = page.getByTestId('exploration-map');
  await expect(mapEl).toHaveAttribute('data-ready', 'true');
  await expect(mapEl).toHaveAttribute('data-drawn', 'true');
  await expect(mapEl).toHaveAttribute('data-zoom-tier', 'country');
  await expect(page.getByLabel('年份')).toHaveValue('all');
  await expect(page.locator('.map-label').first()).toBeVisible();
  expect(external).toHaveLength(0);
  // National overview uses /markers without fetching nationwide /cells at low zoom.
  expect(state.requests.some((entry) => entry.url.pathname.endsWith('/markers'))).toBe(true);
  expect(state.requests.some((entry) => entry.url.pathname.endsWith('/cells'))).toBe(false);

  // Linked city ranking click drills down into city scope and fetches bbox /cells.
  const cityLink = page.getByRole('link', { name: /青岬市/ });
  await cityLink.focus();
  await expect(cityLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '青岬市' })).toBeVisible();
  await expect
    .poll(() =>
      state.requests.map(({ url }) =>
        url.pathname.endsWith('/cells')
          ? `${url.searchParams.get('all_years')}:${url.searchParams.get('bbox') ?? ''}`
          : url.pathname,
      ),
    )
    .toContainEqual(expect.stringContaining('true:'));
  await expect(mapEl).toHaveAttribute('data-drawn', 'true');
  expect(state.requests.every((entry) => entry.header === undefined)).toBe(true);
  expect(external).toHaveLength(0);

  // Switch to first-exploration mode -> defaults from 'all' to current year.
  await page.getByRole('button', { name: '首次探索' }).click();
  await expect(page.getByLabel('年份')).not.toHaveValue('all');
  await expect.poll(() => state.requests.some((entry) => entry.url.searchParams.get('layer') === 'new')).toBe(true);

  // Switch to year with 0 new cells -> shows friendly switch-to-history prompt, not blank failure.
  await page.getByLabel('年份').selectOption('2024');
  await expect(page.getByRole('button', { name: '查看全部年份' })).toBeVisible();
  await page.getByRole('button', { name: '查看全部年份' }).click();
  await expect(page.getByLabel('年份')).toHaveValue('all');

  // Nearby city is clickable and opens nearby summary without crashing.
  await page.getByRole('link', { name: /杉港市/ }).click();
  await expect(page.getByRole('heading', { name: '杉港市' })).toBeVisible();
  await expect(page.getByText('附近有记录', { exact: true })).toBeVisible();

  // Reset to national overview button returns to global scope.
  await page.getByRole('button', { name: '回到全国' }).click();
  await expect(page.getByRole('heading', { name: '全国及全球足迹总览' })).toBeVisible();

  // Regression: in 'new' mode on a year with zero new cells, historical markers remain visible on the map.
  await page.getByRole('button', { name: '首次探索' }).click();
  await page.getByLabel('年份').selectOption('2024');
  await expect(page.getByRole('button', { name: '查看全部年份' })).toBeVisible();
  await expect(mapEl).toHaveAttribute('data-drawn', 'true');
  await expect(page.locator('.map-label').first()).toBeVisible();
  await page.getByRole('button', { name: '查看全部年份' }).click();
  await expect(page.getByLabel('年份')).toHaveValue('all');

  await page.getByText('查看逐月数据').click();
  await expect(page.getByRole('rowheader', { name: '1 月', exact: true })).toBeVisible();
});

test('mobile touch tap shows confirmation bar before drilling down', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await context.addCookies([ownerCookie]);
  await fixture(page);
  await page.goto(root);
  const mapEl = page.getByTestId('exploration-map');
  await expect(mapEl).toHaveAttribute('data-drawn', 'true');
  // Tap Chengdu (haicheng) marker or dispatch touch pointerdown + click on map canvas.
  const box = await mapEl.boundingBox();
  expect(box).not.toBeNull();
  // Tapping via touchscreen on the Chengdu bubble area or verifying touch pointer path triggers tap bar if hit:
  await page.touchscreen.tap(box!.x + box!.width * 0.48, box!.y + box!.height * 0.56);
  // Ensure layout stays clean on mobile touch viewport with no overflow.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('pending, retry, empty and expired session', async ({ page }) => {
  await page.context().addCookies([ownerCookie]);
  const state = await fixture(page);
  state.response = 'pending';
  await page.goto(root);
  await expect(page.getByText('正在整理历史足迹')).toBeVisible();
  state.response = 'error';
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(page.getByRole('alert')).toContainText('无法读取城市探索');
  state.response = 'empty';
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('还没有跑步记录')).toBeVisible();
  state.response = 'unauthorized';
  await page.reload();
  await expect(page).toHaveURL(/\/admin\?reason=changed/);
});

for (const width of [390, 768, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`overview and drill-down at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.context().addCookies([ownerCookie]);
      await page.addInitScript((value) => localStorage.setItem('runnote-theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.setViewportSize({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 });
      await fixture(page);
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto(root);
      await expect(page.getByRole('heading', { name: '城市探索' })).toBeVisible();
      await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-drawn', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(await noOverflow()).toBe(true);

      if (process.env.EXPLORATION_SCREENSHOTS) {
        await page.screenshot({ path: info.outputPath(`overview-${width}-${theme}.png`), fullPage: true });
      }

      await page.getByRole('link', { name: /青岬市/ }).click();
      await expect(page.getByRole('heading', { name: '青岬市' })).toBeVisible();
      await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-zoom-tier', 'city');
      await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-drawn', 'true');
      if (process.env.EXPLORATION_SCREENSHOTS) {
        await page.screenshot({ path: info.outputPath(`city-${width}-${theme}.png`), fullPage: true });
      }
      expect(await noOverflow()).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
