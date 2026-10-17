import { afterEach, expect, it, vi } from 'vitest';
import type { Map as LibreMap } from 'maplibre-gl';

vi.mock('../../src/lib/components/system-theme.ts', () => ({ watchSystemTheme: (fn: (dark: boolean) => void) => { fn(false); return () => {}; } }));
vi.mock('../../src/lib/api/map-style.ts', async importOriginal => ({
  ...await importOriginal<object>(), applyMapTheme: vi.fn(), savedBasemapPreference: () => 'auto',
  watchBasemapPreference: () => () => {}
}));
import { createBasemapController } from '../../src/lib/map/basemap-controller.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['timeout', 'off'])('recovers from %s without reusing failed assets or accepting expired sprite errors', async mode => {
  vi.useFakeTimers();
  const callbacks: ((error?: Error) => void)[] = [];
  const listeners = new Map<string, (...args: any[]) => void>();
  const sources = new Map(), layers = new Map();
  let glyphs: string | undefined;
  const setGlyphs = vi.fn((url: string) => { glyphs = url; });
  const map = {
    on: (name: string, fn: (...args: any[]) => void) => listeners.set(name, fn), off: vi.fn(),
    getLayer: (id: string) => layers.get(id), removeLayer: (id: string) => layers.delete(id),
    getSource: (id: string) => sources.get(id), removeSource: (id: string) => sources.delete(id),
    getGlyphs: () => glyphs, setGlyphs, getSprite: () => [],
    style: { setSprite: (_url: string, _options: object, done: (error?: Error) => void) => callbacks.push(done) },
    setSprite: (_url: string) => callbacks.push(() => {}),
    addSource: (id: string, source: unknown) => sources.set(id, source),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    isStyleLoaded: () => true, isSourceLoaded: () => true
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: 8,
    glyphs: 'https://example.test/{fontstack}/{range}.pbf', sprite: 'https://example.test/sprite',
    sources: { tiles: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}'] } },
    layers: [{ id: 'land', type: 'fill', source: 'tiles', 'source-layer': 'land' }] }) })));
  const states: string[] = [];
  const controller = createBasemapController(map as unknown as LibreMap, 'route-lines', state => states.push(state.status));
  await vi.advanceTimersByTimeAsync(0); expect(callbacks).toHaveLength(1);
  if (mode === 'off') {
    controller.toggle(); callbacks[0](new Error('offline while disabled'));
    await vi.advanceTimersByTimeAsync(0); expect(states.at(-1)).toBe('off');
    controller.toggle();
  } else {
    await vi.advanceTimersByTimeAsync(8100); expect(states.at(-1)).toBe('failed');
    controller.retry();
  }
  await vi.advanceTimersByTimeAsync(0); expect(callbacks).toHaveLength(2);
  callbacks[1](); await vi.advanceTimersByTimeAsync(0); expect(states.at(-1)).toBe('ready');
  const installed = [...layers.keys()];
  listeners.get('error')!({ error: new Error('expired sprite') }); callbacks[0](new Error('expired sprite'));
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe('ready'); expect([...layers.keys()]).toEqual(installed);
  expect(setGlyphs).toHaveBeenCalledTimes(2);
  controller.destroy(); expect(sources.size).toBe(0); expect(layers.size).toBe(0);
});
