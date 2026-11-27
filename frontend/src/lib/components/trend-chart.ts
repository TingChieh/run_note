import { formatDuration, formatPace } from '#lib/api/activities.ts';
import { dashboardDistance } from '#lib/api/dashboard-format.ts';
import type { Trends } from '#lib/api/statistics.ts';
import { fastestIndex, peakIndex, SOFT_OPACITY, type ChartColors } from './records-chart';

export type TrendMetric = 'distance' | 'count' | 'duration' | 'pace';
type Bucket = Trends['buckets'][number];

export const TREND_LABELS: Record<TrendMetric, string> = { distance: '距离', count: '次数', duration: '已知耗时', pace: '可靠配速' };

/** "3月" for a month bucket, "10/13" for a week bucket (the Monday it starts on). */
export function bucketLabel(bucket: Bucket, period: Trends['period']): string {
  const [, month, day] = bucket.bucket_start.split('-');
  return period === 'month' ? `${Number(month)}月` : `${Number(month)}/${Number(day)}`;
}

export function trendValue(bucket: Bucket, metric: TrendMetric): number | null {
  if (metric === 'distance') return Number(bucket.distance_m) / 1000;
  if (metric === 'count') return bucket.activity_count;
  if (metric === 'duration') return bucket.duration_sum_seconds === null ? null : Number(bucket.duration_sum_seconds) / 60;
  return bucket.avg_pace_seconds_per_km === null ? null : Number(bucket.avg_pace_seconds_per_km);
}

export function trendText(bucket: Bucket, metric: TrendMetric): string {
  if (metric === 'distance') return dashboardDistance(bucket.distance_m);
  if (metric === 'count') return `${bucket.activity_count} 次`;
  if (metric === 'duration') return formatDuration(bucket.duration_sum_seconds);
  return formatPace(bucket.avg_pace_seconds_per_km);
}

/** Editorial Receipt marks (brand.md §5): the peak in receipt yellow, the unfinished bucket hatched. */
export interface ReceiptMarks {
  mark: string;
  background: string;
  /** Print every monthly value (wide charts); narrow charts print only the peak so labels never collide. */
  printAll?: boolean;
  /**
   * Today (YYYY-MM-DD) in the subject's timezone: the bucket containing it is the unfinished one. The API's
   * `is_partial` only says a bucket was clipped by the requested range (e.g. a week crossing 1 January), so it
   * cannot mark an unfinished period.
   */
  today?: string;
}

/** WCAG contrast ratio of two #rgb/#rrggbb colours; null when either cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const luminance = (value: string) => {
    const hex = value.trim().replace(/^#/, '');
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    const [r, g, b] = [0, 2, 4].map(i => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [luminance(a), luminance(b)];
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Weekly or monthly trend in the same language as the records monthly chart: no grid lines or value axis,
 * soft rounded bars with the best bucket in full colour and labelled; pace is a line on a reversed axis.
 * Presentation only: the values are the server's bucket aggregates.
 */
export function trendChartOption(trends: Trends, metric: TrendMetric, colors: ChartColors, animate: boolean, receipt?: ReceiptMarks) {
  const buckets = trends.buckets;
  const pace = metric === 'pace';
  const values = buckets.map(bucket => trendValue(bucket, metric));
  const best = pace ? fastestIndex(values) : peakIndex(values.map(value => value ?? 0));
  const label = (text: string, bold = false) => ({ show: true, position: 'top', distance: 6, color: colors.foreground, fontSize: 12, fontWeight: bold ? 700 : 600, fontFamily: receipt ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined, formatter: () => text });
  // Receipt bars: every bar in the accent, the peak in yellow with a bold label and value (yellow alone is not
  // enough: on light paper it is ~2:1, so it also gets a 1px ink outline whenever it falls under 3:1). Monthly
  // bars print every value as a bare number (the unit is in the metric switch); 52 weekly bars only the peak.
  const outline = receipt && (contrastRatio(receipt.mark, receipt.background) ?? 0) < 3;
  const printAll = receipt && (receipt.printAll ?? true) && trends.period === 'month';
  const bare = (text: string) => text.replace(/^(.*\d)\s+\S+$/, '$1');
  const hatch = (color: string) => ({ color, symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -Math.PI / 4 });
  const today = receipt?.today;
  const receiptBar = (bucket: Bucket, i: number) => {
    const peak = i === best && (values[i] ?? 0) > 0;
    const color = peak ? receipt!.mark : colors.primary;
    const running = !!today && bucket.bucket_start <= today && today < bucket.bucket_end;
    return {
      value: values[i],
      itemStyle: {
        color: running && !peak ? receipt!.background : color,
        opacity: 1,
        borderColor: peak && outline ? colors.foreground : running ? color : undefined,
        borderWidth: (peak && outline) || running ? 1 : 0,
        ...(running ? { decal: hatch(color) } : {}),
      },
      ...(peak ? { label: label(trendText(bucket, metric), true) } : printAll && (values[i] ?? 0) > 0 ? { label: label(bare(trendText(bucket, metric))) } : {}),
    };
  };
  const data = pace
    ? buckets.map((bucket, i) => ({ value: values[i], symbolSize: i === best ? 10 : 6, ...(i === best ? { label: label(trendText(bucket, metric), !!receipt) } : {}) }))
    : receipt
      ? buckets.map(receiptBar)
      : buckets.map((bucket, i) => ({ value: values[i], itemStyle: { color: colors.primary, opacity: i === best ? 1 : SOFT_OPACITY }, ...(i === best ? { label: label(trendText(bucket, metric)) } : {}) }));
  const labels = buckets.map(bucket => bucketLabel(bucket, trends.period));
  return {
    animation: animate, animationDuration: 500, animationDurationUpdate: 400,
    textStyle: { color: colors.foreground },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground },
      axisPointer: { type: pace ? 'line' : 'shadow', shadowStyle: { color: colors.border, opacity: .35 }, lineStyle: { color: colors.border } },
      formatter: (params: { dataIndex: number }[]) => {
        const bucket = buckets[params[0]?.dataIndex];
        if (!bucket) return '';
        const head = `${trends.period === 'week' ? `${bucketLabel(bucket, 'week')} 起的一周` : bucketLabel(bucket, 'month')}${bucket.is_partial ? '（部分）' : ''}`;
        return `${head}\n${TREND_LABELS[metric]} ${trendText(bucket, metric)}\n${bucket.activity_count} 次 · 里程 ${dashboardDistance(bucket.distance_m)}`;
      }
    },
    // Side room so the label over a first or last bar is never clipped.
    grid: { left: 24, right: 24, top: 28, bottom: 28 },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { show: true, lineStyle: { color: colors.border } }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: receipt
        ? {
            color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10,
            formatter: (value: string, index: number) => (index === best ? `{peak|${value}}` : value),
            rich: { peak: { color: colors.foreground, fontWeight: 700, fontSize: 11 } }
          }
        : { color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10 }
    },
    yAxis: pace
      // Lower is faster, so the axis is reversed and the line climbs as the runner gets quicker.
      ? { type: 'value', show: false, inverse: true, scale: true, splitLine: { show: false } }
      : { type: 'value', show: false, min: 0, splitLine: { show: false } },
    series: [pace
      ? { name: TREND_LABELS[metric], type: 'line', data, connectNulls: false, symbol: 'circle', showSymbol: true, itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 }, lineStyle: { color: colors.primary, width: 2.5 } }
      : receipt
        ? { name: TREND_LABELS[metric], type: 'bar', data, barMaxWidth: 28, barCategoryGap: '42%', itemStyle: { borderRadius: 0 }, emphasis: { disabled: true } }
        : { name: TREND_LABELS[metric], type: 'bar', data, barMaxWidth: 22, barCategoryGap: '38%', itemStyle: { borderRadius: [6, 6, 2, 2] }, emphasis: { itemStyle: { opacity: 1 } } }]
  };
}
