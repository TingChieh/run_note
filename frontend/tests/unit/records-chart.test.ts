import { describe, expect, it } from 'vitest';
import { fastestIndex, monthlyChartOption, peakIndex, SOFT_OPACITY, type ChartColors } from '../../src/lib/components/records-chart';
import type { MonthPoint } from '../../src/lib/api/records';

const colors: ChartColors = { foreground: '#111', muted: '#666', border: '#ddd', surface: '#fff', primary: '#17745c' };
const months: MonthPoint[] = [
  { month_start: '2025-12-01', activity_count: 2, distance_m: '12000.000', avg_pace_seconds_per_km: '360.000' },
  { month_start: '2026-01-01', activity_count: 0, distance_m: '0', avg_pace_seconds_per_km: null },
  { month_start: '2026-02-01', activity_count: 3, distance_m: '30500.000', avg_pace_seconds_per_km: '330.000' },
  { month_start: '2026-03-01', activity_count: 1, distance_m: '5000.000', avg_pace_seconds_per_km: '345.000' }
];

describe('peakIndex / fastestIndex', () => {
  it('finds the longest month and keeps the latest one on a tie', () => {
    expect(peakIndex([3, 9, 9, 1])).toBe(2);
    expect(peakIndex([0, 0])).toBe(-1);
    expect(peakIndex([])).toBe(-1);
  });
  it('finds the fastest pace, skipping gaps', () => {
    expect(fastestIndex([360, null, 330, 345])).toBe(2);
    expect(fastestIndex([null, null])).toBe(-1);
  });
});

describe('monthly chart option', () => {
  it('draws distance as rounded bars with only the longest month in full colour', () => {
    const option: any = monthlyChartOption(months, 'distance', colors, false);
    expect(option.animation).toBe(false);
    expect(option.xAxis.data).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    const [series] = option.series;
    expect(series.type).toBe('bar');
    expect(series.itemStyle.borderRadius).toBeTruthy();
    expect(series.data.map((item: any) => item.value)).toEqual([12, 0, 30.5, 5]);
    expect(series.data.map((item: any) => item.itemStyle.color)).toEqual(Array(4).fill('#17745c'));
    expect(series.data.map((item: any) => item.itemStyle.opacity)).toEqual([SOFT_OPACITY, SOFT_OPACITY, 1, SOFT_OPACITY]);
    // The longest month carries its own value label; no other bar does.
    expect(series.data.map((item: any) => item.label?.show === true)).toEqual([false, false, true, false]);
    expect(series.data[2].label.formatter()).toBe('30.5 km');
  });
  it('has no grid lines and no value axis labels', () => {
    for (const metric of ['distance', 'pace'] as const) {
      const option: any = monthlyChartOption(months, metric, colors, true);
      expect(option.yAxis.show).toBe(false);
      expect(option.yAxis.splitLine.show).toBe(false);
      expect(option.xAxis.splitLine.show).toBe(false);
      expect(option.xAxis.axisTick.show).toBe(false);
      expect(option.xAxis.axisLabel.hideOverlap).toBe(true);
      expect(option.legend).toBeUndefined();
    }
    expect((monthlyChartOption(months, 'distance', colors, true) as any).yAxis.min).toBe(0);
  });
  it('draws pace as a broken line on a reversed axis so faster is higher', () => {
    const option: any = monthlyChartOption(months, 'pace', colors, true);
    const [series] = option.series;
    expect(series.type).toBe('line');
    expect(series.connectNulls).toBe(false);
    expect(series.data.map((item: any) => item.value)).toEqual([360, null, 330, 345]);
    expect(option.yAxis.inverse).toBe(true);
    expect(option.yAxis.scale).toBe(true);
    expect(series.lineStyle.color).toBe('#17745c');
    expect(series.data[2].label.show).toBe(true);
    expect(series.data[2].label.formatter()).toBe('5:30 /km');
    expect(series.data[2].symbolSize).toBeGreaterThan(series.data[0].symbolSize);
  });
  it('explains each month in the tooltip, with a dash for a missing pace', () => {
    const distance: any = monthlyChartOption(months, 'distance', colors, true);
    expect(distance.tooltip.formatter([{ dataIndex: 2 }])).toBe('2026-02\n里程 30.5 km\n3 次 · 配速 5:30 /km');
    const pace: any = monthlyChartOption(months, 'pace', colors, true);
    expect(pace.tooltip.formatter([{ dataIndex: 1 }])).toBe('2026-01\n配速 —（无可靠配速）\n0 次 · 里程 0 km');
    expect(pace.tooltip.formatter([])).toBe('');
  });
});
