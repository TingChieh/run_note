export interface ChartSeries { name: string; type: 'bar' | 'line'; data: (number | null)[]; color: 'primary' | 'secondary' }
export interface ChartSpec { labels: string[]; series: ChartSeries[]; yName: string; format: (value: number) => string; zeroBased: boolean }
export interface ChartColors { foreground: string; muted: string; border: string; surface: string; primary: string; secondary: string }

export function buildChartOption(spec: ChartSpec, colors: ChartColors, animate: boolean) {
  const several = spec.series.length > 1;
  return {
    animation: animate, animationDuration: 400, animationDurationUpdate: 400,
    textStyle: { color: colors.foreground },
    legend: several ? { top: 0, textStyle: { color: colors.muted } } : { show: false },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      valueFormatter: (value: number | null | undefined) => value === null || value === undefined ? '—' : spec.format(value)
    },
    grid: { left: 56, right: 20, top: several ? 48 : 40, bottom: 36 },
    xAxis: { type: 'category', data: spec.labels, axisLine: { lineStyle: { color: colors.border } }, axisTick: { lineStyle: { color: colors.border } }, axisLabel: { color: colors.muted, fontSize: 11 } },
    yAxis: {
      type: 'value', name: spec.yName, ...(spec.zeroBased ? { min: 0 } : { scale: true }),
      nameTextStyle: { color: colors.muted, align: 'left' }, axisLabel: { color: colors.muted, formatter: (value: number) => spec.format(value) }, splitLine: { lineStyle: { color: colors.border } }
    },
    series: spec.series.map(item => ({
      name: item.name, type: item.type, connectNulls: false, data: item.data, symbol: 'circle',
      itemStyle: { color: colors[item.color] }, lineStyle: { color: colors[item.color] }
    }))
  };
}

/** Blank out months after the cutoff month so a "same period" chart shows gaps, not zeros. */
export function nullAfterCutoff<T>(values: (T | null)[], cutoffDate: string): (T | null)[] {
  const month = Number(cutoffDate.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return values;
  return values.map((value, index) => (index + 1 > month ? null : value));
}
