import { ActivityError, request, type Metric } from './activities';
import type { Calendar, Summary } from './statistics';
export interface PublicActivity { id: string; title: string; activity_date: string; distance_m: Metric; elapsed_seconds: Metric; avg_pace_seconds_per_km: Metric; author: { username: string; display_name: string }; has_shared_route: false }
export interface PublicProfile { username: string; display_name: string; bio: string; summary: Summary }
export interface PublicList { items: PublicActivity[]; total: number; limit: number; offset: number }
export interface Share { link_id: string; created_at: string; expires_at: string | null; revoked_at: string | null; status: 'active' | 'revoked' | 'expired' }
export interface CreatedShare { link_id: string; share_url: string; expires_at: string | null }
export function parsePublicActivity(value: unknown): PublicActivity {
  const v = value as PublicActivity;
  if (!v || typeof v.id !== 'string' || typeof v.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.activity_date) || typeof v.author?.username !== 'string' || typeof v.author?.display_name !== 'string' || v.has_shared_route !== false) throw new ActivityError('公开服务返回无效响应',502);
  for (const key of ['distance_m','elapsed_seconds','avg_pace_seconds_per_km'] as const) {
    const n = v[key];
    if (n === null && key !== 'distance_m') continue;
    if ((typeof n !== 'number' && typeof n !== 'string') || n === '' || !Number.isFinite(Number(n)) || Number(n) < 0) throw new ActivityError('公开指标无效',502);
  }
  // Construct only the public whitelist; do not propagate unexpected backend fields.
  return { id:v.id,title:v.title,activity_date:v.activity_date,distance_m:v.distance_m,elapsed_seconds:v.elapsed_seconds,avg_pace_seconds_per_km:v.avg_pace_seconds_per_km,author:{username:v.author.username,display_name:v.author.display_name},has_shared_route:false };
}
export async function sharingWrite<T>(path: string, method: 'PATCH' | 'POST' | 'DELETE', body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  const csrf = await request('/api/v1/auth/csrf',{},fetcher) as {csrf_token:string};
  if (typeof csrf?.csrf_token !== 'string') throw new ActivityError('无法确认操作权限，请重新登录',403);
  return await request(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token},...(body === undefined ? {} : {body:JSON.stringify(body)})},fetcher) as T;
}
export const readPublicActivity = async (path: string) => parsePublicActivity(await request(path,{},fetch));
export const readProfile = async (username: string) => await request(`/api/v1/public/users/${encodeURIComponent(username)}`,{},fetch) as PublicProfile;
export const readPublicCalendar = async (username: string, year: number) => await request(`/api/v1/public/users/${encodeURIComponent(username)}/calendar?year=${year}`,{},fetch) as Calendar;
export async function readPublicList(username: string, offset: number, day: string | null): Promise<PublicList> {
  const v = await request(`/api/v1/public/users/${encodeURIComponent(username)}/activities?limit=20&offset=${offset}${day ? `&activity_date=${day}` : ''}`,{},fetch) as PublicList;
  if (!Array.isArray(v?.items) || !Number.isInteger(v.total)) throw new ActivityError('公开列表无效',502);
  return {...v,items:v.items.map(parsePublicActivity)};
}
export const readShares = async (id: string) => await request(`/api/v1/activities/${id}/shares`,{},fetch) as {items:Share[]};
