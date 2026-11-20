import { ActivityError, request } from './activities';
import { parseSummary, type Summary } from './statistics';

export type ReportPeriod = 'month' | 'year';

export interface PeriodReport extends Summary {
  period: ReportPeriod;
  year: number;
  month: number | null;
  date_from: string;
  date_to: string;
  is_partial: boolean;
  cutoff_date: string | null;
  today: string;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isoDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function invalid(): never {
  throw new ActivityError('报告服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE');
}

function periodStartDate(period: ReportPeriod, year: number, month: number | null): string {
  return period === 'month' ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
}

function periodEndDate(period: ReportPeriod, year: number, month: number | null): string {
  if (period === 'year') return `${year + 1}-01-01`;
  const m = month!;
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

export function parsePeriodReport(v: unknown): PeriodReport {
  if (!object(v)) invalid();
  let base: Summary;
  try {
    base = parseSummary(v);
  } catch {
    invalid();
  }
  const { period, year, month, date_from, date_to, is_partial, cutoff_date, today } = v;
  if (period !== 'month' && period !== 'year') invalid();
  if (typeof year !== 'number' || !Number.isSafeInteger(year) || year < 1900 || year > 2100) invalid();
  if (period === 'month') {
    if (typeof month !== 'number' || !Number.isSafeInteger(month) || month < 1 || month > 12) invalid();
  } else if (month !== null) {
    invalid();
  }
  if (!isoDate(date_from) || !isoDate(date_to) || !isoDate(today)) invalid();
  if (typeof is_partial !== 'boolean') invalid();
  if (cutoff_date !== null && !isoDate(cutoff_date)) invalid();
  if (is_partial !== (cutoff_date !== null)) invalid();

  const expectedStart = periodStartDate(period, year, month as number | null);
  const expectedEnd = periodEndDate(period, year, month as number | null);
  if (date_from !== expectedStart || date_to < date_from || date_to > expectedEnd) invalid();
  if (is_partial && (cutoff_date! < date_from || cutoff_date! >= expectedEnd)) invalid();

  return {
    ...base,
    period,
    year,
    month: month as number | null,
    date_from,
    date_to,
    is_partial,
    cutoff_date: cutoff_date as string | null,
    today,
  };
}

export async function readPeriodReport(
  period: ReportPeriod,
  year: number,
  month?: number,
  fetcher: typeof fetch = fetch,
): Promise<PeriodReport> {
  const path =
    period === 'month'
      ? `/api/v1/showcase/statistics/report?period=month&year=${year}&month=${month}`
      : `/api/v1/showcase/statistics/report?period=year&year=${year}`;
  return parsePeriodReport(await request(path, {}, fetcher));
}

export function currentMonthValue(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export function shiftMonthValue(value: string, delta: number): string {
  const [year, month] = value.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  const clamped = Math.max(1900 * 12, Math.min(2100 * 12 + 11, total));
  const nextYear = Math.floor(clamped / 12);
  const nextMonth = (clamped % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function formatPeriodTitle(period: ReportPeriod, year: number, month: number | null): string {
  return period === 'month' && month !== null ? `${year} 年 ${month} 月` : `${year} 年`;
}

export function formatReportRange(
  report: Pick<PeriodReport, 'date_from' | 'date_to' | 'is_partial' | 'cutoff_date'>,
): string {
  if (report.date_from === report.date_to) return '尚未开始';
  if (report.is_partial && report.cutoff_date) return `${report.date_from} 至 ${report.cutoff_date}`;
  return `${report.date_from} 至 ${previousDay(report.date_to)}`;
}
