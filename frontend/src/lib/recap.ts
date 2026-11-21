import { ActivityError, formatDuration, formatPace } from '#lib/api/activities.ts';
import { formatPeriodTitle, formatReportRange, type PeriodReport } from '#lib/api/period-report.ts';
import type { TrendBucket, Trends } from '#lib/api/statistics.ts';

export type RecapPeriod =
  { period: 'year'; year: number; month: null } | { period: 'month'; year: number; month: number };

export const recapPosterStyles = [
  { id: 'editorial', code: 'A', name: '特刊', description: '深森绿封面与里程地形' },
  { id: 'telemetry', code: 'B', name: '环道', description: '中心环道仪表与分段读数' },
  { id: 'receipt', code: 'C', name: '存根', description: '三联锯齿票根与打孔节律' },
] as const;

export type RecapPosterStyle = (typeof recapPosterStyles)[number]['id'];

const MARATHON_M = 42195;
const TRACK_LAP_M = 400;

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

export function recapIssueTag({ period, year, month }: Pick<PeriodReport, 'period' | 'year' | 'month'>): string {
  return period === 'month' && month !== null
    ? `MONTHLY RECAP · ${year}.${String(month).padStart(2, '0')}`
    : `ANNUAL RECAP · ${year}`;
}

export function recapSlots({ period, year, month }: RecapPeriod) {
  const first = dateAt(year, month ?? 1);
  const last = dateAt(year, month === null ? 13 : month + 1);
  const slots: { start: string; end: string; label: string; shortLabel: string }[] = [];
  for (let cursor = first; cursor < last;) {
    const next =
      period === 'year' ? dateAt(year, cursor.getUTCMonth() + 2) : addDays(cursor, 7 - ((cursor.getUTCDay() + 6) % 7));
    const end = next < last ? next : last;
    const index: number = slots.length + 1;
    slots.push({
      start: iso(cursor),
      end: iso(end),
      label: period === 'year' ? `${cursor.getUTCMonth() + 1}月` : `第${index}周`,
      shortLabel: period === 'year' ? `${cursor.getUTCMonth() + 1}月` : `W${index}`,
    });
    cursor = end;
  }
  return slots;
}

export const km = (metres: number, digits = 2) =>
  (metres / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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

function finiteMetric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function eligibleBucketPace(bucket: TrendBucket | undefined): number | null {
  if (!bucket) return null;
  const distance = finiteMetric(bucket.distance_m);
  if (distance === null || distance <= 0) return null;
  const paceEligibleCount = bucket.pace_eligible_count;
  if (typeof paceEligibleCount === 'number' && paceEligibleCount <= 0) return null;
  const pace = finiteMetric(bucket.avg_pace_seconds_per_km);
  return pace !== null && pace > 0 ? pace : null;
}

export interface RecapBucket {
  label: string;
  shortLabel: string;
  start: string;
  last: string;
  rangeShort: string;
  future: boolean;
  partial: boolean;
  distance: number | null;
  cumulative: number | null;
  activityCount: number | null;
  activityDays: number | null;
  durationSeconds: number | null;
  knownDurationCount: number | null;
  missingDurationCount: number | null;
  paceEligibleCount: number | null;
  paceEligibleDistanceM: number | null;
  avgPaceSeconds: number | null;
  peak: boolean;
  fastest: boolean;
}

export interface RecapDerived {
  observedCount: number;
  activeCount: number;
  activeRatioText: string;
  activeRatioCompact: string;
  peakLabels: string[];
  peakLabel: string;
  peakTied: boolean;
  peakSharePct: number;
  fastestPace: number | null;
  slowestPace: number | null;
  fastestLabels: string[];
  fastestLabel: string;
  fastestTied: boolean;
  fastestPaceText: string;
  avgRunDistanceM: number | null;
  avgRunKmText: string;
  marathons: number;
  marathonsText: string;
  trackLaps: number;
  trackLapsText: string;
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
  const pacedValues = trends.buckets
    .map((bucket) => eligibleBucketPace(bucket))
    .filter((value): value is number => value !== null);
  const fastestPace = pacedValues.length ? Math.min(...pacedValues) : null;
  const slowestPace = pacedValues.length ? Math.max(...pacedValues) : null;

  let cumulative = 0;
  const buckets: RecapBucket[] = slots.map((slot, index) => {
    const bucket = trends.buckets[index];
    const end = slot.end < report.date_to ? slot.end : report.date_to;
    if (bucket && (bucket.bucket_start !== slot.start || bucket.bucket_end !== end)) throw outOfSync();
    const distance = bucket ? Number(bucket.distance_m) : null;
    if (distance !== null) cumulative += distance;
    const last = iso(addDays(dateFromIso(bucket ? end : slot.end), -1));
    const bucketPace = eligibleBucketPace(bucket);
    const activityCount = bucket ? safeCount(bucket.activity_count) : null;
    const activityDays = bucket ? safeCount(bucket.activity_days) : null;
    const knownDurationCount = bucket ? safeCount(bucket.known_duration_count) : null;
    const missingDurationCount = bucket ? safeCount(bucket.missing_duration_count) : null;
    const paceEligibleCount = bucket ? safeCount(bucket.pace_eligible_count) : null;
    const paceEligibleDistanceM = bucket ? (finiteMetric(bucket.pace_eligible_distance_m) ?? 0) : null;
    return {
      label: slot.label,
      shortLabel: slot.shortLabel,
      start: slot.start,
      last,
      rangeShort: selection.period === 'month' ? `${monthDay(slot.start)}–${monthDay(last)}` : slot.label,
      future: !bucket,
      partial: bucket ? Boolean(bucket.is_partial) : false,
      distance,
      cumulative: bucket ? cumulative : null,
      activityCount,
      activityDays,
      durationSeconds: bucket ? finiteMetric(bucket.duration_sum_seconds) : null,
      knownDurationCount,
      missingDurationCount,
      paceEligibleCount,
      paceEligibleDistanceM,
      avgPaceSeconds: bucket ? finiteMetric(bucket.avg_pace_seconds_per_km) : null,
      peak: max > 0 && distance === max,
      fastest: fastestPace !== null && bucketPace !== null && Math.abs(bucketPace - fastestPace) < 1e-6,
    };
  });

  const observedBuckets = buckets.filter((bucket) => !bucket.future);
  const activeBuckets = observedBuckets.filter(
    (bucket) => (bucket.activityCount ?? 0) > 0 || (bucket.distance ?? 0) > 0,
  );
  const peakLabels = observedBuckets.filter((bucket) => bucket.peak).map((bucket) => bucket.rangeShort);
  const fastestLabels = observedBuckets.filter((bucket) => bucket.fastest).map((bucket) => bucket.rangeShort);
  const avgRunDistanceM = report.activity_count > 0 && total > 0 ? total / report.activity_count : null;
  const marathons = total > 0 ? total / MARATHON_M : 0;
  const trackLaps = total > 0 ? Math.round(total / TRACK_LAP_M) : 0;

  const derived: RecapDerived = {
    observedCount: observedBuckets.length,
    activeCount: activeBuckets.length,
    activeRatioText: `${activeBuckets.length}/${observedBuckets.length} ${selection.period === 'year' ? '个月有开跑' : '周有开跑'}`,
    activeRatioCompact: `${activeBuckets.length}/${observedBuckets.length}`,
    peakLabels,
    peakLabel: peakLabels.join('、'),
    peakTied: peakLabels.length > 1,
    peakSharePct: total > 0 && max > 0 ? Math.round((max / total) * 100) : 0,
    fastestPace,
    slowestPace,
    fastestLabels,
    fastestLabel: fastestLabels.join('、'),
    fastestTied: fastestLabels.length > 1,
    fastestPaceText: fastestPace !== null ? formatPace(fastestPace) : '—',
    avgRunDistanceM,
    avgRunKmText: avgRunDistanceM !== null ? `${km(avgRunDistanceM, 1)} km` : '—',
    marathons,
    marathonsText:
      marathons > 0
        ? `${marathons >= 100 ? Math.round(marathons).toLocaleString('zh-CN') : marathons.toFixed(1)} 场全马`
        : '—',
    trackLaps,
    trackLapsText: trackLaps > 0 ? `${trackLaps.toLocaleString('zh-CN')} 圈` : '—',
  };

  return {
    ...selection,
    title: recapTitle(report),
    issueTag: recapIssueTag(report),
    range: formatReportRange(report),
    dateFrom: report.date_from,
    dateTo: report.date_to,
    isPartial: Boolean(report.is_partial),
    cutoff: report.cutoff_date,
    totalDistanceM: total,
    distance: km(total),
    activityCount: report.activity_count,
    activityDays: report.activity_days,
    durationSeconds: finiteMetric(report.duration_sum_seconds),
    avgPaceSeconds: finiteMetric(report.avg_pace_seconds_per_km),
    knownDurationCount: report.known_duration_count,
    missingDurationCount: report.missing_duration_count,
    paceEligibleCount: report.pace_eligible_count,
    paceEligibleDistanceM: finiteMetric(report.pace_eligible_distance_m) ?? 0,
    metrics: recapMetrics(report),
    coverage: recapCoverage(report),
    max,
    derived,
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
  const labels = peaks.map((bucket) => bucket.rangeShort);
  return `${peaks.length > 1 ? '并列峰值' : '峰值'} · ${labels.join('、')} · ${km(recap.max)} km`;
}

export function defaultRecapBucketIndex(recap: Recap): number {
  const peakIndex = recap.buckets.findIndex((bucket) => bucket.peak);
  if (peakIndex >= 0) return peakIndex;
  const lastObserved = recap.buckets.findLastIndex((bucket) => !bucket.future);
  return Math.max(0, lastObserved);
}
