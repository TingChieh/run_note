export type GoalPeriod = 'week' | 'month' | 'year';
/** Calendar boundaries use the account's timezone; the API assigns activity local dates. */
export function goalRange(period: GoalPeriod, timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => Number(parts.find(p => p.type === type)!.value);
  const start = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === 'month') start.setUTCDate(1);
  if (period === 'year') start.setUTCMonth(0, 1);
  const end = new Date(start);
  if (period === 'week') end.setUTCDate(end.getUTCDate() + 7);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  if (period === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
export function validGoal(value: string): number | null {
  if (!/^\d+(\.\d)?$/.test(value.trim())) return null;
  const result = Number(value);
  return result > 0 && result <= 100000 ? result : null;
}
export const goalStorageKey = (userId: string, period: GoalPeriod) => `runnote:goal:${userId}:${period}`;
