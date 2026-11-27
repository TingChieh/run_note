import { describe, expect, it } from 'vitest';
import { bucketLabel, contrastRatio, trendChartOption, trendText, trendValue } from '../../src/lib/components/trend-chart';
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
  it('receipt bars: square, accent colour, the peak in receipt yellow with a bold label and value, the unfinished bucket hatched', () => {
    const complete: Trends = { ...trends, buckets: [trends.buckets[0], trends.buckets[1], { ...trends.buckets[2], is_partial: false }, bucket('2026-04-01', '2026-05-01', 1, '8000.000', 2800, '350.000')] };
    const option: any = trendChartOption(complete, 'distance', colors, false, { mark: '#e0ab00', background: '#f6f7f4', today: '2026-04-17' });
    const [series] = option.series;
    expect(series.itemStyle.borderRadius).toBe(0);
    expect(series.barMaxWidth).toBe(28);
    const [jan, feb, mar, apr] = series.data;
    expect(jan.itemStyle.color).toBe('#17745c');
    expect(jan.itemStyle.opacity).toBe(1);
    expect(jan.label.formatter()).toBe('12');
    expect(feb.label).toBeUndefined();
    expect(mar.itemStyle.color).toBe('#e0ab00');
    expect(mar.label.fontWeight).toBe(700);
    expect(mar.label.formatter()).toBe('30.5 km');
    // Yellow on light paper is ~2:1, so the peak gets a 1px ink outline to stay distinguishable.
    expect(mar.itemStyle.borderColor).toBe('#111');
    expect(mar.itemStyle.borderWidth).toBe(1);
    expect(apr.itemStyle.decal.color).toBe('#17745c');
    expect(apr.itemStyle.color).toBe('#f6f7f4');
    expect(option.xAxis.axisLabel.formatter('3月', 2)).toBe('{peak|3月}');
    expect(option.xAxis.axisLabel.formatter('1月', 0)).toBe('1月');
  });
  it('receipt hatching follows today, not the API flag for buckets clipped by the requested range', () => {
    // A finished week crossing 1 January is clipped (is_partial) but not unfinished; the week holding today is.
    const weeks: Trends = { period: 'week', date_from: '2025-01-01', date_to: '2026-01-01', week_start: 'monday', date_assignment: 'activity_local_date', buckets: [
      bucket('2025-01-01', '2025-01-06', 1, '5000.000', 1800, '360.000', true),
      bucket('2025-12-22', '2025-12-29', 2, '9000.000', 3200, '355.000'),
      bucket('2025-12-29', '2026-01-01', 1, '4000.000', 1500, '375.000', true),
    ] };
    const past: any = trendChartOption(weeks, 'distance', colors, false, { mark: '#e0ab00', background: '#f6f7f4', today: '2026-11-27' });
    expect(past.series[0].data.some((d: any) => d.itemStyle.decal)).toBe(false);
    const running: any = trendChartOption(weeks, 'distance', colors, false, { mark: '#e0ab00', background: '#f6f7f4', today: '2025-12-30' });
    expect(running.series[0].data.map((d: any) => !!d.itemStyle.decal)).toEqual([false, false, true]);
    const unknown: any = trendChartOption(weeks, 'distance', colors, false, { mark: '#e0ab00', background: '#f6f7f4' });
    expect(unknown.series[0].data.some((d: any) => d.itemStyle.decal)).toBe(false);
  });
  it('receipt peak needs no outline where yellow already contrasts, and narrow charts print only the peak', () => {
    const whole: Trends = { ...trends, buckets: trends.buckets.map(b => ({ ...b, is_partial: false })) };
    const option: any = trendChartOption(whole, 'distance', colors, false, { mark: '#f5c519', background: '#292725', printAll: false });
    const [jan, , mar] = option.series[0].data;
    expect(mar.itemStyle.borderWidth).toBe(0);
    expect(jan.label).toBeUndefined();
    expect(contrastRatio('#e0ab00', '#f6f7f4')).toBeLessThan(3);
    expect(contrastRatio('#f5c519', '#292725')).toBeGreaterThan(3);
    expect(contrastRatio('var(--x)', '#fff')).toBeNull();
  });
  it('names the partial bucket in the tooltip', () => {
    const option: any = trendChartOption(trends, 'count', colors, false);
    expect(option.tooltip.formatter([{ dataIndex: 2 }])).toBe('3月（部分）\n次数 4 次\n4 次 · 里程 30.5 km');
  });
});
