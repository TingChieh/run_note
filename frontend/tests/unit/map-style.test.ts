import { describe, expect, it } from 'vitest';
import { createBasemapSource, createRouteMapStyle, isBasemapError } from '../../src/lib/api/map-style';

describe('route map external tile boundary', () => {
  it('initializes a local background without external requests so route readiness is independent of tiles', () => {
    const style = createRouteMapStyle();
    expect(style.sources).toEqual({});
    expect(style.layers).toEqual([expect.objectContaining({ type: 'background' })]);
  });

  it('requests standard HTTPS OSM raster tiles with visible copyright attribution', () => {
    const source = createBasemapSource();
    expect(source).toMatchObject({ type: 'raster', tileSize: 256, maxzoom: 19 });
    expect(source.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
    expect(source.attribution).toContain('© OpenStreetMap contributors');
    expect(source.attribution).toContain('https://www.openstreetmap.org/copyright');
  });

  it('degrades only errors belonging to the basemap source', () => {
    expect(isBasemapError({ sourceId: 'osm-basemap', error: new Error('network') })).toBe(true);
    expect(isBasemapError({ sourceId: 'route', error: new Error('route') })).toBe(false);
    expect(isBasemapError({ error: new Error('WebGL') })).toBe(false);
    expect(isBasemapError(null)).toBe(false);
  });
});
