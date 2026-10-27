import { formatPace } from '#lib/api/activities.ts';
import { dashboardDistance } from '#lib/api/dashboard-format.ts';
import { monthLabel, type MonthPoint } from '#lib/api/records.ts';

export type MonthlyMetric = 'distance' | 'pace';
export interface ChartColors { foreground: string; muted: string; border: string; surface: string; primary: string }
/** Non-highlighted marks: `--primary` at this opacity over the card's `--surface`, i.e. a soft mix of the two. */
export const SOFT_OPACITY = 0.35;

/** The month with the most distance (latest on a tie); -1 when nothing was run. */
export function peakIndex(values: number[]): number {
  let index = -1;
  values.forEach((value, i) => { if (value > 0 && (index < 0 || value >= values[index])) index = i; });
  return index;
}

/** The month with the fastest (lowest) pace, skipping gaps; -1 when there is none. */
export function fastestIndex(values: (number | null)[]): number {
  let index = -1;
  values.forEach((value, i) => { if (value !== null && (index < 0 || value <= (values[index] as number))) index = i; });
  return index;
}

const paceText = (point: MonthPoint) => point.avg_pace_seconds_per_km === null ? '—（无可靠配速）' : formatPace(point.avg_pace_seconds_per_km);

/**
 * Monthly distance (bars) or pace (line) over the whole history. Presentation only: the values are the
 * server's monthly aggregates. No grid lines or value axis; the best month carries its own label and the
 * tooltip spells out each month.
 */
export function monthlyChartOption(points: MonthPoint[], metric: MonthlyMetric, colors: ChartColors, animate: boolean) {
  const distance = metric === 'distance';
  const km = points.map(point => Number(point.distance_m) / 1000);
  const pace = points.map(point => point.avg_pace_seconds_per_km === null ? null : Number(point.avg_pace_seconds_per_km));
  const best = distance ? peakIndex(km) : fastestIndex(pace);
  const label = (text: string) => ({ show: true, position: 'top', distance: 6, color: colors.foreground, fontSize: 12, fontWeight: 600, formatter: () => text });
  const data = distance
    ? points.map((point, i) => ({ value: km[i], itemStyle: { color: colors.primary, opacity: i === best ? 1 : SOFT_OPACITY }, ...(i === best ? { label: label(dashboardDistance(point.distance_m)) } : {}) }))
    : points.map((point, i) => ({ value: pace[i], symbolSize: i === best ? 10 : 6, ...(i === best ? { label: label(formatPace(point.avg_pace_seconds_per_km)) } : {}) }));
  return {
    animation: animate, animationDuration: 500, animationDurationUpdate: 400,
    textStyle: { color: colors.foreground },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      axisPointer: { type: distance ? 'shadow' : 'line', shadowStyle: { color: colors.border, opacity: .35 }, lineStyle: { color: colors.border } },
      formatter: (params: { dataIndex: number }[]) => {
        const point = points[params[0]?.dataIndex];
        if (!point) return '';
        return distance
          ? `${monthLabel(point.month_start)}\n里程 ${dashboardDistance(point.distance_m)}\n${point.activity_count} 次 · 配速 ${paceText(point)}`
          : `${monthLabel(point.month_start)}\n配速 ${paceText(point)}\n${point.activity_count} 次 · 里程 ${dashboardDistance(point.distance_m)}`;
      }
    },
    // Side room so the label over a first or last bar is never clipped.
    grid: { left: 24, right: 24, top: 28, bottom: 28 },
    xAxis: {
      type: 'category', data: points.map(point => monthLabel(point.month_start)),
      axisLine: { show: true, lineStyle: { color: colors.border } }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10 }
    },
    yAxis: distance
      ? { type: 'value', show: false, min: 0, splitLine: { show: false } }
      // Pace: lower is faster, so the axis is reversed and the line climbs as the runner gets quicker.
      : { type: 'value', show: false, inverse: true, scale: true, splitLine: { show: false } },
    series: [distance
      ? { name: '月里程', type: 'bar', data, barMaxWidth: 22, barCategoryGap: '38%', itemStyle: { borderRadius: [6, 6, 2, 2] }, emphasis: { itemStyle: { opacity: 1 } } }
      : { name: '月配速', type: 'line', data, connectNulls: false, symbol: 'circle', showSymbol: true, itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 }, lineStyle: { color: colors.primary, width: 2.5 } }]
  };
}
