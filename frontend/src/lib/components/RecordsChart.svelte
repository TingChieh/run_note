<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { monthlyChartOption, type MonthlyMetric } from './records-chart';
  import { formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { monthLabel, type MonthPoint } from '#lib/api/records.ts';
  // Monthly distance or pace over the whole history; the chart is presentation only, the table below is the full fallback.
  let { monthly, metric }: { monthly: MonthPoint[]; metric: MonthlyMetric } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  const name = $derived(metric === 'distance' ? '月度里程' : '月度配速');
  // The selected metric comes first after the month.
  const columns = $derived(metric === 'distance' ? ['里程', '活动次数', '配速'] : ['配速', '活动次数', '里程']);
  const cell = (point: MonthPoint, column: string) => column === '里程' ? dashboardDistance(point.distance_m) : column === '活动次数' ? `${point.activity_count} 次` : formatPace(point.avg_pace_seconds_per_km);
  const missing = $derived(monthly.some(point => point.avg_pace_seconds_per_km === null));

  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (token: string) => style.getPropertyValue(token).trim();
    chart.setOption(monthlyChartOption(monthly, metric, {
      foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'), surface: color('--surface'), primary: color('--chart-series')
    }, !window.matchMedia('(prefers-reduced-motion: reduce)').matches), { notMerge: true });
  }
  $effect(() => { monthly; metric; if (mounted) draw(); });
  onMount(() => {
    let disposed = false; let observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => {
      try {
        const ec = await import('./records-chart-runtime'); if (disposed) return;
        chart = ec.init(container); mounted = true; draw();
        observer = new ResizeObserver(() => chart?.resize()); observer.observe(container);
      } catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; }
    })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>

{#if message}<p role="status" class="chart-message">{message}</p>{/if}
<div bind:this={container} class="monthly-chart" role="img" aria-label={`${name}，共 ${monthly.length} 个月，下方提供完整数据表`} data-testid="records-chart-monthly" data-ready={mounted ? 'true' : 'false'}></div>
<details class="data-table" data-testid="records-chart-monthly-table">
  <summary>查看每月数据</summary>
  <div class="table-scroll">
    <table>
      <caption class="sr-only">每月里程、活动次数与配速</caption>
      <thead><tr><th scope="col">月份</th>{#each columns as column (column)}<th scope="col">{column}</th>{/each}</tr></thead>
      <tbody>
        {#each monthly as point (point.month_start)}
          <tr><th scope="row">{monthLabel(point.month_start)}</th>{#each columns as column (column)}<td>{cell(point, column)}</td>{/each}</tr>
        {/each}
      </tbody>
    </table>
    {#if missing}<p class="sr-only">表中“—”表示该月没有可靠配速。</p>{/if}
  </div>
</details>

<style>
  .monthly-chart { width: 100%; height: 16rem; margin-top: var(--space-4); }
  .chart-message { margin-top: var(--space-3); color: var(--muted-foreground); font-size: var(--text-small); }
  @media (max-width: 639px) { .monthly-chart { height: 13rem; } }
</style>
