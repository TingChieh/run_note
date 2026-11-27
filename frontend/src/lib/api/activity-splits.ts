import { calendarDate, type Activity } from './activities.ts';
import type { ReplayData } from './replay.ts';

export interface KmSplit {
  index: number;
  label: string;
  distanceM: number;
  cumulativeDistanceM: number;
  splitSeconds: number;
  cumulativeSeconds: number;
  paceSecondsPerKm: number | null;
  fastest: boolean;
  barRatio: number;
}

export interface PaceSample {
  distanceKm: number;
  paceSecondsPerKm: number;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** Formats `YYYY-MM-DD` with its weekday for the receipt header while preserving the ISO date string. */
export function formatReceiptDate(value: string): string {
  if (!calendarDate(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${value} ${weekday}`;
}

function formatClockHM(value: string | null, timezone: string): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

/** Formats the `HH:MM — HH:MM` time span for the receipt header; falls back to start time alone. */
export function formatReceiptTimeRange(
  startedAt: string | null,
  endedAt: string | null,
  timezone: string,
): string {
  const start = formatClockHM(startedAt, timezone);
  const end = formatClockHM(endedAt, timezone);
  if (start && end && start !== end) return `${start} — ${end}`;
  return start || end;
}

export function visibilityLabel(visibility: Activity['visibility']): string {
  return { private: '仅自己可见', unlisted: '持链接可见', public: '公开展示' }[visibility];
}

export function splitFigure(value: string): { number: string; unit: string } {
  const match = /^(.*\d)\s+(\S+)$/.exec(value);
  return match ? { number: match[1], unit: match[2] } : { number: value, unit: '' };
}

/**
 * Slices server-computed replay distance and moving-time arrays into per-kilometre rows for presentation.
 * Authoritative totals still come from `Activity`; simulated tracks return an empty list.
 */
export function extractSplits(replay: ReplayData | null): KmSplit[] {
  if (!replay || replay.mode !== 'real' || replay.distance_m < 100) return [];
  const distances: number[] = [];
  const moving: number[] = [];
  for (const segment of replay.segments) {
    for (let i = 0; i < segment.distance_m.length; i++) {
      const d = segment.distance_m[i];
      const t = segment.moving_s[i];
      if (!distances.length || d > distances[distances.length - 1]) {
        distances.push(d);
        moving.push(t);
      }
    }
  }
  if (distances.length < 2) return [];
  const totalDistance = distances[distances.length - 1];
  if (totalDistance < 100) return [];

  const timeAt = (targetM: number): number => {
    if (targetM <= distances[0]) return moving[0];
    if (targetM >= totalDistance) return moving[moving.length - 1];
    let low = 0;
    let high = distances.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (distances[mid] <= targetM) low = mid;
      else high = mid;
    }
    const span = distances[high] - distances[low];
    const ratio = span > 0 ? (targetM - distances[low]) / span : 0;
    return moving[low] + (moving[high] - moving[low]) * ratio;
  };

  const fullKms = Math.floor(totalDistance / 1000);
  const remainder = totalDistance - fullKms * 1000;
  const boundaries: { distanceM: number; cumulativeM: number; label: string }[] = [];
  for (let km = 1; km <= fullKms; km++) {
    boundaries.push({ distanceM: 1000, cumulativeM: km * 1000, label: String(km) });
  }
  if (remainder >= 100) {
    const partialKm = Math.round(remainder / 100) / 10;
    boundaries.push({
      distanceM: remainder,
      cumulativeM: totalDistance,
      label: partialKm >= 1 ? String(fullKms + 1) : partialKm.toFixed(1),
    });
  }
  if (!boundaries.length) return [];

  let prevTime = timeAt(0);
  const rows: KmSplit[] = boundaries.map((b, idx) => {
    const cumTime = timeAt(b.cumulativeM);
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
    // Only highlight a fastest km when splits actually differ (> 0.5 s/km).
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
 * Downsamples server-computed replay pace samples (`pace_s_per_km` over `distance_m`) for the pace chart.
 */
export function extractPaceSamples(replay: ReplayData | null, maxPoints = 120): PaceSample[] {
  if (!replay || replay.mode !== 'real') return [];
  const raw: PaceSample[] = [];
  for (const segment of replay.segments) {
    if (!segment.pace_s_per_km) continue;
    for (let i = 0; i < segment.distance_m.length; i++) {
      const pace = segment.pace_s_per_km[i];
      if (pace !== null && Number.isFinite(pace) && pace >= 60 && pace <= 3600) {
        raw.push({ distanceKm: segment.distance_m[i] / 1000, paceSecondsPerKm: pace });
      }
    }
  }
  if (raw.length <= maxPoints) return raw;
  const sampled: PaceSample[] = [];
  const step = (raw.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(raw[Math.round(i * step)]);
  }
  return sampled;
}
