import { describe, expect, test } from 'vitest';
import { parseCells, parseDetail, parseMarkers, type ExplorationMarker } from '../../src/lib/api/exploration.ts';
import {
  cellsToFeatures,
  computeFraming,
  placeLabels,
  visitedRegionCodes,
  zoomTier,
} from '../../src/lib/map/exploration-layers.ts';

const version = { source_version: 0, atlas_version: 'test', status: 'ready' } as const;

const sampleMarkers: ExplorationMarker[] = [
  {
    code: '310000',
    name: '青岬市',
    short_name: '青岬',
    region_code: 'CN-01',
    region_name: '岚海州',
    country_code: 'CHN',
    kind: 'boundary',
    lon: 121.47,
    lat: 31.23,
    bounds: [121.0, 30.8, 121.9, 31.6],
    activity_count: 42,
    distance_m: 182400,
    first_date: '2024-05-12',
    last_date: '2026-06-04',
    is_new_in_year: false,
  },
  {
    code: '320500',
    name: '松溪市',
    short_name: '松溪',
    region_code: 'CN-01',
    region_name: '岚海州',
    country_code: 'CHN',
    kind: 'boundary',
    lon: 120.6,
    lat: 31.3,
    bounds: [120.2, 31.0, 121.0, 31.6],
    activity_count: 18,
    distance_m: 96000,
    first_date: '2026-02-01',
    last_date: '2026-06-01',
    is_new_in_year: true,
  },
  {
    code: 'nearby',
    name: '杉港市',
    short_name: '杉港',
    region_code: 'CN-02',
    region_name: '北原省',
    country_code: 'CHN',
    kind: 'nearby',
    lon: 116.4,
    lat: 39.9,
    bounds: null,
    activity_count: 5,
    distance_m: null,
    first_date: '2025-04-01',
    last_date: '2025-05-01',
    is_new_in_year: false,
  },
];

describe('exploration response validation', () => {
  test('validates grid extent, counts and response cap', () => {
    const valid = { ...version, bounds: [10, 11, 12, 13], cells: [[1, -2, 3]], block_size: 4 };
    expect(parseCells(valid).cells).toEqual([[1, -2, 3]]);
    expect(() => parseCells({ ...valid, cells: [[1, -2, 0]] })).toThrow();
    expect(() => parseCells({ ...valid, cells: Array(5001).fill([1, -2, 3]) })).toThrow();
    expect(() => parseCells({ ...valid, bounds: [10, 11, -12, 13] })).toThrow();
  });

  test('requires all twelve chronological months, even while history is pending', () => {
    const pending = {
      ...version,
      status: 'pending',
      scope: 'global',
      code: 'all',
      year: 2026,
      name: '全域',
      city: null,
      first_year: null,
      new_cells: null,
      cumulative_cells: null,
      months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, new_cells: null, cumulative_cells: null })),
    };
    expect(parseDetail(pending).status).toBe('pending');
    expect(() => parseDetail({ ...pending, months: pending.months.slice(1) })).toThrow();
    expect(() => parseDetail({ ...pending, months: [...pending.months].reverse() })).toThrow();
  });

  test('validates markers payload for boundary and nearby places', () => {
    const valid = {
      ...version,
      year: null,
      items: sampleMarkers,
      regions: [{ code: 'CN-01', name: '岚海州' }],
      activity_count: 65,
      boundary_count: 2,
      nearby_count: 1,
    };
    expect(parseMarkers(valid).items).toHaveLength(3);
    expect(() => parseMarkers({ ...valid, items: [{ ...sampleMarkers[0], lon: 200 }] })).toThrow();
    expect(() => parseMarkers({ ...valid, items: [{ ...sampleMarkers[2], distance_m: 100 }] })).toThrow();
  });
});

describe('exploration map layers', () => {
  test('classifies zoom tiers cleanly', () => {
    expect(zoomTier(3.8)).toBe('country');
    expect(zoomTier(6.5)).toBe('region');
    expect(zoomTier(10.5)).toBe('city');
  });

  test('frames China-only vs overseas + China visits', () => {
    const chinaOnly = computeFraming(sampleMarkers);
    expect(chinaOnly.hasChina).toBe(true);
    expect(chinaOnly.hasOverseas).toBe(false);
    expect(chinaOnly.initialBounds).toEqual(chinaOnly.chinaBounds);

    const overseas = computeFraming([
      ...sampleMarkers,
      {
        ...sampleMarkers[2],
        code: 'GN-1850147',
        name: '东京',
        short_name: '东京',
        region_code: 'JP-13',
        country_code: 'JPN',
        lon: 139.7,
        lat: 35.68,
      },
    ]);
    expect(overseas.hasChina).toBe(true);
    expect(overseas.hasOverseas).toBe(true);
    expect(overseas.initialBounds).toEqual(overseas.allBounds);
  });

  test('builds both polygon cells and centroid points for coarse zoom fallback', () => {
    const { polygons, centroids } = cellsToFeatures({
      ...version,
      bounds: [121, 31, 122, 32],
      block_size: 16,
      cells: [[8450, 2320, 4]],
    });
    expect(polygons.features).toHaveLength(1);
    expect(centroids.features).toHaveLength(1);
    expect(centroids.features[0].geometry.type).toBe('Point');
  });

  test('culls colliding labels while preserving cluster badges and new-year priority', () => {
    const placed = placeLabels(
      sampleMarkers,
      [{ id: 1, lon: 121.0, lat: 31.25, count: 2, hasNew: true }],
      ([lon, lat]) => ({ x: 400 + (lon - 115) * 20, y: 300 - (lat - 30) * 20 }),
      800,
      500,
      4.5,
      'new',
    );
    expect(placed.some((item) => item.kind === 'cluster' && item.text === '2城' && item.accent)).toBe(true);
    expect(placed.some((item) => item.id === 'city-nearby')).toBe(true);
    expect(visitedRegionCodes(sampleMarkers, 'new')).toEqual(['CN-01']);
    expect(visitedRegionCodes(sampleMarkers, 'heatmap')).toEqual(['CN-01', 'CN-02']);
  });
});
