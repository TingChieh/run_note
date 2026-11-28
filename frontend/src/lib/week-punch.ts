import type { Streaks } from '#lib/api/milestones.ts';
import type { CalendarDay } from '#lib/api/statistics.ts';

export type WeekPunchKind = 'active' | 'active-nodist' | 'today-rest' | 'rest' | 'future';

export interface WeekPunchDay {
  date: string;
  weekdayIndex: number;
  weekdayLabel: string;
  displayLabel: string;
  active: boolean;
  isToday: boolean;
  isFuture: boolean;
  distanceM: number | null;
  blocks: number;
  showActiveDot: boolean;
  kind: WeekPunchKind;
  ariaLabel: string;
}

export interface WeekPunchSummary {
  days: WeekPunchDay[];
  maxDistanceM: number;
  ariaLabel: string;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/**
 * Extracts unique calendar years spanned by a streak week (1 year normally, 2 for a cross-year week
 * such as Mon Dec 29 – Sun Jan 4).
 */
export function weekSpanYears(week: readonly { date: string }[]): number[] {
  const years = new Set<number>();
  for (const entry of week) {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(entry.date);
    if (!match) continue;
    const year = Number(match[1]);
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Builds a `YYYY-MM-DD -> distanceM` map from one or more calendar year payloads.
 */
export function indexCalendarDistances(
  dayLists: readonly (readonly CalendarDay[] | null | undefined)[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const list of dayLists) {
    if (!list) continue;
    for (const day of list) {
      const parsed = Number(day.distance_m);
      if (Number.isFinite(parsed) && parsed >= 0) {
        map.set(day.date, parsed);
      }
    }
  }
  return map;
}

function readDistanceM(
  source:
    | ReadonlyMap<string, number | null | undefined>
    | Readonly<Record<string, number | null | undefined>>
    | null
    | undefined,
  date: string,
): number | null {
  if (!source) return null;
  const raw =
    source instanceof Map ? source.get(date) : (source as Readonly<Record<string, number | null | undefined>>)[date];
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function formatKmShort(distanceM: number): string {
  const km = distanceM / 1000;
  return km >= 10 ? km.toFixed(1) : km.toFixed(1);
}

/**
 * Computes the 7-day Editorial Receipt punch-block strip for the current week (Mon–Sun).
 *
 * Truthfulness rules:
 * - Active days with real positive distance render 1..maxBlocks proportional to the week's peak day.
 * - Active days with missing distance (e.g. calendar failed / partial cross-year fetch) or 0 m distance
 *   NEVER fabricate stacked blocks: they render `blocks = 0` and `showActiveDot = true`.
 * - Inactive past days render a rest placeholder; today (if inactive) renders the `--receipt-mark` frame;
 *   future days render a thin baseline mark.
 */
export function buildWeekPunch(
  streaks: Streaks,
  distances?:
    ReadonlyMap<string, number | null | undefined> | Readonly<Record<string, number | null | undefined>> | null,
  maxBlocks = 5,
): WeekPunchSummary {
  const cap = Math.max(1, Math.floor(maxBlocks));
  const resolvedDistances = streaks.week.map((day) => readDistanceM(distances, day.date));
  let maxDistanceM = 0;
  for (let i = 0; i < streaks.week.length; i += 1) {
    const day = streaks.week[i];
    const dist = resolvedDistances[i];
    if (day.active && day.date <= streaks.today && dist !== null && dist > maxDistanceM) {
      maxDistanceM = dist;
    }
  }

  const days: WeekPunchDay[] = streaks.week.map((day, index) => {
    const weekdayLabel = WEEKDAY_LABELS[index] ?? '';
    const isToday = day.date === streaks.today;
    const isFuture = day.date > streaks.today;
    const distanceM = resolvedDistances[index];
    const displayLabel = isToday ? '今天' : weekdayLabel;

    let blocks = 0;
    let showActiveDot = false;
    let kind: WeekPunchKind;
    let statusText: string;

    if (isFuture) {
      kind = 'future';
      statusText = '尚未到来';
    } else if (day.active) {
      if (distanceM !== null && distanceM > 0 && maxDistanceM > 0) {
        blocks = Math.max(1, Math.min(cap, Math.round((distanceM / maxDistanceM) * cap)));
        kind = 'active';
        statusText = `${formatKmShort(distanceM)} 公里`;
      } else {
        blocks = 0;
        showActiveDot = true;
        kind = 'active-nodist';
        statusText = distanceM === 0 ? '有活动（0 公里）' : '有活动';
      }
    } else if (isToday) {
      kind = 'today-rest';
      statusText = '尚未跑步';
    } else {
      kind = 'rest';
      statusText = '休息';
    }

    const prefix = isToday ? `今天（周${weekdayLabel}）` : `周${weekdayLabel}`;
    const ariaLabel = `${day.date} ${prefix}：${statusText}`;

    return {
      date: day.date,
      weekdayIndex: index,
      weekdayLabel,
      displayLabel,
      active: day.active,
      isToday,
      isFuture,
      distanceM,
      blocks,
      showActiveDot,
      kind,
      ariaLabel,
    };
  });

  const activeSummary = days
    .filter((d) => !d.isFuture)
    .map((d) => {
      const name = d.isToday ? '今天' : `周${d.weekdayLabel}`;
      if (d.kind === 'active' && d.distanceM !== null) return `${name} ${formatKmShort(d.distanceM)} 公里`;
      if (d.kind === 'active-nodist') return `${name} 有活动`;
      if (d.kind === 'today-rest') return '今天尚未跑步';
      return `${name}休息`;
    })
    .join('，');

  return {
    days,
    maxDistanceM,
    ariaLabel: activeSummary ? `本周每日打卡：${activeSummary}` : '本周每日打卡',
  };
}
