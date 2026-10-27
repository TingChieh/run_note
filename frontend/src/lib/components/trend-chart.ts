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

/**
 * Weekly or monthly trend in the same language as the records monthly chart: no grid lines or value axis,
 * soft rounded bars with the best bucket in full colour and labelled; pace is a line on a reversed axis.
 * Presentation only: the values are the server's bucket aggregates.
 */
export function trendChartOption(trends: Trends, metric: TrendMetric, colors: ChartColors, animate: boolean) {
  const buckets = trends.buckets;
  const pace = metric === 'pace';
  const values = buckets.map(bucket => trendValue(bucket, metric));
  const best = pace ? fastestIndex(values) : peakIndex(values.map(value => value ?? 0));
  const label = (text: string) => ({ show: true, position: 'top', distance: 6, color: colors.foreground, fontSize: 12, fontWeight: 600, formatter: () => text });
  const data = pace
    ? buckets.map((bucket, i) => ({ value: values[i], symbolSize: i === best ? 10 : 6, ...(i === best ? { label: label(trendText(bucket, metric)) } : {}) }))
    : buckets.map((bucket, i) => ({ value: values[i], itemStyle: { color: colors.primary, opacity: i === best ? 1 : SOFT_OPACITY }, ...(i === best ? { label: label(trendText(bucket, metric)) } : {}) }));
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
      type: 'category', data: buckets.map(bucket => bucketLabel(bucket, trends.period)),
      axisLine: { show: true, lineStyle: { color: colors.border } }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10 }
    },
    yAxis: pace
      // Lower is faster, so the axis is reversed and the line climbs as the runner gets quicker.
      ? { type: 'value', show: false, inverse: true, scale: true, splitLine: { show: false } }
      : { type: 'value', show: false, min: 0, splitLine: { show: false } },
    series: [pace
      ? { name: TREND_LABELS[metric], type: 'line', data, connectNulls: false, symbol: 'circle', showSymbol: true, itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 }, lineStyle: { color: colors.primary, width: 2.5 } }
      : { name: TREND_LABELS[metric], type: 'bar', data, barMaxWidth: 22, barCategoryGap: '38%', itemStyle: { borderRadius: [6, 6, 2, 2] }, emphasis: { itemStyle: { opacity: 1 } } }]
  };
}
