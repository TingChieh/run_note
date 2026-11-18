import { describe, expect, it } from 'vitest';
import {
  buildGraticuleLines,
  buildLandDots,
  buildOceanGrid,
  buildSubdividedLines,
  buildSubdividedPolygons,
  decodeChinaCitiesBounds,
  decodeChinaCitiesFeatures,
  fitBoundsGlobe3D,
  fitBoundsMercator2D,
  hexToRgb,
  lonLatToMercator2D,
  lonLatToSphere,
  MERCATOR_MAX_Y,
  MERCATOR_WORLD_WIDTH,
  mercator2DToLonLat,
  mergeGeoBounds,
  pointInGeoFeature,
  spherePointToLonLat,
  type ChinaCitiesData,
  type GeoFeature,
} from '../../src/lib/map/globe-geometry';

describe('globe geometry helpers', () => {
  it('round-trips geographic coordinates across sphere and Mercator 2D projections', () => {
    for (const [lon, lat] of [
      [118.78, 32.06],
      [-122.42, 37.77],
      [121.56, 25.03],
      [-0.12, 51.51],
      [139.69, 35.69],
    ] as const) {
      const [sx, sy, sz] = lonLatToSphere(lon, lat, 1);
      expect(Math.hypot(sx, sy, sz)).toBeCloseTo(1, 5);
      const [rlon, rlat] = spherePointToLonLat(sx, sy, sz);
      expect(rlon).toBeCloseTo(lon, 4);
      expect(rlat).toBeCloseTo(lat, 4);

      const [mx, my, mz] = lonLatToMercator2D(lon, lat, 0.02);
      expect(mz).toBe(0.02);
      const [mlon, mlat] = mercator2DToLonLat(mx, my);
      expect(mlon).toBeCloseTo(lon, 4);
      expect(mlat).toBeCloseTo(lat, 4);
    }
  });

  it('clamps extreme latitudes cleanly in Mercator 2D projection and converts hex colors', () => {
    for (const [lon, lat] of [
      [-180, -89.9],
      [0, 0],
      [180, 89.9],
      [121.5, 25.0],
    ] as const) {
      const [fx, fy, fz] = lonLatToMercator2D(lon, lat, 0.01);
      expect(Number.isFinite(fx)).toBe(true);
      expect(Number.isFinite(fy)).toBe(true);
      expect(fz).toBe(0.01);
    }

    const [fxMin] = lonLatToMercator2D(-180, 0, 0);
    const [fxMax, fyMax] = lonLatToMercator2D(180, 84.5, 0);
    expect(fxMax - fxMin).toBeCloseTo(MERCATOR_WORLD_WIDTH, 5);
    expect(fyMax).toBeCloseTo(MERCATOR_MAX_Y, 5);

    const [r, g, b] = hexToRgb('#17745c');
    expect(r).toBeCloseTo(0x17 / 255, 5);
    expect(g).toBeCloseTo(0x74 / 255, 5);
    expect(b).toBeCloseTo(0x5c / 255, 5);
  });

  it('subdivides polygons with vertex colors, flat ocean grid, and graticule lines', () => {
    const giantSquare: GeoFeature = {
      type: 'Feature',
      properties: { code: 'TEST' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [40, 0],
            [40, 40],
            [0, 40],
            [0, 0],
          ],
        ],
      },
    } as GeoFeature;

    const poly = buildSubdividedPolygons([giantSquare], 1.0, 0.0, 4.5, 4, () => [0.2, 0.6, 0.4]);
    expect(poly.sphere.length).toBeGreaterThan(2 * 9 * 16);
    expect(poly.colors?.length).toBe(poly.sphere.length);
    for (let i = 0; i < poly.sphere.length; i += 3) {
      expect(Math.hypot(poly.sphere[i], poly.sphere[i + 1], poly.sphere[i + 2])).toBeCloseTo(1.0, 5);
    }

    const lines = buildSubdividedLines([giantSquare], 1.002, 0.004, 4.5);
    expect(lines.sphere.length).toBeGreaterThan(0);

    const ocean = buildOceanGrid(0.996, -0.02);
    expect(ocean.sphere.length).toBeGreaterThan(0);
    expect(ocean.flat.length).toBe(ocean.sphere.length);
    // The globe's ocean reaches both poles, while the flat map stays inside the Mercator band.
    const ys = Array.from({ length: ocean.sphere.length / 3 }, (_, i) => ocean.sphere[i * 3 + 1]);
    expect(Math.max(...ys)).toBeCloseTo(0.996, 5);
    expect(Math.min(...ys)).toBeCloseTo(-0.996, 5);
    const flatYs = Array.from({ length: ocean.flat.length / 3 }, (_, i) => ocean.flat[i * 3 + 1]);
    expect(Math.max(...flatYs)).toBeLessThanOrEqual(MERCATOR_MAX_Y + 1e-6);

    const grat = buildGraticuleLines(0.998, -0.01);
    expect(grat.sphere.length).toBeGreaterThan(0);
  });

  it('decodes Chinese city bounds/polygons and computes adaptive Mercator viewports', () => {
    const raw: ChinaCitiesData = {
      scale: 100,
      regions: [
        {
          code: '310000',
          name: '上海市',
          bounds: [
            [121, 31],
            [122, 32],
          ],
          polygons: [[[12100, 3100, 100, 0, 0, 100, -100, 0, 0, -100]]],
        },
        {
          code: '320100',
          name: '南京市',
          bounds: [
            [118, 31],
            [119, 32],
          ],
          polygons: [[[11800, 3100, 100, 0, 0, 100, -100, 0, 0, -100]]],
        },
      ],
    };

    const boundsMap = decodeChinaCitiesBounds(raw);
    expect(boundsMap.get('310000')).toEqual([121, 31, 122, 32]);
    expect(boundsMap.get('320100')).toEqual([118, 31, 119, 32]);

    const merged = mergeGeoBounds([boundsMap.get('310000'), boundsMap.get('320100'), null]);
    expect(merged).toEqual([118, 31, 122, 32]);

    const wideView = fitBoundsMercator2D(merged!, 1.6, 36);
    const cityView = fitBoundsMercator2D(boundsMap.get('310000')!, 1.6, 36);
    expect(cityView.dist).toBeLessThan(wideView.dist);
    expect(cityView.dist).toBeGreaterThan(0.02);

    const wideGlobe = fitBoundsGlobe3D(merged!, 1.6, 32, 2.8);
    const cityGlobe = fitBoundsGlobe3D(boundsMap.get('310000')!, 1.6, 32, 1.05);
    expect(cityGlobe.dist).toBeLessThan(wideGlobe.dist);
    expect(cityGlobe.dist).toBeLessThan(1.25);
    expect(cityGlobe.dist).toBeGreaterThan(1.04);

    const features = decodeChinaCitiesFeatures(raw, new Set(['310000']));
    expect(features).toHaveLength(1);
    expect((features[0].properties as { code: string }).code).toBe('310000');
    expect(pointInGeoFeature(121.5, 31.5, features[0])).toBe(true);
    expect(pointInGeoFeature(118.5, 31.5, features[0])).toBe(false);
  });

  it('frames the same visible area at any field of view, clamps included', () => {
    const visible = (dist: number, fov: number) => dist * Math.tan((fov * Math.PI) / 360);
    // Ordinary, too small (minimum clamp) and too large (maximum clamp) extents.
    for (const bounds of [
      [103.6, 24.6, 121.9, 35.1],
      [121.4, 31.2, 121.41, 31.21],
      [-179, -80, 179, 80],
    ] as const) {
      const flatWide = fitBoundsMercator2D([...bounds], 2.2, 32, 0.01);
      const flatNarrow = fitBoundsMercator2D([...bounds], 2.2, 12, 0.01);
      expect(visible(flatNarrow.dist, 12)).toBeCloseTo(visible(flatWide.dist, 32), 6);
      const globeWide = fitBoundsGlobe3D([...bounds], 2.2, 32, 0.01);
      const globeNarrow = fitBoundsGlobe3D([...bounds], 2.2, 12, 0.01);
      expect(visible(globeNarrow.dist - 1, 12)).toBeCloseTo(visible(globeWide.dist - 1, 32), 6);
    }
  });

  it('scatters evenly spaced land dots only inside polygons and outside their holes', () => {
    const square: GeoFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.3, 0.3],
            [20.3, 0.3],
            [20.3, 20.3],
            [0.3, 20.3],
            [0.3, 0.3],
          ],
          [
            [8.3, 8.3],
            [12.3, 8.3],
            [12.3, 12.3],
            [8.3, 12.3],
            [8.3, 8.3],
          ],
        ],
      },
    };
    // Edges sit off the dot grid: a dot exactly on an edge is a tie either way.
    const dots = buildLandDots([square], 2, 1, 0);
    const count = dots.sphere.length / 3;
    expect(dots.flat).toHaveLength(dots.sphere.length);
    // About 20° x 20° at 2° spacing, minus the 4° x 4° hole.
    expect(count).toBeGreaterThan(80);
    expect(count).toBeLessThan(110);
    for (let i = 0; i < count; i++) {
      const [lon, lat] = spherePointToLonLat(dots.sphere[i * 3], dots.sphere[i * 3 + 1], dots.sphere[i * 3 + 2]);
      expect(pointInGeoFeature(lon, lat, square)).toBe(true);
      const [mlon, mlat] = mercator2DToLonLat(dots.flat[i * 3], dots.flat[i * 3 + 1]);
      expect(mlon).toBeCloseTo(lon, 4);
      expect(mlat).toBeCloseTo(lat, 4);
    }
    expect(buildLandDots([], 2, 1, 0).sphere).toHaveLength(0);
  });
});
