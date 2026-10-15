import { describe, expect, it } from 'vitest';
import { comparisonWindow, goalTotals, parseStreaks, parseProvinces } from '../../src/lib/api/milestones';
import { routeDrawing } from '../../src/lib/api/route-drawing';

describe('running milestones', () => {
  it('compares the same local calendar progress across leap months and years', () => {
    const now = new Date('2024-03-31T18:00:00Z');
    expect(comparisonWindow('month', 'Asia/Shanghai', now)).toEqual({ current: { from: '2024-04-01', to: '2024-04-02' }, previous: { from: '2024-03-01', to: '2024-03-02' } });
    const leap = new Date('2024-02-29T12:00:00Z');
    expect(comparisonWindow('year', 'UTC', leap).previous.to).toBe('2023-03-01');
    expect(comparisonWindow('week', 'UTC', new Date('2026-01-01T12:00:00Z'))).toEqual({ current:{from:'2025-12-29',to:'2026-01-02'},previous:{from:'2025-12-22',to:'2025-12-26'} });
  });
  it('caps only the progress bar and leaves missing duration unknown', () => {
    expect(goalTotals({ distance_m: '52000', duration_sum_seconds: null, activity_count: 4 }, 35)).toEqual({ km: 52, hours: null, count: 4, percent: 100 });
    expect(goalTotals({ distance_m: 0, duration_sum_seconds: 0, activity_count: 0 }, null).percent).toBeNull();
  });
  it('rejects invalid streaks and synthetic sea areas counted as provinces', () => {
    expect(() => parseStreaks({ current_days: -1 })).toThrow();
    expect(() => parseProvinces({ year: 2026, total: 35, provinces: [] }, 2026)).toThrow();
  });
  it('accepts cumulative provinces while rejecting a mismatched time scope', () => {
    const cumulative = { year: null, total: 34, activity_count: 3, located_activity_count: 2, provinces: [{ code: 310000, name: '上海市', activity_count: 2 }] };
    expect(parseProvinces(cumulative)).toEqual(cumulative);
    expect(() => parseProvinces(cumulative, 2026)).toThrow();
    expect(() => parseProvinces({ ...cumulative, year: 2026 })).toThrow();
    expect(() => parseProvinces({ ...cumulative, located_activity_count: 4 })).toThrow();
  });
});

describe('activity route drawings', () => {
  it('keeps segment breaks, single points and dateline routes bounded', () => {
    const drawing = routeDrawing({ type:'FeatureCollection', start:[179.9,0], end:[180.1,0], features:[
      { type:'Feature', geometry:{type:'LineString',coordinates:[[179.9,0],[180,0]]},properties:{segment_index:0,point_count:2} },
      { type:'Feature', geometry:{type:'Point',coordinates:[180.1,0]},properties:{segment_index:1,point_count:1} }
    ] });
    expect(drawing.paths).toHaveLength(1);
    expect(drawing.points).toHaveLength(1);
    for (const [x,y] of drawing.points) { expect(x).toBeGreaterThanOrEqual(16); expect(x).toBeLessThanOrEqual(344); expect(y).toBeGreaterThanOrEqual(16); expect(y).toBeLessThanOrEqual(204); }
    expect(drawing.paths[0]).not.toMatch(/NaN|Infinity/);
  });
});
