import type { CalendarMetric, Trends } from './statistics';
export interface DashboardSelection { year: number; metric: CalendarMetric; period: Trends['period']; day: string | null }
export function dashboardSelection(query: URLSearchParams, defaultYear: number): DashboardSelection {
  const raw = query.get('year') ?? '', parsed = Number(raw);
  const year = /^\d{4}$/.test(raw) && parsed >= 1900 && parsed <= 2100 ? parsed : defaultYear;
  const date = query.get('day');
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(`${year}-`) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
  return { year, metric: query.get('metric') === 'count' ? 'count' : 'distance', period: query.get('period') === 'week' ? 'week' : 'month', day };
}
export function dashboardQuery(current: URLSearchParams, selection: DashboardSelection): URLSearchParams {
  const query = new URLSearchParams(current); query.set('year', String(selection.year)); query.set('metric', selection.metric); query.set('period', selection.period);
  if (selection.day) query.set('day', selection.day); else query.delete('day'); return query;
}
