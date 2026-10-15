import { ActivityError, request, type Metric } from './activities';
import { goalRange, type GoalPeriod } from './running-goal';
import { parseSummary, type Summary } from './statistics';

export interface DateRange { from: string; to: string }
export interface Streaks { today: string; current_days: number; longest_days: number; current_weeks: number; longest_weeks: number; week: { date: string; active: boolean }[] }
export interface Provinces { year: number | null; total: number; provinces: { code: number; name: string; activity_count: number }[]; activity_count: number; located_activity_count: number }
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(new Date(Date.parse(date) + days * 86400000));
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && iso(new Date(v)) === v;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function invalid(): never { throw new ActivityError('运动汇总返回了无效数据，请重试', 502, 'INVALID_RESPONSE'); }

export function comparisonWindow(period: GoalPeriod, timezone: string, now = new Date()): { current: DateRange; previous: DateRange } {
  const full = goalRange(period, timezone, now);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const current = { from: full.from, to: shift(today, 1) };
  if (period === 'week') return { current, previous: { from: shift(current.from, -7), to: shift(current.to, -7) } };
  const previousStart = new Date(`${full.from}T00:00:00Z`);
  if (period === 'month') previousStart.setUTCMonth(previousStart.getUTCMonth() - 1);
  else previousStart.setUTCFullYear(previousStart.getUTCFullYear() - 1);
  const day = new Date(`${today}T00:00:00Z`);
  const previousYear = period === 'year' ? day.getUTCFullYear() - 1 : previousStart.getUTCFullYear();
  const previousMonth = period === 'year' ? day.getUTCMonth() : previousStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(previousYear, previousMonth + 1, 0)).getUTCDate();
  const previousEnd = new Date(Date.UTC(previousYear, previousMonth, Math.min(day.getUTCDate(), lastDay) + 1));
  return { current, previous: { from: iso(previousStart), to: iso(previousEnd) } };
}
export function goalTotals(summary: { distance_m: Metric; duration_sum_seconds: Metric; activity_count: number }, target: number | null) {
  const km = Number(summary.distance_m) / 1000;
  return { km, hours: summary.duration_sum_seconds === null ? null : Number(summary.duration_sum_seconds) / 3600, count: summary.activity_count, percent: target === null ? null : Math.min(100, km / target * 100) };
}
export async function readRange(range: DateRange): Promise<Summary> {
  return parseSummary(await request(`/api/v1/statistics/summary?date_from=${range.from}&date_to=${range.to}`, {}, fetch));
}
export function parseStreaks(v: unknown): Streaks {
  if (!object(v) || !date(v.today) || !['current_days','longest_days','current_weeks','longest_weeks'].every(k => count(v[k])) || Number(v.current_days) > Number(v.longest_days) || Number(v.current_weeks) > Number(v.longest_weeks) || !Array.isArray(v.week) || v.week.length !== 7) invalid();
  const today = new Date(`${v.today}T00:00:00Z`), monday = shift(v.today, -(today.getUTCDay() + 6) % 7);
  if (!v.week.every((d, i) => object(d) && d.date === shift(monday, i) && typeof d.active === 'boolean' && !(d.active && String(d.date) > String(v.today)))) invalid();
  return v as unknown as Streaks;
}
export async function readStreaks(): Promise<Streaks> { return parseStreaks(await request('/api/v1/statistics/streaks', {}, fetch)); }
export function parseProvinces(v: unknown, year: number | null = null): Provinces {
  if (!object(v) || v.year !== year || v.total !== 34 || !count(v.activity_count) || !count(v.located_activity_count) || v.located_activity_count > v.activity_count || !Array.isArray(v.provinces) || v.provinces.length > 34) invalid();
  const seen = new Set<number>();
  for (const p of v.provinces) { if (!object(p) || !count(p.code) || p.code < 110000 || p.code > 820000 || p.code % 10000 !== 0 || seen.has(p.code) || typeof p.name !== 'string' || !count(p.activity_count) || p.activity_count < 1 || p.activity_count > v.located_activity_count) invalid(); seen.add(p.code); }
  return v as unknown as Provinces;
}
export async function readProvinces(year: number | null = null): Promise<Provinces> { return parseProvinces(await request(`/api/v1/footprints/provinces${year === null ? '' : `?year=${year}`}`, {}, fetch), year); }
