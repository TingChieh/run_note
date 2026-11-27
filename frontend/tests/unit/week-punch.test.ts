import { describe, expect, it } from 'vitest';
import type { Streaks } from '#lib/api/milestones.ts';
import { activeStreakYears, buildWeekPunch } from '#lib/week-punch.ts';

function makeStreaks(today: string, week: { date: string; active: boolean }[]): Streaks {
  return {
    today,
    current_days: week.filter((d) => d.active).length,
    longest_days: 5,
    current_weeks: 1,
    longest_weeks: 3,
    week,
  };
}

describe('week-punch', () => {
  it('returns no calendar years and zero blocks when the current week has no active days', () => {
    const streaks = makeStreaks('2026-11-26', [
      { date: '2026-11-23', active: false },
      { date: '2026-11-24', active: false },
      { date: '2026-11-25', active: false },
      { date: '2026-11-26', active: false },
      { date: '2026-11-27', active: false },
      { date: '2026-11-28', active: false },
      { date: '2026-11-29', active: false },
    ]);
    expect(activeStreakYears(streaks)).toEqual([]);
    const punch = buildWeekPunch(streaks, new Map());
    expect(punch.map((d) => d.blocks)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(punch.map((d) => d.state)).toEqual(['rest', 'rest', 'rest', 'today-empty', 'future', 'future', 'future']);
  });

  it('detects both years on a cross-year week and merges measured distances proportionally', () => {
    const streaks = makeStreaks('2026-01-02', [
      { date: '2025-12-29', active: true },
      { date: '2025-12-30', active: false },
      { date: '2025-12-31', active: true },
      { date: '2026-01-01', active: true },
      { date: '2026-01-02', active: true },
      { date: '2026-01-03', active: false },
      { date: '2026-01-04', active: false },
    ]);
    expect(activeStreakYears(streaks)).toEqual([2025, 2026]);
    const distances = new Map<string, number>([
      ['2025-12-29', 4000],
      ['2025-12-31', 10000],
      ['2026-01-01', 6000],
      // 2026-01-02 active but missing distance -> must NOT fabricate 2 blocks
    ]);
    const punch = buildWeekPunch(streaks, distances);
    expect(punch[0]).toMatchObject({ date: '2025-12-29', state: 'measured', blocks: 2 });
    expect(punch[1]).toMatchObject({ date: '2025-12-30', state: 'rest', blocks: 0 });
    expect(punch[2]).toMatchObject({ date: '2025-12-31', state: 'measured', blocks: 5 });
    expect(punch[3]).toMatchObject({ date: '2026-01-01', state: 'measured', blocks: 3 });
    expect(punch[4]).toMatchObject({ date: '2026-01-02', isToday: true, active: true, state: 'active', blocks: 0 });
    expect(punch[5]).toMatchObject({ date: '2026-01-03', state: 'future', blocks: 0 });
  });

  it('never fabricates 2 blocks when active days have missing or zero distance', () => {
    const streaks = makeStreaks('2026-10-14', [
      { date: '2026-10-12', active: true },
      { date: '2026-10-13', active: true },
      { date: '2026-10-14', active: false },
      { date: '2026-10-15', active: false },
      { date: '2026-10-16', active: false },
      { date: '2026-10-17', active: false },
      { date: '2026-10-18', active: false },
    ]);
    const punch = buildWeekPunch(streaks, new Map([['2026-10-12', 0]]));
    expect(punch[0]).toMatchObject({ active: true, state: 'active', blocks: 0 });
    expect(punch[1]).toMatchObject({ active: true, state: 'active', blocks: 0 });
  });
});
