import { describe, expect, it } from 'vitest';
import { createRouteMapStyle, resolveBasemap, parseBasemapPreference, prepareBasemapStyle } from '../../src/lib/api/map-style';

describe('map external resource boundary', () => {
  it('starts locally without waiting for external styles, sprites or glyphs', () => {
    const style = createRouteMapStyle();
    expect(style.sources).toEqual({});
    expect(style.sprite).toBeUndefined();
    expect(style.glyphs).toBeUndefined();
    expect(style.layers).toEqual([expect.objectContaining({ type: 'background' })]);
  });
  it('follows the effective theme only in automatic mode', () => {
    expect(resolveBasemap('auto', false)).toBe('positron');
    expect(resolveBasemap('auto', true)).toBe('dark');
    expect(resolveBasemap('liberty', true)).toBe('liberty');
    expect(resolveBasemap('dark', false)).toBe('dark');
  });
  it('ignores invalid stored values', () => {
    for (const value of [null, '', 'osm', '{"style":"dark"}']) expect(parseBasemapPreference(value)).toBe('auto');
    expect(parseBasemapPreference('positron')).toBe('positron');
    expect(parseBasemapPreference('dark')).toBe('dark');
    expect(parseBasemapPreference('liberty')).toBe('liberty');
  });
  it('namespaces all external IDs and references without changing local source layers', () => {
    const original = { version: 8 as const, sources: { route: { type: 'vector' as const, url: 'https://tiles.openfreemap.org/planet' } },
      layers: [{ id: 'route-lines', type: 'line' as const, source: 'route', 'source-layer': 'transportation' }] };
    const style = prepareBasemapStyle(original, 'basemap-2-');
    expect(Object.keys(style.sources)).toEqual(['basemap-2-route']);
    expect(style.layers[0]).toMatchObject({ id: 'basemap-2-route-lines', source: 'basemap-2-route', 'source-layer': 'transportation' });
    expect(original.layers[0].source).toBe('route');
    expect(original.layers[0].id).toBe('route-lines');
  });
  it('rejects malformed styles before mutating the map', () => {
    for (const value of [null, {}, { version: 7, sources: {}, layers: [] }, { version: 8, sources: {}, layers: [{ id: 'bad', type: 'line', source: 'missing' }] }]) {
      expect(() => prepareBasemapStyle(value, 'basemap-1-')).toThrow();
    }
  });
});
