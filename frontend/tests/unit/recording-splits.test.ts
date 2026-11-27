import { describe, expect, it } from 'vitest';
import type { RecordedTrackPoint } from '#lib/gpx-serializer.ts';
import { extractRecordedSplits, summarizeLiveSplit } from '#lib/recording-splits.ts';

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
});
