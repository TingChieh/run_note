import { expect, test, type Locator, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';
import { installAI, installPublic, summary } from '../fixtures/p2';

async function appearance(locator: Locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el);
    // Let the browser decode rgb(), color(srgb ...) and colour-mix results.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const parse = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (color: number[], background: number[]) => color.slice(0, 3).map((channel, i) => channel * color[3] / 255 + background[i] * (1 - color[3] / 255));
    const layers: number[][] = [];
    for (let node: Element | null = el; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
    const backgroundRGB = layers.reverse().reduce((background, color) => over(color, background), [255, 255, 255]);
    const luminance = (color: number[]) => {
      const rgb = color.map(n => {
        const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const background = luminance(backgroundRGB), foreground = luminance(over(parse(style.color), backgroundRGB));
    return { background, contrast: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) };
  });
}
async function dark(page: Page) {
  await expect.poll(async () => (await appearance(page.locator('.sport-theme'))).background).toBeLessThan(.06);
  expect((await appearance(page.locator('.sport-theme'))).contrast).toBeGreaterThanOrEqual(4.5);
}
async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function mapCorner(page: Page, map: Locator) {
  const png = await map.screenshot();
  return page.evaluate(async png => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    // Stay inside the rounded clipping edge and below the overlaid tile toggle.
    const p = context.getImageData(40, 80, 1, 1).data; return (p[0] + p[1] + p[2]) / 3;
  }, png.toString('base64'));
}
async function installNeutralTiles(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ffffff'; context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/*tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
}
async function dimmedTiles(page: Page, map: Locator) {
  await expect.poll(async () => {
    const brightness = await mapCorner(page, map);
    return brightness > 70 && brightness < 150;
  }).toBe(true);
}

test('manual theme switches override the system, persist, and can return to automatic', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill('draft@example.com');
  await page.getByRole('button', { name: '切换到深色模式', exact: true }).click({ timeout: 5000 });
  await dark(page);
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('draft@example.com');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
  await expect.poll(async () => (await appearance(page.locator('.sport-theme'))).background).toBeGreaterThan(.8);
  await page.reload();
  await expect.poll(async () => (await appearance(page.locator('.sport-theme'))).background).toBeGreaterThan(.8);
  await page.getByRole('button', { name: '跟随系统外观', exact: true }).click();
  await dark(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await appearance(page.locator('.sport-theme'))).background).toBeGreaterThan(.8);
  await loginRunner(page); await page.goto('/dashboard');
  const toggle = page.locator('.app-sidebar .theme-toggle');
  await expect(toggle).toHaveText('日间模式');
  await expect(toggle).toHaveAttribute('title', '当前为日间模式，点击切换到夜间模式');
  await toggle.click(); await dark(page);
  await expect(toggle).toHaveText('夜间模式');
  await expect(toggle).toHaveAttribute('title', '当前为夜间模式，点击切换到日间模式');
  await toggle.click();
  await expect(toggle).toHaveText('日间模式');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height:900});
    await expect(page.getByRole('button', { name: '切换到深色模式', exact: true })).toBeVisible();
    await fits(page);
  }
});

test('device theme applies to the first page and switches live without losing a form draft', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/login'); await dark(page);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
  expect((await appearance(page.locator('.auth-card'))).background).toBeLessThan(.1);
  expect((await appearance(page.locator('.auth-card'))).contrast).toBeGreaterThanOrEqual(4.5);
  await page.getByLabel('邮箱', { exact: true }).fill('draft@example.com');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await appearance(page.locator('.sport-theme'))).background).toBeGreaterThan(.8);
  await page.emulateMedia({ colorScheme: 'dark' }); await dark(page);
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('draft@example.com');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await fits(page);
    await page.screenshot({ path: `test-results/theme-login-${width}.png` });
  }
});

test('private and public pages have readable surfaces, warnings and keyboard focus in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await installActivities(page); await installAI(page); await installPublic(page); await loginRunner(page);
  for (const path of ['/dashboard?year=2026', '/activities', '/settings', '/ai', '/u/runner', `/public/activities/${sampleActivity.id}`, '/shared/synthetic-token']) {
    await page.goto(path); await dark(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('header[data-auth-ready="true"]')).toHaveCount(1);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const card = page.locator('.aux-panel, .goal-card, .activity-card, .share-card').first();
    if (await card.count()) { expect((await appearance(card)).background).toBeLessThan(.1); expect((await appearance(card)).contrast).toBeGreaterThanOrEqual(4.5); }
    for (const button of await page.locator('button.bg-primary').all()) {
      expect((await appearance(button)).contrast, `Primary button contrast on ${path}`).toBeGreaterThanOrEqual(4.5);
    }
    if (path === '/ai') expect((await appearance(page.getByText(/^AI训练建议/))).contrast).toBeGreaterThanOrEqual(4.5);
    for (const width of [320, 390, 1440]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
    await page.screenshot({ path: `test-results/theme-${path.split(/[/?]/)[1]}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: `test-results/theme-${path.split(/[/?]/)[1]}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.goto('/dashboard?year=2026');
  const nav = page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '数据汇总', exact: true });
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await nav.focus(); expect(await nav.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect((await appearance(nav)).contrast).toBeGreaterThanOrEqual(4.5);
  const skip = page.getByRole('link', { name: '跳转到主要内容' });
  await skip.focus(); expect((await appearance(skip)).contrast).toBeGreaterThanOrEqual(4.5);
});

test('trend axes redraw for the device theme and preserve the selected metric', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route('**/api/v1/statistics/trends?**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { data: { period: url.searchParams.get('period'), date_from: '2026-01-01', date_to: '2027-01-01', week_start: 'monday', date_assignment: 'activity_local_date', buckets: [{ ...summary, bucket_start: '2026-01-01', bucket_end: '2027-01-01', is_partial: true }] }, error: null } });
  });
  await loginRunner(page); await page.goto('/dashboard?year=2026'); await dark(page);
  const canvas = page.locator('canvas'); await expect(canvas).toBeVisible();
  await page.getByLabel('趋势指标').selectOption('pace');
  await expect(page.getByLabel('趋势指标')).toHaveValue('pace');
  // Axis labels in the bottom margin must actually render with light ink.
  const lightAxisPixels = () => canvas.evaluate(el => {
    const canvas = el as HTMLCanvasElement, context = canvas.getContext('2d')!;
    const pixels = context.getImageData(0, Math.round(canvas.height * .83), canvas.width, Math.floor(canvas.height * .17)).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 150 && pixels[i] > 140 && pixels[i + 1] > 140 && pixels[i + 2] > 140) count++;
    return count;
  });
  await expect.poll(lightAxisPixels).toBeGreaterThan(10);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(lightAxisPixels).toBeLessThan(10);
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(lightAxisPixels).toBeGreaterThan(10);
  await expect(page.getByLabel('趋势指标')).toHaveValue('pace');
  await canvas.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/theme-trend-dark.png' });
});

test('route map updates its fallback background without replacing the canvas or view', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await installActivities(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible(); await dark(page);
  const map = page.locator('.maplibregl-canvas'); const original = await map.elementHandle();
  await expect(page.getByRole('status').filter({ hasText: '底图暂不可用' })).toBeVisible();
  // WebGL discards its drawing buffer after presenting. Sample the displayed
  // screenshot instead of reading the cleared offscreen buffer.
  const background = () => mapCorner(page, map);
  await expect.poll(background).toBeLessThan(60);
  const start = page.getByLabel('路线起点'), before = await start.boundingBox();
  await page.emulateMedia({ colorScheme: 'light' }); await expect.poll(background).toBeGreaterThan(200);
  await page.getByRole('button', { name: '切换到深色模式', exact: true }).click(); await expect.poll(background).toBeLessThan(60);
  expect(await original!.evaluate(el => el === document.querySelector('.maplibregl-canvas'))).toBe(true);
  const after = await start.boundingBox(); expect(after!.x).toBeCloseTo(before!.x, 1); expect(after!.y).toBeCloseTo(before!.y, 1);
  await expect(page.getByRole('button', { name: '关闭底图', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/theme-detail-dark.png' });
});

test('loaded raster tiles dim with the theme and the basemap toggle stays off across changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await installActivities(page); await installNeutralTiles(page); await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await expect(page.getByTestId('route-map-ready')).toBeVisible();
  const map = page.locator('.maplibregl-canvas');
  await dimmedTiles(page, map);
  await page.emulateMedia({ colorScheme: 'light' }); await expect.poll(() => mapCorner(page, map)).toBeGreaterThan(230);
  await page.getByRole('button', { name: '关闭底图', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(() => mapCorner(page, map)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: '开启底图', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '开启底图', exact: true }).click();
  await dimmedTiles(page, map);
});

test('all-record footprint map preserves selection while adapting to theme changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await installActivities(page); await installNeutralTiles(page);
  await page.route('**/api/v1/footprints/all?**', route => {
    const url = new URL(route.request().url()), mode = url.searchParams.get('mode');
    const geometry = mode === 'heatmap' ? { type: 'Polygon', coordinates: [[[121.484, 31.233], [121.485, 31.233], [121.485, 31.234], [121.484, 31.234], [121.484, 31.233]]] } : { type: 'LineString', coordinates: [[121.48, 31.23], [121.485, 31.2335], [121.49, 31.237]] };
    return route.fulfill({ json: { data: {status:'ready',generated_at:'2026-10-15T00:00:00Z',refreshing:false,result:{scope:'all', type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { activity_id: sampleActivity.id, title: sampleActivity.title, activity_date: sampleActivity.activity_date, segment_index: 0, i: 135236, j: 36621, count: 2 } }], mode, activity_count: 1, visible_activity_count: 1, unsupported_segment_count: 0, grid_size_m: 100, grid_crs: 'EPSG:3857', count_basis: 'distinct_activity_per_cell', max_count: mode === 'heatmap' ? 2 : 0 }}, error: null } });
  });
  await loginRunner(page); await page.goto('/footprints?filter=range&from=2026-10-01&to=2026-10-15');
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible(); await dark(page);
  const map = page.locator('.maplibregl-canvas'), original = await map.elementHandle();
  await page.getByText('全部可显示记录', { exact: false }).click();
  await page.getByRole('button', { name: '定位 河畔晨跑', exact: true }).click();
  await dimmedTiles(page, map);
  await page.emulateMedia({ colorScheme: 'light' }); await expect.poll(() => mapCorner(page, map)).toBeGreaterThan(230);
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(() => mapCorner(page, map)).toBeLessThan(150);
  expect(await original!.evaluate(el => el === document.querySelector('.maplibregl-canvas'))).toBe(true);
  await expect(page.getByRole('button', { name: '定位 河畔晨跑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/footprints\?mode=tracks$/);
  await page.getByRole('button', { name: '运动热力图', exact: true }).click();
  await expect(page.getByTestId('footprint-map-ready')).toBeVisible();
  await expect(page.getByTestId('heat-legend')).toContainText('2–3 次');
  await page.screenshot({ path: 'test-results/theme-footprints-desktop.png' });
  for (const width of [320, 390]) { await page.setViewportSize({ width, height: 900 }); await fits(page); }
  await page.screenshot({ path: 'test-results/theme-footprints-mobile.png' });
});
