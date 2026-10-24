<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { formatDuration, type Metric } from '#lib/api/activities.ts';
  import type { RouteRun } from '#lib/api/route-groups.ts';
  let { runs }: { runs: RouteRun[] } = $props();
  const ordered = $derived([...runs].sort((a, b) => a.activity_date.localeCompare(b.activity_date)));
  const minutes = (value: Metric) => value === null ? null : Number(value) / 60;
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container), color = (name: string) => style.getPropertyValue(name).trim();
    const foreground = color('--foreground'), muted = color('--muted-foreground'), border = color('--border');
    chart.setOption({
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      textStyle: { color: foreground },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: color('--surface'), borderColor: border, textStyle: { color: foreground }, valueFormatter: (value: number | null) => value === null ? '—' : formatDuration(value * 60) },
      grid: { left: 55, right: 20, top: 30, bottom: 50 },
      xAxis: { type: 'category', data: ordered.map(run => run.activity_date), axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted } },
      yAxis: { type: 'value', name: '用时（分钟）', scale: true, nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: border } } },
      series: [{ name: '用时', type: 'line', connectNulls: false, data: ordered.map(run => minutes(run.duration_seconds)), itemStyle: { color: color('--chart-series') }, lineStyle: { color: color('--chart-series') } }]
    }, { notMerge: true });
  }
  $effect(() => { ordered; if (mounted) draw(); });
  onMount(() => {
    let disposed = false, observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => {
      try { const ec = await import('./trend-chart-runtime'); if (disposed) return; chart = ec.init(container); mounted = true; draw(); observer = new ResizeObserver(() => chart?.resize()); observer.observe(container); }
      catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; }
    })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>
{#if message}<p role="status">{message}</p>{/if}
<div bind:this={container} class="h-72 w-full" role="img" aria-label="历次用时趋势，下方提供完整数据表"></div>
<details class="mt-3"><summary class="cursor-pointer text-sm text-primary">查看趋势数据</summary>
  <div class="mt-3 max-h-80 overflow-auto"><table class="w-full text-left text-sm"><thead><tr><th>日期</th><th>用时</th></tr></thead><tbody>
    {#each ordered as run}<tr class="border-t border-border"><td class="py-2">{run.activity_date}</td><td>{run.duration_seconds === null ? '—' : formatDuration(run.duration_seconds)}{#if run.duration_seconds === null}<span class="sr-only">未记录用时</span>{/if}</td></tr>{/each}
  </tbody></table></div>
</details>
