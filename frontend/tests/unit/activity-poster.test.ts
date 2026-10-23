import { describe, expect, it } from 'vitest';
import { activityPosterFields, loadActivityPoster, posterPace } from '../../src/lib/share/activity-poster-data.ts';
import { routeDrawing, routeEndpoints } from '../../src/lib/api/route-drawing.ts';

const id = '11111111-1111-4111-8111-111111111111';
const base = {
  id, title: '河畔晨跑', activity_date: '2026-10-18', timezone: 'Asia/Shanghai', started_at: null, ended_at: null,
  distance_m: '10420.5', elapsed_seconds: '3368', timer_seconds: null, avg_pace_seconds_per_km: '323.4',
  temporal_quality: 'complete', visibility: 'private', allow_shared_route: false, quality_summary: {},
  metrics_version: 'test', has_route: true, created_at: '2026-10-18T00:00:00Z', notes: 'private',
};
const route = { type: 'FeatureCollection', start: [10, 20], end: [10.02, 20.02], features: [
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 20], [10.01, 20.02], [10.02, 20.02]] }, properties: { segment_index: 0, point_count: 3 } },
] };
function fixture({ driftAfter = Infinity, status = 200 } = {}) {
  const state = { urls: [] as string[], reads: 0 };
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input), 'http://localhost'); state.urls.push(url.pathname);
    const body = (data: unknown) => new Response(JSON.stringify({ data, error: status >= 400 ? { message: '读取失败' } : null }), { status });
    if (url.pathname.endsWith('/route')) return body(route);
    state.reads++;
    return body({ ...base, distance_m: state.reads > driftAfter ? '1' : base.distance_m });
  };
  return { state, fetcher };
}
describe('activity poster', () => {
  it('formats the visible fields from server values', () => {
    expect(activityPosterFields(base as never)).toEqual({ title: '河畔晨跑', date: '2026 年 10 月 18 日', weekday: '周日',
      kilometers: '10.42', duration: '56:08', pace: '5′23″' });
    expect(posterPace(null)).toBe('—'); expect(posterPace('359.7')).toBe('6′00″');
  });
  it('reads only the own-data activity and its route, and carries no private fields', async () => {
    const { state, fetcher } = fixture();
    const result = await loadActivityPoster({ id, withRoute: true, fetcher });
    expect(state.urls.filter(url => url.endsWith('/route'))).toHaveLength(1);
    expect(state.urls.every(url => !url.includes('/showcase/') || url.endsWith('/route'))).toBe(true);
    expect(result.route).not.toBeNull();
    expect(JSON.stringify({ ...result, route: null })).not.toMatch(/private|11111111/);
  });
  it('skips the route when asked and rejects when the record changed meanwhile', async () => {
    const plain = fixture();
    expect((await loadActivityPoster({ id, withRoute: false, fetcher: plain.fetcher })).route).toBeNull();
    expect(plain.state.urls.some(url => url.endsWith('/route'))).toBe(false);
    const drift = fixture({ driftAfter: 1 });
    await expect(loadActivityPoster({ id, withRoute: true, fetcher: drift.fetcher })).rejects.toMatchObject({ code: 'POSTER_DATA_CHANGED' });
  });
  it('surfaces service errors and honours cancellation', async () => {
    await expect(loadActivityPoster({ id, withRoute: true, fetcher: fixture({ status: 503 }).fetcher })).rejects.toBeDefined();
    await expect(loadActivityPoster({ id, withRoute: true, fetcher: fixture().fetcher, cancelled: () => true })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('projects endpoints into the same box as the drawing', () => {
    const { start, end } = routeEndpoints(route as never, 800, 600);
    const drawing = routeDrawing(route as never, 800, 600);
    const [first] = drawing.paths[0].slice(1).split('L')[0].split(',').map(Number);
    expect(start[0]).toBeCloseTo(first, 1);
    for (const [x, y] of [start, end]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(800); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(600); }
  });
});
