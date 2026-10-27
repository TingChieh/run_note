<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import type { Trends } from '#lib/api/statistics.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { TREND_LABELS, trendChartOption, trendText, type TrendMetric } from './trend-chart';
  // Weekly or monthly trend for one year; the chart is presentation only, the table below is the full fallback.
  let { trends, metric }: { trends: Trends; metric: TrendMetric } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  const unit = $derived(trends.period === 'week' ? '周' : '月');
  const missing = $derived(trends.buckets.some(bucket => trendText(bucket, 'duration') === '—' || trendText(bucket, 'pace') === '—'));
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (token: string) => style.getPropertyValue(token).trim();
    chart.setOption(trendChartOption(trends, metric, {
      foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'), surface: color('--surface'), primary: color('--chart-series')
    }, !window.matchMedia('(prefers-reduced-motion: reduce)').matches), { notMerge: true });
  }
  $effect(() => { trends; metric; if (mounted) draw(); });
  onMount(() => {
    let disposed = false; let observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => { try { const ec = await import('./trend-chart-runtime'); if (disposed) return; chart = ec.init(container); mounted = true; draw(); observer = new ResizeObserver(() => chart?.resize()); observer.observe(container); } catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; } })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>
{#if message}<p role="status" class="chart-message">{message}</p>{/if}
<div bind:this={container} class="trend-chart" role="img" aria-label={`每${unit}${TREND_LABELS[metric]}趋势，下方提供完整数据表`}></div>
<details class="data-table">
  <summary>查看每{unit}数据</summary>
  <div class="table-scroll">
    <table>
      <caption class="sr-only">每{unit}{TREND_LABELS[metric]}、活动次数、里程与覆盖量</caption>
      <thead><tr><th scope="col">开始日期</th><th scope="col">{TREND_LABELS[metric]}</th><th scope="col">活动次数</th><th scope="col">里程</th><th scope="col">已知/未知耗时</th><th scope="col">配速有效</th></tr></thead>
      <tbody>{#each trends.buckets as bucket (bucket.bucket_start)}<tr><th scope="row">{bucket.bucket_start}{bucket.is_partial ? '（部分）' : ''}</th><td>{trendText(bucket, metric)}</td><td>{bucket.activity_count} 次</td><td>{dashboardDistance(bucket.distance_m)}</td><td>{bucket.known_duration_count} / {bucket.missing_duration_count}</td><td>{bucket.pace_eligible_count}</td></tr>{/each}</tbody>
    </table>
    {#if missing}<p class="sr-only">表中“—”表示该周期没有已知耗时或可靠配速。</p>{/if}
  </div>
</details>

<style>
  .trend-chart { width: 100%; height: 16rem; margin-top: var(--space-4); }
  .chart-message { margin-top: var(--space-3); color: var(--muted-foreground); font-size: var(--text-small); }
  .data-table { margin-top: var(--space-4); font-size: var(--text-small); }
  .data-table summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .table-scroll { position: relative; max-height: 20rem; margin-top: var(--space-3); overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
  :is(th, td) { padding: var(--space-1) var(--space-3) var(--space-1) 0; border-top: 1px solid var(--border); white-space: nowrap; }
  thead th { border-top: 0; color: var(--muted-foreground); font-weight: var(--weight-medium); }
  tbody th { font-weight: var(--weight-medium); }
  @media (max-width: 639px) { .trend-chart { height: 13rem; } }
</style>
