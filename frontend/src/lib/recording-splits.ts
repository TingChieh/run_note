import { haversineMeters, type RecordedTrackPoint } from './gpx-serializer.ts';
import type { KmSplit } from './api/activity-splits.ts';

export interface LiveSplitSummary {
  /** 1-based kilometre currently being run (e.g. 4 when distance is 3.42 km). */
  currentKm: number;
  /** Completed full kilometres so far. */
  completedFullKms: number;
  /** Pace in seconds/km for the most recently completed full kilometre, or null if < 1 km or invalid. */
  lastFullKmPaceSecondsPerKm: number | null;
}

interface DistanceTimeSeries {
  distances: number[];
  movingS: number[];
  totalDistanceM: number;
}

/**
 * Builds cumulative distance and moving-time arrays from recorded track points, keeping pause
 * boundaries (`segmentIndex` changes) strictly non-bridged in both distance and moving time.
 */
function buildRecordedSeries(points: RecordedTrackPoint[]): DistanceTimeSeries {
  if (points.length < 2) return { distances: [], movingS: [], totalDistanceM: 0 };
  const ordered = [...points].sort((a, b) =>
    a.segmentIndex !== b.segmentIndex ? a.segmentIndex - b.segmentIndex : a.recordedAtMs - b.recordedAtMs,
  );
  const distances: number[] = [0];
  const movingS: number[] = [0];
  let cumDist = 0;
  let cumMovingS = 0;

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (curr.segmentIndex !== prev.segmentIndex) continue;
    const deltaDist = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
    const deltaS = Math.max(0, (curr.recordedAtMs - prev.recordedAtMs) / 1000);
    if (deltaDist <= 0 && deltaS <= 0) continue;
    cumDist += deltaDist;
    cumMovingS += deltaS;
    if (cumDist > distances[distances.length - 1]) {
      distances.push(cumDist);
      movingS.push(cumMovingS);
    }
  }
  return { distances, movingS, totalDistanceM: cumDist };
}

function interpolateMovingTime(series: DistanceTimeSeries, targetM: number): number {
  const { distances, movingS, totalDistanceM } = series;
  if (targetM <= distances[0]) return movingS[0];
  if (targetM >= totalDistanceM) return movingS[movingS.length - 1];
  let low = 0;
  let high = distances.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (distances[mid] <= targetM) low = mid;
    else high = mid;
  }
  const span = distances[high] - distances[low];
  const ratio = span > 0 ? (targetM - distances[low]) / span : 0;
  return movingS[low] + (movingS[high] - movingS[low]) * ratio;
}

/**
 * Extracts client-side preview per-kilometre splits strictly from recorded GPS points.
 * Authoritative totals still come from the backend PostGIS pipeline after upload.
 */
export function extractRecordedSplits(points: RecordedTrackPoint[]): KmSplit[] {
  const series = buildRecordedSeries(points);
  if (series.distances.length < 2 || series.totalDistanceM < 100) return [];

  const fullKms = Math.floor(series.totalDistanceM / 1000);
  const remainder = series.totalDistanceM - fullKms * 1000;
  const boundaries: { distanceM: number; cumulativeM: number; label: string }[] = [];
  for (let km = 1; km <= fullKms; km++) {
    boundaries.push({ distanceM: 1000, cumulativeM: km * 1000, label: String(km) });
  }
  if (remainder >= 100) {
    const partialKm = Math.round(remainder / 100) / 10;
    boundaries.push({
      distanceM: remainder,
      cumulativeM: series.totalDistanceM,
      label: partialKm >= 1 ? String(fullKms + 1) : partialKm.toFixed(1),
    });
  }
  if (!boundaries.length) return [];

  let prevTime = interpolateMovingTime(series, 0);
  const rows: KmSplit[] = boundaries.map((b, idx) => {
    const cumTime = interpolateMovingTime(series, b.cumulativeM);
    const splitSeconds = Math.max(0, cumTime - prevTime);
    prevTime = cumTime;
    const pace = splitSeconds > 0 && b.distanceM > 0 ? splitSeconds / (b.distanceM / 1000) : null;
    const validPace = pace !== null && Number.isFinite(pace) && pace >= 60 && pace <= 3600 ? pace : null;
    return {
      index: idx + 1,
      label: b.label,
      distanceM: b.distanceM,
      cumulativeDistanceM: b.cumulativeM,
      splitSeconds,
      cumulativeSeconds: cumTime,
      paceSecondsPerKm: validPace,
      fastest: false,
      barRatio: 0.75,
    };
  });

  const valid = rows.filter((r) => r.paceSecondsPerKm !== null);
  if (valid.length >= 2) {
    const speeds = valid.map((r) => 1 / r.paceSecondsPerKm!);
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);
    const spread = maxSpeed - minSpeed;
    const minPace = Math.min(...valid.map((r) => r.paceSecondsPerKm!));
    const maxPace = Math.max(...valid.map((r) => r.paceSecondsPerKm!));
    let fastestMarked = false;
    for (const row of rows) {
      if (row.paceSecondsPerKm === null) {
        row.barRatio = 0;
        continue;
      }
      const speed = 1 / row.paceSecondsPerKm;
      row.barRatio = spread > 1e-7 ? 0.42 + ((speed - minSpeed) / spread) * 0.58 : 0.78;
      if (!fastestMarked && maxPace - minPace >= 0.5 && row.paceSecondsPerKm === minPace) {
        row.fastest = true;
        fastestMarked = true;
      }
    }
  } else if (valid.length === 1) {
    valid[0].barRatio = 0.78;
  }
  return rows;
}

/**
 * Derives live split context ("第 N 公里 · 上一公里 X:XX") from recorded points and preview distance.
 */
export function summarizeLiveSplit(previewDistanceM: number, points: RecordedTrackPoint[]): LiveSplitSummary {
  const safeDist = Number.isFinite(previewDistanceM) && previewDistanceM > 0 ? previewDistanceM : 0;
  const completedFullKms = Math.floor(safeDist / 1000);
  const currentKm = completedFullKms + 1;
  if (completedFullKms < 1 || points.length < 2) {
    return { currentKm, completedFullKms, lastFullKmPaceSecondsPerKm: null };
  }
  const splits = extractRecordedSplits(points);
  const lastFull = splits.find((row) => row.index === completedFullKms && row.distanceM === 1000);
  return {
    currentKm,
    completedFullKms,
    lastFullKmPaceSecondsPerKm: lastFull?.paceSecondsPerKm ?? null,
  };
}
