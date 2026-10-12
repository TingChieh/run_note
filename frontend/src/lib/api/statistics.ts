import { ActivityError, request, type Metric } from './activities';
export type CalendarMetric = 'distance' | 'count';
export interface Summary {
  activity_count: number; distance_m: Metric; duration_sum_seconds: Metric; known_duration_count: number; missing_duration_count: number;
  activity_days: number; pace_eligible_count: number; pace_eligible_distance_m: Metric; avg_pace_seconds_per_km: Metric; quality_warning_count: number; date_assignment: 'activity_local_date';
}
export interface CalendarDay { date: string; activity_count: number; distance_m: Metric; duration_sum_seconds: Metric; known_duration_count: number; missing_duration_count: number }
export interface Calendar { year: number; metric: CalendarMetric; days: CalendarDay[]; activity_count: number; distance_m: Metric; date_assignment: 'activity_local_date' }
export interface TrendBucket extends Summary { bucket_start: string; bucket_end: string; is_partial: boolean }
export interface Trends { period: 'week' | 'month'; date_from: string; date_to: string; week_start: 'monday'; date_assignment: 'activity_local_date'; buckets: TrendBucket[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const metric = (v: unknown, nullable = false) => v === null ? nullable : (typeof v === 'number' || typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function invalid(): never { throw new ActivityError('统计服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE'); }
function base(v: unknown): v is Record<string, unknown> {
  return object(v) && ['activity_count','known_duration_count','missing_duration_count'].every(k => count(v[k])) && metric(v.distance_m) && metric(v.duration_sum_seconds, true) && Number(v.known_duration_count) + Number(v.missing_duration_count) === v.activity_count && (v.known_duration_count === 0 ? v.duration_sum_seconds === null : v.duration_sum_seconds !== null);
}
function summary(v: unknown): Summary {
  if (!base(v) || !['activity_days','pace_eligible_count','quality_warning_count'].every(k => count(v[k])) || !metric(v.pace_eligible_distance_m) || !metric(v.avg_pace_seconds_per_km, true) || v.date_assignment !== 'activity_local_date') invalid();
  return v as unknown as Summary;
}
export function currentYear(timezone: string, now = new Date()): number { return Number(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric' }).format(now)); }
export function calendarCells(year: number): (string | null)[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error('年份须为 1900–2100');
  const first = new Date(`${year}-01-01T00:00:00Z`), end = new Date(`${year + 1}-01-01T00:00:00Z`);
  const cells: (string | null)[] = Array((first.getUTCDay() + 6) % 7).fill(null);
  for (let d = first; d < end; d = new Date(d.getTime() + 86400000)) cells.push(d.toISOString().slice(0, 10));
  while (cells.length % 7) cells.push(null); return cells;
}
export async function readSummary(year?: number, fetcher: typeof fetch = fetch): Promise<Summary> {
  return summary(await request(`/api/v1/statistics/summary${year === undefined ? '' : `?date_from=${year}-01-01&date_to=${year + 1}-01-01`}`, {}, fetcher));
}
export async function readCalendar(year: number, selectedMetric: CalendarMetric, fetcher: typeof fetch = fetch): Promise<Calendar> {
  const dates = calendarCells(year).filter(Boolean), v = await request(`/api/v1/statistics/calendar?year=${year}&metric=${selectedMetric}`, {}, fetcher);
  if (!object(v) || v.year !== year || v.metric !== selectedMetric || v.date_assignment !== 'activity_local_date' || !count(v.activity_count) || !metric(v.distance_m) || !Array.isArray(v.days) || v.days.length !== dates.length || !v.days.every((day, i) => base(day) && day.date === dates[i])) invalid();
  return v as unknown as Calendar;
}
export async function readTrends(year: number, period: Trends['period'], fetcher: typeof fetch = fetch): Promise<Trends> {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`, v = await request(`/api/v1/statistics/trends?date_from=${from}&date_to=${to}&period=${period}`, {}, fetcher);
  if (!object(v) || v.period !== period || v.date_from !== from || v.date_to !== to || v.week_start !== 'monday' || v.date_assignment !== 'activity_local_date' || !Array.isArray(v.buckets) || !v.buckets.length) invalid();
  let cursor = from;
  for (const b of v.buckets) { summary(b); if (!object(b) || b.bucket_start !== cursor || typeof b.bucket_end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.bucket_end) || b.bucket_end <= cursor || b.bucket_end > to || typeof b.is_partial !== 'boolean') invalid(); cursor = b.bucket_end; }
  if (cursor !== to) invalid(); return v as unknown as Trends;
}
