import type { Coordinate, Metric, Route } from './activities.ts';

export type RouteSort = 'count' | 'recent' | 'distance';
export interface RouteGroupItem { id: string; run_count: number; first_date: string; last_date: string; median_distance_m: Metric; best_duration_seconds: Metric; avg_duration_seconds: Metric; best_pace_seconds_per_km: Metric; avg_pace_seconds_per_km: Metric; shape: Coordinate[][] }
export interface RouteGroupList { items: RouteGroupItem[]; total: number; limit: number; offset: number; building: boolean }
export interface RouteRun { activity_id: string; title: string; activity_date: string; distance_m: Metric; duration_seconds: Metric; avg_pace_seconds_per_km: Metric; coverage: number }
export interface RouteGroupDetail extends RouteGroupItem { runs: RouteRun[] }
export class RouteGroupError extends Error { constructor(message: string, public status = 422) { super(message); } }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid: () => never = () => { throw new RouteGroupError('路线服务返回了无效响应，请重试', 502); };
const calendarDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const count = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
function metric(v: unknown, nullable: boolean): Metric {
  if (v === null && nullable) return null;
  const parsed = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1e9) return invalid();
  return v as Metric;
}
function shape(v: unknown): Coordinate[][] {
  if (!Array.isArray(v) || v.length === 0) return invalid();
  return v.map(line => {
    if (!Array.isArray(line) || line.length < 2) return invalid();
    return line.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(x => typeof x !== 'number' || !Number.isFinite(x)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return invalid();
      return [point[0], point[1]] as Coordinate;
    });
  });
}
function parseItem(v: unknown): RouteGroupItem {
  if (!object(v) || typeof v.id !== 'string' || !uuid.test(v.id) || !count(v.run_count, 2) || !calendarDate(v.first_date) || !calendarDate(v.last_date) || v.first_date > v.last_date) return invalid();
  return { id: v.id, run_count: v.run_count, first_date: v.first_date, last_date: v.last_date, median_distance_m: metric(v.median_distance_m, false), best_duration_seconds: metric(v.best_duration_seconds, true), avg_duration_seconds: metric(v.avg_duration_seconds, true), best_pace_seconds_per_km: metric(v.best_pace_seconds_per_km, true), avg_pace_seconds_per_km: metric(v.avg_pace_seconds_per_km, true), shape: shape(v.shape) };
}
function parseRun(v: unknown): RouteRun {
  if (!object(v) || typeof v.activity_id !== 'string' || !uuid.test(v.activity_id) || typeof v.title !== 'string' || !calendarDate(v.activity_date) || typeof v.coverage !== 'number' || !(v.coverage >= 0 && v.coverage <= 1)) return invalid();
  return { activity_id: v.activity_id, title: v.title, activity_date: v.activity_date, distance_m: metric(v.distance_m, false), duration_seconds: metric(v.duration_seconds, true), avg_pace_seconds_per_km: metric(v.avg_pace_seconds_per_km, true), coverage: v.coverage };
}
export function parseRouteGroupList(v: unknown): RouteGroupList {
  if (!object(v) || !Array.isArray(v.items) || !count(v.total) || !count(v.limit, 1) || !count(v.offset) || typeof v.building !== 'boolean') return invalid();
  return { items: v.items.map(parseItem), total: v.total, limit: v.limit, offset: v.offset, building: v.building };
}
export function parseRouteGroupDetail(v: unknown): RouteGroupDetail {
  if (!object(v) || !Array.isArray(v.runs)) return invalid();
  return { ...parseItem(v), runs: v.runs.map(parseRun) };
}
/** A route-shaped view of a simplified group shape, for `routeDrawing` and `RouteMap`. */
export function shapeRoute(lines: Coordinate[][]): Route {
  const last = lines[lines.length - 1];
  return {
    type: 'FeatureCollection',
    features: lines.map((coordinates, segment_index) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { segment_index, point_count: coordinates.length } })),
    start: lines[0][0],
    end: last[last.length - 1]
  };
}
async function request(path: string, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin', signal });
  if (response.status === 401) throw new RouteGroupError('登录已过期', 401);
  let body: unknown;
  try { body = await response.json(); } catch { throw new RouteGroupError('无法读取常跑路线，请稍后重试', response.ok ? 502 : response.status); }
  if (!object(body)) return invalid();
  if (!response.ok || body.error) throw new RouteGroupError(object(body.error) && typeof body.error.message === 'string' ? body.error.message : '无法读取常跑路线，请稍后重试', response.status);
  return body.data;
}
export async function readRouteGroups(sort: RouteSort, limit: number, offset: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RouteGroupList> {
  const query = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
  return parseRouteGroupList(await request(`/api/v1/showcase/routes/groups?${query}`, signal, fetcher));
}
export async function readRouteGroup(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RouteGroupDetail> {
  if (!uuid.test(id)) throw new RouteGroupError('路线不存在', 404);
  return parseRouteGroupDetail(await request(`/api/v1/showcase/routes/groups/${id}`, signal, fetcher));
}
