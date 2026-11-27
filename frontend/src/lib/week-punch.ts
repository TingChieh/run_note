import type { Streaks } from './api/milestones.ts';

export type WeekPunchState = 'measured' | 'active' | 'today-empty' | 'rest' | 'future';

export interface WeekPunchDay {
  date: string;
  active: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** Number of proportional mileage blocks (1–5) when distance is known; 0 otherwise. */
  blocks: number;
  state: WeekPunchState;
  weekday: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/**
 * Returns the distinct calendar years needed to read daily distances for active days in the
 * current streak week (handles cross-year weeks such as Dec 29 – Jan 4, and returns `[]` when
 * the week has no active days).
 */
export function activeStreakYears(streaks: Streaks | null): number[] {
  if (!streaks) return [];
  const years = new Set<number>();
  for (const day of streaks.week) {
    if (!day.active) continue;
    const year = Number(day.date.slice(0, 4));
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Maps the current streak week plus known daily distances (`YYYY-MM-DD -> meters`) to punch-card
 * items. When an active day lacks a positive distance measurement, `blocks` stays `0` with
 * `state: 'active'` so the UI shows known activity without fabricating mileage height.
 */
export function buildWeekPunch(streaks: Streaks | null, distanceByDate: ReadonlyMap<string, number>): WeekPunchDay[] {
  if (!streaks) return [];
  const distances = streaks.week.map((day) => {
    const raw = distanceByDate.get(day.date) ?? 0;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });
  const maxDist = Math.max(0, ...distances);
  return streaks.week.map((day, idx) => {
    const dist = distances[idx];
    const isToday = day.date === streaks.today;
    const isFuture = day.date > streaks.today;
    if (day.active) {
      if (maxDist > 0 && dist > 0) {
        return {
          date: day.date,
          active: true,
          isToday,
          isFuture,
          blocks: Math.max(1, Math.min(5, Math.round((dist / maxDist) * 5))),
          state: 'measured',
          weekday: WEEKDAYS[idx] ?? '',
        };
      }
      return {
        date: day.date,
        active: true,
        isToday,
        isFuture,
        blocks: 0,
        state: 'active',
        weekday: WEEKDAYS[idx] ?? '',
      };
    }
    return {
      date: day.date,
      active: false,
      isToday,
      isFuture,
      blocks: 0,
      state: isToday ? 'today-empty' : isFuture ? 'future' : 'rest',
      weekday: WEEKDAYS[idx] ?? '',
    };
  });
}
