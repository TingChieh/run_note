import { describe, expect, it } from 'vitest';
import { CHART_META, chartSummary, recordedDays, wellbeingChartOption } from '../../src/lib/components/wellbeing-chart';
import type { TrendDay } from '../../src/lib/api/wellbeing';

const colors = { foreground: '#000', muted: '#666', border: '#ccc', surface: '#fff', primary: '#0a0', accent: '#a60' };
const day = (n: number, over: Partial<TrendDay> = {}): TrendDay => ({ date: `2026-10-0${n}`, mood: null, anxiety: null, energy: null, focus: null, functioning: null, sleep_hours: null, sleep_quality: null, dose_count: 0, symptom_count: 0, symptom_max_severity: null, ...over });
const series = [day(1, { mood: 0, energy: 5, sleep_hours: 7.5, sleep_quality: 6 }), day(2), day(3, { mood: 8, symptom_count: 2, symptom_max_severity: 6 })];

describe('wellbeing chart options', () => {
  it('leaves unrecorded days as gaps instead of zeros or interpolated values', () => {
    const option: any = wellbeingChartOption('mood', series, colors, false);
    expect(option.series[0].data).toEqual([0, null, 8]);
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.yAxis[0]).toMatchObject({ min: 0, max: 10 });
  });
  it('plots hours as bars and quality as a line on its own axis', () => {
    const option: any = wellbeingChartOption('sleep', series, colors, false);
    expect(option.series.map((s: any) => s.type)).toEqual(['bar', 'line']);
    expect(option.series[0].data).toEqual([7.5, null, null]);
    expect(option.series[1]).toMatchObject({ yAxisIndex: 1, connectNulls: false });
  });
  it('charts daily functioning on its own, one straight line per recorded day', () => {
    const withValue = [day(1, { functioning: 7 }), day(2), day(3, { functioning: 4 })];
    const option: any = wellbeingChartOption('functioning', withValue, colors, false);
    expect(option.series[0].data).toEqual([7, null, 4]);
    expect(option.series[0].connectNulls).toBe(false);
    expect(CHART_META.functioning.direction).toContain('越高越好');
    expect(recordedDays('functioning', withValue)).toBe(2);
  });
  it('draws thick straight lines (never a smoothed curve) so gaps are not filled in', () => {
    const option: any = wellbeingChartOption('mood', series, colors, false);
    expect(option.series[0].smooth).toBe(false);
    expect(option.series[0].lineStyle.width).toBeGreaterThanOrEqual(4);
    expect(option.series[0].symbolSize).toBeGreaterThanOrEqual(10);
  });
  it('draws two distinguishable lines for energy and focus', () => {
    const option: any = wellbeingChartOption('energy_focus', series, colors, false);
    expect(option.legend.show).toBe(true);
    expect(option.series.map((s: any) => s.lineStyle.type)).toEqual(['solid', 'dashed']);
  });
  it('states the direction of every chart so a rising line is never mistaken for improvement', () => {
    expect(CHART_META.mood.direction).toContain('越高越开心'); // happiness: higher is better
    expect(CHART_META.anxiety.direction).toContain('越高越严重');
    expect(CHART_META.energy_focus.direction).toContain('越高越好');
    expect(chartSummary('mood', series)).toContain('近 3 天中有 2 天有记录');
  });
  it('counts only days with something to draw', () => {
    expect(recordedDays('mood', series)).toBe(2);
    expect(recordedDays('anxiety', series)).toBe(0);
    expect(recordedDays('sleep', series)).toBe(1);
  });
  it('writes missing table cells as a dash', () => {
    expect(CHART_META.mood.columns[0].format(series[1])).toBe('—');
    expect(CHART_META.functioning.columns[0].format(series[0])).toBe('—');
    expect(CHART_META.sleep.columns[0].format(series[0])).toBe('7 小时 30 分');
  });
  it('shows missing days in the tooltip as unrecorded', () => {
    const option: any = wellbeingChartOption('anxiety', series, colors, false);
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toBe('2026-10-02\n焦虑 —');
  });
});
