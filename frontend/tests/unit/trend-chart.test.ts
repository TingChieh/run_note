import { describe, expect, it } from 'vitest';
import { bucketLabel, trendChartOption, trendText, trendValue } from '../../src/lib/components/trend-chart';
import { SOFT_OPACITY, type ChartColors } from '../../src/lib/components/records-chart';
import type { Trends, TrendBucket } from '../../src/lib/api/statistics';

const colors: ChartColors = { foreground: '#111', muted: '#666', border: '#ddd', surface: '#fff', primary: '#17745c' };
const bucket = (start: string, end: string, count: number, distance: string, duration: number | null, pace: string | null, partial = false): TrendBucket => ({
  bucket_start: start, bucket_end: end, is_partial: partial, activity_count: count, distance_m: distance, duration_sum_seconds: duration,
  known_duration_count: duration === null ? 0 : count, missing_duration_count: duration === null ? count : 0, activity_days: count,
  pace_eligible_count: pace === null ? 0 : count, pace_eligible_distance_m: pace === null ? '0' : distance, avg_pace_seconds_per_km: pace,
  quality_warning_count: 0, date_assignment: 'activity_local_date'
} as TrendBucket);
const trends: Trends = {
  period: 'month', date_from: '2026-01-01', date_to: '2026-04-01', week_start: 'monday', date_assignment: 'activity_local_date',
  buckets: [
    bucket('2026-01-01', '2026-02-01', 2, '12000.000', 4200, '350.000'),
    bucket('2026-02-01', '2026-03-01', 0, '0', null, null),
    bucket('2026-03-01', '2026-04-01', 4, '30500.000', 9900, '325.000', true)
  ]
};

describe('trend chart helpers', () => {
  it('labels month and week buckets compactly', () => {
    expect(bucketLabel(trends.buckets[0], 'month')).toBe('1月');
    expect(bucketLabel(bucket('2026-10-13', '2026-10-20', 1, '5000', 1800, '360'), 'week')).toBe('10/13');
  });
  it('reads each metric in its display unit and keeps gaps as null', () => {
    expect(trendValue(trends.buckets[0], 'distance')).toBe(12);
    expect(trendValue(trends.buckets[0], 'count')).toBe(2);
    expect(trendValue(trends.buckets[0], 'duration')).toBe(70);
    expect(trendValue(trends.buckets[1], 'duration')).toBeNull();
    expect(trendValue(trends.buckets[1], 'pace')).toBeNull();
    expect(trendText(trends.buckets[1], 'pace')).toBe('—');
  });
});

describe('trend chart option', () => {
  it('draws totals as rounded bars, only the biggest bucket in full colour and labelled, with no value axis or grid', () => {
    const option: any = trendChartOption(trends, 'distance', colors, false);
    expect(option.xAxis.data).toEqual(['1月', '2月', '3月']);
    expect(option.yAxis.show).toBe(false);
    expect(option.xAxis.splitLine.show).toBe(false);
    const [series] = option.series;
    expect(series.type).toBe('bar');
    expect(series.data.map((d: any) => d.itemStyle.opacity)).toEqual([SOFT_OPACITY, SOFT_OPACITY, 1]);
    expect(series.data[2].label.formatter()).toBe('30.5 km');
    expect(series.data[0].label).toBeUndefined();
  });
  it('draws pace as a line on a reversed axis with the fastest bucket marked', () => {
    const option: any = trendChartOption(trends, 'pace', colors, false);
    expect(option.series[0].type).toBe('line');
    expect(option.yAxis.inverse).toBe(true);
    expect(option.series[0].data.map((d: any) => d.value)).toEqual([350, null, 325]);
    expect(option.series[0].data[2].symbolSize).toBe(10);
  });
  it('names the partial bucket in the tooltip', () => {
    const option: any = trendChartOption(trends, 'count', colors, false);
    expect(option.tooltip.formatter([{ dataIndex: 2 }])).toBe('3月（部分）\n次数 4 次\n4 次 · 里程 30.5 km');
  });
});
