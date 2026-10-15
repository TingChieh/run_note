<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import type { Trends } from '#lib/api/statistics.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  let { trends, metric, enhanced = false }: { trends: Trends; metric: 'distance' | 'count' | 'duration' | 'pace'; enhanced?: boolean } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  const labels = { distance: '距离（km）', count: '活动次数', duration: '已知耗时（分钟）', pace: '可靠配速（分钟/km）' };
  function value(b: Trends['buckets'][number]) { const n = metric === 'distance' ? b.distance_m : metric === 'count' ? b.activity_count : metric === 'duration' ? b.duration_sum_seconds : b.avg_pace_seconds_per_km; return n === null ? null : Number(n) / (metric === 'distance' ? 1000 : metric === 'count' ? 1 : 60); }
  function display(b: Trends['buckets'][number]) { return metric === 'distance' ? (enhanced ? dashboardDistance(b.distance_m) : formatDistance(b.distance_m)) : metric === 'count' ? `${b.activity_count} 次` : metric === 'duration' ? formatDuration(b.duration_sum_seconds) : formatPace(b.avg_pace_seconds_per_km); }
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const foreground = color('--foreground'), muted = color('--muted-foreground'), border = color('--border');
    chart.setOption({
      animation: false,
      textStyle: { color: foreground },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: color('--surface'), borderColor: border, textStyle: { color: foreground }, valueFormatter: enhanced ? (value: number | null) => value === null ? '—' : metric === 'distance' && enhanced ? dashboardDistance(value * 1000) : metric === 'pace' ? formatPace(value * 60) : metric === 'count' ? `${value} 次` : `${value} 分钟` : undefined },
      grid: { left: enhanced ? 45 : 65, right: 20, top: 40, bottom: 60 },
      xAxis: { type: 'category', data: trends.buckets.map(b => `${b.bucket_start}${b.is_partial ? '（部分）' : ''}`), axisLine: { lineStyle: { color: border } }, axisTick: { lineStyle: { color: border } }, axisLabel: { color: muted, rotate: enhanced ? 0 : 35, fontSize: enhanced ? 11 : 10, formatter: (label: string) => enhanced ? label.slice(5) : label } },
      yAxis: { type: 'value', name: labels[metric], min: 0, nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: border } } },
      series: [{ name: labels[metric], type: metric === 'count' || metric === 'distance' ? 'bar' : 'line', connectNulls: false, data: trends.buckets.map(value), itemStyle: { color: color('--chart-series') }, lineStyle: { color: color('--chart-series') } }]
    }, { notMerge: true });
  }
  $effect(() => { trends; metric; if (mounted) draw(); });
  onMount(() => {
    let disposed = false; let observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => { try { const ec = await import('./trend-chart-runtime'); if (disposed) return; chart = ec.init(container); mounted = true; draw(); observer = new ResizeObserver(() => chart?.resize()); observer.observe(container); } catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; } })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>
{#if message}<p role="status">{message}</p>{/if}
<div bind:this={container} class="h-80 w-full" role="img" aria-label={`${trends.period === 'week' ? '周' : '月'}${labels[metric]}趋势，下方提供完整数据表`}></div>
{#if trends.buckets.every(b => b.activity_count === 0)}<p class="text-sm text-muted-foreground">这一年还没有活动，趋势以空桶展示。</p>{/if}
<details class="mt-3"><summary class="cursor-pointer text-sm text-primary">查看趋势数据与覆盖量</summary><div class="mt-3 max-h-80 overflow-auto"><table class="w-full text-left text-sm"><thead><tr><th>开始日期</th><th>范围</th><th>{labels[metric]}</th><th>已知/未知耗时活动</th><th>配速有效活动</th></tr></thead><tbody>{#each trends.buckets as bucket}<tr class="border-t border-border"><td class="py-2">{bucket.bucket_start}</td><td>{bucket.is_partial ? '部分周期' : '完整周期'}</td><td>{display(bucket)}</td><td>{bucket.known_duration_count} / {bucket.missing_duration_count}</td><td>{bucket.pace_eligible_count}</td></tr>{/each}</tbody></table></div></details>
