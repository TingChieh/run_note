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

interface DistanceStep {
  startDist: number;
  endDist: number;
  startTime: number;
  endTime: number;
}

interface DistanceTimeSeries {
  steps: DistanceStep[];
  totalDistanceM: number;
  totalMovingS: number;
}

/**
 * Builds monotonic distance steps from recorded track points:
 * - Pause boundaries (`segmentIndex` changes) add neither distance nor time.
 * - Stationary points within the same segment advance `cumMovingS` before the next moving step,
 *   so stationary dwell time stays at the distance where it occurred rather than being smeared
 *   across the subsequent moving segment.
 */
function buildRecordedSeries(points: RecordedTrackPoint[]): DistanceTimeSeries {
  if (points.length < 2) return { steps: [], totalDistanceM: 0, totalMovingS: 0 };
  const ordered = [...points].sort((a, b) =>
    a.segmentIndex !== b.segmentIndex ? a.segmentIndex - b.segmentIndex : a.recordedAtMs - b.recordedAtMs,
  );
  const steps: DistanceStep[] = [];
  let cumDist = 0;
  let cumMovingS = 0;

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (curr.segmentIndex !== prev.segmentIndex) continue;
    const deltaDist = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
    const deltaS = Math.max(0, (curr.recordedAtMs - prev.recordedAtMs) / 1000);
    if (deltaDist <= 0 && deltaS <= 0) continue;
    const prevDist = cumDist;
    const prevMovingS = cumMovingS;
    cumDist += deltaDist;
    cumMovingS += deltaS;
    if (deltaDist > 0) {
      steps.push({
        startDist: prevDist,
        endDist: cumDist,
        startTime: prevMovingS,
        endTime: cumMovingS,
      });
    }
  }
  return { steps, totalDistanceM: cumDist, totalMovingS: cumMovingS };
}

function interpolateMovingTime(series: DistanceTimeSeries, targetM: number): number {
  const { steps, totalDistanceM, totalMovingS } = series;
  if (steps.length === 0 || targetM <= 0) return 0;
  if (targetM >= totalDistanceM) return totalMovingS;
  let low = 0;
  let high = steps.length - 1;
  // Find the first step whose `endDist >= targetM` so exact boundary crossings report arrival time.
  while (low < high) {
    const mid = (low + high) >> 1;
    if (steps[mid].endDist < targetM) low = mid + 1;
    else high = mid;
  }
  const step = steps[low];
  if (targetM <= step.startDist) return step.startTime;
  const span = step.endDist - step.startDist;
  const ratio = span > 0 ? (targetM - step.startDist) / span : 0;
  return step.startTime + (step.endTime - step.startTime) * ratio;
}

/**
 * Formats a partial final split distance (`100 m <= remainder < 1000 m`) so it never rounds up
 * to look like a completed full kilometre index (`950–999 m` renders as `0.95`–`0.99`).
 */
export function formatPartialSplitLabel(remainderM: number): string {
  const roundedTenths = Math.round(remainderM / 100) / 10;
  if (roundedTenths < 1) return roundedTenths.toFixed(1);
  return Math.min(0.99, Math.floor(remainderM / 10) / 100).toFixed(2);
}

/**
 * Extracts client-side preview per-kilometre splits strictly from recorded GPS points.
 * Authoritative totals still come from the backend PostGIS pipeline after upload.
 */
export function extractRecordedSplits(points: RecordedTrackPoint[]): KmSplit[] {
  const series = buildRecordedSeries(points);
  if (series.steps.length === 0 || series.totalDistanceM < 100) return [];

  const fullKms = Math.floor(series.totalDistanceM / 1000);
  const remainder = series.totalDistanceM - fullKms * 1000;
  const boundaries: { distanceM: number; cumulativeM: number; label: string }[] = [];
  for (let km = 1; km <= fullKms; km++) {
    boundaries.push({ distanceM: 1000, cumulativeM: km * 1000, label: String(km) });
  }
  if (remainder >= 100) {
    boundaries.push({
      distanceM: remainder,
      cumulativeM: series.totalDistanceM,
      label: formatPartialSplitLabel(remainder),
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
  const fullValid = valid.filter((r) => r.distanceM === 1000);
  if (valid.length >= 2) {
    const speeds = valid.map((r) => 1 / r.paceSecondsPerKm!);
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);
    const spread = maxSpeed - minSpeed;
    const minFullPace = fullValid.length >= 2 ? Math.min(...fullValid.map((r) => r.paceSecondsPerKm!)) : null;
    const maxFullPace = fullValid.length >= 2 ? Math.max(...fullValid.map((r) => r.paceSecondsPerKm!)) : null;
    let fastestMarked = false;
    for (const row of rows) {
      if (row.paceSecondsPerKm === null) {
        row.barRatio = 0;
        continue;
      }
      const speed = 1 / row.paceSecondsPerKm;
      row.barRatio = spread > 1e-7 ? 0.42 + ((speed - minSpeed) / spread) * 0.58 : 0.78;
      if (
        !fastestMarked &&
        row.distanceM === 1000 &&
        minFullPace !== null &&
        maxFullPace !== null &&
        maxFullPace - minFullPace >= 0.5 &&
        row.paceSecondsPerKm === minFullPace
      ) {
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
