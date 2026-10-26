import { ActivityError, formatDuration, request, type Metric } from './activities';
import { dashboardDistance } from './dashboard-format';

export type RecordCategory = '5km' | '10km';
export interface PersonalBest { activity_id: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric; qualifying_count: number }
export interface CategoryBest { category: RecordCategory; best: PersonalBest | null }
export interface MonthPoint { month: number; activity_count: number; distance_m: Metric; avg_pace_seconds_per_km: Metric }
export interface WeekPoint { week_start: string; active_days: number }
export interface WeekdayPoint { weekday: number; activity_count: number }
export interface YearTotals { year: number; activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric }
export interface ComparisonDelta { activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric }
export interface Records {
  year: number; compare_year: number; cutoff_date: string; compare_cutoff_date: string; date_assignment: 'activity_local_date';
  personal_bests: CategoryBest[]; monthly: MonthPoint[]; compare_monthly: MonthPoint[]; weekly: WeekPoint[]; weekday: WeekdayPoint[];
  comparison: { current: YearTotals; previous: YearTotals; delta: ComparisonDelta };
}

export const CATEGORY_NAMES: Record<RecordCategory, string> = { '5km': '5K', '10km': '10K' };
export const CATEGORY_RANGES: Record<RecordCategory, string> = { '5km': '4.0–7.5 km', '10km': '9.0–12.0 km' };
const CATEGORIES: RecordCategory[] = ['5km', '10km'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const metric = (v: unknown, nullable = false) => v === null ? nullable : (typeof v === 'number' || typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0;
const signed = (v: unknown, nullable = false) => v === null ? nullable : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
const isoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
function invalid(): never { throw new ActivityError('纪录服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE'); }

function validBest(v: unknown): boolean {
  return object(v) && typeof v.activity_id === 'string' && uuid.test(v.activity_id) && isoDate(v.activity_date) && metric(v.distance_m) && metric(v.duration_seconds)
    && metric(v.avg_pace_seconds_per_km) && count(v.qualifying_count) && Number(v.qualifying_count) >= 1;
}
const validMonths = (v: unknown) => Array.isArray(v) && v.length === 12 && v.every((item, i) => object(item) && item.month === i + 1 && count(item.activity_count) && metric(item.distance_m) && metric(item.avg_pace_seconds_per_km, true));
const validTotals = (v: unknown, year: number) => object(v) && v.year === year && count(v.activity_count) && metric(v.distance_m) && count(v.activity_days) && metric(v.avg_pace_seconds_per_km, true);

export function parseRecords(v: unknown, year?: number, compareYear?: number): Records {
  if (!object(v) || !Number.isInteger(v.year) || !Number.isInteger(v.compare_year) || v.year === v.compare_year) invalid();
  const data = v as Record<string, any>;
  if ((year !== undefined && data.year !== year) || (compareYear !== undefined && data.compare_year !== compareYear)) invalid();
  if (!isoDate(data.cutoff_date) || !isoDate(data.compare_cutoff_date) || data.date_assignment !== 'activity_local_date') invalid();
  if (!Array.isArray(data.personal_bests) || data.personal_bests.length !== 2 || !data.personal_bests.every((item: unknown, i: number) => object(item) && item.category === CATEGORIES[i] && (item.best === null || validBest(item.best)))) invalid();
  if (!validMonths(data.monthly) || !validMonths(data.compare_monthly)) invalid();
  if (!Array.isArray(data.weekly) || data.weekly.length !== 26 || !data.weekly.every((item: unknown, i: number, all: any[]) => object(item) && isoDate(item.week_start) && count(item.active_days) && Number(item.active_days) <= 7 && (i === 0 || item.week_start > all[i - 1].week_start))) invalid();
  if (!Array.isArray(data.weekday) || data.weekday.length !== 7 || !data.weekday.every((item: unknown, i: number) => object(item) && item.weekday === i && count(item.activity_count))) invalid();
  const c = data.comparison;
  if (!object(c) || !validTotals(c.current, data.year) || !validTotals(c.previous, data.compare_year) || !object(c.delta)
    || !Number.isSafeInteger(c.delta.activity_count) || !Number.isSafeInteger(c.delta.activity_days) || !signed(c.delta.distance_m) || !signed(c.delta.avg_pace_seconds_per_km, true)) invalid();
  return data as Records;
}

export async function readRecords(year?: number, compareYear?: number, fetcher: typeof fetch = fetch): Promise<Records> {
  const query = new URLSearchParams();
  if (year !== undefined) query.set('year', String(year));
  if (compareYear !== undefined) query.set('compare_year', String(compareYear));
  const suffix = query.toString();
  return parseRecords(await request(`/api/v1/showcase/statistics/records${suffix ? `?${suffix}` : ''}`, {}, fetcher), year, compareYear);
}

export function signedDistance(value: Metric): string {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${dashboardDistance(Math.abs(n))}`;
}

/** Negative seconds per km is faster. */
export function paceDelta(value: Metric): string {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return '—';
  const seconds = Math.round(Math.abs(n));
  return seconds === 0 ? '持平' : `${n < 0 ? '快' : '慢'} ${formatDuration(seconds)} /km`;
}
