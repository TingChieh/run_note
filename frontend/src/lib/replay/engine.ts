import type { ReplayData, ReplayMode } from '#lib/api/replay.ts';

export const REPLAY_SPEEDS = [1, 2, 5, 10] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'ended';
/** Playback state only; `time` is on the playback clock, not an index or a wall-clock time. */
export interface ReplayState {
  status: ReplayStatus;
  time: number;
  speed: ReplaySpeed;
}
/** Where the runner is at one moment of playback, interpolated between stored points. */
export interface ReplayPoint {
  lon: number;
  lat: number;
  elapsed: number;
  moving: number;
  distance: number;
  pace: number | null;
  /** Last stored point at or before this moment. */
  index: number;
  segment: number;
  /** Inside a signal gap between segments: time passes, the runner does not move. */
  gap: boolean;
}
export interface ReplayTrack {
  mode: ReplayMode;
  count: number;
  lon: Float64Array;
  lat: Float64Array;
  elapsed: Float64Array;
  moving: Float64Array;
  distance: Float64Array;
  /** NaN where no reliable pace exists. */
  pace: Float64Array;
  segment: Uint32Array;
  /** Playback clock at each point, in track seconds; a gap between segments lasts at most GAP_SCREEN_SECONDS on screen. */
  clock: Float64Array;
  segmentStarts: number[];
  duration: number;
  /** Track seconds per screen second at 1x, chosen so the whole replay takes playbackSeconds(). */
  rate: number;
  totals: { distance: number; elapsed: number; moving: number };
  interpolated: number;
  bounds: [number, number, number, number];
}
export interface DisplayLine {
  segment: number;
  coordinates: [number, number][];
  /** Stored point index of each display vertex, ascending. */
  indices: number[];
}

// A signal gap is a short visible pause, not minutes of a still marker.
export const GAP_SCREEN_SECONDS = 0.6;
export const MIN_PLAYBACK_SECONDS = 15;
export const MAX_PLAYBACK_SECONDS = 120;

/**
 * Screen time of a whole replay at 1x. Square-root growth keeps typical runs (about 20-75 minutes)
 * within 15-30 s while a marathon or a day-long hike still gets proportionally more time.
 */
export function playbackSeconds(trackSeconds: number): number {
  const scaled = 3.5 * Math.sqrt(Math.max(0, trackSeconds) / 60);
  return Math.min(MAX_PLAYBACK_SECONDS, Math.max(MIN_PLAYBACK_SECONDS, scaled));
}
// Enough vertices for a smooth line at any zoom of a single run, few enough to re-upload in a frame.
export const MAX_DISPLAY_VERTICES = 6000;

export function buildTrack(data: ReplayData): ReplayTrack {
  const count = data.segments.reduce((sum, s) => sum + s.coordinates.length, 0);
  // Pace the replay on time spent inside segments; signal gaps get their own fixed pause.
  const active = data.segments.reduce((sum, s) => sum + s.elapsed_s[s.elapsed_s.length - 1] - s.elapsed_s[0], 0);
  const rate = active > 0 ? active / playbackSeconds(active) : 1;
  const track: ReplayTrack = {
    mode: data.mode,
    count,
    lon: new Float64Array(count),
    lat: new Float64Array(count),
    elapsed: new Float64Array(count),
    moving: new Float64Array(count),
    distance: new Float64Array(count),
    pace: new Float64Array(count),
    segment: new Uint32Array(count),
    clock: new Float64Array(count),
    segmentStarts: [],
    duration: 0,
    rate,
    totals: { distance: data.distance_m, elapsed: data.elapsed_seconds, moving: data.moving_seconds },
    interpolated: data.interpolated_point_count,
    bounds: [Infinity, Infinity, -Infinity, -Infinity],
  };
  let i = 0;
  data.segments.forEach((segment, s) => {
    track.segmentStarts.push(i);
    segment.coordinates.forEach(([lon, lat], k) => {
      track.lon[i] = lon;
      track.lat[i] = lat;
      track.elapsed[i] = segment.elapsed_s[k];
      track.moving[i] = segment.moving_s[k];
      track.distance[i] = segment.distance_m[k];
      track.pace[i] = segment.pace_s_per_km?.[k] ?? NaN;
      track.segment[i] = s;
      if (i) {
        const step = track.elapsed[i] - track.elapsed[i - 1];
        track.clock[i] = track.clock[i - 1] + (k === 0 ? Math.min(step, GAP_SCREEN_SECONDS * rate) : step);
      }
      track.bounds[0] = Math.min(track.bounds[0], lon);
      track.bounds[1] = Math.min(track.bounds[1], lat);
      track.bounds[2] = Math.max(track.bounds[2], lon);
      track.bounds[3] = Math.max(track.bounds[3], lat);
      i++;
    });
  });
  track.duration = count ? track.clock[count - 1] : 0;
  return track;
}

/** Largest index whose value is <= target in an ascending array; checks `hint` and its successor first, as playback mostly moves forward. */
export function locate(values: ArrayLike<number>, target: number, hint = 0, end = values.length): number {
  if (end <= 0 || target < values[0]) return 0;
  if (hint >= 0 && hint < end && values[hint] <= target) {
    if (hint + 1 >= end || values[hint + 1] > target) return hint;
    if (hint + 2 >= end || values[hint + 2] > target) return hint + 1;
  }
  let low = 0,
    high = end - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (values[middle] <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function sampleAt(track: ReplayTrack, time: number, hint = 0): ReplayPoint {
  const last = track.count - 1;
  const t = Math.max(0, Math.min(time, track.duration));
  const i = locate(track.clock, t, hint);
  const at = (index: number, gap = false): ReplayPoint => ({
    lon: track.lon[index],
    lat: track.lat[index],
    elapsed: track.elapsed[index],
    moving: track.moving[index],
    distance: track.distance[index],
    pace: Number.isNaN(track.pace[index]) ? null : track.pace[index],
    index,
    segment: track.segment[index],
    gap,
  });
  if (i >= last) return at(last);
  const j = i + 1,
    span = track.clock[j] - track.clock[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (t - track.clock[i]) / span)) : 0;
  if (track.segment[j] !== track.segment[i]) {
    // Never draw movement across a signal gap: hold position, let the clock run.
    const point = at(i, true);
    point.elapsed = track.elapsed[i] + (track.elapsed[j] - track.elapsed[i]) * f;
    point.pace = null;
    return point;
  }
  const lerp = (values: Float64Array) => values[i] + (values[j] - values[i]) * f;
  const a = track.pace[i],
    b = track.pace[j];
  return {
    lon: lerp(track.lon),
    lat: lerp(track.lat),
    elapsed: lerp(track.elapsed),
    moving: lerp(track.moving),
    distance: lerp(track.distance),
    pace: Number.isNaN(a) ? (Number.isNaN(b) ? null : b) : Number.isNaN(b) ? a : a + (b - a) * f,
    index: i,
    segment: track.segment[i],
    gap: false,
  };
}

/** Per-segment display lines thinned by distance; the first and last point of each segment are always kept. */
export function displayLines(track: ReplayTrack, maxVertices = MAX_DISPLAY_VERTICES): DisplayLine[] {
  const spacing = track.count > maxVertices ? track.totals.distance / maxVertices : 0;
  return track.segmentStarts.map((start, s) => {
    const end = s + 1 < track.segmentStarts.length ? track.segmentStarts[s + 1] - 1 : track.count - 1;
    const indices = [start];
    for (let i = start + 1; i <= end; i++) {
      if (i === end || track.distance[i] - track.distance[indices[indices.length - 1]] >= spacing) indices.push(i);
    }
    return { segment: s, indices, coordinates: indices.map((i) => [track.lon[i], track.lat[i]] as [number, number]) };
  });
}

type EdgeGeometry =
  { type: 'LineString'; coordinates: [number, number][] } | { type: 'Point'; coordinates: [number, number] };
export interface DisplayEdges {
  /** One feature per display edge (a lone point for a one-point segment), ids 0..n-1 in route order for feature-state. */
  features: { type: 'Feature'; id: number; properties: Record<string, never>; geometry: EdgeGeometry }[];
  /** Stored point index each edge ends at, ascending. */
  ends: number[];
  segments: number[];
}

/**
 * Splits display lines into fixed edges. The travelled line is then drawn by switching each edge's
 * state, never by re-uploading growing geometry, which re-simplified and visibly shifted it.
 */
export function displayEdges(lines: DisplayLine[]): DisplayEdges {
  const edges: DisplayEdges = { features: [], ends: [], segments: [] };
  const add = (geometry: EdgeGeometry, end: number, segment: number) => {
    edges.features.push({ type: 'Feature', id: edges.features.length, properties: {}, geometry });
    edges.ends.push(end);
    edges.segments.push(segment);
  };
  for (const line of lines) {
    if (line.coordinates.length === 1)
      add({ type: 'Point', coordinates: line.coordinates[0] }, line.indices[0], line.segment);
    for (let k = 1; k < line.coordinates.length; k++)
      add(
        { type: 'LineString', coordinates: [line.coordinates[k - 1], line.coordinates[k]] },
        line.indices[k],
        line.segment,
      );
  }
  return edges;
}

/** Number of edges fully travelled once stored point `index` is reached. */
export function edgesThrough(ends: number[], index: number): number {
  return !ends.length || index < ends[0] ? 0 : locate(ends, index) + 1;
}

/** Stored points after `from` up to the sample, ending at the interpolated position: the short live tip of the progress line. */
export function tipCoordinates(track: ReplayTrack, from: number, point: ReplayPoint): [number, number][] {
  const coordinates: [number, number][] = [];
  for (let i = from; i <= point.index; i++) coordinates.push([track.lon[i], track.lat[i]]);
  coordinates.push([point.lon, point.lat]);
  return coordinates;
}
