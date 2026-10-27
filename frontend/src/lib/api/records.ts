import { ActivityError, formatDuration, request, type Metric } from './activities';
import { dashboardDistance } from './dashboard-format';

export type RecordCategory = '5km' | '10km';
export interface PersonalBest { activity_id: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric; qualifying_count: number }
export interface FirstRun { activity_id: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric }
export interface CategoryBest { category: RecordCategory; best: PersonalBest | null; first: FirstRun | null; pace_gain_seconds_per_km: Metric }
export interface Totals { activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric; first_activity_date: string | null }
/** `month_start` is always the first day of the month, `YYYY-MM-01`. */
export interface MonthPoint { month_start: string; activity_count: number; distance_m: Metric; avg_pace_seconds_per_km: Metric }
export interface WeekPoint { week_start: string; active_days: number }
export interface WeekdayPoint { weekday: number; activity_count: number }
/** Differences against the previous year (or its same period); negative pace is faster. */
export interface YearDelta { activity_count: number; distance_m: Metric; avg_pace_seconds_per_km: Metric }
export interface YearRow {
  year: number; activity_count: number; distance_m: Metric; activity_days: number; avg_pace_seconds_per_km: Metric;
  is_partial: boolean; delta: YearDelta | null; delta_basis: 'previous_year' | 'previous_year_same_period' | null;
}
export interface Records {
  date_assignment: 'activity_local_date'; personal_bests: CategoryBest[]; totals: Totals;
  monthly: MonthPoint[]; weekly: WeekPoint[]; weekday: WeekdayPoint[]; yearly: YearRow[];
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

function validRun(v: unknown): boolean {
  return object(v) && typeof v.activity_id === 'string' && uuid.test(v.activity_id) && isoDate(v.activity_date) && metric(v.distance_m) && metric(v.duration_seconds) && metric(v.avg_pace_seconds_per_km);
}
const validBest = (v: unknown) => validRun(v) && count((v as Record<string, unknown>).qualifying_count) && Number((v as Record<string, unknown>).qualifying_count) >= 1;
function validCategory(v: unknown, category: RecordCategory): boolean {
  if (!object(v) || v.category !== category || !(v.best === null || validBest(v.best)) || !(v.first === null || validRun(v.first)) || !metric(v.pace_gain_seconds_per_km, true)) return false;
  if (v.pace_gain_seconds_per_km === null) return true;
  // A gain only exists between two different runs, and only when it is a real improvement.
  return Number(v.pace_gain_seconds_per_km) > 0 && object(v.best) && object(v.first) && v.best.activity_id !== v.first.activity_id;
}
const monthIndex = (v: string) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5, 7)) - 1;
const validMonths = (v: unknown) => Array.isArray(v) && v.every((item, i, all) => object(item) && isoDate(item.month_start) && item.month_start.endsWith('-01')
  && count(item.activity_count) && metric(item.distance_m) && metric(item.avg_pace_seconds_per_km, true) && (i === 0 || monthIndex(item.month_start) === monthIndex(all[i - 1].month_start) + 1));
const validDelta = (v: unknown) => object(v) && Number.isSafeInteger(v.activity_count) && signed(v.distance_m) && signed(v.avg_pace_seconds_per_km, true);
// Rows run up to the latest year with data, which can lie after the current year, so the partial (current) year is not necessarily last; at most one row is partial.
const validYears = (v: unknown) => Array.isArray(v) && v.filter(item => object(item) && item.is_partial === true).length <= 1 && v.every((item, i, all) => object(item) && Number.isSafeInteger(item.year) && Number(item.year) >= 1900 && Number(item.year) <= 2100
  && count(item.activity_count) && metric(item.distance_m) && count(item.activity_days) && metric(item.avg_pace_seconds_per_km, true) && typeof item.is_partial === 'boolean'
  && (i === 0 || item.year === all[i - 1].year + 1)
  && (i === 0 ? item.delta === null && item.delta_basis === null : validDelta(item.delta) && item.delta_basis === (item.is_partial ? 'previous_year_same_period' : 'previous_year')));
const validTotals = (v: unknown) => object(v) && count(v.activity_count) && metric(v.distance_m) && count(v.activity_days) && metric(v.avg_pace_seconds_per_km, true) && (v.first_activity_date === null || isoDate(v.first_activity_date));

export function parseRecords(v: unknown): Records {
  if (!object(v) || v.date_assignment !== 'activity_local_date') invalid();
  const data = v as Record<string, any>;
  if (!Array.isArray(data.personal_bests) || data.personal_bests.length !== 2 || !data.personal_bests.every((item: unknown, i: number) => validCategory(item, CATEGORIES[i]))) invalid();
  if (!validTotals(data.totals) || !validMonths(data.monthly) || !validYears(data.yearly)) invalid();
  // Both timelines start at the first activity: either both are empty or the first year matches the first month.
  const noMonths = data.monthly.length === 0, noYears = data.yearly.length === 0;
  if (noMonths !== noYears || (!noMonths && Number(data.monthly[0].month_start.slice(0, 4)) !== data.yearly[0].year)) invalid();
  if (!Array.isArray(data.weekly) || data.weekly.length !== 26 || !data.weekly.every((item: unknown, i: number, all: any[]) => object(item) && isoDate(item.week_start) && count(item.active_days) && Number(item.active_days) <= 7 && (i === 0 || item.week_start > all[i - 1].week_start))) invalid();
  if (!Array.isArray(data.weekday) || data.weekday.length !== 7 || !data.weekday.every((item: unknown, i: number) => object(item) && item.weekday === i && count(item.activity_count))) invalid();
  return data as Records;
}

export async function readRecords(fetcher: typeof fetch = fetch): Promise<Records> {
  return parseRecords(await request('/api/v1/showcase/statistics/records', {}, fetcher));
}

/** `2026-03-01` becomes `2026-03`. */
export const monthLabel = (monthStart: string): string => monthStart.slice(0, 7);

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

/** `2026-03-05` becomes `3 月 5 日`; a date outside `currentYear` keeps its year. Parsed as text, no time-zone shift. */
export function recordDate(date: string, currentYear?: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${currentYear !== undefined && year !== currentYear ? `${year} 年 ` : ''}${month} 月 ${day} 日`;
}

/** One plain sentence about a run: `3 月 5 日，5.0 km，用了 27:30`. */
export function recordSentence(run: FirstRun, currentYear?: number): string {
  const km = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(run.distance_m) / 1000);
  return `${recordDate(run.activity_date, currentYear)}，${km} km，用了 ${formatDuration(run.duration_seconds)}`;
}

/** A pace gain in words: `42 秒`, `1 分 5 秒`; empty when there is no real gain. */
export function gainWords(seconds: Metric): string {
  const n = Math.round(Number(seconds));
  if (seconds === null || !Number.isFinite(n) || n <= 0) return '';
  const minutes = Math.floor(n / 60), rest = n % 60;
  return minutes ? `${minutes} 分${rest ? ` ${rest} 秒` : ''}` : `${rest} 秒`;
}

/**
 * Presentation only: how much of the progress line the first→best segment fills, from 0.2 to 1.
 * A 25 % faster pace (relative to the first run) fills the whole line; no new metric is derived.
 */
export function progressSpan(firstPace: Metric, gain: Metric): number {
  const ratio = Number(gain) / Number(firstPace);
  if (firstPace === null || gain === null || !Number.isFinite(ratio) || ratio <= 0) return 0.2;
  return Math.min(1, 0.2 + (ratio / 0.25) * 0.8);
}

/** Kilometres as a bare number for a big figure (`451`, `1,234.5`); the unit is rendered separately. */
export const kmNumber = (metres: Metric): string => metres === null || !Number.isFinite(Number(metres)) ? '—'
  : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(Number(metres) / 1000);

/** `2025-01-12` becomes `2025 年 1 月`. */
export const recordMonth = (date: string): string => `${Number(date.slice(0, 4))} 年 ${Number(date.slice(5, 7))} 月`;
