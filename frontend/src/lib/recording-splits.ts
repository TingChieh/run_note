import { haversineMeters, type RecordedTrackPoint } from '#lib/gpx-serializer.ts';

export interface RecordedKmSplit {
  index: number;
  label: string;
  distanceM: number;
  cumulativeDistanceM: number;
  splitSeconds: number;
  cumulativeSeconds: number;
  paceSecondsPerKm: number | null;
  isFullKm: boolean;
  fastest: boolean;
  barRatio: number;
}

export interface LiveSplitSummary {
  currentKm: number;
  completedKmCount: number;
  lastCompletedKm: number | null;
  lastCompletedPaceSecondsPerKm: number | null;
}

const FULL_KM_M = 1000;
const MIN_PARTIAL_SPLIT_M = 100;
const MIN_VALID_PACE_S_PER_KM = 60;
const MAX_VALID_PACE_S_PER_KM = 3600;
const FASTEST_SPREAD_THRESHOLD_S = 0.5;

function isValidPoint(pt: RecordedTrackPoint): boolean {
  return (
    Number.isFinite(pt.lat) &&
    Number.isFinite(pt.lon) &&
    pt.lat >= -90 &&
    pt.lat <= 90 &&
    pt.lon >= -180 &&
    pt.lon <= 180 &&
    Number.isFinite(pt.recordedAtMs) &&
    pt.recordedAtMs > 0 &&
    Number.isInteger(pt.segmentIndex) &&
    pt.segmentIndex >= 0
  );
}

/**
 * Formats a partial tail segment distance (< 1000 m) without ever rounding 950–999 m into a full km.
 * - 100–949 m -> 1 decimal km (`0.1`..`0.9`)
 * - 950–999 m -> 2 decimals floored (`0.95`..`0.99`), never `"1"` or `"1.0"`.
 */
function formatPartialTailLabel(remainderM: number): string {
  const roundedM = Math.round(remainderM);
  if (roundedM >= 950) {
    const hundredths = Math.min(99, Math.max(95, Math.floor(roundedM / 10)));
    return (hundredths / 100).toFixed(2);
  }
  const tenths = Math.max(1, Math.min(9, Math.round(roundedM / 100)));
  return (tenths / 10).toFixed(1);
}

function normalizePace(splitSeconds: number, distanceM: number): number | null {
  if (!Number.isFinite(splitSeconds) || !Number.isFinite(distanceM) || splitSeconds <= 0 || distanceM <= 0) {
    return null;
  }
  const pace = splitSeconds / (distanceM / FULL_KM_M);
  if (!Number.isFinite(pace) || pace < MIN_VALID_PACE_S_PER_KM || pace > MAX_VALID_PACE_S_PER_KM) {
    return null;
  }
  return pace;
}

/**
 * Slices recorded GPS track points into per-kilometre preview splits for live recording and the
 * post-run completion receipt.
 *
 * Guarantees:
 * - Never bridges distance or pause duration across `segmentIndex` boundaries.
 * - Stationary intervals (`deltaM === 0` within a segment) accrue strictly at their current
 *   cumulative distance rather than being smeared across subsequent movement or km boundaries.
 * - Partial tail segments of 950–999 m remain `isFullKm = false` and are never labeled as a full km.
 * - The `fastest` flag compares full 1,000 m kilometres only; partial tail rows still receive a
 *   proportional `barRatio` for preview rendering.
 */
export function extractRecordedSplits(points: readonly RecordedTrackPoint[]): RecordedKmSplit[] {
  const valid = points.filter(isValidPoint);
  if (valid.length < 2) return [];

  // Preserve segment order and chronological order within each segment, matching serializeRecordingToGpx.
  const ordered = [...valid].sort((a, b) =>
    a.segmentIndex !== b.segmentIndex ? a.segmentIndex - b.segmentIndex : a.recordedAtMs - b.recordedAtMs,
  );

  const rows: RecordedKmSplit[] = [];
  let completedKms = 0;
  let cumDistanceM = 0;
  let cumSeconds = 0;
  let openDistanceM = 0;
  let openSeconds = 0;

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    // Pause/resume creates a new segmentIndex: never bridge distance or elapsed time across pauses.
    if (curr.segmentIndex !== prev.segmentIndex) continue;

    const deltaS = Math.max(0, (curr.recordedAtMs - prev.recordedAtMs) / 1000);
    const deltaM = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);

    if (deltaM <= 0) {
      // Stationary dwell stays strictly inside the current open split at the position it occurred.
      openSeconds += deltaS;
      cumSeconds += deltaS;
      continue;
    }

    let remainingM = deltaM;
    let remainingS = deltaS;

    while (openDistanceM + remainingM >= FULL_KM_M) {
      const needM = FULL_KM_M - openDistanceM;
      const ratio = remainingM > 0 ? needM / remainingM : 0;
      const partS = remainingS * ratio;

      const splitSeconds = openSeconds + partS;
      cumDistanceM += needM;
      cumSeconds += partS;
      completedKms += 1;

      rows.push({
        index: completedKms,
        label: String(completedKms),
        distanceM: FULL_KM_M,
        cumulativeDistanceM: completedKms * FULL_KM_M,
        splitSeconds,
        cumulativeSeconds: cumSeconds,
        paceSecondsPerKm: normalizePace(splitSeconds, FULL_KM_M),
        isFullKm: true,
        fastest: false,
        barRatio: 0,
      });

      remainingM -= needM;
      remainingS -= partS;
      openDistanceM = 0;
      openSeconds = 0;
    }

    if (remainingM > 0 || remainingS > 0) {
      openDistanceM += remainingM;
      openSeconds += remainingS;
      cumDistanceM += remainingM;
      cumSeconds += remainingS;
    }
  }

  if (openDistanceM >= MIN_PARTIAL_SPLIT_M) {
    rows.push({
      index: rows.length + 1,
      label: formatPartialTailLabel(openDistanceM),
      distanceM: openDistanceM,
      cumulativeDistanceM: cumDistanceM,
      splitSeconds: openSeconds,
      cumulativeSeconds: cumSeconds,
      paceSecondsPerKm: normalizePace(openSeconds, openDistanceM),
      isFullKm: false,
      fastest: false,
      barRatio: 0,
    });
  }

  if (rows.length === 0) return [];

  // Visual bar width compares all rows with a valid pace (full + partial preview).
  const validRows = rows.filter((row) => row.paceSecondsPerKm !== null);
  if (validRows.length >= 2) {
    const speeds = validRows.map((row) => 1 / row.paceSecondsPerKm!);
    const maxSpeed = Math.max(...speeds);
    const minSpeed = Math.min(...speeds);
    const spread = maxSpeed - minSpeed;
    for (const row of rows) {
      if (row.paceSecondsPerKm === null) {
        row.barRatio = 0;
        continue;
      }
      const speed = 1 / row.paceSecondsPerKm;
      row.barRatio = spread > 1e-7 ? 0.42 + ((speed - minSpeed) / spread) * 0.58 : 0.78;
    }
  } else if (validRows.length === 1) {
    validRows[0].barRatio = 0.78;
  }

  // Fastest-kilometre award strictly compares completed full 1,000 m kilometres only.
  const fullValid = rows.filter((row) => row.isFullKm && row.paceSecondsPerKm !== null);
  if (fullValid.length >= 2) {
    const minPace = Math.min(...fullValid.map((row) => row.paceSecondsPerKm!));
    const maxPace = Math.max(...fullValid.map((row) => row.paceSecondsPerKm!));
    if (maxPace - minPace >= FASTEST_SPREAD_THRESHOLD_S) {
      const winner = fullValid.find((row) => row.paceSecondsPerKm === minPace);
      if (winner) winner.fastest = true;
    }
  }

  return rows;
}

/**
 * Returns the fastest completed full-kilometre split for receipt summary lines.
 * Mirrors the table highlight (`row.fastest`): returns `null` when fewer than 2 full kilometres
 * have a valid pace or when the full-kilometre pace spread is < 0.5 s.
 */
export function findFastestFullSplit(splits: readonly RecordedKmSplit[]): RecordedKmSplit | null {
  return splits.find((row) => row.isFullKm && row.paceSecondsPerKm !== null && row.fastest) ?? null;
}

/**
 * Summarizes the live split hint shown during active recording / pause.
 * Only reports a previous-kilometre pace when the actual point set completes >= 1 full kilometre.
 */
export function summarizeLiveSplit(points: readonly RecordedTrackPoint[], previewDistanceM: number): LiveSplitSummary {
  const safeDist = Number.isFinite(previewDistanceM) && previewDistanceM > 0 ? previewDistanceM : 0;
  const splits = extractRecordedSplits(points);
  const fullCompleted = splits.filter((row) => row.isFullKm && row.paceSecondsPerKm !== null);
  const lastFull = fullCompleted.at(-1) ?? null;
  const completedKmCount = splits.filter((row) => row.isFullKm).length;
  const currentKm = Math.max(1, Math.floor(safeDist / FULL_KM_M) + 1);

  return {
    currentKm,
    completedKmCount,
    lastCompletedKm: lastFull?.index ?? null,
    lastCompletedPaceSecondsPerKm: lastFull?.paceSecondsPerKm ?? null,
  };
}
