import type { FootprintCollection } from './footprints.ts';

export interface Runner { user_id: string; avatar_version: string | null; username: string; display_name: string; distance_m: number; count: number; week_m: number; month_m: number }
export interface Recent { id: string; username: string; display_name: string; title: string; activity_date: string; distance_m: number; avg_pace_seconds_per_km: number | null }
export interface Together { distance_m: number; count: number; participants: Runner[]; recent: Recent[]; footprints: FootprintCollection }
export class TogetherError extends Error { constructor(message: string, public status = 502) { super(message); } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown) => number(v) && Number.isInteger(v);
const username = (v: unknown) => typeof v === 'string' && /^[a-z0-9_]{3,30}$/.test(v);
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const id = (v: unknown) => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
function invalid(): never { throw new TogetherError('一起跑步服务返回了无效响应'); }
export function parseTogether(value: unknown): Together {
  if (!object(value) || !number(value.distance_m) || !integer(value.count) || !Array.isArray(value.participants) || !Array.isArray(value.recent) || !Array.isArray(value.tracks)) return invalid();
  const participants: Runner[] = value.participants.map((p: unknown) => {
    if (!object(p) || !id(p.user_id) || !(p.avatar_version === null || typeof p.avatar_version === 'string' && /^[a-zA-Z0-9]+$/.test(p.avatar_version)) || !username(p.username) || typeof p.display_name !== 'string' || !number(p.distance_m) || !integer(p.count) || !number(p.week_m) || !number(p.month_m)) return invalid();
    return {user_id:p.user_id as string, avatar_version:p.avatar_version as string | null, username:p.username as string, display_name:p.display_name, distance_m:p.distance_m as number, count:p.count as number, week_m:p.week_m as number, month_m:p.month_m as number};
  });
  const names = new Set(participants.map(p=>p.username));
  const recent: Recent[] = value.recent.map((r: unknown) => {
    if (!object(r) || !id(r.id) || !username(r.username) || !names.has(r.username as string) || typeof r.display_name !== 'string' || typeof r.title !== 'string' || !date(r.activity_date) || !number(r.distance_m) || !(r.avg_pace_seconds_per_km === null || number(r.avg_pace_seconds_per_km))) return invalid();
    return {id:r.id as string, username:r.username as string, display_name:r.display_name, title:r.title, activity_date:r.activity_date as string, distance_m:r.distance_m as number, avg_pace_seconds_per_km:r.avg_pace_seconds_per_km as number | null};
  });
  const features = value.tracks.map((t: unknown) => {
    if (!object(t) || !username(t.username) || !names.has(t.username as string) || !id(t.activity_id) || typeof t.title !== 'string' || !date(t.activity_date) || !integer(t.segment_index) || !object(t.geometry) || t.geometry.type !== 'LineString' || !Array.isArray(t.geometry.coordinates) || t.geometry.coordinates.length < 2 || !t.geometry.coordinates.every((point: unknown) => Array.isArray(point) && point.length === 2 && typeof point[0] === 'number' && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 && typeof point[1] === 'number' && Number.isFinite(point[1]) && Math.abs(point[1]) <= 85)) return invalid();
    return {type:'Feature' as const, geometry:{type:'LineString' as const, coordinates:t.geometry.coordinates as [number,number][]}, properties:{username:t.username, activity_id:t.activity_id, title:t.title, activity_date:t.activity_date, segment_index:t.segment_index}};
  });
  return {distance_m:value.distance_m as number, count:value.count as number, participants, recent, footprints:{type:'FeatureCollection',scope:'all',mode:'tracks',features,activity_count:value.count as number,visible_activity_count:new Set(features.map(f=>f.properties.activity_id)).size,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0}};
}
export async function readTogether(signal: AbortSignal): Promise<Together> {
  let response: Response;
  try { response = await fetch('/api/v1/together', {cache:'no-store',signal}); } catch { throw new TogetherError('无法连接一起跑步服务',503); }
  let body: unknown;
  try { body=await response.json(); } catch { return invalid(); }
  if (response.status===401) throw new TogetherError('登录已过期',401);
  if (!response.ok || !object(body) || body.error) throw new TogetherError('无法读取一起跑步，请重试', response.status);
  return parseTogether(body.data);
}
