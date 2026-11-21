/**
 * Synthetic PeriodReport + Trends datasets strictly matching RunNote backend schema:
 * - GET /api/v1/statistics/report
 * - GET /api/v1/statistics/trends
 *
 * ZERO personal identifiers, ZERO GPS coordinates, ZERO Work Item 19 fields.
 */

export const SCENARIOS = {
  'year-2025': {
    id: 'year-2025',
    badge: '完整年度',
    shortLabel: '2025 年',
    report: {
      period: 'year',
      year: 2025,
      month: null,
      date_from: '2025-01-01',
      date_to: '2026-01-01',
      is_partial: false,
      cutoff_date: null,
      today: '2026-11-21',
      activity_count: 132,
      distance_m: 956240,
      activity_days: 106,
      duration_sum_seconds: 355212, // 98h 40m 12s
      known_duration_count: 132,
      missing_duration_count: 0,
      pace_eligible_count: 132,
      pace_eligible_distance_m: 956240,
      avg_pace_seconds_per_km: 371.467, // 6'11"
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    },
    trends: {
      period: 'month',
      date_from: '2025-01-01',
      date_to: '2026-01-01',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: [
        { bucket_start: '2025-01-01', bucket_end: '2025-02-01', is_partial: false, distance_m: 56400, activity_count: 8, activity_days: 7, duration_sum_seconds: 21714, known_duration_count: 8, missing_duration_count: 0, pace_eligible_count: 8, pace_eligible_distance_m: 56400, avg_pace_seconds_per_km: 385.0 },
        { bucket_start: '2025-02-01', bucket_end: '2025-03-01', is_partial: false, distance_m: 42800, activity_count: 7, activity_days: 6, duration_sum_seconds: 16649, known_duration_count: 7, missing_duration_count: 0, pace_eligible_count: 7, pace_eligible_distance_m: 42800, avg_pace_seconds_per_km: 389.0 },
        { bucket_start: '2025-03-01', bucket_end: '2025-04-01', is_partial: false, distance_m: 68200, activity_count: 10, activity_days: 8, duration_sum_seconds: 25780, known_duration_count: 10, missing_duration_count: 0, pace_eligible_count: 10, pace_eligible_distance_m: 68200, avg_pace_seconds_per_km: 378.0 },
        { bucket_start: '2025-04-01', bucket_end: '2025-05-01', is_partial: false, distance_m: 79600, activity_count: 11, activity_days: 9, duration_sum_seconds: 29691, known_duration_count: 11, missing_duration_count: 0, pace_eligible_count: 11, pace_eligible_distance_m: 79600, avg_pace_seconds_per_km: 373.0 },
        { bucket_start: '2025-05-01', bucket_end: '2025-06-01', is_partial: false, distance_m: 61500, activity_count: 9, activity_days: 7, duration_sum_seconds: 23370, known_duration_count: 9, missing_duration_count: 0, pace_eligible_count: 9, pace_eligible_distance_m: 61500, avg_pace_seconds_per_km: 380.0 },
        { bucket_start: '2025-06-01', bucket_end: '2025-07-01', is_partial: false, distance_m: 93800, activity_count: 13, activity_days: 10, duration_sum_seconds: 34894, known_duration_count: 13, missing_duration_count: 0, pace_eligible_count: 13, pace_eligible_distance_m: 93800, avg_pace_seconds_per_km: 372.0 },
        { bucket_start: '2025-07-01', bucket_end: '2025-08-01', is_partial: false, distance_m: 87400, activity_count: 12, activity_days: 10, duration_sum_seconds: 32950, known_duration_count: 12, missing_duration_count: 0, pace_eligible_count: 12, pace_eligible_distance_m: 87400, avg_pace_seconds_per_km: 377.0 },
        { bucket_start: '2025-08-01', bucket_end: '2025-09-01', is_partial: false, distance_m: 104600, activity_count: 14, activity_days: 11, duration_sum_seconds: 38284, known_duration_count: 14, missing_duration_count: 0, pace_eligible_count: 14, pace_eligible_distance_m: 104600, avg_pace_seconds_per_km: 366.0 },
        { bucket_start: '2025-09-01', bucket_end: '2025-10-01', is_partial: false, distance_m: 91200, activity_count: 12, activity_days: 10, duration_sum_seconds: 32923, known_duration_count: 12, missing_duration_count: 0, pace_eligible_count: 12, pace_eligible_distance_m: 91200, avg_pace_seconds_per_km: 361.0 },
        { bucket_start: '2025-10-01', bucket_end: '2025-11-01', is_partial: false, distance_m: 118420, activity_count: 15, activity_days: 12, duration_sum_seconds: 41921, known_duration_count: 15, missing_duration_count: 0, pace_eligible_count: 15, pace_eligible_distance_m: 118420, avg_pace_seconds_per_km: 354.0 },
        { bucket_start: '2025-11-01', bucket_end: '2025-12-01', is_partial: false, distance_m: 84520, activity_count: 12, activity_days: 9, duration_sum_seconds: 30681, known_duration_count: 12, missing_duration_count: 0, pace_eligible_count: 12, pace_eligible_distance_m: 84520, avg_pace_seconds_per_km: 363.0 },
        { bucket_start: '2025-12-01', bucket_end: '2026-01-01', is_partial: false, distance_m: 67800, activity_count: 9, activity_days: 7, duration_sum_seconds: 26355, known_duration_count: 9, missing_duration_count: 0, pace_eligible_count: 9, pace_eligible_distance_m: 67800, avg_pace_seconds_per_km: 388.7 },
      ],
    },
  },

  'month-2025-10': {
    id: 'month-2025-10',
    badge: '完整月度',
    shortLabel: '2025 年 10 月',
    report: {
      period: 'month',
      year: 2025,
      month: 10,
      date_from: '2025-10-01',
      date_to: '2025-11-01',
      is_partial: false,
      cutoff_date: null,
      today: '2026-11-21',
      activity_count: 15,
      distance_m: 118420,
      activity_days: 12,
      duration_sum_seconds: 41921, // 11h 38m 41s
      known_duration_count: 15,
      missing_duration_count: 0,
      pace_eligible_count: 15,
      pace_eligible_distance_m: 118420,
      avg_pace_seconds_per_km: 354.0, // 5'54"
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    },
    trends: {
      period: 'week',
      date_from: '2025-10-01',
      date_to: '2025-11-01',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: [
        { bucket_start: '2025-10-01', bucket_end: '2025-10-06', is_partial: true, distance_m: 16200, activity_count: 2, activity_days: 2, duration_sum_seconds: 5897, known_duration_count: 2, missing_duration_count: 0, pace_eligible_count: 2, pace_eligible_distance_m: 16200, avg_pace_seconds_per_km: 364.0 },
        { bucket_start: '2025-10-06', bucket_end: '2025-10-13', is_partial: false, distance_m: 26800, activity_count: 3, activity_days: 3, duration_sum_seconds: 9514, known_duration_count: 3, missing_duration_count: 0, pace_eligible_count: 3, pace_eligible_distance_m: 26800, avg_pace_seconds_per_km: 355.0 },
        { bucket_start: '2025-10-13', bucket_end: '2025-10-20', is_partial: false, distance_m: 32640, activity_count: 4, activity_days: 3, duration_sum_seconds: 11293, known_duration_count: 4, missing_duration_count: 0, pace_eligible_count: 4, pace_eligible_distance_m: 32640, avg_pace_seconds_per_km: 346.0 },
        { bucket_start: '2025-10-20', bucket_end: '2025-10-27', is_partial: false, distance_m: 24980, activity_count: 4, activity_days: 2, duration_sum_seconds: 8818, known_duration_count: 4, missing_duration_count: 0, pace_eligible_count: 4, pace_eligible_distance_m: 24980, avg_pace_seconds_per_km: 353.0 },
        { bucket_start: '2025-10-27', bucket_end: '2025-11-01', is_partial: true, distance_m: 17800, activity_count: 2, activity_days: 2, duration_sum_seconds: 6399, known_duration_count: 2, missing_duration_count: 0, pace_eligible_count: 2, pace_eligible_distance_m: 17800, avg_pace_seconds_per_km: 359.5 },
      ],
    },
  },

  'year-2026': {
    id: 'year-2026',
    badge: '进行中 · 含部分缺计时',
    shortLabel: '2026 年（进行中）',
    report: {
      period: 'year',
      year: 2026,
      month: null,
      date_from: '2026-01-01',
      date_to: '2026-11-22',
      is_partial: true,
      cutoff_date: '2026-11-21',
      today: '2026-11-21',
      activity_count: 114,
      distance_m: 842600,
      activity_days: 93,
      duration_sum_seconds: 300120,
      known_duration_count: 112,
      missing_duration_count: 2,
      pace_eligible_count: 110,
      pace_eligible_distance_m: 816000,
      avg_pace_seconds_per_km: 363.2, // 6'03"
      quality_warning_count: 2,
      date_assignment: 'activity_local_date',
    },
    trends: {
      period: 'month',
      date_from: '2026-01-01',
      date_to: '2026-11-22',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: [
        { bucket_start: '2026-01-01', bucket_end: '2026-02-01', is_partial: false, distance_m: 64200, activity_count: 9, activity_days: 8, duration_sum_seconds: 24139, known_duration_count: 9, missing_duration_count: 0, pace_eligible_count: 9, pace_eligible_distance_m: 64200, avg_pace_seconds_per_km: 376.0 },
        { bucket_start: '2026-02-01', bucket_end: '2026-03-01', is_partial: false, distance_m: 58900, activity_count: 8, activity_days: 7, duration_sum_seconds: 22029, known_duration_count: 8, missing_duration_count: 0, pace_eligible_count: 8, pace_eligible_distance_m: 58900, avg_pace_seconds_per_km: 374.0 },
        { bucket_start: '2026-03-01', bucket_end: '2026-04-01', is_partial: false, distance_m: 82400, activity_count: 11, activity_days: 9, duration_sum_seconds: 30323, known_duration_count: 11, missing_duration_count: 0, pace_eligible_count: 11, pace_eligible_distance_m: 82400, avg_pace_seconds_per_km: 368.0 },
        { bucket_start: '2026-04-01', bucket_end: '2026-05-01', is_partial: false, distance_m: 96500, activity_count: 13, activity_days: 11, duration_sum_seconds: 34836, known_duration_count: 13, missing_duration_count: 0, pace_eligible_count: 13, pace_eligible_distance_m: 96500, avg_pace_seconds_per_km: 361.0 },
        { bucket_start: '2026-05-01', bucket_end: '2026-06-01', is_partial: false, distance_m: 74300, activity_count: 10, activity_days: 8, duration_sum_seconds: 27194, known_duration_count: 10, missing_duration_count: 0, pace_eligible_count: 10, pace_eligible_distance_m: 74300, avg_pace_seconds_per_km: 366.0 },
        { bucket_start: '2026-06-01', bucket_end: '2026-07-01', is_partial: false, distance_m: 52100, activity_count: 7, activity_days: 6, duration_sum_seconds: 15280, known_duration_count: 5, missing_duration_count: 2, pace_eligible_count: 5, pace_eligible_distance_m: 41000, avg_pace_seconds_per_km: 372.7 },
        { bucket_start: '2026-07-01', bucket_end: '2026-08-01', is_partial: false, distance_m: 71800, activity_count: 10, activity_days: 8, duration_sum_seconds: 26422, known_duration_count: 10, missing_duration_count: 0, pace_eligible_count: 10, pace_eligible_distance_m: 71800, avg_pace_seconds_per_km: 368.0 },
        { bucket_start: '2026-08-01', bucket_end: '2026-09-01', is_partial: false, distance_m: 88200, activity_count: 12, activity_days: 9, duration_sum_seconds: 31576, known_duration_count: 12, missing_duration_count: 0, pace_eligible_count: 12, pace_eligible_distance_m: 88200, avg_pace_seconds_per_km: 358.0 },
        { bucket_start: '2026-09-01', bucket_end: '2026-10-01', is_partial: false, distance_m: 109400, activity_count: 14, activity_days: 11, duration_sum_seconds: 38290, known_duration_count: 14, missing_duration_count: 0, pace_eligible_count: 14, pace_eligible_distance_m: 109400, avg_pace_seconds_per_km: 350.0 },
        { bucket_start: '2026-10-01', bucket_end: '2026-11-01', is_partial: false, distance_m: 76400, activity_count: 12, activity_days: 9, duration_sum_seconds: 25660, known_duration_count: 12, missing_duration_count: 0, pace_eligible_count: 10, pace_eligible_distance_m: 60900, avg_pace_seconds_per_km: 356.0 },
        { bucket_start: '2026-11-01', bucket_end: '2026-11-22', is_partial: true, distance_m: 68400, activity_count: 8, activity_days: 7, duration_sum_seconds: 24371, known_duration_count: 8, missing_duration_count: 0, pace_eligible_count: 8, pace_eligible_distance_m: 68400, avg_pace_seconds_per_km: 356.3 },
      ],
    },
  },

  'month-2026-11': {
    id: 'month-2026-11',
    badge: '进行中月度',
    shortLabel: '2026 年 11 月',
    report: {
      period: 'month',
      year: 2026,
      month: 11,
      date_from: '2026-11-01',
      date_to: '2026-11-22',
      is_partial: true,
      cutoff_date: '2026-11-21',
      today: '2026-11-21',
      activity_count: 8,
      distance_m: 68400,
      activity_days: 7,
      duration_sum_seconds: 24371,
      known_duration_count: 8,
      missing_duration_count: 0,
      pace_eligible_count: 8,
      pace_eligible_distance_m: 68400,
      avg_pace_seconds_per_km: 356.3, // 5'56"
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    },
    trends: {
      period: 'week',
      date_from: '2026-11-01',
      date_to: '2026-11-22',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: [
        { bucket_start: '2026-11-01', bucket_end: '2026-11-02', is_partial: true, distance_m: 10200, activity_count: 1, activity_days: 1, duration_sum_seconds: 3672, known_duration_count: 1, missing_duration_count: 0, pace_eligible_count: 1, pace_eligible_distance_m: 10200, avg_pace_seconds_per_km: 360.0 },
        { bucket_start: '2026-11-02', bucket_end: '2026-11-09', is_partial: false, distance_m: 21400, activity_count: 3, activity_days: 2, duration_sum_seconds: 7661, known_duration_count: 3, missing_duration_count: 0, pace_eligible_count: 3, pace_eligible_distance_m: 21400, avg_pace_seconds_per_km: 358.0 },
        { bucket_start: '2026-11-09', bucket_end: '2026-11-16', is_partial: false, distance_m: 24600, activity_count: 3, activity_days: 3, duration_sum_seconds: 8659, known_duration_count: 3, missing_duration_count: 0, pace_eligible_count: 3, pace_eligible_distance_m: 24600, avg_pace_seconds_per_km: 352.0 },
        { bucket_start: '2026-11-16', bucket_end: '2026-11-22', is_partial: true, distance_m: 12200, activity_count: 1, activity_days: 1, duration_sum_seconds: 4379, known_duration_count: 1, missing_duration_count: 0, pace_eligible_count: 1, pace_eligible_distance_m: 12200, avg_pace_seconds_per_km: 359.0 },
      ],
    },
  },
};

function dateAt(year, month, day = 1) {
  return new Date(Date.UTC(year, month - 1, day));
}
function iso(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(date, days) {
  return dateAt(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() + days);
}
function prevIsoDay(str) {
  return iso(addDays(new Date(`${str}T00:00:00Z`), -1));
}
export function monthDay(date) {
  return date.slice(5).replace('-', '.');
}

export function formatKm(metres, digits = 1) {
  return (metres / 1000).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDurationHM(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatDurationFull(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}` : `${m}:${String(rem).padStart(2, '0')}`;
}

export function formatPace(secPerKm) {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm)) return '—';
  const rounded = Math.round(secPerKm);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}′${String(s).padStart(2, '0')}″`;
}

export function buildSlots(report) {
  const first = dateAt(report.year, report.month ?? 1, 1);
  const last = dateAt(report.year, report.month === null ? 13 : report.month + 1, 1);
  const slots = [];
  for (let cursor = first; cursor < last; ) {
    const next =
      report.period === 'year'
        ? dateAt(report.year, cursor.getUTCMonth() + 2, 1)
        : addDays(cursor, 7 - ((cursor.getUTCDay() + 6) % 7));
    const end = next < last ? next : last;
    const idx = slots.length + 1;
    slots.push({
      index: idx,
      start: iso(cursor),
      end: iso(end),
      label: report.period === 'year' ? `${cursor.getUTCMonth() + 1}月` : `第${idx}周`,
      shortLabel: report.period === 'year' ? `${cursor.getUTCMonth() + 1}月` : `W${idx}`,
      enLabel: report.period === 'year'
        ? ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][cursor.getUTCMonth()]
        : `WK ${idx}`,
    });
    cursor = end;
  }
  return slots;
}

/**
 * Pure presentation view-model built EXCLUSIVELY from PeriodReport + Trends server aggregates.
 */
export function buildViewModel(scenarioId) {
  const sc = SCENARIOS[scenarioId] || SCENARIOS['year-2025'];
  const { report, trends } = sc;
  const slots = buildSlots(report);

  const maxDist = Math.max(0, ...trends.buckets.map((b) => Number(b.distance_m)));
  const pacedBuckets = trends.buckets.filter((b) => b.avg_pace_seconds_per_km !== null && b.distance_m > 0);
  const fastestPace = pacedBuckets.length
    ? Math.min(...pacedBuckets.map((b) => Number(b.avg_pace_seconds_per_km)))
    : null;
  const slowestPace = pacedBuckets.length
    ? Math.max(...pacedBuckets.map((b) => Number(b.avg_pace_seconds_per_km)))
    : null;

  let cumulative = 0;
  const buckets = slots.map((slot, i) => {
    const b = trends.buckets[i] || null;
    const isFuture = !b;
    const distance = b ? Number(b.distance_m) : null;
    if (distance !== null) cumulative += distance;
    const endShown = b ? b.bucket_end : slot.end;
    const lastDay = prevIsoDay(endShown);
    const isPeak = maxDist > 0 && distance === maxDist;
    const isFastest =
      fastestPace !== null &&
      b &&
      b.avg_pace_seconds_per_km !== null &&
      Math.abs(Number(b.avg_pace_seconds_per_km) - fastestPace) < 0.01;

    return {
      ...slot,
      last: lastDay,
      rangeShort: report.period === 'month' ? `${monthDay(slot.start)}–${monthDay(lastDay)}` : slot.label,
      isFuture,
      isPartial: b ? Boolean(b.is_partial) : false,
      distance,
      cumulative: isFuture ? null : cumulative,
      activity_count: b ? b.activity_count : null,
      activity_days: b ? b.activity_days : null,
      duration_sum_seconds: b ? b.duration_sum_seconds : null,
      avg_pace_seconds_per_km: b ? b.avg_pace_seconds_per_km : null,
      isPeak,
      isFastest,
    };
  });

  const observedBuckets = buckets.filter((b) => !b.isFuture);
  const activeBuckets = observedBuckets.filter((b) => (b.activity_count ?? 0) > 0);
  const peakBuckets = observedBuckets.filter((b) => b.isPeak);
  const fastestBuckets = observedBuckets.filter((b) => b.isFastest);

  const rangeText = report.is_partial && report.cutoff_date
    ? `${report.date_from.replaceAll('-', '.')} – ${report.cutoff_date.replaceAll('-', '.')}`
    : `${report.date_from.replaceAll('-', '.')} – ${prevIsoDay(report.date_to).replaceAll('-', '.')}`;

  const title =
    report.period === 'month'
      ? `${report.year} 年 ${report.month} 月跑步回顾`
      : `${report.year} 年跑步回顾`;

  const issueTag =
    report.period === 'month'
      ? `MONTHLY RECAP · ${report.year}.${String(report.month).padStart(2, '0')}`
      : `ANNUAL RECAP · ${report.year}`;

  const coverageNotes = [];
  if (report.missing_duration_count > 0) {
    coverageNotes.push(`用时覆盖 ${report.known_duration_count}/${report.activity_count} 次`);
  }
  if (report.pace_eligible_count < report.activity_count) {
    coverageNotes.push(`配速覆盖 ${report.pace_eligible_count}/${report.activity_count} 次`);
  }

  const totalKm = Number(report.distance_m) / 1000;
  const avgRunKm = report.activity_count > 0 ? totalKm / report.activity_count : 0;
  const marathons = totalKm / 42.195;
  const trackLaps = Math.round(Number(report.distance_m) / 400);

  return {
    id: sc.id,
    badge: sc.badge,
    period: report.period,
    year: report.year,
    month: report.month,
    title,
    issueTag,
    rangeText,
    cutoff: report.cutoff_date,
    isPartial: report.is_partial,
    totalDistanceM: Number(report.distance_m),
    totalKm,
    distanceText: formatKm(Number(report.distance_m), 1),
    distanceExactText: formatKm(Number(report.distance_m), 2),
    activityCount: report.activity_count,
    activityDays: report.activity_days,
    durationSeconds: report.duration_sum_seconds,
    durationHM: formatDurationHM(report.duration_sum_seconds),
    durationFull: formatDurationFull(report.duration_sum_seconds),
    avgPaceSeconds: report.avg_pace_seconds_per_km,
    avgPaceText: formatPace(report.avg_pace_seconds_per_km),
    coverageText: coverageNotes.join(' · '),
    metrics: [
      { key: 'count', label: '跑步次数', value: report.activity_count.toLocaleString('zh-CN'), unit: '次' },
      { key: 'days', label: '跑步天数', value: report.activity_days.toLocaleString('zh-CN'), unit: '天' },
      { key: 'duration', label: '总用时', value: formatDurationHM(report.duration_sum_seconds), unit: '时:分' },
      {
        key: 'pace',
        label: '平均配速',
        value: formatPace(report.avg_pace_seconds_per_km),
        unit: report.avg_pace_seconds_per_km !== null ? '/km' : '',
      },
    ],
    derived: {
      avgRunKmText: avgRunKm > 0 ? `${avgRunKm.toFixed(1)} km` : '—',
      marathonsText: `${marathons.toFixed(1)} 场全马`,
      trackLapsText: `${trackLaps.toLocaleString('zh-CN')} 圈`,
      activeRatioText: `${activeBuckets.length}/${observedBuckets.length} ${report.period === 'year' ? '个月有开跑' : '周有开跑'}`,
      activeRatioShort: `${activeBuckets.length}/${observedBuckets.length} ${report.period === 'year' ? '月' : '周'}`,
      peakLabel: peakBuckets.map((b) => b.rangeShort).join('、'),
      peakKmText: maxDist > 0 ? `${formatKm(maxDist, 1)} km` : '—',
      peakSharePct: Number(report.distance_m) > 0 ? Math.round((maxDist / Number(report.distance_m)) * 100) : 0,
      fastestLabel: fastestBuckets.map((b) => b.rangeShort).join('、'),
      fastestPaceText: fastestPace !== null ? `${formatPace(fastestPace)} /km` : '—',
    },
    maxDist,
    fastestPace,
    slowestPace,
    buckets,
    filename: `runnote-recap-${report.year}${report.month === null ? '' : `-${String(report.month).padStart(2, '0')}`}.png`,
  };
}

/**
 * Shared Theme Controller for prototypes
 */
export function initTheme(toggleBtn) {
  const params = new URLSearchParams(window.location.search);
  const urlTheme = params.get('theme');
  const initial = urlTheme === 'dark' || urlTheme === 'light' ? urlTheme : 'light';
  document.documentElement.dataset.theme = initial;

  const updateIcon = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    if (!toggleBtn) return;
    toggleBtn.setAttribute('aria-label', dark ? '切换到浅色外观' : '切换到深色外观');
    toggleBtn.setAttribute('title', dark ? '切换到浅色外观' : '切换到深色外观');
    toggleBtn.innerHTML = dark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  };

  updateIcon();
  toggleBtn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    updateIcon();
    window.dispatchEvent(new CustomEvent('rn-theme-change', { detail: { theme: next } }));
  });
}

/**
 * Animate numeric text smoothly (respects prefers-reduced-motion)
 */
export function animateNumber(el, target, formatFn, duration = 620) {
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || duration <= 0) {
    el.textContent = formatFn(target);
    return;
  }
  const start = performance.now();
  const from = 0;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = formatFn(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
