import { describe, expect, it } from 'vitest';
import {
  currentMonthValue,
  formatPeriodTitle,
  formatReportRange,
  parsePeriodReport,
  readPeriodReport,
  shiftMonthValue,
} from '../../src/lib/api/period-report.ts';

function validMonth(): any {
  return {
    period: 'month',
    year: 2024,
    month: 1,
    date_from: '2024-01-01',
    date_to: '2024-02-01',
    is_partial: false,
    cutoff_date: null,
    today: '2026-03-06',
    activity_count: 3,
    distance_m: '6000.000',
    activity_days: 2,
    duration_sum_seconds: '1500.000',
    known_duration_count: 2,
    missing_duration_count: 1,
    pace_eligible_count: 2,
    pace_eligible_distance_m: '4000.000',
    avg_pace_seconds_per_km: '375.000',
    quality_warning_count: 1,
    date_assignment: 'activity_local_date',
  };
}

function validYear(): any {
  return {
    ...validMonth(),
    period: 'year',
    month: null,
    date_from: '2024-01-01',
    date_to: '2025-01-01',
    activity_count: 4,
    activity_days: 3,
    known_duration_count: 3,
    missing_duration_count: 1,
  };
}

describe('period report contract', () => {
  it('accepts valid completed, partial, leap-month, and future empty reports', () => {
    const jan = parsePeriodReport(validMonth());
    expect(jan.activity_count).toBe(3);
    expect(jan.avg_pace_seconds_per_km).toBe('375.000');

    const y2024 = parsePeriodReport(validYear());
    expect(y2024.month).toBeNull();
    expect(y2024.activity_count).toBe(4);

    const leap = parsePeriodReport({
      ...validMonth(),
      month: 2,
      date_from: '2024-02-01',
      date_to: '2024-03-01',
      activity_count: 1,
      distance_m: '0',
      duration_sum_seconds: '0',
      known_duration_count: 1,
      missing_duration_count: 0,
      pace_eligible_count: 0,
      pace_eligible_distance_m: '0',
      avg_pace_seconds_per_km: null,
    });
    expect(leap.avg_pace_seconds_per_km).toBeNull();

    const partial = parsePeriodReport({
      ...validMonth(),
      year: 2026,
      month: 3,
      date_from: '2026-03-01',
      date_to: '2026-03-07',
      is_partial: true,
      cutoff_date: '2026-03-06',
      today: '2026-03-06',
    });
    expect(partial.is_partial).toBe(true);
    expect(partial.cutoff_date).toBe('2026-03-06');

    const future = parsePeriodReport({
      ...validMonth(),
      year: 2026,
      month: 5,
      date_from: '2026-05-01',
      date_to: '2026-05-01',
      is_partial: false,
      cutoff_date: null,
      activity_count: 0,
      distance_m: '0',
      activity_days: 0,
      duration_sum_seconds: null,
      known_duration_count: 0,
      missing_duration_count: 0,
      pace_eligible_count: 0,
      pace_eligible_distance_m: '0',
      avg_pace_seconds_per_km: null,
      quality_warning_count: 0,
    });
    expect(future.date_from).toBe(future.date_to);
  });

  it('rejects malformed period report payloads', () => {
    const cases: [string, (v: any) => void][] = [
      [
        'invalid period',
        (v) => {
          v.period = 'week';
        },
      ],
      [
        'month missing for month period',
        (v) => {
          v.month = null;
        },
      ],
      [
        'month out of range',
        (v) => {
          v.month = 13;
        },
      ],
      [
        'month set for year period',
        (v) => {
          v.period = 'year';
          v.date_to = '2025-01-01';
        },
      ],
      [
        'year out of range',
        (v) => {
          v.year = 1899;
        },
      ],
      [
        'mismatched date_from',
        (v) => {
          v.date_from = '2024-01-02';
        },
      ],
      [
        'date_to after natural period end',
        (v) => {
          v.date_to = '2024-02-02';
        },
      ],
      [
        'date_to before date_from',
        (v) => {
          v.date_to = '2023-12-31';
        },
      ],
      [
        'partial without cutoff_date',
        (v) => {
          v.is_partial = true;
          v.cutoff_date = null;
        },
      ],
      [
        'cutoff_date when not partial',
        (v) => {
          v.is_partial = false;
          v.cutoff_date = '2024-01-15';
        },
      ],
      [
        'invalid today',
        (v) => {
          v.today = '2026-02-30';
        },
      ],
      [
        'negative distance',
        (v) => {
          v.distance_m = '-1';
        },
      ],
    ];
    for (const [name, mutate] of cases) {
      const value = validMonth();
      mutate(value);
      expect(() => parsePeriodReport(value), name).toThrow('无效响应');
    }
    expect(() => parsePeriodReport(null)).toThrow('无效响应');
  });

  it('requests the authenticated owner report path with query params and maps 401', async () => {
    const seen: string[] = [];
    await readPeriodReport('month', 2024, 1, async (url, init) => {
      seen.push(String(url));
      expect(init?.cache).toBe('no-store');
      return Response.json({ data: validMonth(), error: null });
    });
    await readPeriodReport('year', 2024, undefined, async (url) => {
      seen.push(String(url));
      return Response.json({ data: validYear(), error: null });
    });
    expect(seen).toEqual([
      '/api/v1/statistics/report?period=month&year=2024&month=1',
      '/api/v1/statistics/report?period=year&year=2024',
    ]);
    await expect(
      readPeriodReport('year', 2024, undefined, async () => new Response('x', { status: 401 })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('resolves timezone-safe month values, shifts across year boundaries, and formats ranges', () => {
    expect(currentMonthValue('America/Los_Angeles', new Date('2026-01-01T00:30:00Z'))).toBe('2025-12');
    expect(currentMonthValue('Asia/Shanghai', new Date('2026-01-01T00:30:00Z'))).toBe('2026-01');
    expect(shiftMonthValue('2024-12', 1)).toBe('2025-01');
    expect(shiftMonthValue('2025-01', -1)).toBe('2024-12');
    expect(shiftMonthValue('1900-01', -1)).toBe('1900-01');
    expect(shiftMonthValue('2100-12', 1)).toBe('2100-12');

    expect(formatPeriodTitle('month', 2024, 1)).toBe('2024 年 1 月');
    expect(formatPeriodTitle('year', 2024, null)).toBe('2024 年');

    expect(formatReportRange(parsePeriodReport(validMonth()))).toBe('2024-01-01 至 2024-01-31');
    expect(
      formatReportRange(
        parsePeriodReport({ ...validMonth(), month: 2, date_from: '2024-02-01', date_to: '2024-03-01' }),
      ),
    ).toBe('2024-02-01 至 2024-02-29');
    expect(formatReportRange(parsePeriodReport(validYear()))).toBe('2024-01-01 至 2024-12-31');
    expect(
      formatReportRange(
        parsePeriodReport({
          ...validMonth(),
          year: 2026,
          month: 3,
          date_from: '2026-03-01',
          date_to: '2026-03-07',
          is_partial: true,
          cutoff_date: '2026-03-06',
        }),
      ),
    ).toBe('2026-03-01 至 2026-03-06');
    expect(
      formatReportRange(
        parsePeriodReport({
          ...validMonth(),
          year: 2026,
          month: 5,
          date_from: '2026-05-01',
          date_to: '2026-05-01',
          activity_count: 0,
          distance_m: '0',
          activity_days: 0,
          duration_sum_seconds: null,
          known_duration_count: 0,
          missing_duration_count: 0,
          pace_eligible_count: 0,
          pace_eligible_distance_m: '0',
          avg_pace_seconds_per_km: null,
          quality_warning_count: 0,
        }),
      ),
    ).toBe('尚未开始');
  });
});
