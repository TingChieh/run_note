import { describe, expect, it } from 'vitest';
import {
  buildRecap,
  defaultRecapBucketIndex,
  formatRecapLabelList,
  km,
  recapFilename,
  recapHref,
  recapIssueTag,
  recapPeak,
  recapPosterStyles,
  recapSelection,
  recapSlots,
  recapTitle,
} from '#lib/recap.ts';
import type { PeriodReport } from '#lib/api/period-report.ts';
import type { Trends } from '#lib/api/statistics.ts';

const baseReport = {
  period: 'month',
  year: 2025,
  month: 10,
  date_from: '2025-10-01',
  date_to: '2025-10-13',
  is_partial: true,
  cutoff_date: '2025-10-12',
  today: '2025-10-12',
  activity_count: 2,
  activity_days: 2,
  distance_m: '12345.000',
  duration_sum_seconds: '3600',
  avg_pace_seconds_per_km: null,
  missing_duration_count: 1,
  known_duration_count: 1,
  pace_eligible_count: 0,
  pace_eligible_distance_m: '0',
  quality_warning_count: 0,
  date_assignment: 'activity_local_date',
  email: 'private@example.test',
  display_name: '真实姓名',
  city: '上海',
  wellbeing_note: '私人健康备注',
} as unknown as PeriodReport;

describe('running recap', () => {
  it('defaults to the current year and accepts a valid historical deep link', () => {
    expect(recapSelection(new URLSearchParams(), '2026-11')).toEqual({ period: 'year', year: 2026, month: null });
    expect(recapSelection(new URLSearchParams('period=month&year=2024&month=2'), '2026-11')).toEqual({
      period: 'month',
      year: 2024,
      month: 2,
    });
    expect(recapSelection(new URLSearchParams('period=month&year=2026&month=12'), '2026-11')).toEqual({
      period: 'month',
      year: 2026,
      month: 12,
    });
    expect(recapHref({ period: 'year', year: 2025, month: null })).toBe(
      '/workspace/records/recap?period=year&year=2025',
    );
    expect(recapHref({ period: 'month', year: 2025, month: 10 })).toBe(
      '/workspace/records/recap?period=month&year=2025&month=10',
    );
    expect(recapTitle({ period: 'year', year: 2025, month: null })).toBe('2025 年跑步回顾');
    expect(recapIssueTag({ period: 'month', year: 2025, month: 4 })).toBe('MONTHLY RECAP · 2025.04');
    expect(recapPosterStyles.map((style) => style.id)).toEqual(['editorial', 'telemetry', 'receipt']);
  });

  it('clips Monday weeks at the month edges, including leap day', () => {
    expect(recapSlots({ period: 'month', year: 2024, month: 2 }).map(({ start, end }) => [start, end])).toEqual([
      ['2024-02-01', '2024-02-05'],
      ['2024-02-05', '2024-02-12'],
      ['2024-02-12', '2024-02-19'],
      ['2024-02-19', '2024-02-26'],
      ['2024-02-26', '2024-03-01'],
    ]);
  });

  it('whitelists export fields, identifies ties, and keeps future distances absent', () => {
    const trends = {
      buckets: [
        {
          bucket_start: '2025-10-01',
          bucket_end: '2025-10-06',
          distance_m: '6172.500',
          username: 'secret',
          notes: 'private-note',
        },
        { bucket_start: '2025-10-06', bucket_end: '2025-10-13', distance_m: '6172.500' },
      ],
    } as unknown as Trends;
    const recap = buildRecap(baseReport, trends);
    expect(recap.buckets.map(({ distance, peak, future }) => [distance, peak, future])).toEqual([
      [6172.5, true, false],
      [6172.5, true, false],
      [null, false, true],
      [null, false, true],
      [null, false, true],
    ]);
    expect(recap.buckets.map((bucket) => bucket.cumulative)).toEqual([6172.5, 12345, null, null, null]);
    expect(recap.distance).toBe('12.35');
    expect(recap.metrics[3]).toMatchObject({ label: '平均配速', value: '—' });
    expect(recap.cutoff).toBe('2025-10-12');
    expect(recap.derived.peakTied).toBe(true);
    expect(recap.derived.peakSharePct).toBe(50);
    expect(recap.derived.activeRatioText).toBe('2/2 周有开跑');
    expect(recapPeak(recap)).toContain('并列峰值');
    expect(recapFilename(recap)).toBe('runnote-recap-2025-10.png');
    expect(JSON.stringify(recap)).not.toMatch(
      /email|private@example|username|secret|真实姓名|上海|私人健康|private-note/,
    );
    expect(() => buildRecap({ ...baseReport, distance_m: 1000 }, trends)).toThrow();
    expect(() => buildRecap(baseReport, { ...trends, buckets: trends.buckets.slice(0, 1) })).toThrow();
  });

  it('preserves all server bucket fields and computes deterministic display derivations without recomputing pace', () => {
    const yearReport: PeriodReport = {
      period: 'year',
      year: 2025,
      month: null,
      date_from: '2025-01-01',
      date_to: '2026-01-01',
      is_partial: false,
      cutoff_date: null,
      today: '2026-11-21',
      activity_count: 20,
      activity_days: 16,
      distance_m: '210975.000',
      duration_sum_seconds: '73841.000',
      known_duration_count: 20,
      missing_duration_count: 0,
      pace_eligible_count: 18,
      pace_eligible_distance_m: '190000.000',
      avg_pace_seconds_per_km: '350.000',
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    };

    const slots = recapSlots({ period: 'year', year: 2025, month: null });
    const distances = [10000, 0, 20000, 15000, 25000, 10000, 15000, 20000, 15975, 40000, 20000, 20000];
    const paces: (number | null)[] = [380, null, 360, 355, 340, 370, 350, 345, 340, 330, 360, 355];
    const trends: Trends = {
      period: 'month',
      date_from: '2025-01-01',
      date_to: '2026-01-01',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: slots.map((slot, i) => ({
        bucket_start: slot.start,
        bucket_end: slot.end,
        is_partial: false,
        distance_m: String(distances[i]),
        activity_count: distances[i] > 0 ? (i === 9 ? 4 : 2) : 0,
        activity_days: distances[i] > 0 ? (i === 9 ? 3 : 1) : 0,
        duration_sum_seconds: distances[i] > 0 ? String(Math.round((distances[i] / 1000) * (paces[i] ?? 360))) : null,
        known_duration_count: distances[i] > 0 ? (i === 9 ? 4 : 2) : 0,
        missing_duration_count: 0,
        // Month 10 has pace_eligible_count 0 even though avg_pace is 330 -> must NOT be picked as fastest!
        pace_eligible_count: i === 9 ? 0 : distances[i] > 0 ? 2 : 0,
        pace_eligible_distance_m: i === 9 ? '0' : String(distances[i]),
        avg_pace_seconds_per_km: paces[i] !== null ? String(paces[i]) : null,
        quality_warning_count: 0,
        date_assignment: 'activity_local_date',
      })),
    };

    const recap = buildRecap(yearReport, trends);
    expect(recap.dateAssignment).toBe('activity_local_date');
    expect(recap.qualityWarningCount).toBe(0);
    expect(recap.buckets).toHaveLength(12);
    expect(recap.buckets[9].peak).toBe(true);
    expect(recap.buckets[9].activityCount).toBe(4);
    expect(recap.buckets[9].activityDays).toBe(3);
    expect(recap.buckets[9].qualityWarningCount).toBe(0);
    expect(recap.buckets[11].cumulative).toBe(210975);
    expect(formatRecapLabelList(['1月', '2月', '3月', '4月', '5月'])).toBe('1月、2月、3月 等 5 段');
    expect(recap.derived.activeCount).toBe(11);
    expect(recap.derived.observedCount).toBe(12);
    expect(recap.derived.activeRatioText).toBe('11/12 个月有开跑');
    expect(recap.derived.peakLabel).toBe('10月');
    expect(recap.derived.peakSharePct).toBe(19);
    // Month 5 and Month 9 tie at 340s/km; Month 10 (pace_eligible_count: 0) is excluded.
    expect(recap.derived.fastestPace).toBe(340);
    expect(recap.derived.fastestTied).toBe(true);
    expect(recap.derived.fastestLabel).toBe('5月、9月');
    expect(recap.derived.fastestPaceText).toBe('5:40 /km');
    expect(recap.derived.marathons).toBeCloseTo(5.0, 3);
    expect(recap.derived.marathonsText).toBe('5.0 场全马');
    expect(recap.derived.trackLaps).toBe(Math.round(210975 / 400));
    expect(recap.derived.avgRunKmText).toBe(`${km(210975 / 20, 1)} km`);
    expect(defaultRecapBucketIndex(recap)).toBe(9);
  });

  it('degrades safely for a single observed bucket, zero distance, and extreme distances', () => {
    const singleBucketReport: PeriodReport = {
      period: 'year',
      year: 2026,
      month: null,
      date_from: '2026-01-01',
      date_to: '2026-01-03',
      is_partial: true,
      cutoff_date: '2026-01-02',
      today: '2026-01-02',
      activity_count: 1,
      activity_days: 1,
      distance_m: '123456789.000',
      duration_sum_seconds: '44444444',
      known_duration_count: 1,
      missing_duration_count: 0,
      pace_eligible_count: 1,
      pace_eligible_distance_m: '123456789.000',
      avg_pace_seconds_per_km: '360.000',
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    };
    const singleTrends: Trends = {
      period: 'month',
      date_from: '2026-01-01',
      date_to: '2026-01-03',
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets: [
        {
          bucket_start: '2026-01-01',
          bucket_end: '2026-01-03',
          is_partial: true,
          distance_m: '123456789.000',
          activity_count: 1,
          activity_days: 1,
          duration_sum_seconds: '44444444',
          known_duration_count: 1,
          missing_duration_count: 0,
          pace_eligible_count: 1,
          pace_eligible_distance_m: '123456789.000',
          avg_pace_seconds_per_km: '360.000',
          quality_warning_count: 0,
          date_assignment: 'activity_local_date',
        },
      ],
    };

    const extreme = buildRecap(singleBucketReport, singleTrends);
    expect(extreme.distance).toBe('123,456.79');
    expect(extreme.derived.observedCount).toBe(1);
    expect(extreme.derived.peakSharePct).toBe(100);
    expect(extreme.derived.marathonsText).toBe('2,926 场全马');
    expect(defaultRecapBucketIndex(extreme)).toBe(0);

    const zeroReport: PeriodReport = {
      ...singleBucketReport,
      distance_m: '0.000',
      duration_sum_seconds: '0',
      pace_eligible_count: 0,
      pace_eligible_distance_m: '0',
      avg_pace_seconds_per_km: null,
    };
    const zeroTrends: Trends = {
      ...singleTrends,
      buckets: [
        {
          ...singleTrends.buckets[0],
          distance_m: '0.000',
          duration_sum_seconds: '0',
          pace_eligible_count: 0,
          pace_eligible_distance_m: '0',
          avg_pace_seconds_per_km: null,
        },
      ],
    };
    const zero = buildRecap(zeroReport, zeroTrends);
    expect(zero.max).toBe(0);
    expect(zero.derived.peakLabel).toBe('');
    expect(zero.derived.peakSharePct).toBe(0);
    expect(zero.derived.fastestPace).toBeNull();
    expect(zero.derived.marathonsText).toBe('—');
    expect(zero.derived.avgRunKmText).toBe('—');
    expect(recapPeak(zero)).toBe('');
  });
});
