import { expect, type Page } from '@playwright/test';

// Minimal synthetic MVT: one full-tile land polygon, no real locations or user data.
function varint(value: number): number[] { const out: number[] = []; do { const n = value & 127; value >>>= 7; out.push(n | (value ? 128 : 0)); } while (value); return out; }
function bytes(field: number, value: number[]): number[] { return [...varint(field * 8 + 2), ...varint(value.length), ...value]; }
const geometry = [9, 0, 0, 26, 8192, 0, 0, 8192, 8191, 0, 15].flatMap(varint);
const feature = [24, 3, ...bytes(4, geometry)];
const layer = [...bytes(1, [...Buffer.from('land')]), ...bytes(2, feature), 40, ...varint(4096), 120, 2];
const tile = Buffer.from(bytes(3, layer));
export async function installBasemaps(page: Page) {
  const state = { fail: false, sprite: false, glyphs: false, failSprite: false, delay: 0, requests: [] as string[], styles: [] as string[] };
  await page.route('https://tiles.openfreemap.org/**', async route => {
    const url = new URL(route.request().url()); state.requests.push(url.pathname);
    if (state.fail) return route.abort();
    if (url.pathname.startsWith('/styles/')) {
      const name = url.pathname.split('/').at(-1)!; state.styles.push(name);
      const delay = state.delay; if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill({ json: { version: 8, ...(state.sprite ? { sprite: 'https://tiles.openfreemap.org/test-sprite' } : {}), ...(state.glyphs ? { glyphs: 'https://tiles.openfreemap.org/test-fonts/{fontstack}/{range}.pbf' } : {}), sources: { openmaptiles: { type: 'vector', tiles: ['https://tiles.openfreemap.org/synthetic/{z}/{x}/{y}.pbf'], attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap' } }, layers: [
        { id: 'background', type: 'background', paint: { 'background-color': name === 'dark' ? '#444444' : '#ffffff' } },
        { id: 'land', source: 'openmaptiles', 'source-layer': 'land', type: 'fill', paint: { 'fill-color': name === 'dark' ? '#666666' : name === 'liberty' ? '#f6e7c1' : '#ffffff' } },
        ...(state.glyphs ? [{ id: 'label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'land', layout: { 'text-field': 'A', 'text-font': ['Test'] } }] : [])
      ] } });
    }
    if (url.pathname.startsWith('/test-sprite')) {
      if (state.failSprite) return route.abort();
      if (url.pathname.endsWith('.json')) return route.fulfill({ json: {} });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64') });
    }
    if (url.pathname.startsWith('/synthetic/')) return route.fulfill({ body: tile, contentType: 'application/x-protobuf' });
    if (url.pathname.startsWith('/test-fonts/')) return route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
    return route.abort();
  });
  return state;
}

// Observe real MapLibre instances only in tests, without production debug hooks.
export async function observeMaps(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/maplibre-gl.js'))!;
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const root = window as typeof window & { __maps: import('maplibre-gl').Map[] };
    root.__maps = [];
    const original = lib.default.Map.prototype.fire;
    lib.default.Map.prototype.fire = function (...args: unknown[]) {
      if (!root.__maps.includes(this)) root.__maps.push(this);
      return original.apply(this, args);
    };
    window.dispatchEvent(new Event('resize'));
  });
  await page.locator('.maplibregl-canvas').focus(); await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => (window as any).__maps.length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__maps.at(-1).isMoving())).toBe(false);
}

export async function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as typeof window & { __maps: import('maplibre-gl').Map[] }).__maps.at(-1)!;
    const style = map.getStyle();
    return { camera: [map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()],
      layers: style.layers.map(layer => layer.id), sources: Object.keys(style.sources),
      local: style.sources.route ?? style.sources.footprints,
      selection: map.getLayer('footprint-lines') ? map.getPaintProperty('footprint-lines', 'line-width') : null };
  });
}
export async function chooseBasemap(page: Page, name: string) {
  await page.getByRole('button', { name: '切换底图', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
export async function basemapReady(page: Page, style: string) {
  await expect(page.locator('[data-basemap-status="ready"]')).toHaveAttribute('data-basemap-style', style);
}
