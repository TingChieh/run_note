/**
 * Deterministic GPX 1.1 serializer and client-side live preview calculator for Phase 3 recording.
 *
 * Authority boundary:
 * - Client preview metrics (distance/pace) are strictly for live display during a run.
 * - Final authoritative distance, duration, and pace are always calculated by the backend
 *   PostGIS GPX pipeline (`POST /api/v1/gpx-imports`).
 */

export interface RecordedTrackPoint {
  lat: number;
  lon: number;
  elevationM?: number | null;
  accuracyM?: number | null;
  recordedAtMs: number;
  segmentIndex: number;
}

export interface GpxSerializationInput {
  title?: string;
  startedAtMs: number;
  points: RecordedTrackPoint[];
}

export interface GpxSerializationResult {
  gpxXml: string;
  pointCount: number;
  segmentCount: number;
  previewDistanceM: number;
}

const EARTH_RADIUS_M = 6371008.8;
const MAX_ACCEPTED_ACCURACY_M = 50;
const MAX_REALISTIC_SPEED_MPS = 12;

export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_M * c;
}

export function evaluateTrackPoint(
  candidate: RecordedTrackPoint,
  previous: RecordedTrackPoint | null,
): { accepted: boolean; reason: string | null; distanceDeltaM: number } {
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) {
    return { accepted: false, reason: 'invalid_coordinate', distanceDeltaM: 0 };
  }
  if (candidate.lat < -90 || candidate.lat > 90 || candidate.lon < -180 || candidate.lon > 180) {
    return { accepted: false, reason: 'coordinate_out_of_range', distanceDeltaM: 0 };
  }
  if (!Number.isFinite(candidate.recordedAtMs) || candidate.recordedAtMs <= 0) {
    return { accepted: false, reason: 'invalid_timestamp', distanceDeltaM: 0 };
  }
  if (
    candidate.accuracyM !== undefined &&
    candidate.accuracyM !== null &&
    (!Number.isFinite(candidate.accuracyM) || candidate.accuracyM < 0 || candidate.accuracyM > MAX_ACCEPTED_ACCURACY_M)
  ) {
    return { accepted: false, reason: 'poor_accuracy', distanceDeltaM: 0 };
  }
  if (previous) {
    if (candidate.recordedAtMs < previous.recordedAtMs) {
      return { accepted: false, reason: 'time_reversal', distanceDeltaM: 0 };
    }
    if (
      candidate.recordedAtMs === previous.recordedAtMs &&
      candidate.lat === previous.lat &&
      candidate.lon === previous.lon
    ) {
      return { accepted: false, reason: 'duplicate_point', distanceDeltaM: 0 };
    }
    if (candidate.segmentIndex === previous.segmentIndex) {
      const delta = haversineMeters(previous.lat, previous.lon, candidate.lat, candidate.lon);
      const dtSec = (candidate.recordedAtMs - previous.recordedAtMs) / 1000;
      if (dtSec === 0 && delta > 0) {
        return { accepted: false, reason: 'zero_time_jump', distanceDeltaM: 0 };
      }
      if (dtSec > 0 && delta / dtSec > MAX_REALISTIC_SPEED_MPS) {
        return { accepted: false, reason: 'speed_jump', distanceDeltaM: 0 };
      }
      return { accepted: true, reason: null, distanceDeltaM: delta };
    }
  }
  return { accepted: true, reason: null, distanceDeltaM: 0 };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatCoord(value: number): string {
  const fixed = value.toFixed(7);
  return fixed === '-0.0000000' ? '0.0000000' : fixed;
}

function formatIsoUtc(ms: number): string {
  return new Date(Math.round(ms)).toISOString();
}

/**
 * Generates byte-for-byte deterministic GPX 1.1 XML from a finalized recording session.
 * Pause/resume boundaries map directly to separate `<trkseg>` blocks so backend PostGIS
 * route distance never bridges across pauses.
 */
export function serializeRecordingToGpx(input: GpxSerializationInput): GpxSerializationResult {
  const valid = input.points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      p.lat >= -90 &&
      p.lat <= 90 &&
      p.lon >= -180 &&
      p.lon <= 180 &&
      Number.isFinite(p.recordedAtMs) &&
      p.recordedAtMs > 0,
  );

  if (valid.length === 0) {
    throw new Error('没有有效 GPS 轨迹点，无法生成轨迹文件');
  }

  const ordered = [...valid].sort((a, b) =>
    a.segmentIndex !== b.segmentIndex ? a.segmentIndex - b.segmentIndex : a.recordedAtMs - b.recordedAtMs,
  );

  const segments: RecordedTrackPoint[][] = [];
  let currentSegIndex: number | null = null;
  let currentSegment: RecordedTrackPoint[] = [];

  for (const point of ordered) {
    if (currentSegIndex !== point.segmentIndex) {
      if (currentSegment.length > 0) segments.push(currentSegment);
      currentSegment = [point];
      currentSegIndex = point.segmentIndex;
    } else {
      currentSegment.push(point);
    }
  }
  if (currentSegment.length > 0) segments.push(currentSegment);

  let previewDistanceM = 0;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i += 1) {
      previewDistanceM += haversineMeters(seg[i - 1].lat, seg[i - 1].lon, seg[i].lat, seg[i].lon);
    }
  }

  const safeTitle = (input.title?.trim() || 'RunNote 实时跑步记录').slice(0, 120);
  const metaTime = formatIsoUtc(input.startedAtMs > 0 ? input.startedAtMs : ordered[0].recordedAtMs);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RunNote Companion 2.5.0" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXml(safeTitle)}</name>`,
    `    <time>${metaTime}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(safeTitle)}</name>`,
  ];

  for (const seg of segments) {
    lines.push('    <trkseg>');
    for (const pt of seg) {
      const eleTag =
        pt.elevationM !== undefined && pt.elevationM !== null && Number.isFinite(pt.elevationM)
          ? `<ele>${pt.elevationM.toFixed(1)}</ele>`
          : '';
      lines.push(
        `      <trkpt lat="${formatCoord(pt.lat)}" lon="${formatCoord(pt.lon)}">${eleTag}<time>${formatIsoUtc(pt.recordedAtMs)}</time></trkpt>`,
      );
    }
    lines.push('    </trkseg>');
  }

  lines.push('  </trk>', '</gpx>');

  return {
    gpxXml: `${lines.join('\n')}\n`,
    pointCount: ordered.length,
    segmentCount: segments.length,
    previewDistanceM: Math.round(previewDistanceM * 1000) / 1000,
  };
}

export function formatClockDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatPreviewDistanceKm(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return '0.00 km';
  return `${(distanceM / 1000).toFixed(2)} km`;
}

export function formatPreviewPace(durationMs: number, distanceM: number): string {
  if (!Number.isFinite(durationMs) || !Number.isFinite(distanceM) || distanceM < 50 || durationMs <= 0) {
    return '—';
  }
  const secPerKm = Math.round(durationMs / 1000 / (distanceM / 1000));
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '—';
  const min = Math.floor(secPerKm / 60);
  const sec = secPerKm % 60;
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}
