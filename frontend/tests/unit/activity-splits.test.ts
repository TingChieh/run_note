import { describe, expect, it } from 'vitest';
import {
  extractPaceSamples,
  extractSplits,
  formatReceiptDate,
  formatReceiptTimeRange,
  splitFigure,
  visibilityLabel,
} from '../../src/lib/api/activity-splits.ts';
import type { ReplayData } from '../../src/lib/api/replay.ts';

function makeReplay(pacesPerKm: number[], mode: 'real' | 'simulated' = 'real'): ReplayData {
  const coordinates: [number, number][] = [];
  const elapsed_s: number[] = [];
  const moving_s: number[] = [];
  const distance_m: number[] = [];
  const pace_s_per_km: (number | null)[] = [];
  let elapsed = 0;
  let dist = 0;
  // 10 points per km (every 100m)
  coordinates.push([121.48, 31.23]);
  elapsed_s.push(0);
  moving_s.push(0);
  distance_m.push(0);
  pace_s_per_km.push(null);
  for (let km = 0; km < pacesPerKm.length; km++) {
    const pace = pacesPerKm[km];
    for (let step = 1; step <= 10; step++) {
      dist += 100;
      elapsed += pace / 10;
      coordinates.push([121.48 + dist * 0.00001, 31.23]);
      elapsed_s.push(Math.round(elapsed * 10) / 10);
      moving_s.push(Math.round(elapsed * 10) / 10);
      distance_m.push(dist);
      pace_s_per_km.push(pace);
    }
  }
  return {
    mode,
    point_count: coordinates.length,
    interpolated_point_count: 0,
    distance_m: dist,
    elapsed_seconds: elapsed,
    moving_seconds: elapsed,
    segments: [
      {
        segment_index: 0,
        coordinates,
        elapsed_s,
        moving_s,
        distance_m,
        pace_s_per_km: mode === 'real' ? pace_s_per_km : null,
      },
    ],
  };
}

describe('activity-splits presentation helpers', () => {
  it('formats receipt date with weekday while preserving YYYY-MM-DD', () => {
    expect(formatReceiptDate('2026-10-13')).toBe('2026-10-13 周二');
    expect(formatReceiptDate('invalid')).toBe('—');
  });

  it('formats receipt time range in activity timezone', () => {
    expect(formatReceiptTimeRange('2026-10-13T00:00:00Z', '2026-10-13T00:30:00Z', 'Asia/Shanghai')).toBe(
      '08:00 — 08:30',
    );
    expect(formatReceiptTimeRange('2026-10-13T00:00:00Z', null, 'Asia/Shanghai')).toBe('08:00');
    expect(formatReceiptTimeRange(null, null, 'Asia/Shanghai')).toBe('');
  });

  it('maps visibility labels and splits formatted figures', () => {
    expect(visibilityLabel('private')).toBe('仅自己可见');
    expect(visibilityLabel('unlisted')).toBe('持链接可见');
    expect(visibilityLabel('public')).toBe('公开展示');
    expect(splitFigure('5.1 km')).toEqual({ number: '5.1', unit: 'km' });
    expect(splitFigure('—')).toEqual({ number: '—', unit: '' });
  });

  it('extracts per-km splits and highlights the fastest km only when paces differ', () => {
    const splits = extractSplits(makeReplay([358, 331, 350]));
    expect(splits).toHaveLength(3);
    expect(splits.map((s) => s.label)).toEqual(['1', '2', '3']);
    expect(Math.round(splits[0].paceSecondsPerKm!)).toBe(358);
    expect(Math.round(splits[1].paceSecondsPerKm!)).toBe(331);
    expect(splits[1].fastest).toBe(true);
    expect(splits[0].fastest).toBe(false);
    expect(splits[1].barRatio).toBeCloseTo(1, 2);
    expect(splits[0].barRatio).toBeLessThan(splits[1].barRatio);
  });

  it('does not mark an arbitrary fastest split when all km paces are identical', () => {
    const splits = extractSplits(makeReplay([340, 340]));
    expect(splits).toHaveLength(2);
    expect(splits.every((s) => !s.fastest)).toBe(true);
  });

  it('returns empty splits and pace samples for simulated replay', () => {
    const simulated = makeReplay([350, 340], 'simulated');
    expect(extractSplits(simulated)).toEqual([]);
    expect(extractPaceSamples(simulated)).toEqual([]);
  });

  it('downsamples long pace series to the configured cap', () => {
    const replay = makeReplay(Array.from({ length: 20 }, () => 330));
    const samples = extractPaceSamples(replay, 50);
    expect(samples).toHaveLength(50);
    expect(samples[0].distanceKm).toBeCloseTo(0.1, 2);
    expect(samples[samples.length - 1].distanceKm).toBeCloseTo(20, 2);
  });
});
