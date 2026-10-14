import { request, ActivityError } from './activities';
export type GoalPeriod = 'week' | 'month' | 'year';
export type RunningGoals = Record<GoalPeriod, number | null>;
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
function invalidGoalResponse(): never { throw new ActivityError('目标服务返回了无效响应，请重试', 502, 'INVALID_RESPONSE'); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const targetValue = (value: unknown): value is number => typeof value === 'number' && validGoal(String(value)) !== null;
export async function readGoals(fetcher: typeof fetch = fetch): Promise<RunningGoals> {
  const data = await request('/api/v1/me/running-goals', {}, fetcher);
  if (!object(data)) invalidGoalResponse();
  for (const period of ['week', 'month', 'year']) if (data[period] !== null && !targetValue(data[period])) invalidGoalResponse();
  return { week: data.week as number | null, month: data.month as number | null, year: data.year as number | null };
}
export async function saveGoal(period: GoalPeriod, target: number, fetcher: typeof fetch = fetch): Promise<number> {
  if (!targetValue(target)) throw new ActivityError('请输入有效的目标公里数', 422);
  const csrf = await request('/api/v1/auth/csrf', {}, fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalidGoalResponse();
  const data = await request(`/api/v1/me/running-goals/${period}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token }, body: JSON.stringify({ target_km: target })
  }, fetcher);
  if (!object(data) || data.period !== period || !targetValue(data.target_km)) invalidGoalResponse();
  return data.target_km;
}
