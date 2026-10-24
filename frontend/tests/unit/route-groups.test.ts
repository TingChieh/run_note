import { describe, expect, it } from 'vitest';
import { parseRouteGroupDetail, parseRouteGroupList, readRouteGroups, shapeRoute, RouteGroupError } from '../../src/lib/api/route-groups.ts';

const id = '11111111-1111-4111-8111-111111111111';
const item = { id, run_count: 3, first_date: '2025-01-01', last_date: '2025-02-01', median_distance_m: '5000.000', best_duration_seconds: '1500.000', avg_duration_seconds: '1560.5', best_pace_seconds_per_km: '300.000', avg_pace_seconds_per_km: '312.1', shape: [[[121.47, 31.23], [121.48, 31.24], [121.47, 31.23]]] };
const list = { items: [item], total: 1, limit: 20, offset: 0, building: false };
const run = { activity_id: id, title: '晨跑', activity_date: '2025-02-01', distance_m: '5000.000', duration_seconds: '1500.000', avg_pace_seconds_per_km: '300.000', coverage: 0.93 };

describe('route group parsing', () => {
  it('accepts a valid list and detail', () => {
    expect(parseRouteGroupList(list).items[0].run_count).toBe(3);
    expect(parseRouteGroupDetail({ ...item, runs: [run] }).runs[0].coverage).toBe(0.93);
  });
  it('rejects malformed fields', () => {
    for (const bad of [
      { ...list, items: [{ ...item, run_count: 1 }] },
      { ...list, items: [{ ...item, id: 'nope' }] },
      { ...list, items: [{ ...item, first_date: '2025-13-40' }] },
      { ...list, items: [{ ...item, shape: [[[200, 31]]] }] },
      { ...list, items: [{ ...item, median_distance_m: 'abc' }] },
      { ...list, building: 'no' },
      { ...list, total: -1 },
      null,
    ]) expect(() => parseRouteGroupList(bad)).toThrow(RouteGroupError);
    expect(() => parseRouteGroupDetail({ ...item, runs: [{ ...run, coverage: 2 }] })).toThrow(RouteGroupError);
  });
  it('keeps only whitelisted fields', () => {
    const parsed = parseRouteGroupList({ ...list, items: [{ ...item, email: 'x@example.com' }] });
    expect('email' in parsed.items[0]).toBe(false);
  });
});

describe('route group requests', () => {
  it('reads through the showcase path and maps 401 to an expired login', async () => {
    const urls: string[] = [];
    const ok = (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response(JSON.stringify({ data: list, error: null })); }) as typeof fetch;
    await readRouteGroups('recent', 10, 20, new AbortController().signal, ok);
    expect(urls[0]).toBe('/api/v1/showcase/routes/groups?sort=recent&limit=10&offset=20');
    const denied = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    await expect(readRouteGroups('count', 20, 0, new AbortController().signal, denied)).rejects.toMatchObject({ status: 401, message: '登录已过期' });
  });
});

describe('shapeRoute', () => {
  it('builds a route whose endpoints are the first and last coordinates', () => {
    const route = shapeRoute(item.shape as [number, number][][]);
    expect(route.features).toHaveLength(1);
    expect(route.start).toEqual([121.47, 31.23]);
    expect(route.end).toEqual([121.47, 31.23]);
  });
});
