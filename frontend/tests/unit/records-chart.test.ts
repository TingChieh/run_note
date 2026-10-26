import { describe, expect, it } from 'vitest';
import { buildChartOption, nullAfterCutoff, type ChartColors, type ChartSpec } from '../../src/lib/components/records-chart';

const colors: ChartColors = { foreground: '#111', muted: '#666', border: '#ddd', surface: '#fff', primary: '#27815c', secondary: '#4bb6df' };
const one: ChartSpec = { labels: ['1 月', '2 月'], series: [{ name: '2024 年', type: 'bar', color: 'primary', data: [3, null] }], yName: '里程（km）', format: v => `${v} km`, zeroBased: true };

describe('records chart option', () => {
  it('keeps missing values as gaps instead of zero', () => {
    const option: any = buildChartOption(one, colors, false);
    expect(option.series[0].data).toEqual([3, null]);
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.animation).toBe(false);
  });
  it('shows a legend only for several series and anchors count axes at zero', () => {
    expect((buildChartOption(one, colors, true) as any).legend.show).toBe(false);
    expect((buildChartOption(one, colors, true) as any).yAxis.min).toBe(0);
    const two: ChartSpec = { ...one, zeroBased: false, series: [...one.series, { name: '2023 年', type: 'line', color: 'secondary', data: [1, 2] }] };
    const option: any = buildChartOption(two, colors, true);
    expect(option.legend.show).not.toBe(false);
    expect(option.yAxis.min).toBeUndefined();
    expect(option.yAxis.scale).toBe(true);
    expect(option.series[1].itemStyle.color).toBe('#4bb6df');
  });
  it('formats tooltip values and renders gaps as a dash', () => {
    const option: any = buildChartOption(one, colors, true);
    expect(option.tooltip.valueFormatter(3)).toBe('3 km');
    expect(option.tooltip.valueFormatter(null)).toBe('—');
  });
});

describe('nullAfterCutoff', () => {
  const full = Array.from({ length: 12 }, (_, i) => i + 1);
  it('keeps the cutoff month and blanks later months', () => {
    expect(nullAfterCutoff(full, '2026-03-15')).toEqual([1, 2, 3, null, null, null, null, null, null, null, null, null]);
  });
  it('leaves a full year untouched when the cutoff is December', () => {
    expect(nullAfterCutoff(full, '2025-12-31')).toEqual(full);
  });
  it('ignores a malformed cutoff', () => {
    expect(nullAfterCutoff(full, 'bad')).toEqual(full);
  });
});
