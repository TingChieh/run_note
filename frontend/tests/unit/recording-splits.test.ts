import { describe, expect, it } from 'vitest';
import { haversineMeters, type RecordedTrackPoint } from '#lib/gpx-serializer.ts';
import { extractRecordedSplits, findFastestFullSplit, summarizeLiveSplit } from '#lib/recording-splits.ts';

// ~111.195 m per 0.001 degree of latitude along a meridian.
const DEG_PER_METER_LAT = 1 / haversineMeters(31.23, 121.47, 32.23, 121.47);

function trackFromLegs(
  legs: { distanceM: number; durationS: number; segmentIndex?: number; steps?: number }[],
  startMs = 1_764_112_500_000,
): RecordedTrackPoint[] {
  const points: RecordedTrackPoint[] = [];
  let lat = 31.23;
  const lon = 121.47;
  let timeMs = startMs;

  let prevSeg: number | null = null;
  for (const leg of legs) {
    const seg = leg.segmentIndex ?? 0;
    const steps = Math.max(1, leg.steps ?? 1);
    if (prevSeg === null || seg !== prevSeg) {
      // Simulate a 5-minute pause gap between distinct segments, moving position slightly.
      if (prevSeg !== null) {
        timeMs += 300_000;
        lat += 200 * DEG_PER_METER_LAT;
      }
      points.push({ lat, lon, recordedAtMs: timeMs, segmentIndex: seg });
      prevSeg = seg;
    }
    for (let s = 0; s < steps; s += 1) {
      lat += (leg.distanceM / steps) * DEG_PER_METER_LAT;
      timeMs += (leg.durationS / steps) * 1000;
      points.push({ lat, lon, recordedAtMs: timeMs, segmentIndex: seg });
    }
  }
  return points;
}

describe('recording-splits', () => {
  it('handles empty, single-point, invalid, stationary, and short (<100m) tracks safely', () => {
    // Empty track
    expect(extractRecordedSplits([])).toEqual([]);
    expect(findFastestFullSplit([])).toBeNull();
    expect(summarizeLiveSplit([], 0)).toEqual({
      currentKm: 1,
      completedKmCount: 0,
      lastCompletedKm: null,
      lastCompletedPaceSecondsPerKm: null,
    });
    expect(summarizeLiveSplit([], Number.NaN).currentKm).toBe(1);
    expect(summarizeLiveSplit([], -50).currentKm).toBe(1);

    // Single valid point
    const singlePoint: RecordedTrackPoint[] = [
      { lat: 31.23, lon: 121.47, recordedAtMs: 1_764_112_500_000, segmentIndex: 0 },
    ];
    expect(extractRecordedSplits(singlePoint)).toEqual([]);
    expect(summarizeLiveSplit(singlePoint, 10)).toEqual({
      currentKm: 1,
      completedKmCount: 0,
      lastCompletedKm: null,
      lastCompletedPaceSecondsPerKm: null,
    });

    // Invalid points filtered out leaving < 2 valid points
    const invalidPoints: RecordedTrackPoint[] = [
      { lat: Number.NaN, lon: 121.47, recordedAtMs: 1_764_112_500_000, segmentIndex: 0 },
      { lat: 95, lon: 121.47, recordedAtMs: 1_764_112_510_000, segmentIndex: 0 },
      { lat: 31.23, lon: 200, recordedAtMs: 1_764_112_520_000, segmentIndex: 0 },
      { lat: 31.23, lon: 121.47, recordedAtMs: 0, segmentIndex: 0 },
      { lat: 31.23, lon: 121.47, recordedAtMs: 1_764_112_530_000, segmentIndex: -1 },
      { lat: 31.23, lon: 121.47, recordedAtMs: 1_764_112_540_000, segmentIndex: 0 },
    ];
    expect(extractRecordedSplits(invalidPoints)).toEqual([]);

    // Stationary-only track (0m moved)
    const stationary = trackFromLegs([{ distanceM: 0, durationS: 120, steps: 4 }]);
    expect(extractRecordedSplits(stationary)).toEqual([]);

    // Short tracks below MIN_PARTIAL_SPLIT_M (100m) produce no split noise
    for (const shortM of [50, 99]) {
      const shortTrack = trackFromLegs([{ distanceM: shortM, durationS: 30 }]);
      expect(extractRecordedSplits(shortTrack)).toEqual([]);
      expect(summarizeLiveSplit(shortTrack, shortM)).toEqual({
        currentKm: 1,
        completedKmCount: 0,
        lastCompletedKm: null,
        lastCompletedPaceSecondsPerKm: null,
      });
    }

    // Partial-only track (>= 100m and < 1000m): preview row only, no fastest full split
    const partialOnly = trackFromLegs([{ distanceM: 400, durationS: 120 }]);
    const partialSplits = extractRecordedSplits(partialOnly);
    expect(partialSplits).toHaveLength(1);
    expect(partialSplits[0]).toMatchObject({ label: '0.4', isFullKm: false, fastest: false });
    expect(findFastestFullSplit(partialSplits)).toBeNull();
  });

  it('keeps stationary dwell time strictly in the split where it occurred', () => {
    // km 1: run 800m in 240s, stand still for 60s at 800m, then run 400m (crossing 1000m) in 120s (300s/km).
    // Expected km 1 time: 240 + 60 + (200/400)*120 = 360s (6:00/km).
    // Remaining 200m of km 2: (200/400)*120 = 60s (5:00/km).
    const points = trackFromLegs([
      { distanceM: 800, durationS: 240 },
      { distanceM: 0, durationS: 60 },
      { distanceM: 400, durationS: 120 },
    ]);
    const splits = extractRecordedSplits(points);
    expect(splits).toHaveLength(2);
    expect(splits[0].isFullKm).toBe(true);
    expect(splits[0].label).toBe('1');
    expect(splits[0].splitSeconds).toBeCloseTo(360, 1);
    expect(splits[0].paceSecondsPerKm).toBeCloseTo(360, 1);

    expect(splits[1].isFullKm).toBe(false);
    expect(splits[1].label).toBe('0.2');
    expect(splits[1].splitSeconds).toBeCloseTo(60, 1);
    expect(splits[1].paceSecondsPerKm).toBeCloseTo(300, 1);
  });

  it('never bridges distance or pause duration across segmentIndex changes', () => {
    // Segment 0: 600m in 180s (5:00/km)
    // Pause (segment 1 starts 5 minutes later and 200m away — ignored!)
    // Segment 1: 400m in 120s (5:00/km) -> completes km 1 in 300s total (NOT 600s and NOT 1200m!)
    const points = trackFromLegs([
      { distanceM: 600, durationS: 180, segmentIndex: 0 },
      { distanceM: 400, durationS: 120, segmentIndex: 1 },
    ]);
    const splits = extractRecordedSplits(points);
    expect(splits).toHaveLength(1);
    expect(splits[0].isFullKm).toBe(true);
    expect(splits[0].label).toBe('1');
    expect(splits[0].splitSeconds).toBeCloseTo(300, 1);
    expect(splits[0].paceSecondsPerKm).toBeCloseTo(300, 1);
  });

  it('never mislabels a 950–999m tail segment as a full kilometre', () => {
    for (const tailM of [950, 975, 999]) {
      const points = trackFromLegs([
        { distanceM: 1000, durationS: 330 },
        { distanceM: tailM, durationS: Math.round((tailM / 1000) * 300) },
      ]);
      const splits = extractRecordedSplits(points);
      expect(splits).toHaveLength(2);
      expect(splits[0]).toMatchObject({ isFullKm: true, label: '1' });
      expect(splits[1].isFullKm).toBe(false);
      expect(splits[1].label).not.toBe('2');
      expect(splits[1].label).not.toBe('1');
      expect(splits[1].label).not.toBe('1.0');
      expect(splits[1].label).toMatch(/^0\.9[5-9]$/);
    }
  });

  it('compares only full kilometres when marking the fastest split', () => {
    // km 1: 5:30 (330s), km 2: 5:10 (310s), tail 200m sprint: 4:00/km (48s for 200m)
    const points = trackFromLegs([
      { distanceM: 1000, durationS: 330 },
      { distanceM: 1000, durationS: 310 },
      { distanceM: 200, durationS: 48 },
    ]);
    const splits = extractRecordedSplits(points);
    expect(splits).toHaveLength(3);
    expect(splits[0]).toMatchObject({ label: '1', isFullKm: true, fastest: false });
    expect(splits[1]).toMatchObject({ label: '2', isFullKm: true, fastest: true });
    expect(splits[2]).toMatchObject({ label: '0.2', isFullKm: false, fastest: false });
    // Partial row still gets a valid preview bar ratio.
    expect(splits[2].barRatio).toBeGreaterThan(0.5);

    const fastest = findFastestFullSplit(splits);
    expect(fastest?.label).toBe('2');
    expect(fastest?.isFullKm).toBe(true);
  });

  it('does not award fastest to a partial tail or summary when there is only 1 full kilometre', () => {
    const points = trackFromLegs([
      { distanceM: 1000, durationS: 330 },
      { distanceM: 250, durationS: 60 }, // 4:00/km partial sprint
    ]);
    const splits = extractRecordedSplits(points);
    expect(splits[0]).toMatchObject({ isFullKm: true, fastest: false });
    expect(splits[1]).toMatchObject({ isFullKm: false, fastest: false });
    expect(findFastestFullSplit(splits)).toBeNull();
  });

  it('keeps fastest summary and table highlight unified when full-km spread is < 0.5s vs >= 0.5s', () => {
    // Spread 0.3s (< 0.5s threshold): neither table nor summary marks a fastest split.
    const uniformPoints = trackFromLegs([
      { distanceM: 1000, durationS: 300.0 },
      { distanceM: 1000, durationS: 300.3 },
    ]);
    const uniformSplits = extractRecordedSplits(uniformPoints);
    expect(uniformSplits).toHaveLength(2);
    expect(uniformSplits.every((row) => !row.fastest)).toBe(true);
    expect(findFastestFullSplit(uniformSplits)).toBeNull();

    // Spread 0.6s (>= 0.5s threshold): both table and summary mark the exact same fastest split.
    const distinctPoints = trackFromLegs([
      { distanceM: 1000, durationS: 300.6 },
      { distanceM: 1000, durationS: 300.0 },
    ]);
    const distinctSplits = extractRecordedSplits(distinctPoints);
    expect(distinctSplits).toHaveLength(2);
    expect(distinctSplits[0].fastest).toBe(false);
    expect(distinctSplits[1].fastest).toBe(true);
    expect(findFastestFullSplit(distinctSplits)).toBe(distinctSplits[1]);
  });

  it('summarizes live split only when points genuinely complete a full km (including 7-decimal rounding)', () => {
    // 7-decimal rounded coordinates just shy of 1000m (999.9m) -> completedKmCount must be 0!
    const almostKm = trackFromLegs([{ distanceM: 999.9, durationS: 310 }]).map((pt) => ({
      ...pt,
      lat: Number(pt.lat.toFixed(7)),
      lon: Number(pt.lon.toFixed(7)),
    }));
    const beforeComplete = summarizeLiveSplit(almostKm, 1000.01);
    expect(beforeComplete.completedKmCount).toBe(0);
    expect(beforeComplete.lastCompletedKm).toBeNull();
    expect(beforeComplete.lastCompletedPaceSecondsPerKm).toBeNull();

    // Adding the next point pushes the 7-decimal point set past 1000m -> completed km 1 appears!
    const last = almostKm[almostKm.length - 1];
    const completed = [
      ...almostKm,
      {
        lat: Number((last.lat + 20 * DEG_PER_METER_LAT).toFixed(7)),
        lon: last.lon,
        recordedAtMs: last.recordedAtMs + 6_200,
        segmentIndex: 0,
      },
    ];
    const afterComplete = summarizeLiveSplit(completed, 1020);
    expect(afterComplete.currentKm).toBe(2);
    expect(afterComplete.completedKmCount).toBe(1);
    expect(afterComplete.lastCompletedKm).toBe(1);
    expect(afterComplete.lastCompletedPaceSecondsPerKm).toBeCloseTo(310, 0);
  });
});
