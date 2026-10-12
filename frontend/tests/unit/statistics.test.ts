import { describe, expect, it } from 'vitest';
import { calendarCells, currentYear, readCalendar, readSummary } from '../../src/lib/api/statistics';
import { readActivities } from '../../src/lib/api/activities';
describe('statistics calendar and privacy contract', () => {
  it('includes leap day and positions dates from Monday without timezone shifts', () => {
    const leap = calendarCells(2024); expect(leap.filter(Boolean)).toHaveLength(366); expect(leap[0]).toBe('2024-01-01'); expect(leap).toContain('2024-02-29');
    expect(calendarCells(2023).slice(0, 7)).toEqual([null,null,null,null,null,null,'2023-01-01']);
    expect(currentYear('America/Los_Angeles', new Date('2026-01-01T00:30:00Z'))).toBe(2025);
  });
  it('preserves null metrics and validates statistics before showing them', async () => {
    const summary = { activity_count: 0, distance_m: '0.000', duration_sum_seconds: null, known_duration_count: 0, missing_duration_count: 0, activity_days: 0, pace_eligible_count: 0, pace_eligible_distance_m: '0', avg_pace_seconds_per_km: null, quality_warning_count: 0, date_assignment: 'activity_local_date' };
    await expect(readSummary(undefined, async () => Response.json({ data: summary }))).resolves.toMatchObject({ duration_sum_seconds: null });
    await expect(readSummary(undefined, async () => Response.json({ data: {...summary, distance_m: ''} }))).rejects.toThrow('无效响应');
    await expect(readCalendar(2024, 'distance', async () => Response.json({ data: {year:2024,metric:'distance',days:[]} }))).rejects.toThrow('无效响应');
    await expect(readSummary(undefined, async () => new Response('expired', {status:401}))).rejects.toMatchObject({status:401});
  });
  it('filters clicked-day records with credentials and no private cache', async () => {
    await readActivities(async (url, init) => { expect(String(url)).toContain('activity_date=2024-02-29'); expect(init?.cache).toBe('no-store'); expect(init?.credentials).toBe('same-origin'); return Response.json({data:{items:[],total:0,limit:20,offset:20}}); }, 20, '2024-02-29');
  });
});
