<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { CHART_META, chartSummary, recordedDays, wellbeingChartOption, type WellbeingChartKind } from './wellbeing-chart';
  import { dateLabel, type TrendDay } from '#lib/api/wellbeing.ts';
  // One trend chart. Presentation only: values are the server's daily records, gaps stay gaps, and the table below is the full fallback.
  let { kind, series }: { kind: WellbeingChartKind; series: TrendDay[] } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  const meta = $derived(CHART_META[kind]);
  const empty = $derived(recordedDays(kind, series) === 0);

  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (token: string) => style.getPropertyValue(token).trim();
    chart.setOption(wellbeingChartOption(kind, series, {
      foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'), surface: color('--surface'), primary: color('--chart-series'), accent: color('--warning')
    }, !window.matchMedia('(prefers-reduced-motion: reduce)').matches), { notMerge: true });
  }
  $effect(() => { kind; series; if (mounted) draw(); });
  onMount(() => {
    let disposed = false; let observer: ResizeObserver | undefined;
    const stopTheme = watchSystemTheme(() => draw());
    void (async () => {
      try {
        const ec = await import('./wellbeing-chart-runtime'); if (disposed) return;
        chart = ec.init(container); mounted = true; draw();
        observer = new ResizeObserver(() => chart?.resize()); observer.observe(container);
      } catch { if (!disposed) message = '图表暂时无法显示，下方数据表仍可查看。'; }
    })();
    return () => { disposed = true; stopTheme(); observer?.disconnect(); chart?.dispose(); chart = undefined; };
  });
</script>

<section class="well-chart" aria-labelledby={`chart-${kind}`} data-testid={`wellbeing-chart-${kind}`}>
  <h3 id={`chart-${kind}`}>{meta.title}</h3>
  <p class="direction">{meta.direction}</p>
  {#if message}<p role="status" class="chart-message">{message}</p>{/if}
  {#if empty}<p class="chart-empty" data-testid={`wellbeing-chart-${kind}-empty`}>{meta.empty}。记录后会显示在这里，缺少记录的日子保持空白。</p>{/if}
  <div bind:this={container} class="chart" class:hidden={empty} role="img" aria-label={chartSummary(kind, series)} data-ready={mounted ? 'true' : 'false'}></div>
  <details class="data-table">
    <summary>查看{meta.title}数据表</summary>
    <div class="table-scroll">
      <table>
        <caption class="sr-only">{meta.title}逐日数据，{meta.direction}</caption>
        <thead><tr><th scope="col">日期</th>{#each meta.columns as column (column.key)}<th scope="col">{column.label}</th>{/each}</tr></thead>
        <tbody>{#each series as day (day.date)}<tr><th scope="row">{dateLabel(day.date)}</th>{#each meta.columns as column (column.key)}<td>{column.format(day)}{#if column.format(day) === '—'}<span class="sr-only">（当天没有记录）</span>{/if}</td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
  </details>
</section>

<style>
  .well-chart { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  h3 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .direction { margin-top: var(--space-1); color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .chart { width: 100%; height: 14rem; margin-top: var(--space-4); }
  .chart.hidden { display: none; }
  .chart-empty, .chart-message { margin-top: var(--space-4); padding: var(--space-4); border: 1px dashed var(--border); border-radius: var(--radius-control); color: var(--muted-foreground); font-size: var(--text-small); }
  .data-table { margin-top: var(--space-4); font-size: var(--text-small); }
  .data-table summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .table-scroll { position: relative; max-height: 20rem; margin-top: var(--space-3); overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
  :is(th, td) { padding: var(--space-1) var(--space-3) var(--space-1) 0; border-top: 1px solid var(--border); white-space: nowrap; }
  thead th { border-top: 0; color: var(--muted-foreground); font-weight: var(--weight-medium); }
  tbody th { font-weight: var(--weight-medium); }
  @media (max-width: 767px) { .well-chart { padding: var(--space-4); } }
  @media (max-width: 639px) { .chart { height: 12rem; } }
</style>
