import { formatPace } from '#lib/api/activities.ts';
import { dashboardDistance } from '#lib/api/dashboard-format.ts';
import { monthLabel, type MonthPoint } from '#lib/api/records.ts';

export type MonthlyMetric = 'distance' | 'pace';
export interface ChartColors { foreground: string; muted: string; border: string; surface: string; primary: string }
export interface MonthlyReceiptMarks { mark: string; background: string }
/** Non-highlighted marks: `--primary` at this opacity over the card's `--surface`, i.e. a soft mix of the two. */
export const SOFT_OPACITY = 0.35;

/** WCAG contrast ratio of two #rgb/#rrggbb colours; null when either cannot be parsed. */
function hexContrast(a: string, b: string): number | null {
  const luminance = (value: string) => {
    const hex = value.trim().replace(/^#/, '');
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    const [r, g, bChannel] = [0, 2, 4].map(i => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bChannel;
  };
  const [x, y] = [luminance(a), luminance(b)];
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

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
export function monthlyChartOption(
  points: MonthPoint[],
  metric: MonthlyMetric,
  colors: ChartColors,
  animate: boolean,
  receipt?: MonthlyReceiptMarks,
) {
  const distance = metric === 'distance';
  const km = points.map(point => Number(point.distance_m) / 1000);
  const pace = points.map(point => point.avg_pace_seconds_per_km === null ? null : Number(point.avg_pace_seconds_per_km));
  const best = distance ? peakIndex(km) : fastestIndex(pace);
  const label = (text: string, bold = false) => ({
    show: true,
    position: 'top',
    distance: 6,
    color: colors.foreground,
    fontSize: 12,
    fontWeight: bold ? 700 : 600,
    fontFamily: receipt ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined,
    formatter: () => text,
  });
  const outline = !!receipt && (hexContrast(receipt.mark, receipt.background) ?? 0) < 3;
  const data = distance
    ? receipt
      ? points.map((point, i) => {
          const peak = i === best && km[i] > 0;
          return {
            value: km[i],
            itemStyle: {
              color: peak ? receipt.mark : colors.primary,
              opacity: 1,
              borderColor: peak && outline ? colors.foreground : undefined,
              borderWidth: peak && outline ? 1 : 0,
            },
            ...(peak ? { label: label(dashboardDistance(point.distance_m), true) } : {}),
          };
        })
      : points.map((point, i) => ({ value: km[i], itemStyle: { color: colors.primary, opacity: i === best ? 1 : SOFT_OPACITY }, ...(i === best ? { label: label(dashboardDistance(point.distance_m)) } : {}) }))
    : points.map((point, i) => ({
        value: pace[i],
        symbolSize: i === best ? 10 : 6,
        ...(receipt && i === best ? { itemStyle: { color: receipt.mark, borderColor: colors.foreground, borderWidth: outline ? 1.5 : 2 } } : {}),
        ...(i === best ? { label: label(formatPace(point.avg_pace_seconds_per_km), !!receipt) } : {}),
      }));
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
      axisLabel: receipt
        ? {
            color: colors.muted,
            fontSize: 11,
            hideOverlap: true,
            margin: 10,
            formatter: (value: string, index: number) => (index === best ? `{peak|${value}}` : value),
            rich: { peak: { color: colors.foreground, fontWeight: 700, fontSize: 11 } },
          }
        : { color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10 }
    },
    yAxis: distance
      ? { type: 'value', show: false, min: 0, splitLine: { show: false } }
      // Pace: lower is faster, so the axis is reversed and the line climbs as the runner gets quicker.
      : { type: 'value', show: false, inverse: true, scale: true, splitLine: { show: false } },
    series: [distance
      ? receipt
        ? { name: '月里程', type: 'bar', data, barMaxWidth: 28, barCategoryGap: '42%', itemStyle: { borderRadius: 0 }, emphasis: { disabled: true } }
        : { name: '月里程', type: 'bar', data, barMaxWidth: 22, barCategoryGap: '38%', itemStyle: { borderRadius: [6, 6, 2, 2] }, emphasis: { itemStyle: { opacity: 1 } } }
      : { name: '月配速', type: 'line', data, connectNulls: false, symbol: 'circle', showSymbol: true, itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 }, lineStyle: { color: colors.primary, width: receipt ? 2 : 2.5 } }]
  };
}
