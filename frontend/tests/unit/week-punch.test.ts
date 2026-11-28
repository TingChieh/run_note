import { describe, expect, it } from 'vitest';
import { buildWeekPunch, indexCalendarDistances, weekSpanYears } from '#lib/week-punch.ts';
import type { Streaks } from '#lib/api/milestones.ts';

function makeStreaks(today: string, activeFlags: boolean[]): Streaks {
  const t = new Date(`${today}T00:00:00Z`);
  const mondayMs = t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000;
  return {
    today,
    current_days: activeFlags.filter(Boolean).length,
    longest_days: 5,
    current_weeks: 1,
    longest_weeks: 3,
    week: Array.from({ length: 7 }, (_, i) => ({
      date: new Date(mondayMs + i * 86400000).toISOString().slice(0, 10),
      active: activeFlags[i] ?? false,
    })),
  };
}

describe('week-punch', () => {
  it('detects single-year and cross-year streak weeks', () => {
    const midYear = makeStreaks('2026-11-26', [true, false, true, false, false, false, false]);
    expect(weekSpanYears(midYear.week)).toEqual([2026]);

    // Thu 2026-01-01 -> Mon 2025-12-29 .. Sun 2026-01-04
    const crossYear = makeStreaks('2026-01-01', [true, false, true, true, false, false, false]);
    expect(crossYear.week[0].date).toBe('2025-12-29');
    expect(crossYear.week[6].date).toBe('2026-01-04');
    expect(weekSpanYears(crossYear.week)).toEqual([2025, 2026]);
  });

  it('computes proportional stacked blocks for active days with positive distance', () => {
    const streaks = makeStreaks('2026-11-26', [true, false, true, false, false, false, false]);
    const punch = buildWeekPunch(streaks, {
      '2026-11-23': 3900,
      '2026-11-25': 2800,
    });
    expect(punch.days[0]).toMatchObject({ kind: 'active', blocks: 5, showActiveDot: false, displayLabel: '一' });
    expect(punch.days[1]).toMatchObject({ kind: 'rest', blocks: 0, showActiveDot: false });
    expect(punch.days[2]).toMatchObject({ kind: 'active', blocks: 4, showActiveDot: false });
    expect(punch.days[3]).toMatchObject({ kind: 'today-rest', blocks: 0, isToday: true, displayLabel: '今天' });
    expect(punch.days[4]).toMatchObject({ kind: 'future', blocks: 0, isFuture: true });
    expect(punch.ariaLabel).toContain('3.9 公里');
    expect(punch.ariaLabel).toContain('2.8 公里');
  });

  it('shows active dot and 0 blocks when distance is missing, cross-year unmapped, or zero', () => {
    const streaks = makeStreaks('2026-01-01', [true, false, true, true, false, false, false]);
    // Simulate 2025 calendar missing (cross-year gap) and 2026-01-01 having 0 m distance.
    const distances = indexCalendarDistances([
      [
        {
          date: '2026-01-01',
          activity_count: 1,
          distance_m: 0,
          duration_sum_seconds: 600,
          known_duration_count: 1,
          missing_duration_count: 0,
        },
      ],
    ]);
    const punch = buildWeekPunch(streaks, distances);

    // 2025-12-29 (active, missing distance) -> active dot, 0 blocks
    expect(punch.days[0]).toMatchObject({
      date: '2025-12-29',
      kind: 'active-nodist',
      blocks: 0,
      showActiveDot: true,
      distanceM: null,
    });
    // 2025-12-31 (active, missing distance) -> active dot, 0 blocks
    expect(punch.days[2]).toMatchObject({
      date: '2025-12-31',
      kind: 'active-nodist',
      blocks: 0,
      showActiveDot: true,
      distanceM: null,
    });
    // 2026-01-01 (active today, 0 m distance) -> active dot, 0 blocks
    expect(punch.days[3]).toMatchObject({
      date: '2026-01-01',
      kind: 'active-nodist',
      blocks: 0,
      showActiveDot: true,
      distanceM: 0,
      isToday: true,
    });
  });

  it('merges cross-year calendar distances when both years are provided', () => {
    const streaks = makeStreaks('2026-01-01', [true, false, false, true, false, false, false]);
    const distances = indexCalendarDistances([
      [
        {
          date: '2025-12-29',
          activity_count: 1,
          distance_m: '6000',
          duration_sum_seconds: 1800,
          known_duration_count: 1,
          missing_duration_count: 0,
        },
      ],
      [
        {
          date: '2026-01-01',
          activity_count: 1,
          distance_m: '3000',
          duration_sum_seconds: 900,
          known_duration_count: 1,
          missing_duration_count: 0,
        },
      ],
    ]);
    const punch = buildWeekPunch(streaks, distances);
    expect(punch.days[0]).toMatchObject({ date: '2025-12-29', kind: 'active', blocks: 5, showActiveDot: false });
    expect(punch.days[3]).toMatchObject({
      date: '2026-01-01',
      kind: 'active',
      blocks: 3,
      showActiveDot: false,
      isToday: true,
    });
  });
});
