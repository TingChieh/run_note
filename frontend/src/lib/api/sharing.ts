import { ActivityError, calendarDate, number, request, type Metric } from './activities';
import type { Calendar, Summary } from './statistics';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface PublicActivity {
  id: string;
  title: string;
  activity_date: string;
  distance_m: Metric;
  elapsed_seconds: Metric;
  avg_pace_seconds_per_km: Metric;
  author: { username: string; display_name: string };
  has_shared_route: false;
}
export interface PublicProfile {
  username: string;
  display_name: string;
  bio: string;
  summary: Summary;
}
export interface PublicList {
  items: PublicActivity[];
  total: number;
  limit: number;
  offset: number;
}
export interface Share {
  link_id: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  status: 'active' | 'revoked' | 'expired';
}
export interface CreatedShare {
  link_id: string;
  share_url: string;
  expires_at: string | null;
}
function decimalMetric(value: unknown): value is Exclude<Metric, null> {
  return (typeof value === 'number' || typeof value === 'string') && number(value) !== null;
}
function invalidShare(): never {
  throw new ActivityError('分享服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE');
}
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parsePublicActivity(value: unknown): PublicActivity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActivityError('公开服务返回无效响应', 502);
  const v = value as Record<string, unknown>;
  const author = v.author;
  if (
    typeof v.id !== 'string' ||
    !uuid.test(v.id) ||
    typeof v.title !== 'string' ||
    !calendarDate(v.activity_date) ||
    !author ||
    typeof author !== 'object' ||
    Array.isArray(author) ||
    v.has_shared_route !== false
  )
    throw new ActivityError('公开服务返回无效响应', 502);
  const person = author as Record<string, unknown>;
  const distance = v.distance_m;
  const elapsed = v.elapsed_seconds;
  const pace = v.avg_pace_seconds_per_km;
  if (typeof person.username !== 'string' || typeof person.display_name !== 'string')
    throw new ActivityError('公开服务返回无效响应', 502);
  if (!decimalMetric(distance)) throw new ActivityError('公开指标无效', 502);
  if (elapsed !== null && !decimalMetric(elapsed)) throw new ActivityError('公开指标无效', 502);
  if (pace !== null && !decimalMetric(pace)) throw new ActivityError('公开指标无效', 502);
  // Construct only the public whitelist; do not propagate unexpected backend fields.
  return {
    id: v.id,
    title: v.title,
    activity_date: v.activity_date,
    distance_m: distance,
    elapsed_seconds: elapsed,
    avg_pace_seconds_per_km: pace,
    author: { username: person.username, display_name: person.display_name },
    has_shared_route: false,
  };
}
export function parseShares(value: unknown): { items: Share[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidShare();
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) invalidShare();
  return {
    items: items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) invalidShare();
      const row = item as Record<string, unknown>;
      const { link_id, created_at, expires_at, revoked_at, status } = row;
      if (typeof link_id !== 'string' || !uuid.test(link_id) || !instant(created_at)) invalidShare();
      if (expires_at !== null && !instant(expires_at)) invalidShare();
      if (revoked_at !== null && !instant(revoked_at)) invalidShare();
      if (status !== 'active' && status !== 'revoked' && status !== 'expired') invalidShare();
      return { link_id, created_at, expires_at, revoked_at, status };
    }),
  };
}
export async function sharingWrite<T>(
  path: string,
  method: 'PATCH' | 'POST' | 'DELETE',
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const csrf = (await request('/api/v1/auth/csrf', {}, fetcher)) as { csrf_token: string };
  if (typeof csrf?.csrf_token !== 'string') throw new ActivityError('无法确认操作权限，请重新登录', 403);
  return (await request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fetcher,
  )) as T;
}
export const readPublicActivity = async (path: string) => parsePublicActivity(await request(path, {}, fetch));
export const readProfile = async (username: string) =>
  (await request(`/api/v1/public/users/${encodeURIComponent(username)}`, {}, fetch)) as PublicProfile;
export const readPublicCalendar = async (username: string, year: number) =>
  (await request(`/api/v1/public/users/${encodeURIComponent(username)}/calendar?year=${year}`, {}, fetch)) as Calendar;
export async function readPublicList(username: string, offset: number, day: string | null): Promise<PublicList> {
  const v = (await request(
    `/api/v1/public/users/${encodeURIComponent(username)}/activities?limit=20&offset=${offset}${day ? `&activity_date=${day}` : ''}`,
    {},
    fetch,
  )) as PublicList;
  if (!Array.isArray(v?.items) || !Number.isInteger(v.total)) throw new ActivityError('公开列表无效', 502);
  return { ...v, items: v.items.map(parsePublicActivity) };
}
export async function readShares(id: string, fetcher: typeof fetch = fetch): Promise<{ items: Share[] }> {
  return parseShares(await request(`/api/v1/activities/${id}/shares`, {}, fetcher));
}
