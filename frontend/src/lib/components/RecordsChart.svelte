<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { buildChartOption, type ChartSpec } from './records-chart';
  let { spec, label, columns, rows, testid }: { spec: ChartSpec; label: string; columns: string[]; rows: string[][]; testid: string } = $props();
  let container: HTMLDivElement, mounted = $state(false), message = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  function draw() {
    if (!chart) return;
    const style = getComputedStyle(container);
    const color = (name: string) => style.getPropertyValue(name).trim();
    chart.setOption(buildChartOption(spec, {
      foreground: color('--foreground'), muted: color('--muted-foreground'), border: color('--border'), surface: color('--surface'),
      primary: color('--chart-series'), secondary: color('--sport-blue')
    }, !window.matchMedia('(prefers-reduced-motion: reduce)').matches), { notMerge: true });
  }
  $effect(() => { spec; if (mounted) draw(); });
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
{#if message}<p role="status" class="text-sm text-muted-foreground">{message}</p>{/if}
<div bind:this={container} class="h-72 w-full" role="img" aria-label={`${label}，下方提供完整数据表`} data-testid={testid} data-ready={mounted ? 'true' : 'false'}></div>
<details class="mt-3" data-testid={`${testid}-table`}>
  <summary class="cursor-pointer text-sm text-primary">查看{label}数据表</summary>
  <div class="mt-3 max-h-80 overflow-auto">
    <table class="w-full text-left text-sm">
      <thead><tr>{#each columns as column}<th>{column}</th>{/each}</tr></thead>
      <tbody>{#each rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody>
    </table>
    {#if rows.some(row => row.includes('—'))}<p class="sr-only">表中“—”表示该项缺失或无法可靠计算。</p>{/if}
  </div>
</details>
