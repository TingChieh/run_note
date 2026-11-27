import { describe, expect, it } from 'vitest';
import { haversineMeters, type RecordedTrackPoint } from '#lib/gpx-serializer.ts';
import { extractRecordedSplits, formatPartialSplitLabel, summarizeLiveSplit } from '#lib/recording-splits.ts';

function straightTrack(
  kmSegments: { km: number; paceSecPerKm: number; segmentIndex?: number; gapSecBefore?: number }[],
): RecordedTrackPoint[] {
  // ~0.0089932 deg latitude ≈ 1000 m along meridian
  const DEG_PER_KM = 1000 / 111_195;
  const points: RecordedTrackPoint[] = [];
  let lat = 31.23;
  let timeMs = Date.parse('2026-11-26T07:15:00Z');
  for (let s = 0; s < kmSegments.length; s++) {
    const seg = kmSegments[s];
    const segIdx = seg.segmentIndex ?? 0;
    if (seg.gapSecBefore) {
      timeMs += seg.gapSecBefore * 1000;
      lat += 0.01; // jump during pause must NOT add distance across different segments
    }
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      if (i === 0 && points.length > 0 && points[points.length - 1].segmentIndex === segIdx) continue;
      if (i > 0) {
        lat += (seg.km * DEG_PER_KM) / steps;
        timeMs += ((seg.km * seg.paceSecPerKm) / steps) * 1000;
      }
      points.push({
        lat,
        lon: 121.47,
        elevationM: 12,
        accuracyM: 6,
        recordedAtMs: Math.round(timeMs),
        segmentIndex: segIdx,
      });
    }
  }
  return points;
}

describe('recording-splits', () => {
  it('returns empty splits for short or empty tracks', () => {
    expect(extractRecordedSplits([])).toEqual([]);
    expect(
      extractRecordedSplits([
        { lat: 31.23, lon: 121.47, recordedAtMs: 1000, segmentIndex: 0 },
        { lat: 31.2301, lon: 121.47, recordedAtMs: 5000, segmentIndex: 0 },
      ]),
    ).toEqual([]);
  });

  it('extracts per-km splits, marks the fastest full km, and preserves partial final split', () => {
    const pts = straightTrack([
      { km: 1, paceSecPerKm: 340 },
      { km: 1, paceSecPerKm: 300 },
      { km: 0.5, paceSecPerKm: 330 },
    ]);
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(3);
    expect(splits.map((s) => s.label)).toEqual(['1', '2', '0.5']);
    expect(splits[0].fastest).toBe(false);
    expect(splits[1].fastest).toBe(true);
    expect(splits[1].barRatio).toBeCloseTo(1, 2);
    expect(splits[1].paceSecondsPerKm!).toBeGreaterThan(295);
    expect(splits[1].paceSecondsPerKm!).toBeLessThan(305);
  });

  it('excludes a faster partial final segment from the fastest-kilometre award while keeping its pace bar', () => {
    const pts = straightTrack([
      { km: 1, paceSecPerKm: 340 },
      { km: 1, paceSecPerKm: 300 },
      { km: 0.2, paceSecPerKm: 240 },
    ]);
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(3);
    expect(splits.map((s) => s.label)).toEqual(['1', '2', '0.2']);
    expect(splits[0].fastest).toBe(false);
    expect(splits[1].fastest).toBe(true);
    expect(splits[2].fastest).toBe(false);
    expect(splits[2].barRatio).toBeGreaterThan(0.9);
  });

  it('does not bridge distance or moving time across pause segments', () => {
    const pts = straightTrack([
      { km: 1, paceSecPerKm: 320, segmentIndex: 0 },
      { km: 1, paceSecPerKm: 340, segmentIndex: 1, gapSecBefore: 600 },
    ]);
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(2);
    expect(splits[0].paceSecondsPerKm!).toBeGreaterThan(315);
    expect(splits[0].paceSecondsPerKm!).toBeLessThan(325);
    expect(splits[1].paceSecondsPerKm!).toBeGreaterThan(335);
    expect(splits[1].paceSecondsPerKm!).toBeLessThan(345);
  });

  it('summarizes live split progress honestly without fabricating previous km pace under 1 km', () => {
    expect(summarizeLiveSplit(420, [])).toEqual({
      currentKm: 1,
      completedFullKms: 0,
      lastFullKmPaceSecondsPerKm: null,
    });
    const pts = straightTrack([
      { km: 1, paceSecPerKm: 330 },
      { km: 1, paceSecPerKm: 315 },
      { km: 0.4, paceSecPerKm: 325 },
    ]);
    const live = summarizeLiveSplit(2400, pts);
    expect(live.currentKm).toBe(3);
    expect(live.completedFullKms).toBe(2);
    expect(live.lastFullKmPaceSecondsPerKm).not.toBeNull();
    expect(live.lastFullKmPaceSecondsPerKm!).toBeGreaterThan(310);
    expect(live.lastFullKmPaceSecondsPerKm!).toBeLessThan(320);
  });

  it('keeps same-segment stationary time at the distance where it occurred instead of smearing it past 1 km', () => {
    const startLat = 31.23;
    const lon = 121.47;
    const metersPerDeg = haversineMeters(startLat, lon, startLat + 1, lon);
    const latAt = (meters: number) => startLat + meters / metersPerDeg;
    const t0 = Date.parse('2026-11-26T07:15:00Z');
    // 0 -> 900 m in 270 s, stand still 300 s at 900 m, then 900 -> 1010 m (+110 m) in 33 s (0.3 s/m).
    // First 1,000 m crosses at 270 + 300 + 33 * (100 / 110) = 600 s (NOT 572.727 s).
    const pts: RecordedTrackPoint[] = [
      { lat: latAt(0), lon, recordedAtMs: t0, segmentIndex: 0 },
      { lat: latAt(900), lon, recordedAtMs: t0 + 270_000, segmentIndex: 0 },
      { lat: latAt(900), lon, recordedAtMs: t0 + 570_000, segmentIndex: 0 },
      { lat: latAt(1010), lon, recordedAtMs: t0 + 603_000, segmentIndex: 0 },
    ];
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(1);
    expect(splits[0].distanceM).toBe(1000);
    expect(splits[0].splitSeconds).toBeCloseTo(600, 1);
    expect(splits[0].paceSecondsPerKm!).toBeCloseTo(600, 1);

    const live = summarizeLiveSplit(1010, pts);
    expect(live.completedFullKms).toBe(1);
    expect(live.lastFullKmPaceSecondsPerKm!).toBeCloseTo(600, 1);
  });

  it('excludes explicit pause duration across segmentIndex changes while preserving arrival times', () => {
    const startLat = 31.23;
    const lon = 121.47;
    const metersPerDeg = haversineMeters(startLat, lon, startLat + 1, lon);
    const latAt = (meters: number) => startLat + meters / metersPerDeg;
    const t0 = Date.parse('2026-11-26T07:15:00Z');
    // Segment 0: 0 -> 900 m in 270 s; explicit pause 600 s; Segment 1: 900 -> 1010 m in 33 s.
    // First 1,000 m should exclude the 600 s explicit pause: 270 + 30 = 300 s.
    const pts: RecordedTrackPoint[] = [
      { lat: latAt(0), lon, recordedAtMs: t0, segmentIndex: 0 },
      { lat: latAt(900), lon, recordedAtMs: t0 + 270_000, segmentIndex: 0 },
      { lat: latAt(900), lon, recordedAtMs: t0 + 870_000, segmentIndex: 1 },
      { lat: latAt(1010), lon, recordedAtMs: t0 + 903_000, segmentIndex: 1 },
    ];
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitSeconds).toBeCloseTo(300, 1);
    expect(summarizeLiveSplit(1010, pts).lastFullKmPaceSecondsPerKm!).toBeCloseTo(300, 1);
  });

  it('handles 7-decimal rounded native points shy of 1 km and resolves once the next point crosses 1 km', () => {
    const startLat = 31.23;
    const lon = 121.47;
    const metersPerDeg = haversineMeters(startLat, lon, startLat + 1, lon);
    const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
    const t0 = Date.parse('2026-11-26T07:15:00Z');
    const p0: RecordedTrackPoint = { lat: startLat, lon, recordedAtMs: t0, segmentIndex: 0 };
    const shyLat = round7(startLat + 999.9 / metersPerDeg);
    const p1: RecordedTrackPoint = { lat: shyLat, lon, recordedAtMs: t0 + 300_000, segmentIndex: 0 };
    expect(haversineMeters(p0.lat, p0.lon, p1.lat, p1.lon)).toBeLessThan(1000);
    // Native raw distance reported 1000.001 m, but rounded points fall shy of 1000 m.
    expect(summarizeLiveSplit(1000.001, [p0, p1]).lastFullKmPaceSecondsPerKm).toBeNull();
    // Next point within the same km pushes rounded points past 1000 m.
    const p2: RecordedTrackPoint = {
      lat: round7(startLat + 1012 / metersPerDeg),
      lon,
      recordedAtMs: t0 + 303_600,
      segmentIndex: 0,
    };
    const resolved = summarizeLiveSplit(1012, [p0, p1, p2]);
    expect(resolved.completedFullKms).toBe(1);
    expect(resolved.lastFullKmPaceSecondsPerKm!).toBeCloseTo(300, 1);
  });

  it('never labels a 950-999 m partial final segment as a full kilometre index', () => {
    expect(formatPartialSplitLabel(100)).toBe('0.1');
    expect(formatPartialSplitLabel(940)).toBe('0.9');
    expect(formatPartialSplitLabel(950)).toBe('0.95');
    expect(formatPartialSplitLabel(964)).toBe('0.96');
    expect(formatPartialSplitLabel(999)).toBe('0.99');
    expect(formatPartialSplitLabel(999.9)).toBe('0.99');

    const pts = straightTrack([
      { km: 1, paceSecPerKm: 330 },
      { km: 1, paceSecPerKm: 310 },
      { km: 0.96, paceSecPerKm: 280 },
    ]);
    const splits = extractRecordedSplits(pts);
    expect(splits).toHaveLength(3);
    expect(splits[0].label).toBe('1');
    expect(splits[1].label).toBe('2');
    expect(splits[2].label).toBe('0.96');
    expect(splits[2].label).not.toBe('3');
    expect(splits[1].fastest).toBe(true);
    expect(splits[2].fastest).toBe(false);
  });
});
