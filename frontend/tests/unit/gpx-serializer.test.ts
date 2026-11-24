import { describe, expect, it } from 'vitest';
import {
  evaluateTrackPoint,
  formatClockDuration,
  formatPreviewDistanceKm,
  formatPreviewPace,
  generateUuidV4,
  serializeRecordingToGpx,
  type RecordedTrackPoint,
} from '../../src/lib/gpx-serializer.ts';

describe('gpx-serializer', () => {
  it('generates valid v4 UUIDs for idempotency keys', () => {
    const a = generateUuidV4();
    const b = generateUuidV4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(b).not.toBe(a);
  });

  it('produces byte-for-byte deterministic GPX 1.1 with separate trkseg across pauses', () => {
    const points: RecordedTrackPoint[] = [
      { lat: 31.23, lon: 121.47, elevationM: 12.34, accuracyM: 6, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 },
      { lat: 31.2305, lon: 121.47, elevationM: 12.5, accuracyM: 5, recordedAtMs: 1_700_000_020_000, segmentIndex: 0 },
      // Resumed after pause on segment 1
      { lat: 31.235, lon: 121.475, elevationM: null, accuracyM: 7, recordedAtMs: 1_700_000_300_000, segmentIndex: 1 },
      { lat: 31.2355, lon: 121.475, elevationM: 14.0, accuracyM: 7, recordedAtMs: 1_700_000_320_000, segmentIndex: 1 },
    ];
    const first = serializeRecordingToGpx({ title: '河滨 & 晨跑 <5K>', startedAtMs: 1_700_000_000_000, points });
    const second = serializeRecordingToGpx({ title: '河滨 & 晨跑 <5K>', startedAtMs: 1_700_000_000_000, points });

    expect(first.gpxXml).toBe(second.gpxXml);
    expect(first.pointCount).toBe(4);
    expect(first.segmentCount).toBe(2);
    expect(first.gpxXml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(first.gpxXml).toContain('河滨 &amp; 晨跑 &lt;5K&gt;');
    expect(first.gpxXml.match(/<trkseg>/g)?.length).toBe(2);
    // Distance is ~55.6m per segment (~111m total) and does NOT bridge the 600m+ pause gap
    expect(first.previewDistanceM).toBeGreaterThan(100);
    expect(first.previewDistanceM).toBeLessThan(130);
  });

  it('throws when no valid GPS points exist', () => {
    expect(() => serializeRecordingToGpx({ title: '空', startedAtMs: 1_700_000_000_000, points: [] })).toThrow();
  });

  it('filters poor accuracy, time reversals, and teleport spikes while keeping new segments', () => {
    const p1: RecordedTrackPoint = {
      lat: 31.23,
      lon: 121.47,
      accuracyM: 6,
      recordedAtMs: 1_700_000_000_000,
      segmentIndex: 0,
    };
    expect(evaluateTrackPoint(p1, null).accepted).toBe(true);
    expect(evaluateTrackPoint({ ...p1, accuracyM: 80, recordedAtMs: p1.recordedAtMs + 2000 }, p1).accepted).toBe(false);
    expect(evaluateTrackPoint({ ...p1, recordedAtMs: p1.recordedAtMs - 1000 }, p1).accepted).toBe(false);
    expect(evaluateTrackPoint({ ...p1, lat: 31.24, recordedAtMs: p1.recordedAtMs + 1000 }, p1).reason).toBe(
      'speed_jump',
    );
    // New segment accepts location cleanly without bridging distance
    const resumed = evaluateTrackPoint(
      { ...p1, lat: 31.24, recordedAtMs: p1.recordedAtMs + 60_000, segmentIndex: 1 },
      p1,
    );
    expect(resumed.accepted).toBe(true);
    expect(resumed.distanceDeltaM).toBe(0);
  });

  it('formats live clock, distance, and pace safely', () => {
    expect(formatClockDuration(65_000)).toBe('01:05');
    expect(formatClockDuration(3_665_000)).toBe('1:01:05');
    expect(formatPreviewDistanceKm(5120)).toBe('5.12 km');
    expect(formatPreviewPace(300_000, 1000)).toBe('5:00 /km');
    expect(formatPreviewPace(30_000, 20)).toBe('—');
  });
});
