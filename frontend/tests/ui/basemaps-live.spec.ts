import { expect, test } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities';
import { basemapReady, chooseBasemap, observeMaps, mapState } from '../fixtures/basemaps';

test('real OpenFreeMap styles, glyphs, sprite and viewport vector tiles render in Chrome', async ({ page }) => {
  await installActivities(page); await page.unroute('https://tiles.openfreemap.org/**');
  const external: { path: string; status: number }[] = [];
  page.on('response', response => { const url = new URL(response.url()); if (url.hostname === 'tiles.openfreemap.org') external.push({ path: url.pathname, status: response.status() }); });
  await loginRunner(page); await page.goto(`/activities/${sampleActivity.id}`);
  await basemapReady(page, 'positron'); await observeMaps(page); const before = await mapState(page);
  for (const name of ['Positron', 'Dark', 'Liberty']) {
    if (name !== 'Positron') await chooseBasemap(page, name);
    await basemapReady(page, name.toLowerCase());
    await expect.poll(() => page.evaluate(() => {
      const map = (window as any).__maps.at(-1);
      return map.queryRenderedFeatures().filter((feature: any) => feature.source?.startsWith('basemap-')).length;
    })).toBeGreaterThan(0);
    expect((await mapState(page)).camera).toEqual(before.camera);
    await page.locator('.route-map').screenshot({ path: `test-results/openfreemap-${name.toLowerCase()}.png` });
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenMapTiles');
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenFreeMap');
  }
  expect(external.some(item => item.path.includes('/planet/') && item.status === 200)).toBe(true);
  expect(external.some(item => item.path.includes('/fonts/') && item.status === 200)).toBe(true);
  expect(external.some(item => item.path.includes('/sprites/') && item.status === 200)).toBe(true);
});
