import { expect, test, type Page } from '@playwright/test';

const root = '/footprints/exploration';
const ownerCookie = { name: 'run_session', value: 'ui-runner', domain: '127.0.0.1', path: '/' };
const base = '/api/v1/me/footprints/exploration';
const version = { status: 'ready', source_version: 2, atlas_version: 'synthetic-2026' };
const city = {
  code: 'synthetic',
  name: '青岬市',
  region_name: '岚海州',
  kind: 'boundary',
  first_date: '2024-05-12',
  last_date: '2026-06-04',
  activity_count: 42,
  distance_m: 182400,
};
const point = {
  ...city,
  code: 'nearby',
  name: '杉港市',
  kind: 'nearby',
  activity_count: 5,
  distance_m: null,
};
const radius = 6378137;
const lng = (column: number) => (column * 100 * 180) / (Math.PI * radius);
const lat = (row: number) => (Math.atan(Math.sinh((row * 100) / radius)) * 180) / Math.PI;

async function fixture(page: Page) {
  const state = { response: 'ready', requests: [] as { url: URL; header: string | undefined }[] };
  await page.route(`**${base}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.requests.push({ url, header: request.headers()['x-footprint-viewport'] });
    if (state.response === 'unauthorized') return route.fulfill({ status: 401, json: { data: null } });
    if (state.response === 'error') return route.fulfill({ status: 503, json: { data: null } });
    let data;
    if (url.pathname.endsWith('/cities')) {
      const empty = state.response === 'empty';
      data = {
        ...version,
        status: state.response === 'pending' ? 'pending' : 'ready',
        items: empty ? [] : [city, point],
        total: empty ? 0 : 2,
        limit: 20,
        offset: 0,
        regions: empty ? [] : [{ code: 'CN-01', name: '岚海州' }],
        activity_count: empty ? 0 : 44,
        boundary_count: empty ? 0 : 1,
        nearby_count: empty ? 0 : 1,
        no_track_count: 0,
        unmatched_count: 0,
        distance_m: empty ? 0 : city.distance_m,
        unallocated_m: empty ? 0 : 6542,
      };
    } else if (url.pathname.endsWith('/cells')) {
      const onlyNew = url.searchParams.get('layer') === 'new';
      data = {
        ...version,
        bounds: [lng(100000), lat(30000), lng(100040), lat(30021)],
        block_size: 1,
        cells: Array.from({ length: 120 }, (_, i) => [
          100000 + (i % 40),
          30000 + (i < 40 ? Math.floor(i / 9) : i < 80 ? Math.floor((i - 40) / 3) : 19 - (i % 10)),
          onlyNew ? 1 : 1 + (i % 10),
        ]).filter((_, i) => !onlyNew || i % 3 === 0),
      };
    } else {
      const code = url.pathname.split('/').at(-1);
      const current = code === 'synthetic' ? city : code === 'nearby' ? point : null;
      const scope = url.pathname.split('/').at(-2);
      const increments = [8, 17, 14, 8, 19, 7, 23, 0, 6, 18, 8, 0];
      let cumulative = 358;
      data = {
        ...version,
        scope,
        code,
        name: current?.name ?? (scope === 'region' ? '岚海州' : '全域'),
        year: Number(url.searchParams.get('year')),
        first_year: 2024,
        city: current,
        months: increments.map((n, i) => ({ month: i + 1, new_cells: n, cumulative_cells: (cumulative += n) })),
        new_cells: 128,
        cumulative_cells: 486,
      };
    }
    await route.fulfill({ json: { data, error: null }, headers: { 'Cache-Control': 'private, no-store' } });
  });
  return state;
}

test('private entry, catalogue, map, year, layer, scope and keyboard', async ({ page }) => {
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
  const cityLink = page.getByRole('link', { name: /青岬市/ });
  await cityLink.focus();
  await expect(cityLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '青岬市' })).toBeVisible();
  await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(() =>
      state.requests.map(({ url, header }) =>
        url.pathname.endsWith('/cells') ? (header ?? 'initial cells') : url.pathname,
      ),
    )
    .toContainEqual(expect.stringContaining(','));
  await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-drawn', 'true');
  expect(state.requests.every((entry) => !entry.url.searchParams.has('bbox'))).toBe(true);
  expect(external).toHaveLength(0);
  await page.getByRole('button', { name: '新增格网' }).click();
  await expect.poll(() => state.requests.some((entry) => entry.url.searchParams.get('layer') === 'new')).toBe(true);
  await page.getByLabel('年份').selectOption('2024');
  await expect(page.getByText('2024 年每月新增格网')).toBeVisible();
  await page.getByText('查看逐月数据').click();
  await expect(page.getByRole('rowheader', { name: '1 月', exact: true })).toBeVisible();
  await page.getByLabel('范围').selectOption('region:CN-01');
  await expect(page.getByRole('heading', { name: '岚海州' })).toBeVisible();
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

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`catalogue and detail at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.context().addCookies([ownerCookie]);
      await page.addInitScript((value) => localStorage.setItem('runnote-theme', value), theme);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.setViewportSize({ width, height: 900 });
      await fixture(page);
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(root);
      await expect(page.getByRole('heading', { name: '城市探索' })).toBeVisible();
      await expect(page.getByRole('link', { name: /青岬市/ })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(await noOverflow()).toBe(true);
      if (width !== 320 && process.env.EXPLORATION_SCREENSHOTS) {
        await page.screenshot({ path: info.outputPath(`catalog-${width}-${theme}.png`), fullPage: true });
      }
      await page.getByRole('link', { name: /青岬市/ }).click();
      await expect(page.getByRole('heading', { name: '青岬市' })).toBeVisible();
      await expect(page.getByTestId('exploration-map')).toHaveAttribute('data-drawn', 'true');
      if (width !== 320 && process.env.EXPLORATION_SCREENSHOTS) {
        await page.screenshot({ path: info.outputPath(`detail-${width}-${theme}.png`), fullPage: true });
      }
      expect(await noOverflow()).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
