import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';
import { installBasemaps, observeMaps, mapState, chooseBasemap, basemapReady } from '../fixtures/basemaps';

test('switches real vector layers while preserving multisegment routes, camera and markers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installActivities(page); await installBasemaps(page); await loginRunner(page);
  await page.route('**/api/v1/showcase/activities/*/route', route => route.fulfill({ json: { data: { type: 'FeatureCollection', start: [121.48,31.23], end: [121.49,31.237], features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[121.48,31.23],[121.482,31.231]] }, properties: { segment_index: 0, point_count: 2 } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[121.487,31.236],[121.49,31.237]] }, properties: { segment_index: 1, point_count: 2 } }
  ] }, error: null } }));
  await page.goto(`/activities/${sampleActivity.id}`); await expect(page.getByTestId('route-map-ready')).toBeVisible(); await basemapReady(page, 'positron'); await observeMaps(page);
  await page.evaluate(() => (window as any).__maps.at(-1).jumpTo({ bearing: 22, pitch: 35, zoom: 13 }));
  const before = await mapState(page); const canvas = await page.locator('.maplibregl-canvas').elementHandle();
  const marker = await page.getByLabel('路线起点').boundingBox();
  for (const name of ['Dark', 'Liberty', 'Positron']) {
    await chooseBasemap(page, name); await basemapReady(page, name.toLowerCase());
    const after = await mapState(page); expect(after.camera).toEqual(before.camera); expect(after.local).toEqual(before.local);
    expect(new Set(after.layers).size).toBe(after.layers.length);
    expect(after.layers.indexOf('route-lines')).toBeGreaterThan(after.layers.findIndex(id => id.endsWith('-land')));
    await expect(page.getByLabel('路线终点')).toBeVisible();
    const current = await page.getByLabel('路线起点').boundingBox(); expect(current!.x).toBeCloseTo(marker!.x, 1); expect(current!.y).toBeCloseTo(marker!.y, 1);
  }
  expect(await canvas!.evaluate(el => el === document.querySelector('.maplibregl-canvas'))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenMapTiles');
  expect(errors).toEqual([]);
  await page.locator('.route-map').screenshot({ path: 'test-results/basemap-route.png' });
});

test('automatic theme, persistent manual override, rapid races, outage, retry and off mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await installActivities(page); const state = await installBasemaps(page); await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`); await basemapReady(page, 'positron'); await observeMaps(page);
  await page.emulateMedia({ colorScheme: 'dark' }); await basemapReady(page, 'dark');
  await chooseBasemap(page, 'Liberty'); await basemapReady(page, 'liberty');
  await page.emulateMedia({ colorScheme: 'light' }); await basemapReady(page, 'liberty');
  await page.reload(); await basemapReady(page, 'liberty'); await observeMaps(page);
  await chooseBasemap(page, '自动（跟随外观）'); await basemapReady(page, 'positron');
  state.delay = 350;
  for (const name of ['Dark', 'Liberty', 'Dark', 'Positron', 'Liberty']) await chooseBasemap(page, name);
  await basemapReady(page, 'liberty');
  const snapshot = await mapState(page); expect(snapshot.sources.filter(id => id.startsWith('basemap-'))).toHaveLength(1);
  state.fail = true; await chooseBasemap(page, 'Dark');
  await expect(page.getByRole('button', { name: '重试底图', exact: true })).toBeVisible();
  await expect(page.getByTestId('route-map-ready')).toBeVisible(); await expect(page.getByLabel('路线起点')).toBeVisible();
  state.fail = false; state.delay = 0; await page.getByRole('button', { name: '重试底图', exact: true }).click(); await basemapReady(page, 'dark');
  await page.getByRole('button', { name: '关闭底图', exact: true }).click();
  const requests = state.requests.length; await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('[data-basemap-status="off"]')).toBeVisible(); expect(state.requests.length).toBe(requests);
  await page.getByRole('button', { name: '开启底图', exact: true }).click(); await basemapReady(page, 'dark');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const toggle = page.getByRole('button', { name: '切换底图', exact: true });
    await toggle.focus(); await page.keyboard.press('Enter');
    const menu = page.getByRole('group', { name: '底图样式', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('scale', '1');
    const menuBounds = (await menu.boundingBox())!; expect(menuBounds.x).toBeGreaterThanOrEqual(0); expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/basemap-menu-${width}.png` });
    await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
    const bounds = await page.locator('.basemap-picker').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);

  }
});

for (const mode of ['tracks', 'heatmap']) test(`preserves footprint ${mode} data, camera, selection and click events`, async ({ page }) => {
  await installActivities(page); await installBasemaps(page);
  await page.route('**/api/v1/showcase/footprints/all?**', route => route.fulfill({ json: { data: { status: 'ready', generated_at: '2026-10-15T00:00:00Z', refreshing: false, result: {
    scope: 'all', type: 'FeatureCollection', mode, activity_count: 1, visible_activity_count: 1, unsupported_segment_count: 0, grid_size_m: 100, grid_crs: 'EPSG:3857', count_basis: 'distinct_activity_per_cell', max_count: mode === 'heatmap' ? 2 : 0,
    features: [{ type: 'Feature', geometry: mode === 'tracks' ? { type: 'LineString', coordinates: [[121.48,31.23],[121.49,31.24]] } : { type: 'Polygon', coordinates: [[[121.48,31.23],[121.49,31.23],[121.49,31.24],[121.48,31.24],[121.48,31.23]]] },
      properties: mode === 'tracks' ? { activity_id: sampleActivity.id, title: sampleActivity.title, activity_date: sampleActivity.activity_date, segment_index: 0 } : { i: 1, j: 1, count: 2 } }]
  } }, error: null } }));
  await loginRunner(page); await page.goto(`/footprints?mode=${mode}`); await expect(page.getByTestId('footprint-map-ready')).toBeVisible(); await basemapReady(page, 'positron'); await observeMaps(page);
  if (mode === 'tracks') { await page.getByText('全部可显示记录', { exact: false }).click(); await page.getByRole('button', { name: `定位 ${sampleActivity.title}`, exact: true }).click(); }
  else { await page.getByText('查看热区数据', { exact: false }).click(); await page.getByRole('button', { name: '定位热区 1', exact: true }).click(); }
  const before = await mapState(page);
  for (const name of ['Dark', 'Liberty', 'Positron']) {
    await chooseBasemap(page, name); await basemapReady(page, name.toLowerCase());
    const after = await mapState(page); expect(after.camera).toEqual(before.camera); expect(after.local).toEqual(before.local); expect(after.selection).toEqual(before.selection);
  }
  const canvas = page.locator('.maplibregl-canvas'); const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  if (mode === 'tracks') await expect(page.getByTestId('route-choices').getByRole('link')).toHaveCount(1);
  else await expect(page.getByRole('status').filter({ hasText: '所选网格：2 条' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('button', { name: '切换底图', exact: true }).click();
  await expect(page.getByRole('group', { name: '底图样式', exact: true })).toHaveCSS('opacity', '1');
  await expect(page.getByRole('group', { name: '底图样式', exact: true })).toHaveCSS('scale', '1');
  await page.screenshot({ path: `test-results/basemap-${mode}-mobile.png` });
});

test('slow style metadata times out while local geometry stays rendered, and retry recovers', async ({ page }) => {
  await installActivities(page); const state = await installBasemaps(page); state.delay = 9500;
  await page.clock.install();
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  await expect(page.getByLabel('路线终点')).toBeVisible();
  await expect.poll(() => state.styles.length).toBe(1);
  await page.clock.fastForward(8100);
  await expect(page.getByRole('button', { name: '重试底图', exact: true })).toBeVisible();
  state.delay = 0; await page.getByRole('button', { name: '重试底图', exact: true }).click(); await basemapReady(page, 'positron');
});

test('sprite outage leaves the local route usable and retry reloads failed sprite assets', async ({ page }) => {
  await installActivities(page); const state = await installBasemaps(page); state.sprite = true; state.failSprite = true;
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible(); await expect(page.getByRole('button', { name: '重试底图', exact: true })).toBeVisible();
  await observeMaps(page);
  state.failSprite = false; await page.getByRole('button', { name: '重试底图', exact: true }).click(); await basemapReady(page, 'positron');
});

test('layer picker keeps its glass surface through dismissal and has stable opening coordinates', async ({ page }) => {
  await installActivities(page); await installBasemaps(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`); await basemapReady(page, 'positron');
  const toggle = page.getByRole('button', { name: '切换底图', exact: true });
  const panel = page.getByRole('group', { name: '底图样式', exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await toggle.click(); await expect(panel.locator('.rn-moving-copy')).toHaveCount(1);
    await expect(panel).toHaveCSS('opacity', '1');
    const coordinates = await panel.evaluate(async el => {
      const values: string[] = [];
      for (let i = 0; i < 8; i++) { values.push(`${(el as HTMLElement).style.top},${(el as HTMLElement).style.right}`); await new Promise(requestAnimationFrame); }
      return values;
    });
    expect(new Set(coordinates).size).toBe(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(100);
    // Native Popover remains painted while the existing 220ms exit animation runs.
    await expect(page.locator('.basemap-options .rn-moving-copy')).toHaveCount(1, { timeout: 100 });
    await expect(page.locator('.basemap-options .rn-moving-copy')).toHaveCount(0);
  }
});

for (const asset of ['sprite', 'glyphs'] as const) test(`a hung ${asset} request cannot poison recovery or fail a newer basemap`, async ({ page }) => {
  await installActivities(page); const state = await installBasemaps(page); state[asset] = true;
  let block = true, pending = 0, released = 0;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(asset === 'sprite' ? '**/test-sprite*' : '**/test-fonts/**', async route => {
    if (!block) return route.fallback();
    pending++; await held;
    await route.abort(); released++;
  });
  await page.clock.install(); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  await expect.poll(() => pending).toBeGreaterThan(0);
  await page.clock.fastForward(8100);
  await expect(page.getByRole('button', { name: '重试底图', exact: true })).toBeVisible();
  block = false; await page.getByRole('button', { name: '重试底图', exact: true }).click(); await basemapReady(page, 'positron');
  release(); await expect.poll(() => released).toBe(pending);
  await page.clock.fastForward(1000); await basemapReady(page, 'positron');
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) test(`pressing map overlay buttons retains the optical surface with spring feedback in ${colorScheme}`, async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width: colorScheme === 'dark' ? 390 : 1440, height: 1000 });
  await installActivities(page); await installBasemaps(page); await loginRunner(page);
  await page.goto(`/activities/${sampleActivity.id}`); await basemapReady(page, colorScheme === 'dark' ? 'dark' : 'positron');
  for (const name of ['切换底图', '关闭底图']) {
    const button = page.getByRole('button', { name, exact: true });
    const optical = button.locator('.rn-glass-layer');
    await expect.poll(() => optical.evaluate(el => el.style.backdropFilter)).toContain('url(');
    await button.scrollIntoViewIfNeeded();
    // Wait for initial atlas decode/settle before observing pressure, not page entry.
    await page.waitForTimeout(350);
    const original = await optical.evaluate(el => el.style.backdropFilter);
    const bounds = (await button.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    const frames = await button.evaluate(async el => {
      const values: { filter: string; surface: string; lens: string }[] = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(requestAnimationFrame);
        const layer = el.querySelector<HTMLElement>('.rn-glass-layer')!;
        values.push({ filter: layer.style.backdropFilter,
          surface: getComputedStyle(el.querySelector('.rn-glass-surface')!).transform,
          lens: layer.style.clipPath });
      }
      return values;
    });
    await testInfo.attach(`${name}-press-frames`, { body: JSON.stringify(frames), contentType: 'application/json' });
    await button.screenshot({ path: testInfo.outputPath(`${name}-pressed.png`) });
    // Drag off before release so neither the menu nor the basemap toggle fires.
    await page.mouse.move(bounds.x - 20, bounds.y - 20); await page.mouse.up();
    expect(new Set(frames.map(frame => frame.filter))).toEqual(new Set([original]));
    expect(new Set(frames.map(frame => frame.lens)).size).toBe(1);
    expect(frames.some(frame => frame.surface !== 'none' && frame.surface !== 'matrix(1, 0, 0, 1, 0, 0)')).toBe(true);
    await expect.poll(() => button.locator('.rn-glass-surface').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1, 3);
  }
});
