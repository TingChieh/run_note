import { describe, expect, it } from 'vitest';
import { recapSelection, recapSlots, buildRecap, recapFilename } from '#lib/recap.ts';
import type { PeriodReport } from '#lib/api/period-report.ts';
import type { Trends } from '#lib/api/statistics.ts';

const report = {
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
  email: 'private@example.test',
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

  it('whitelists export fields, identifies ties and keeps future distances absent', () => {
    const trends = {
      buckets: [
        { bucket_start: '2025-10-01', bucket_end: '2025-10-06', distance_m: '6172.500', username: 'secret' },
        { bucket_start: '2025-10-06', bucket_end: '2025-10-13', distance_m: '6172.500' },
      ],
    } as unknown as Trends;
    const recap = buildRecap(report, trends);
    expect(recap.buckets.map(({ distance, peak }) => [distance, peak])).toEqual([
      [6172.5, true],
      [6172.5, true],
      [null, false],
      [null, false],
      [null, false],
    ]);
    expect(recap.distance).toBe('12.35');
    expect(recap.metrics[3]).toMatchObject({ label: '平均配速', value: '—' });
    expect(recap.cutoff).toBe('2025-10-12');
    expect(recapFilename(recap)).toBe('runnote-recap-2025-10.png');
    expect(JSON.stringify(recap)).not.toMatch(/email|private@example|username|secret/);
    expect(() => buildRecap({ ...report, distance_m: 1000 }, trends)).toThrow();
    expect(() => buildRecap(report, { ...trends, buckets: trends.buckets.slice(0, 1) })).toThrow();
  });
});
