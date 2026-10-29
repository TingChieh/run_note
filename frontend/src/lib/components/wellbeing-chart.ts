import type { TrendDay } from '#lib/api/wellbeing.ts';
import { hoursText, shortDate } from '#lib/api/wellbeing.ts';

export type WellbeingChartKind = 'mood' | 'anxiety' | 'energy_focus' | 'functioning' | 'sleep';
export interface WellbeingChartColors { foreground: string; muted: string; border: string; surface: string; primary: string; accent: string }
export interface ChartColumn { key: string; label: string; format: (day: TrendDay) => string }

const score = (v: number | null) => v === null ? '—' : String(v);
export const MISSING = '—';

/** Titles carry the direction so a rising line is never read as "improving" by default. */
export const CHART_META: Record<WellbeingChartKind, { title: string; direction: string; empty: string; columns: ChartColumn[] }> = {
  mood: { title: '开心程度', direction: '0–10，越高越开心（线向上＝更开心）', empty: '这段时间还没有开心程度评分', columns: [{ key: 'mood', label: '开心程度', format: d => score(d.mood) }] },
  anxiety: { title: '焦虑', direction: '0–10，越高越严重（线向上＝更焦虑）', empty: '这段时间还没有焦虑评分', columns: [{ key: 'anxiety', label: '焦虑', format: d => score(d.anxiety) }] },
  energy_focus: { title: '精力与注意力', direction: '0–10，越高越好（线向上＝精力或注意力更好）', empty: '这段时间还没有精力或注意力评分', columns: [{ key: 'energy', label: '精力', format: d => score(d.energy) }, { key: 'focus', label: '注意力', format: d => score(d.focus) }] },
  functioning: { title: '日常功能', direction: '0–10，越高越好（线向上＝日常事务更能应对）', empty: '这段时间还没有日常功能评分', columns: [{ key: 'functioning', label: '日常功能', format: d => score(d.functioning) }] },
  sleep: { title: '睡眠', direction: '柱：睡眠时长（小时）；线：睡眠质量 0–10，越高越好', empty: '这段时间还没有睡眠记录', columns: [{ key: 'sleep_hours', label: '睡眠时长', format: d => d.sleep_hours === null ? MISSING : hoursText(d.sleep_hours) }, { key: 'sleep_quality', label: '睡眠质量', format: d => score(d.sleep_quality) }] }
};

/** The days with at least one value for the chart; used for the empty state and the screen-reader summary. */
export function recordedDays(kind: WellbeingChartKind, series: TrendDay[]): number {
  const has = (d: TrendDay) => kind === 'energy_focus' ? d.energy !== null || d.focus !== null
    : kind === 'sleep' ? d.sleep_hours !== null || d.sleep_quality !== null
    : d[kind] !== null;
  return series.filter(has).length;
}
export function chartSummary(kind: WellbeingChartKind, series: TrendDay[]): string {
  const meta = CHART_META[kind];
  const days = recordedDays(kind, series);
  return `${meta.title}，近 ${series.length} 天中有 ${days} 天有记录。${meta.direction}。下方提供完整数据表。`;
}

/**
 * Trend charts. Missing days are `null` in the data and are never connected or drawn as zero, so
 * a gap in the line is a gap in what was recorded. Presentation only.
 */
export function wellbeingChartOption(kind: WellbeingChartKind, series: TrendDay[], colors: WellbeingChartColors, animate: boolean) {
  const days = series.map(d => d.date);
  const line = (name: string, data: (number | null)[], color: string, dashed = false, yAxisIndex = 0) => ({
    // Straight segments between the days that were recorded, never a smoothed curve: a curve would suggest values for days nobody filled in. A thick line with big dots reads at a glance.
    name, type: 'line', yAxisIndex, data, connectNulls: false, smooth: false, symbol: dashed ? 'diamond' : 'circle', symbolSize: 10, showSymbol: true,
    itemStyle: { color, borderColor: colors.surface, borderWidth: 2 }, lineStyle: { color, width: 4, type: dashed ? 'dashed' : 'solid', cap: 'round', join: 'round' }
  });
  const bar = (name: string, data: (number | null)[], yAxisIndex = 0) => ({
    name, type: 'bar', yAxisIndex, data, barMaxWidth: 18, itemStyle: { color: colors.primary, opacity: .4, borderRadius: [4, 4, 0, 0] }
  });
  const rating = { type: 'value', min: 0, max: 10, interval: 5, splitLine: { lineStyle: { color: colors.border, opacity: .6 } }, axisLabel: { color: colors.muted, fontSize: 11 } };
  const tooltipRows = (index: number): string => CHART_META[kind].columns.map(c => `${c.label} ${c.format(series[index])}`).join('\n');
  let seriesList: unknown[]; let yAxis: unknown[]; let legend = false;
  if (kind === 'mood' || kind === 'anxiety' || kind === 'functioning') {
    seriesList = [line(CHART_META[kind].title, series.map(d => d[kind]), colors.primary)]; yAxis = [rating];
  } else if (kind === 'energy_focus') {
    seriesList = [line('精力', series.map(d => d.energy), colors.primary), line('注意力', series.map(d => d.focus), colors.accent, true)]; yAxis = [rating]; legend = true;
  } else {
    seriesList = [bar('睡眠时长', series.map(d => d.sleep_hours)), line('睡眠质量', series.map(d => d.sleep_quality), colors.accent, true, 1)];
    yAxis = [{ type: 'value', min: 0, max: (v: { max: number }) => Math.max(12, Math.ceil(v.max)), name: '小时', nameTextStyle: { color: colors.muted, fontSize: 11 }, splitLine: { lineStyle: { color: colors.border, opacity: .6 } }, axisLabel: { color: colors.muted, fontSize: 11 } }, { ...rating, splitLine: { show: false }, name: '质量', nameTextStyle: { color: colors.muted, fontSize: 11 } }];
    legend = true;
  }
  return {
    animation: animate, animationDuration: 400, animationDurationUpdate: 300,
    textStyle: { color: colors.foreground },
    legend: { show: legend, top: 0, textStyle: { color: colors.muted, fontSize: 12 }, icon: 'roundRect', itemWidth: 14, itemHeight: 4 },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      axisPointer: { type: 'line', lineStyle: { color: colors.border } },
      formatter: (params: { dataIndex: number }[]) => params[0] ? `${series[params[0].dataIndex].date}\n${tooltipRows(params[0].dataIndex)}` : ''
    },
    grid: { left: 36, right: kind === 'sleep' ? 36 : 16, top: legend ? 36 : 16, bottom: 28 },
    xAxis: { type: 'category', data: days, boundaryGap: kind === 'sleep', axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false }, axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true, formatter: (value: string) => shortDate(value) } },
    yAxis, series: seriesList
  };
}
