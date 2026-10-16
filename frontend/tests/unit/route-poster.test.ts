import { describe, expect, it } from 'vitest';
import { loadPoster, posterMonthRange, posterStats } from '../../src/lib/share/route-poster-data.ts';
const activity = (i: number, hasRoute = true) => ({
  id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, title: '不可导出的标题',
  activity_date: '2024-02-29', timezone: 'UTC', started_at: null, ended_at: null,
  distance_m: 1000, elapsed_seconds: null, avg_pace_seconds_per_km: null,
  temporal_quality: 'incomplete', has_route: hasRoute, metrics_version: 'test',
  created_at: '2024-03-01T00:00:00Z', notes: 'private',
});
const route = { type: 'FeatureCollection', start: [10, 20], end: [11, 21], features: [
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] }, properties: { segment_index: 0, point_count: 2 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [10.5, 20.5] }, properties: { segment_index: 1, point_count: 1 } },
] };
function fixture(total = 121) {
  const state = { urls: [] as string[], count: total, routes: 0, active: 0, peak: 0, fail: false,
    cancel: false, drift: false, duplicate: false, summaries: 0, wrongMonth: false, noRoutes: false };
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input), 'http://localhost'); state.urls.push(url.pathname + url.search);
    const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: status >= 400 ? { message: '路线读取失败' } : null }), { status });
    if (url.pathname.endsWith('/summary')) {
      state.summaries++;
      return response({ activity_count: state.count, distance_m: state.drift && state.summaries > 1 ? 1 : 42195,
        duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: state.count,
        activity_days: 1, pace_eligible_count: 0, pace_eligible_distance_m: 0,
        avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' });
    }
    if (url.pathname.endsWith('/route')) {
      state.routes++; state.active++; state.peak = Math.max(state.peak, state.active);
      await new Promise(resolve => setTimeout(resolve, 1)); state.active--;
      return response(state.fail ? null : route, state.fail ? 503 : 200);
    }
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
    const items = Array.from({ length: Math.max(0, Math.min(limit, state.count - offset)) }, (_, i) => ({
      ...activity(state.duplicate ? 1 : offset + i, !state.noRoutes && offset + i !== 0),
      activity_date: state.wrongMonth ? '2024-03-01' : '2024-02-29',
    }));
    return response({ items, total: state.count, limit, offset });
  };
  return { state, fetcher };
}
describe('route poster', () => {
  it('uses exclusive month boundaries across leap February and December', () => {
    expect(posterMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-03-01' });
    expect(posterMonthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    for (const bad of ['2026-13', '0000-01', '1899-01', '2101-01', '2026-1']) expect(() => posterMonthRange(bad)).toThrow();
  });
  it('labels half-marathon distance equivalents without inventing completed races', () => {
    expect(posterStats(42195)).toEqual({ kilometers: '42.2', halfMarathons: '2.0' });
    expect(posterStats(0)).toEqual({ kilometers: '0.0', halfMarathons: '0.0' });
  });
  it('samples at most 120 real routes across all history, with no missing-route cells or private metadata', async () => {
    const { state, fetcher } = fixture(251);
    const result = await loadPoster({ fetcher, random: () => 0 });
    expect(result.cells).toHaveLength(120); expect(result.cells.every(Boolean)).toBe(true);
    expect(result.cells[0].paths).toHaveLength(1); expect(result.cells[0].points).toHaveLength(1);
    expect(result.routeCount).toBe(250); expect(result.activityCount).toBe(251);
    expect(state.peak).toBe(4); expect(state.routes).toBe(120);
    expect(state.urls).toContain('/api/v1/showcase/activities?limit=100&offset=0');
    expect(state.urls).toContain('/api/v1/showcase/activities?limit=100&offset=100');
    expect(state.urls).toContain('/api/v1/showcase/activities?limit=51&offset=200');
    expect(state.urls.some(url=>url.endsWith('/11111111-1111-4111-8111-000000000250/route'))).toBe(true);
    expect(state.urls.some(url=>url.endsWith('/11111111-1111-4111-8111-000000000000/route'))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|不可导出|coordinates|activity_date|11111111/);
  });
  it('uses the selected month for both scanning and authoritative totals', async () => {
    const { state, fetcher } = fixture(5);
    const result = await loadPoster({ fetcher, month: '2024-02' });
    expect(result.cells).toHaveLength(4); expect(result.routeCount).toBe(4);
    expect(result.kilometers).toBe('42.2'); expect(result.halfMarathons).toBe('2.0'); expect(state.routes).toBe(4);
    expect(state.urls).toContain('/api/v1/showcase/activities?limit=5&offset=0&activity_month=2024-02');
    expect(state.urls).toContain('/api/v1/showcase/statistics/summary?date_from=2024-02-01&date_to=2024-03-01');
  });
  it('changes the route sample when a different random stream is used', async () => {
    const first = fixture(251), second = fixture(251);
    await loadPoster({fetcher:first.fetcher,random:()=>0});
    await loadPoster({fetcher:second.fetcher,random:()=>.99});
    const routes = (urls: string[]) => urls.filter(url=>url.endsWith('/route')).sort();
    expect(routes(first.state.urls)).not.toEqual(routes(second.state.urls));
  });
  it('stops scheduling new routes when cancelled during loading', async () => {
    const { state, fetcher } = fixture();
    await expect(loadPoster({ fetcher, cancelled: () => state.cancel,
      onprogress: () => { state.cancel = true; } })).rejects.toThrow();
    expect(state.routes).toBeLessThanOrEqual(4);
  });
  it('rejects failed routes instead of presenting them as missing tracks', async () => {
    const { state, fetcher } = fixture(5); state.fail = true;
    await expect(loadPoster({ fetcher })).rejects.toThrow('路线读取失败');
  });
  it('rejects changes detected by the final summary read', async () => {
    const { state, fetcher } = fixture(2); state.drift = true;
    await expect(loadPoster({ fetcher })).rejects.toThrow('记录已变化');
  });
  it('rejects duplicate records and records outside the selected month', async () => {
    const { state, fetcher } = fixture(5); state.duplicate = true;
    await expect(loadPoster({ fetcher })).rejects.toThrow('记录已变化');
    state.duplicate = false; state.wrongMonth = true;
    await expect(loadPoster({ fetcher, month: '2024-02' })).rejects.toThrow('记录已变化');
  });
  it('does not request routes for an empty range or records without any tracks', async () => {
    const { state, fetcher } = fixture(0);
    await expect(loadPoster({ fetcher })).rejects.toThrow('没有跑步记录'); state.count = 121; state.noRoutes = true;
    await expect(loadPoster({ fetcher })).rejects.toThrow('没有可用于分享的轨迹'); expect(state.routes).toBe(0);
  });
});
