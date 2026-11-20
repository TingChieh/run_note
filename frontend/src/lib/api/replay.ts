import { ActivityError, request } from './activities.ts';
import { showcasePath } from './showcase.ts';

export type ReplayMode = 'real' | 'simulated';
export interface ReplaySegmentData {
  segment_index: number;
  coordinates: [number, number][];
  elapsed_s: number[];
  moving_s: number[];
  distance_m: number[];
  pace_s_per_km: (number | null)[] | null;
}
export interface ReplayData {
  mode: ReplayMode;
  point_count: number;
  interpolated_point_count: number;
  distance_m: number;
  elapsed_seconds: number;
  moving_seconds: number;
  segments: ReplaySegmentData[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The parser's own ceiling; the importer already rejects anything larger.
const MAX_POINTS = 50000;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function invalid(): never {
  throw new ActivityError('回放数据无效，请刷新重试', 502, 'INVALID_RESPONSE');
}
function count(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : invalid();
}

/** Checks every field and ordering the player relies on; longitudes are unwrapped like routes so the antimeridian draws continuously. */
export function parseReplay(value: unknown): ReplayData {
  if (
    !object(value) ||
    (value.mode !== 'real' && value.mode !== 'simulated') ||
    !Array.isArray(value.segments) ||
    !value.segments.length
  )
    invalid();
  const mode = value.mode,
    points = count(value.point_count),
    interpolated = count(value.interpolated_point_count);
  if (points > MAX_POINTS || interpolated > points) invalid();
  const totals = [value.distance_m, value.elapsed_seconds, value.moving_seconds];
  if (!totals.every((total) => finite(total) && total >= 0)) invalid();
  let seen = 0,
    lastIndex = -1,
    lastElapsed = 0,
    lastMoving = 0,
    lastDistance = 0,
    previousLon: number | null = null;
  const segments = value.segments.map((raw): ReplaySegmentData => {
    if (!object(raw) || !Number.isInteger(raw.segment_index) || (raw.segment_index as number) <= lastIndex) invalid();
    const { coordinates, elapsed_s, moving_s, distance_m, pace_s_per_km } = raw;
    if (
      !Array.isArray(coordinates) ||
      !coordinates.length ||
      !Array.isArray(elapsed_s) ||
      !Array.isArray(moving_s) ||
      !Array.isArray(distance_m)
    )
      invalid();
    const length = coordinates.length;
    if (elapsed_s.length !== length || moving_s.length !== length || distance_m.length !== length) invalid();
    if (mode === 'real' ? !Array.isArray(pace_s_per_km) || pace_s_per_km.length !== length : pace_s_per_km !== null)
      invalid();
    const paces = Array.isArray(pace_s_per_km) ? pace_s_per_km : null;
    seen += length;
    if (seen > points) invalid();
    const lonLat: [number, number][] = [];
    for (let i = 0; i < length; i++) {
      const c = coordinates[i],
        elapsed = elapsed_s[i],
        moving = moving_s[i],
        distance = distance_m[i];
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !finite(c[0]) ||
        !finite(c[1]) ||
        Math.abs(c[0]) > 180 ||
        Math.abs(c[1]) > 90
      )
        invalid();
      if (
        !finite(elapsed) ||
        !finite(moving) ||
        !finite(distance) ||
        elapsed < lastElapsed ||
        moving < lastMoving ||
        distance < lastDistance
      )
        invalid();
      const pace = paces?.[i];
      if (pace !== undefined && pace !== null && (!finite(pace) || pace <= 0)) invalid();
      const lon: number = previousLon === null ? c[0] : c[0] + Math.round((previousLon - c[0]) / 360) * 360;
      lonLat.push([lon, c[1]]);
      previousLon = lon;
      lastElapsed = elapsed;
      lastMoving = moving;
      lastDistance = distance;
    }
    lastIndex = raw.segment_index as number;
    return {
      segment_index: lastIndex,
      coordinates: lonLat,
      elapsed_s: elapsed_s as number[],
      moving_s: moving_s as number[],
      distance_m: distance_m as number[],
      pace_s_per_km: paces as (number | null)[] | null,
    };
  });
  if (seen !== points) invalid();
  return {
    mode,
    point_count: points,
    interpolated_point_count: interpolated,
    distance_m: value.distance_m as number,
    elapsed_seconds: value.elapsed_seconds as number,
    moving_seconds: value.moving_seconds as number,
    segments,
  };
}

export async function readReplay(id: string, fetcher: typeof fetch = fetch): Promise<ReplayData> {
  if (!uuid.test(id)) throw new ActivityError('找不到这条活动', 404);
  // A 50,000-point track is a few megabytes of JSON; allow longer than the 8 s detail reads.
  return parseReplay(await request(showcasePath(`/api/v1/activities/${id}/replay`), {}, fetcher, 30000));
}
