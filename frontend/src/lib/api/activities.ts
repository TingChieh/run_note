import { dashboardDistance } from './dashboard-format';
export type Metric = number | string | null;
export interface Activity {
  id: string; title: string; activity_date: string; timezone: string;
  notes?: string; category?: string; tags?: string[];
  started_at: string | null; ended_at: string | null; distance_m: Metric; elapsed_seconds: Metric;
  timer_seconds?: Metric; calories_kcal?: number | null; steps?: number | null; avg_heart_rate_bpm?: number | null;
  avg_pace_seconds_per_km: Metric; temporal_quality: 'complete' | 'incomplete' | 'invalid' | 'manual';
  visibility: 'private' | 'unlisted' | 'public'; allow_shared_route: boolean;
  quality_summary: Record<string, unknown>; metrics_version: string; has_route: boolean; created_at: string;
}
export interface ActivityList { items: Activity[]; total: number; limit: number; offset: number }
export type Coordinate = [number, number];
export interface RouteFeature { type: 'Feature'; geometry: { type: 'LineString'; coordinates: Coordinate[] } | { type: 'Point'; coordinates: Coordinate }; properties: { segment_index: number; point_count: number } }
export interface Route { type: 'FeatureCollection'; features: RouteFeature[]; start: Coordinate; end: Coordinate }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export class ActivityError extends Error {
  constructor(message: string, public status: number, public code = 'REQUEST_FAILED', public existingActivityId: string | null = null) { super(message); }
}
function invalid(): never { throw new ActivityError('活动服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE'); }
const calendarDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function number(value: Metric): number | null {
  if (value === null || (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value))) return null;
  const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function parseActivity(value: unknown): Activity {
  if (!object(value) || typeof value.id !== 'string' || !uuid.test(value.id) || typeof value.title !== 'string' || !calendarDate(value.activity_date) || typeof value.timezone !== 'string' || typeof value.has_route !== 'boolean' || typeof value.metrics_version !== 'string' || !object(value.quality_summary) || !['complete', 'incomplete', 'invalid', 'manual'].includes(String(value.temporal_quality))) invalid();
  if (value.notes !== undefined && typeof value.notes !== 'string') invalid();
  if (value.category !== undefined && (typeof value.category !== 'string' || [...value.category].length > 30)) invalid();
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 10 || value.tags.some(tag => typeof tag !== 'string' || !tag.trim() || [...tag].length > 30))) invalid();
  for (const field of ['distance_m', 'elapsed_seconds', 'avg_pace_seconds_per_km']) {
    const metric = value[field];
    if (metric !== null && ((typeof metric !== 'number' && typeof metric !== 'string') || number(metric) === null)) invalid();
  }
  for (const field of ['started_at', 'ended_at', 'created_at']) {
    const timestamp = value[field];
    if (timestamp === null && field !== 'created_at') continue;
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) invalid();
  }
  if (value.timer_seconds !== undefined && value.timer_seconds !== null &&
      ((typeof value.timer_seconds !== 'number' && typeof value.timer_seconds !== 'string') || number(value.timer_seconds) === null || number(value.timer_seconds)! >= 1e9)) invalid();
  for (const field of ['calories_kcal', 'steps', 'avg_heart_rate_bpm']) {
    const metric = value[field];
    if (metric !== undefined && metric !== null && (typeof metric !== 'number' || !Number.isInteger(metric) || metric < (field === 'avg_heart_rate_bpm' ? 1 : 0) || metric > (field === 'avg_heart_rate_bpm' ? 300 : 999999999))) invalid();
  }
  return value as unknown as Activity;
}
export async function request(path: string, init: RequestInit, fetcher: typeof fetch, timeout = 8000): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(timeout) }); }
  catch { throw new ActivityError('无法连接活动服务，请稍后重试', 503, 'NETWORK_ERROR'); }
  if (response.status === 401) throw new ActivityError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED');
  let body: unknown;
  try { body = await response.json(); } catch { if (!response.ok) throw new ActivityError(`请求失败（${response.status}），请稍后重试`, response.status); invalid(); }
  if (!object(body)) invalid();
  if (!response.ok || body.error) {
    const error = object(body.error) ? body.error : {};
    let message = typeof error.message === 'string' ? error.message : `请求失败（${response.status}），请稍后重试`;
    const retry = response.headers.get('Retry-After');
    if (response.status === 429 && retry && /^\d+$/.test(retry)) message += `，请在 ${retry} 秒后重试`;
    const details = Array.isArray(error.details) && error.details.length === 1 && object(error.details[0]) ? error.details[0] : {};
    const id = response.status === 409 && ['raw', 'canonical'].includes(String(details.duplicate_kind)) && typeof details.existing_activity_id === 'string' && uuid.test(details.existing_activity_id) ? details.existing_activity_id : null;
    throw new ActivityError(message, response.status, typeof error.code === 'string' ? error.code : 'REQUEST_FAILED', id);
  }
  return body.data;
}
export async function readActivityCategories(fetcher: typeof fetch = fetch): Promise<string[]> {
  const value = await request('/api/v1/activities/categories', {}, fetcher);
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || [...item].length > 30) || new Set(value).size !== value.length) invalid();
  return value as string[];
}
export async function readActivities(fetcher: typeof fetch = fetch, offset = 0, activityDate?: string, category?: string, activityMonth?: string): Promise<ActivityList> {
  if (activityDate !== undefined && !calendarDate(activityDate)) invalid();
  if (activityMonth !== undefined && !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(activityMonth)) invalid();
  const value = await request(`/api/v1/activities?limit=20&offset=${offset}${activityDate ? `&activity_date=${activityDate}` : ''}${category === undefined ? '' : `&category=${encodeURIComponent(category)}`}${activityMonth ? `&activity_month=${activityMonth}` : ''}`, {}, fetcher);
  if (!object(value) || !Array.isArray(value.items) || !Number.isInteger(value.total) || (value.total as number) < 0 || value.limit !== 20 || value.offset !== offset) invalid();
  return { items: value.items.map(parseActivity), total: value.total as number, limit: 20, offset };
}
export async function readActivity(id: string, fetcher: typeof fetch = fetch): Promise<Activity> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  const value = parseActivity(await request(`/api/v1/activities/${id}`, {}, fetcher));
  if (value.id !== id) invalid(); return value;
}
async function mutateActivity(id: string, method: 'PATCH' | 'DELETE', body: unknown, fetcher: typeof fetch): Promise<unknown> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  const csrf = await request('/api/v1/auth/csrf', {}, fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  return request(`/api/v1/activities/${id}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }, fetcher);
}
export async function updateActivity(id: string, changes: { title: string; notes: string; category?: string; tags?: string[] }, fetcher: typeof fetch = fetch): Promise<Activity> {
  const value = parseActivity(await mutateActivity(id, 'PATCH', { title: changes.title, notes: changes.notes, ...(changes.category === undefined ? {} : { category: changes.category }), ...(changes.tags === undefined ? {} : { tags: changes.tags }) }, fetcher));
  if (value.id !== id || typeof value.notes !== 'string') invalid();
  return value;
}
export async function deleteActivity(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const value = await mutateActivity(id, 'DELETE', undefined, fetcher);
  if (!object(value) || value.deleted !== true) invalid();
}
export async function deleteActivities(ids: string[], fetcher: typeof fetch = fetch): Promise<void> {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) throw new ActivityError('请选择 1–100 条不同的记录', 422);
  const csrf = await request('/api/v1/auth/csrf', {}, fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  const value = await request('/api/v1/activities/batch-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token }, body: JSON.stringify({ ids })
  }, fetcher);
  if (!object(value) || value.deleted !== true || value.deleted_count !== ids.length) invalid();
}
export async function readRoute(id: string, fetcher: typeof fetch = fetch): Promise<Route> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  return unwrapRoute(await request(`/api/v1/activities/${id}/route`, {}, fetcher));
}
export const uploadGpx = (form: FormData, fetcher: typeof fetch = fetch) => uploadTrack(form, 'gpx', fetcher);
export const uploadTcx = (form: FormData, fetcher: typeof fetch = fetch) => uploadTrack(form, 'tcx', fetcher);
async function uploadTrack(form: FormData, format: 'gpx' | 'tcx', fetcher: typeof fetch): Promise<{ activity: Activity; warnings: string[] }> {
  const csrf = await request('/api/v1/auth/csrf', {}, fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  const value = await request(`/api/v1/${format}-imports`, { method: 'POST', headers: { 'X-CSRF-Token': csrf.csrf_token }, body: form }, fetcher, 45000);
  if (!object(value) || !Array.isArray(value.warnings) || !value.warnings.every(w => typeof w === 'string')) invalid();
  return { activity: parseActivity(value.activity), warnings: value.warnings };
}
export const activityDuration = (activity: Pick<Activity, 'timer_seconds' | 'elapsed_seconds'>): Metric => activity.timer_seconds ?? activity.elapsed_seconds;
export function formatStartTime(value: string | null, timezone: string): string {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)); }
  catch { return '—'; }
}
export const formatDate = (value: string) => calendarDate(value) ? value : '—';
export const formatDistance = (value: Metric) => dashboardDistance(number(value));
export function formatDuration(value: Metric): string {
  const n = number(value); if (n === null) return '—';
  const seconds = Math.round(n), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
export const formatPace = (value: Metric) => number(value) === null ? '—' : `${formatDuration(value)} /km`;
export const qualityLabel = (value: Activity['temporal_quality']) => ({ complete: '时间完整', incomplete: '时间不完整', invalid: '时间无效', manual: '手动补录日期' })[value];
export function unwrapRoute(value: unknown): Route {
  const validCoordinate = (c: unknown): c is Coordinate => Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
  if (!object(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features) || !value.features.length || !validCoordinate(value.start) || !validCoordinate(value.end)) invalid();
  const anchor = value.start[0];
  const near = (c: Coordinate, longitude: number): Coordinate => [c[0] + Math.round((longitude - c[0]) / 360) * 360, c[1]];
  let previous = anchor;
  const features = value.features.map((f): RouteFeature => {
    if (!object(f) || f.type !== 'Feature' || !object(f.geometry) || !object(f.properties) || !Number.isInteger(f.properties.segment_index) || (f.properties.segment_index as number) < 0 || !Number.isInteger(f.properties.point_count)) invalid();
    const geometry = f.geometry;
    const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 ? geometry.coordinates : invalid();
    if (!points.every(validCoordinate) || points.length !== f.properties.point_count) invalid();
    const coordinates = points.map(c => { const result = near(c as Coordinate, previous); previous = result[0]; return result; });
    return { type: 'Feature', geometry: geometry.type === 'Point' ? { type: 'Point', coordinates: coordinates[0] } : { type: 'LineString', coordinates }, properties: { segment_index: f.properties.segment_index as number, point_count: points.length } };
  });
  return { type: 'FeatureCollection', features, start: near(value.start, anchor), end: near(value.end, previous) };
}

const warningLabels: Record<string, string> = {
  TRACK_TIME_INVALID: '轨迹时间顺序无效，设备汇总已单独保留', TRACK_TIME_INCOMPLETE: '轨迹时间不完整，设备汇总已单独保留',
  LOCAL_TIME_INTERPRETED: '已按所选时区的当地时间解释文件时间', DEVICE_TIMER_EXCEEDS_ELAPSED: '设备用时超过轨迹经过时间，请核对原记录',
  INVALID_COORDINATE: '已跳过无效坐标，并保留断点', SPEED_CHECK_UNAVAILABLE: '部分点缺少时间，无法完整检查速度',
  ELEVATION_UNAVAILABLE: '部分点缺少海拔', TIME_GAP: '相邻点时间间隔超过 300 秒，已分段', SPEED_JUMP: '相邻点速度超过 12 m/s，已分段',
  EMPTY_SEGMENT: '已跳过空轨迹段', TIME_INVALID: '时间顺序无效，用时与配速不可用', TIME_INCOMPLETE: '时间不完整，用时与配速不可用',
  ZERO_DISTANCE: '有效轨迹距离为零', PACE_UNAVAILABLE: '无法计算可靠的平均配速'
};
export const warningLabel = (value: string): string => warningLabels[value] ?? value;
const qualityLabels: Record<string, string> = {
  time_interpretation: '时间解释', distance_source: '距离来源', duration_source: '用时来源', route_distance_m: '轨迹计算距离（米）',
  input_point_count: '源轨迹点', input_segment_count: '源轨迹段', empty_segment_count: '空轨迹段',
  invalid_coordinate_count: '无效坐标点', missing_time_count: '缺失时间点', missing_elevation_count: '缺失海拔点',
  deduplicated_point_count: '去除的重复点', time_reversal_count: '时间倒序断点', zero_time_movement_count: '零时间移动断点',
  time_gap_count: '时间间隔断点', speed_jump_count: '异常速度断点', valid_point_count: '有效轨迹点', derived_segment_count: '有效轨迹段'
};
export function qualityEntries(value: Record<string, unknown>): [string, string][] {
  return Object.entries(value).map(([key, item]) => [key === 'warnings' ? '质量提示' : qualityLabels[key] ?? key,
    key === 'warnings' && Array.isArray(item) ? item.map(code => warningLabel(String(code))).join('；') || '无' : typeof item === 'string' ? ({ local: '按所选时区当地时间', absolute: '遵守文件时区', device: '设备汇总', route: '轨迹计算', track_timestamps: '轨迹时间差' } as Record<string,string>)[item] ?? item : JSON.stringify(item)]);
}
