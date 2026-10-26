import { describe, expect, it } from 'vitest';
import { paceDelta, parseRecords, readRecords, signedDistance } from '../../src/lib/api/records';
import { pageDescription } from '../../src/lib/seo';

const best = { activity_id: '11111111-1111-4111-8111-111111111111', activity_date: '2024-03-05', distance_m: '5000.000', duration_seconds: '1400.000', avg_pace_seconds_per_km: '280.000', qualifying_count: 5 };
const months = (count = 0) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, activity_count: count, distance_m: String(count * 5000), avg_pace_seconds_per_km: count ? '300.000' : null }));
const totals = (year: number) => ({ year, activity_count: 2, distance_m: '10000', activity_days: 2, avg_pace_seconds_per_km: '300.000' });
function valid() {
  return {
    year: 2024, compare_year: 2023, cutoff_date: '2024-12-31', compare_cutoff_date: '2023-12-31', date_assignment: 'activity_local_date',
    personal_bests: [{ category: '5km', best: { ...best } }, { category: '10km', best: null }],
    monthly: months(1), compare_monthly: months(0),
    weekly: Array.from({ length: 26 }, (_, i) => ({ week_start: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10), active_days: i % 4 })),
    weekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i, activity_count: i })),
    comparison: { current: totals(2024), previous: totals(2023), delta: { activity_count: 0, distance_m: '-1500.5', activity_days: 0, avg_pace_seconds_per_km: null } }
  };
}
const respond = (data: unknown) => async () => Response.json({ data, error: null });

describe('records contract', () => {
  it('accepts a complete response and keeps missing values null', () => {
    const parsed = parseRecords(valid(), 2024, 2023);
    expect(parsed.personal_bests[1].best).toBeNull();
    expect(parsed.monthly[3].avg_pace_seconds_per_km).toBe('300.000');
    expect(parsed.compare_monthly[0].avg_pace_seconds_per_km).toBeNull();
  });
  it('rejects malformed shapes before they reach the page', () => {
    const cases: ((v: any) => void)[] = [
      v => { v.monthly.pop(); }, v => { v.weekly.pop(); }, v => { v.weekday[2].weekday = 5; },
      v => { v.personal_bests.reverse(); }, v => { v.personal_bests[0].best.activity_id = 'nope'; },
      v => { v.personal_bests[0].best.qualifying_count = 0; }, v => { v.monthly[0].distance_m = '-1'; },
      v => { v.cutoff_date = '2024-02-30'; }, v => { v.compare_year = 2024; }, v => { v.weekly[1].week_start = v.weekly[0].week_start; },
      v => { v.comparison.delta.distance_m = 'abc'; }, v => { v.date_assignment = 'utc'; }
    ];
    for (const mutate of cases) { const v = valid(); mutate(v); expect(() => parseRecords(v, 2024, 2023)).toThrow('无效响应'); }
  });
  it('rejects a response for another year than requested', () => {
    expect(() => parseRecords(valid(), 2025, undefined)).toThrow('无效响应');
    expect(() => parseRecords(valid(), 2024, 2022)).toThrow('无效响应');
  });
  it('requests the showcase path with only the given years', async () => {
    const seen: string[] = [];
    await readRecords(2024, 2023, async (url, init) => { seen.push(String(url)); expect(init?.cache).toBe('no-store'); return Response.json({ data: valid(), error: null }); });
    await readRecords(undefined, undefined, async url => { seen.push(String(url)); return Response.json({ data: valid(), error: null }); });
    expect(seen).toEqual(['/api/v1/showcase/statistics/records?year=2024&compare_year=2023', '/api/v1/showcase/statistics/records']);
  });
  it('maps an expired session to 401', async () => {
    await expect(readRecords(2024, 2023, async () => new Response('x', { status: 401 }))).rejects.toMatchObject({ status: 401 });
    await expect(readRecords(2024, 2023, respond({ nope: true }))).rejects.toThrow('无效响应');
  });
  it('formats signed distance and pace differences', () => {
    expect(signedDistance('42500')).toBe('+42.5 km');
    expect(signedDistance('-1500.5')).toBe('−1.5 km');
    expect(signedDistance(0)).toBe('0 km');
    expect(signedDistance(null)).toBe('—');
    expect(paceDelta('-42.456')).toBe('快 0:42 /km');
    expect(paceDelta('12')).toBe('慢 0:12 /km');
    expect(paceDelta(0)).toBe('持平');
    expect(paceDelta(null)).toBe('—');
  });
  it('describes the records page for search engines', () => {
    expect(pageDescription('/records', 200, 'fallback')).toContain('最佳成绩');
    expect(pageDescription('/p/alice/records', 200, 'fallback')).toContain('最佳成绩');
  });
});
