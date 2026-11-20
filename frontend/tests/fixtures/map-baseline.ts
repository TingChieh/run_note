import type { Page } from '@playwright/test';
import { installActivities, sampleActivity, incompleteActivity } from './activities';
import type { FootprintCollection } from '../../src/lib/api/footprints.ts';
import { encodeFootprints } from './footprint-encoding';

export async function installBaselineFootprints(page: Page) {
  const state = {
    multipleCities: false,
    heatCells: 1,
    status: 'ready' as 'ready' | 'pending' | 'failed',
    refreshing: false,
    refreshFailed: false,
    scenario: 'multi' as 'multi' | 'single' | 'point' | 'empty',
    failures: 0,
    expired: false,
    requests: [] as URL[],
  };
  await installActivities(page);
  await page.route('**/api/v1/showcase/footprints/all?**', (route) => {
    const url = new URL(route.request().url());
    state.requests.push(url);
    if (state.expired) return route.fulfill({ status: 401, json: { error: { message: '会话已过期' } } });
    if (state.failures-- > 0)
      return route.fulfill({ status: 503, json: { error: { message: '足迹暂不可用，请重试' } } });
    const mode = url.searchParams.get('mode'),
      empty = state.scenario === 'empty';
    if (state.status !== 'ready')
      return route.fulfill({
        json: { data: { status: state.status, generated_at: null, refreshing: false, result: null }, error: null },
      });
    const records =
      state.scenario === 'multi'
        ? [sampleActivity, { ...incompleteActivity, activity_date: '2024-01-02' }]
        : [sampleActivity];
    const routeCoordinates = [
      [121.48, 31.23],
      [121.485, 31.2335],
      [121.49, 31.237],
    ];
    const features: FootprintCollection['features'] = empty
      ? []
      : mode === 'heatmap'
        ? [
            {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [121.484, 31.233],
                    [121.485, 31.233],
                    [121.485, 31.234],
                    [121.484, 31.234],
                    [121.484, 31.233],
                  ],
                ],
              },
              properties: { i: 135236, j: 36621, count: 2 },
            },
          ]
        : records.map((record) => ({
            type: 'Feature',
            geometry:
              state.scenario === 'point'
                ? { type: 'Point', coordinates: [121.485, 31.235] }
                : {
                    type: 'LineString',
                    coordinates:
                      state.multipleCities && record.id !== sampleActivity.id
                        ? [
                            [116.397, 39.908],
                            [116.402, 39.913],
                          ]
                        : routeCoordinates,
                  },
            properties: {
              activity_id: record.id,
              title: record.title,
              activity_date: record.activity_date,
              segment_index: 0,
            },
          }));
    if (state.multipleCities && mode === 'heatmap')
      features.push({
        ...features[0],
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [116.397, 39.908],
              [116.398, 39.908],
              [116.398, 39.909],
              [116.397, 39.909],
              [116.397, 39.908],
            ],
          ],
        },
        properties: { i: 129574, j: 48500, count: 2 },
      } as (typeof features)[number]);
    const result = {
      scope: 'all',
      type: 'FeatureCollection',
      features:
        mode === 'heatmap'
          ? features.flatMap((feature) =>
              Array.from({ length: state.heatCells }, (_, index) => ({
                ...feature,
                properties: { ...feature.properties, i: 135236 + index },
              })),
            )
          : features,
      mode,
      activity_count: empty ? 0 : records.length,
      visible_activity_count: empty ? 0 : records.length,
      unsupported_segment_count: 0,
      grid_size_m: 100,
      grid_crs: 'EPSG:3857',
      count_basis: 'distinct_activity_per_cell',
      max_count: empty ? 0 : mode === 'heatmap' ? 2 : 0,
    };
    return route.fulfill({
      json: {
        data: {
          status: 'ready',
          generated_at: '2026-10-15T00:00:00Z',
          refreshing: state.refreshing,
          refresh_failed: state.refreshFailed,
          // The page asks for compact coordinates; answer the way the API does.
          result: url.searchParams.get('encoding') === 'delta' ? encodeFootprints(result) : result,
        },
        error: null,
      },
    });
  });
  return state;
}

export async function installBaselineMilestones(page: import('@playwright/test').Page) {
  const state = { provinceFailures: 0, streakFailures: 0, year: null as number | null };
  await installActivities(page);
  await page.clock.setFixedTime(new Date('2026-10-14T06:00:00Z'));
  await page.route('**/api/v1/showcase/statistics/summary**', (route) => {
    const from = new URL(route.request().url()).searchParams.get('date_from') ?? '';
    const to = new URL(route.request().url()).searchParams.get('date_to') ?? '';
    const futureIncluded = to > '2026-10-15';
    const current = from.startsWith('2026');
    const count = current ? 2 : 1,
      distance = current ? '10246.912' : '5000';
    return route.fulfill({
      json: {
        data: {
          activity_count: count,
          distance_m: futureIncluded ? '20246.912' : distance,
          duration_sum_seconds: 1800,
          known_duration_count: 1,
          missing_duration_count: count - 1,
          activity_days: count,
          pace_eligible_count: 1,
          pace_eligible_distance_m: '5123.456',
          avg_pace_seconds_per_km: '351.3',
          quality_warning_count: 1,
          date_assignment: 'activity_local_date',
        },
        error: null,
      },
    });
  });
  await page.route('**/api/v1/showcase/statistics/streaks', (route) =>
    state.streakFailures-- > 0
      ? route.fulfill({ status: 503, json: { error: { message: '连续记录读取失败' } } })
      : route.fulfill({
          json: {
            data: {
              today: '2026-10-14',
              current_days: 2,
              longest_days: 5,
              current_weeks: 2,
              longest_weeks: 7,
              week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${12 + i}`, active: i < 2 })),
            },
            error: null,
          },
        }),
  );
  await page.route('**/api/v1/showcase/footprints/global**', (route) => {
    const year = new URL(route.request().url()).searchParams.get('year');
    state.year = year === null ? null : Number(year);
    if (state.provinceFailures-- > 0)
      return route.fulfill({ status: 503, json: { error: { message: '全球足迹读取失败' } } });
    return route.fulfill({
      json: {
        data: {
          year: state.year,
          activity_count: 4,
          located_activity_count: 4,
          region_count: 3,
          city_count: 3,
          countries: [
            {
              code: 'CHN',
              name: '中国',
              activity_count: 3,
              distance_m: 28500,
              region_count: 2,
              city_count: 2,
              bounds: [120.0, 21.9, 122.0, 31.8],
              regions: [
                {
                  code: 'CN-310000',
                  name: '上海市',
                  short_name: '上海',
                  activity_count: 2,
                  distance_m: 18500,
                  bounds: [120.85, 30.68, 122.0, 31.87],
                  center: [121.47, 31.23],
                  cities: [
                    {
                      code: '310000',
                      name: '上海市',
                      short_name: '上海',
                      activity_count: 2,
                      distance_m: 18500,
                      lon: 121.47,
                      lat: 31.23,
                    },
                  ],
                },
                {
                  code: 'CN-710000',
                  name: '台湾省',
                  short_name: '台湾',
                  activity_count: 1,
                  distance_m: 10000,
                  bounds: [120.0, 21.9, 122.0, 25.3],
                  center: [121.0, 23.6],
                  cities: [
                    {
                      code: 'GN-1668341',
                      name: '台北',
                      short_name: '台北',
                      activity_count: 1,
                      distance_m: 10000,
                      lon: 121.56,
                      lat: 25.03,
                    },
                  ],
                },
              ],
            },
            {
              code: 'JPN',
              name: '日本',
              activity_count: 1,
              distance_m: 6200,
              region_count: 1,
              city_count: 1,
              bounds: [139.0, 35.4, 140.0, 35.9],
              regions: [
                {
                  code: 'JP-13',
                  name: '东京都',
                  short_name: '东京都',
                  activity_count: 1,
                  distance_m: 6200,
                  bounds: [139.0, 35.4, 140.0, 35.9],
                  center: [139.7, 35.69],
                  cities: [
                    {
                      code: 'GN-1850147',
                      name: '东京',
                      short_name: '东京',
                      activity_count: 1,
                      distance_m: 6200,
                      lon: 139.69,
                      lat: 35.69,
                    },
                  ],
                },
              ],
            },
          ],
          region_features: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  code: 'CN-310000',
                  name: '上海市',
                  short_name: '上海',
                  country_code: 'CHN',
                  activity_count: 2,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [121, 31],
                      [122, 31],
                      [122, 32],
                      [121, 32],
                      [121, 31],
                    ],
                  ],
                },
              },
              {
                type: 'Feature',
                properties: {
                  code: 'CN-710000',
                  name: '台湾省',
                  short_name: '台湾',
                  country_code: 'CHN',
                  activity_count: 1,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [120.5, 22],
                      [121.9, 22],
                      [121.9, 25.2],
                      [120.5, 25.2],
                      [120.5, 22],
                    ],
                  ],
                },
              },
              {
                type: 'Feature',
                properties: {
                  code: 'JP-13',
                  name: '东京都',
                  short_name: '东京都',
                  country_code: 'JPN',
                  activity_count: 1,
                },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [139.1, 35.5],
                      [139.9, 35.5],
                      [139.9, 35.9],
                      [139.1, 35.9],
                      [139.1, 35.5],
                    ],
                  ],
                },
              },
            ],
          },
        },
        error: null,
      },
    });
  });
  return state;
}
