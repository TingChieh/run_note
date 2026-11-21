import { ActivityError, formatDuration, formatPace } from '#lib/api/activities.ts';
import { formatPeriodTitle, formatReportRange, type PeriodReport } from '#lib/api/period-report.ts';
import type { Trends } from '#lib/api/statistics.ts';

export type RecapPeriod =
  { period: 'year'; year: number; month: null } | { period: 'month'; year: number; month: number };

const dateAt = (year: number, month: number, day = 1) => new Date(Date.UTC(year, month - 1, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const dateFromIso = (value: string) => new Date(`${value}T00:00:00Z`);
const addDays = (date: Date, days: number) =>
  dateAt(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() + days);
export const monthDay = (date: string) => date.slice(5).replace('-', '.');

export function recapSelection(params: Pick<URLSearchParams, 'get'>, currentMonth: string): RecapPeriod {
  const [currentYear, monthNow] = currentMonth.split('-').map(Number);
  const yearParam = params.get('year') ?? '';
  const year = /^(19\d{2}|20\d{2}|2100)$/.test(yearParam) ? Number(yearParam) : currentYear;
  const monthParam = params.get('month') ?? '';
  const month = /^(0?[1-9]|1[0-2])$/.test(monthParam) ? Number(monthParam) : monthNow;
  return params.get('period') === 'month' ? { period: 'month', year, month } : { period: 'year', year, month: null };
}

export function recapHref({ period, year, month }: Pick<PeriodReport, 'period' | 'year' | 'month'>): string {
  return `/workspace/records/recap?period=${period}&year=${year}${period === 'month' ? `&month=${month}` : ''}`;
}

export function recapTitle({ period, year, month }: Pick<PeriodReport, 'period' | 'year' | 'month'>): string {
  return `${formatPeriodTitle(period, year, month)}跑步回顾`;
}

export function recapSlots({ period, year, month }: RecapPeriod) {
  const first = dateAt(year, month ?? 1);
  const last = dateAt(year, month === null ? 13 : month + 1);
  const slots = [];
  for (let cursor = first; cursor < last;) {
    const next =
      period === 'year' ? dateAt(year, cursor.getUTCMonth() + 2) : addDays(cursor, 7 - ((cursor.getUTCDay() + 6) % 7));
    const end = next < last ? next : last;
    slots.push({
      start: iso(cursor),
      end: iso(end),
      label: period === 'year' ? `${cursor.getUTCMonth() + 1}月` : `第${slots.length + 1}周`,
    });
    cursor = end;
  }
  return slots;
}

export const km = (metres: number) =>
  (metres / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function recapMetrics(report: PeriodReport) {
  return [
    { label: '跑步次数', value: report.activity_count.toLocaleString('zh-CN'), unit: '次' },
    { label: '跑步天数', value: report.activity_days.toLocaleString('zh-CN'), unit: '天' },
    { label: '总用时', value: formatDuration(report.duration_sum_seconds), unit: '' },
    {
      label: '平均配速',
      value: formatPace(report.avg_pace_seconds_per_km).replace(/ \/km$/, ''),
      unit: report.avg_pace_seconds_per_km === null ? '' : '/km',
    },
  ];
}

export function recapCoverage(report: PeriodReport): string {
  const notes = [];
  if (report.missing_duration_count) notes.push(`用时覆盖 ${report.known_duration_count}/${report.activity_count} 次`);
  if (report.pace_eligible_count < report.activity_count)
    notes.push(`配速覆盖 ${report.pace_eligible_count}/${report.activity_count} 次`);
  return notes.join(' · ');
}

export function buildRecap(report: PeriodReport, trends: Trends) {
  const selection: RecapPeriod =
    report.period === 'month'
      ? { period: 'month', year: report.year, month: report.month! }
      : { period: 'year', year: report.year, month: null };
  const slots = recapSlots(selection);
  const observed = slots.filter((slot) => slot.start < report.date_to);
  const total = Number(report.distance_m);
  const sum = trends.buckets.reduce((distance, bucket) => distance + Number(bucket.distance_m), 0);
  const outOfSync = () => new ActivityError('里程汇总已变化，请重试读取分布', 409, 'RECAP_TRENDS_MISMATCH');
  if (
    observed.length !== trends.buckets.length ||
    Math.abs(sum - total) > Math.max(0.001, total * Number.EPSILON * 16)
  ) {
    throw outOfSync();
  }
  const max = Math.max(0, ...trends.buckets.map((bucket) => Number(bucket.distance_m)));
  const buckets = slots.map((slot, index) => {
    const bucket = trends.buckets[index];
    const end = slot.end < report.date_to ? slot.end : report.date_to;
    if (bucket && (bucket.bucket_start !== slot.start || bucket.bucket_end !== end)) throw outOfSync();
    const distance = bucket ? Number(bucket.distance_m) : null;
    return {
      label: slot.label,
      start: slot.start,
      last: iso(addDays(dateFromIso(bucket ? end : slot.end), -1)),
      distance,
      peak: max > 0 && distance === max,
    };
  });
  return {
    ...selection,
    title: recapTitle(report),
    range: formatReportRange(report),
    cutoff: report.cutoff_date,
    distance: km(total),
    metrics: recapMetrics(report),
    coverage: recapCoverage(report),
    max,
    buckets,
  };
}

export type Recap = ReturnType<typeof buildRecap>;

export function recapFilename({ year, month }: Pick<Recap, 'year' | 'month'>) {
  return `runnote-recap-${year}${month === null ? '' : `-${String(month).padStart(2, '0')}`}.png`;
}

export function recapPeak(recap: Recap): string {
  const peaks = recap.buckets.filter((bucket) => bucket.peak);
  if (!peaks.length) return '';
  const labels = peaks.map((bucket) =>
    recap.period === 'month' ? `${monthDay(bucket.start)}–${monthDay(bucket.last)}` : bucket.label,
  );
  return `${peaks.length > 1 ? '并列峰值' : '峰值'} · ${labels.join('、')} · ${km(recap.max)} km`;
}
