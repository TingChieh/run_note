import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';

// A synthetic small running loop, independent of real places or user tracks.
const coordinates = Array.from({ length: 49 }, (_, index) => {
  const angle = index * Math.PI / 24;
  return [121.48 + Math.sin(angle) * .0006, 31.23 + Math.cos(angle) * .0012];
});
const geometry = { type: 'LineString', coordinates };
const routeData = {
  type: 'FeatureCollection', start: coordinates[0], end: coordinates.at(-1),
  features: [{ type: 'Feature', geometry, properties: { segment_index: 0, point_count: coordinates.length } }]
};

async function installLoop(page: Page) {
  const state = await installActivities(page);
  state.records = [{ ...sampleActivity, timer_seconds: '1166', avg_heart_rate_bpm: 156, calories_kcal: 144, steps: 3262 }];
  await page.route(`**/api/v1/showcase/activities/${sampleActivity.id}/route`, route => route.fulfill({ json: { data: routeData, error: null } }));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await loginRunner(page);
}

async function routeExtent(page: Page) {
  const png = await page.locator('.maplibregl-canvas').screenshot({ style: '.glass-tuner { visibility: hidden !important; }' });
  // Read the presented WebGL frame: its offscreen drawing buffer is discarded.
  return page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4, [r, g, b] = pixels.slice(i, i + 3);
      if (r < 180 && g > 90 && g < 225 && b < 200 && g > r * 1.2 && g > b * 1.1) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { ratio: Math.max((right - left) / canvas.width, (bottom - top) / canvas.height), margin: Math.min(left, top, canvas.width - right, canvas.height - bottom) };
  }, png.toString('base64'));
}

for (const view of ['detail', 'preview']) test(`small loops fill the ${view} map while staying fully visible`, async ({ page }, testInfo) => {
  await installLoop(page);
  await page.goto(view === 'detail' ? `/activities/${sampleActivity.id}` : '/dashboard?year=2026');
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  await page.getByRole('button', { name: '关闭底图', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('route-map-ready')).toBeVisible();
    await expect.poll(async () => (await routeExtent(page)).ratio).toBeGreaterThan(.55);
    expect((await routeExtent(page)).margin).toBeGreaterThan(20);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width !== 320) await page.locator(view === 'detail' ? '.detail-workspace' : '.activity-explorer').screenshot({ path: testInfo.outputPath(`${view}-${width}.png`), animations: 'disabled', style: '.glass-tuner { visibility: hidden !important; }' });
  }
});

for (const mode of ['tracks', 'heatmap']) test(`small ${mode} footprints fill the map on load, selection and overview`, async ({ page }, testInfo) => {
  await installLoop(page);
  await page.route('**/api/v1/showcase/footprints/all?**', route => route.fulfill({ json: { data: {
    status: 'ready', generated_at: '2026-10-15T00:00:00Z', refreshing: false,
    result: { scope: 'all', type: 'FeatureCollection', mode, activity_count: 1, visible_activity_count: 1,
      unsupported_segment_count: 0, grid_size_m: 100, grid_crs: 'EPSG:3857', count_basis: 'distinct_activity_per_cell', max_count: mode === 'heatmap' ? 2 : 0,
      features: [{ type: 'Feature', geometry: mode === 'tracks' ? geometry : { type: 'Polygon', coordinates: [[[121.48,31.23],[121.481,31.23],[121.481,31.231],[121.48,31.231],[121.48,31.23]]] },
        properties: { activity_id: sampleActivity.id, title: sampleActivity.title, activity_date: sampleActivity.activity_date, segment_index: 0, i: 135236, j: 36621, count: 2 } }]
    }
  }, error: null } }));
  await page.goto(`/footprints?mode=${mode}`);
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible();
  await page.getByRole('button', { name: '关闭底图', exact: true }).click();
  await expect.poll(async () => (await routeExtent(page)).ratio).toBeGreaterThan(.6);
  if (mode === 'tracks') {
    await page.getByText('全部可显示记录', { exact: false }).click();
    await page.getByRole('button', { name: `定位 ${sampleActivity.title}`, exact: true }).click();
  } else {
    await page.getByText('查看热区数据', { exact: false }).click();
    await page.getByRole('button', { name: '定位热区 1', exact: true }).click();
  }
  await expect.poll(async () => (await routeExtent(page)).ratio).toBeGreaterThan(.6);
  await page.getByRole('button', { name: '回到全部足迹', exact: true }).click();
  await expect.poll(async () => (await routeExtent(page)).ratio).toBeGreaterThan(.6);
  await page.getByRole('group', { name: '有记录的城市', exact: true }).getByRole('button', { name: '上海市', exact: true }).click();
  await expect.poll(async () => (await routeExtent(page)).ratio).toBeGreaterThan(.6);
  expect((await routeExtent(page)).margin).toBeGreaterThan(20);
  await page.locator('.map-frame').screenshot({ path: testInfo.outputPath(`${mode}.png`), style: '.glass-tuner { visibility: hidden !important; }' });
});
