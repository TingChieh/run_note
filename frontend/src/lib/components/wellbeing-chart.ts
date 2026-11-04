import type { TrendDay } from '#lib/api/wellbeing.ts';
import { hoursText, shortDate } from '#lib/api/wellbeing.ts';

export type WellbeingChartKind = 'mood' | 'anxiety' | 'energy_focus' | 'functioning' | 'sleep';
export interface WellbeingChartColors { foreground: string; muted: string; border: string; surface: string; primary: string; accent: string; wakeups?: string }
export interface ChartColumn { key: string; label: string; format: (day: TrendDay) => string }

const score = (v: number | null) => v === null ? '—' : String(v);
export const MISSING = '—';

/** Titles carry the direction so a rising line is never read as "improving" by default. */
export const CHART_META: Record<WellbeingChartKind, { title: string; direction: string; empty: string; columns: ChartColumn[] }> = {
  mood: { title: '开心程度', direction: '0–10，越高越开心（线向上＝更开心）', empty: '这段时间还没有开心程度评分', columns: [{ key: 'mood', label: '开心程度', format: d => score(d.mood) }] },
  anxiety: { title: '焦虑', direction: '0–10，越高越严重（线向上＝更焦虑）', empty: '这段时间还没有焦虑评分', columns: [{ key: 'anxiety', label: '焦虑', format: d => score(d.anxiety) }] },
  energy_focus: { title: '精力与注意力', direction: '0–10，越高越好（线向上＝精力或注意力更好）', empty: '这段时间还没有精力或注意力评分', columns: [{ key: 'energy', label: '精力', format: d => score(d.energy) }, { key: 'focus', label: '注意力', format: d => score(d.focus) }] },
  functioning: { title: '日常功能', direction: '0–10，越高越好（线向上＝日常事务更能应对）', empty: '这段时间还没有日常功能评分', columns: [{ key: 'functioning', label: '日常功能', format: d => score(d.functioning) }] },
  sleep: { title: '睡眠', direction: '基线以上：睡眠时长（柱）与质量（虚线，0–10）；基线以下：夜间醒来次数，向下越长醒得越多', empty: '这段时间还没有睡眠记录', columns: [{ key: 'sleep_hours', label: '睡眠时长', format: d => d.sleep_hours === null ? MISSING : hoursText(d.sleep_hours) }, { key: 'sleep_quality', label: '睡眠质量', format: d => score(d.sleep_quality) }, { key: 'sleep_wakeups', label: '夜间醒来', format: d => d.sleep_wakeups === null ? MISSING : `${d.sleep_wakeups} 次` }] }
};

/** The days with at least one value for the chart; used for the empty state and the screen-reader summary. The sleep chart counts the night's waking too. */
export function recordedDays(kind: WellbeingChartKind, series: TrendDay[]): number {
  const has = (d: TrendDay) => kind === 'energy_focus' ? d.energy !== null || d.focus !== null
    : kind === 'sleep' ? d.sleep_hours !== null || d.sleep_quality !== null || d.sleep_wakeups !== null
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
    // A mirror around one baseline: above it the hours (columns, left axis) with quality as a line (right axis); below it the nights' waking grows downward, its count written under
    // each column (a 0 is written too: no waking is an answer, an unrecorded night has nothing). The lower part is a third of the height; both axes put 0 on the baseline.
    // Hours ticks stay round (0 / 6 / 12, or 9 / 18 after a very long night); the lower part is a third of the height, with one dashed reference at 4 times so a column's length reads as a count.
    const hoursTop = Math.max(12, Math.ceil(Math.max(0, ...series.map(d => d.sleep_hours ?? 0)) / 6) * 6), below = hoursTop / 2;
    const wakeTop = Math.max(4, ...series.map(d => d.sleep_wakeups ?? 0)), perWake = below / (wakeTop + 1.5);   // room under the deepest column for its number, clear of the dates
    const tone = colors.wakeups ?? colors.accent, quality = line('睡眠质量', series.map(d => d.sleep_quality), colors.accent, true, 1);
    seriesList = [
      // One width for the columns above and below the baseline, sharing one centre, so a night reads as one column split by the baseline.
      { ...bar('睡眠时长', series.map(d => d.sleep_hours)), barWidth: '60%', barMaxWidth: 18, barGap: '-100%', markLine: { silent: true, symbol: 'none', animation: false, label: { show: false }, lineStyle: { color: colors.muted, type: 'solid', width: 1, opacity: .7 }, data: [{ yAxis: 0 }] } },
      // A thinner dashed line with small dots than the other charts: it shares the space with the columns.
      { ...quality, symbol: 'circle', symbolSize: 6, itemStyle: { color: colors.accent, borderWidth: 0 }, lineStyle: { ...quality.lineStyle, width: 2.5, type: [6, 4] } },
      { name: '夜间醒来（向下）', type: 'bar', data: series.map(d => d.sleep_wakeups === null ? null : { value: -d.sleep_wakeups * perWake, count: d.sleep_wakeups }), barWidth: '60%', barMaxWidth: 18, barGap: '-100%', itemStyle: { color: tone, borderRadius: [0, 0, 3, 3] },
        label: { show: true, position: 'bottom', distance: 2, color: tone, fontSize: 10, fontWeight: 700, formatter: (p: { data: { count: number } | null }) => p.data ? String(p.data.count) : '' },
        z: 3, markLine: { z: 1, silent: true, symbol: 'none', animation: false, lineStyle: { color: colors.border, type: 'solid', width: 1 }, label: { show: true, position: 'start', distance: 10, formatter: '4', color: colors.muted, fontSize: 11 }, data: [{ yAxis: -4 * perWake }] } }
    ];
    // Below the baseline the axes are left unlabelled (they would read as negative hours); the reference line at 4 carries the count instead.
    yAxis = [{ type: 'value', min: -below, max: hoursTop, interval: below, splitLine: { lineStyle: { color: colors.border, opacity: .6 } }, axisLabel: { color: colors.muted, fontSize: 11, formatter: (v: number) => v < 0 ? '' : String(v) } },
      { ...rating, min: -5, max: 10, splitLine: { show: false }, axisLabel: { ...rating.axisLabel, formatter: (v: number) => v <= 0 ? '' : String(v) } }];
    legend = true;
  }
  return {
    animation: animate, animationDuration: 400, animationDurationUpdate: 300,
    textStyle: { color: colors.foreground },
    legend: { show: legend, top: 0, left: kind === 'sleep' ? 0 : 'center', textStyle: { color: colors.muted, fontSize: 12 }, icon: 'roundRect', itemWidth: 14, itemHeight: 4 },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      axisPointer: { type: 'line', lineStyle: { color: colors.border } },
      formatter: (params: { dataIndex: number }[]) => params[0] ? `${series[params[0].dataIndex].date}\n${tooltipRows(params[0].dataIndex)}` : ''
    },
    grid: { left: 36, right: kind === 'sleep' ? 36 : 16, top: legend ? 36 : 16, bottom: 28 },
    xAxis: { type: 'category', data: days, boundaryGap: kind === 'sleep', axisLine: { onZero: false, lineStyle: { color: colors.border } }, axisTick: { show: false }, axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true, formatter: (value: string) => shortDate(value) } },
    yAxis, series: seriesList
  };
}
