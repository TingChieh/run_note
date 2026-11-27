<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from './system-theme.ts';
  import FeedbackState from './FeedbackState.svelte';
  import { formatDuration, formatPace } from '#lib/api/activities.ts';
  import { extractPaceSamples, extractSplits } from '#lib/api/activity-splits.ts';
  import type { ReplayData } from '#lib/api/replay.ts';

  let {
    replay,
    loading = false,
    error = '',
    routeUnavailable = false,
    hasRoute = false,
    avgPaceSecondsPerKm = null,
    onretry,
  }: {
    replay: ReplayData | null;
    loading?: boolean;
    error?: string;
    routeUnavailable?: boolean;
    hasRoute?: boolean;
    avgPaceSecondsPerKm?: number | null;
    onretry?: () => void;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let chartError = $state('');
  let chart: import('echarts/core').ECharts | undefined;
  let runtime: typeof import('./wellbeing-chart-runtime.ts') | undefined;
  let disposed = false;

  const splits = $derived(extractSplits(replay));
  const samples = $derived(extractPaceSamples(replay, 120));
  const fastest = $derived(splits.find((s) => s.fastest) ?? null);
  const sectionMeta = $derived.by(() => {
    if (!hasRoute) return '无轨迹';
    if (error) return '读取失败';
    if (routeUnavailable) return '等待路线';
    if (loading || !replay) return '正在读取…';
    if (replay.mode === 'simulated') return '模拟轨迹';
    if (avgPaceSecondsPerKm !== null) return `均值 ${formatPace(avgPaceSecondsPerKm)} · 按轨迹采样`;
    return samples.length ? '按轨迹采样' : '';
  });
  const ariaLabel = $derived.by(() => {
    const parts = ['配速随距离变化曲线'];
    if (avgPaceSecondsPerKm !== null) parts.push(`平均配速 ${formatPace(avgPaceSecondsPerKm)}`);
    if (fastest?.paceSecondsPerKm)
      parts.push(`第 ${fastest.label} 公里最快 ${formatPace(fastest.paceSecondsPerKm)}`);
    parts.push('下方提供分段数据表');
    return parts.join('，');
  });

  function draw() {
    if (!chart || !container || !samples.length) return;
    const style = getComputedStyle(container);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const primary = token('--primary') || '#17745c';
    const border = token('--border') || '#e0e6da';
    const muted = token('--muted-foreground') || '#5c695e';
    const foreground = token('--foreground') || '#202d23';
    const surface = token('--surface') || '#ffffff';
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    const paces = samples.map((s) => s.paceSecondsPerKm);
    const minPace = Math.min(...paces, ...(avgPaceSecondsPerKm ? [avgPaceSecondsPerKm] : []));
    const maxPace = Math.max(...paces, ...(avgPaceSecondsPerKm ? [avgPaceSecondsPerKm] : []));
    const pad = Math.max(15, Math.round((maxPace - minPace) * 0.2));
    const yMin = Math.max(60, Math.floor((minPace - pad) / 15) * 15);
    const yMax = Math.ceil((maxPace + pad) / 15) * 15;
    const maxKm = Math.max(0.1, samples[samples.length - 1].distanceKm);
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    chart.setOption(
      {
        animation: animate,
        animationDuration: 360,
        textStyle: { color: foreground },
        grid: { left: 46, right: 16, top: 18, bottom: 26 },
        tooltip: {
          trigger: 'axis',
          renderMode: 'richText',
          backgroundColor: surface,
          borderColor: border,
          textStyle: { color: foreground, fontFamily: mono, fontSize: 12 },
          axisPointer: { type: 'line', lineStyle: { color: border } },
          formatter: (params: { value: [number, number] }[]) => {
            const point = params[0]?.value;
            if (!point) return '';
            return `${point[0].toFixed(2)} km\n配速 ${formatPace(point[1])}`;
          },
        },
        xAxis: {
          type: 'value',
          min: 0,
          max: maxKm,
          axisLine: { show: true, lineStyle: { color: border } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: muted,
            fontFamily: mono,
            fontSize: 11,
            formatter: (v: number) => (v === 0 ? '0' : `${Number(v.toFixed(1))} km`),
          },
        },
        yAxis: {
          type: 'value',
          inverse: true,
          min: yMin,
          max: yMax,
          splitNumber: 3,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: border, opacity: 0.65 } },
          axisLabel: {
            color: muted,
            fontFamily: mono,
            fontSize: 11,
            formatter: (v: number) => formatDuration(v),
          },
        },
        series: [
          {
            type: 'line',
            showSymbol: false,
            smooth: 0.15,
            data: samples.map((s) => [Number(s.distanceKm.toFixed(3)), s.paceSecondsPerKm]),
            lineStyle: { color: primary, width: 2 },
            itemStyle: { color: primary },
            ...(avgPaceSecondsPerKm !== null
              ? {
                  markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { color: muted, type: 'dashed', width: 1 },
                    label: {
                      show: true,
                      position: 'insideEndTop',
                      color: muted,
                      fontFamily: mono,
                      fontSize: 11,
                      formatter: `均 ${formatDuration(avgPaceSecondsPerKm)}`,
                    },
                    data: [{ yAxis: avgPaceSecondsPerKm }],
                  },
                }
              : {}),
          },
        ],
      },
      { notMerge: true },
    );
  }

  async function ensureChart(node: HTMLDivElement) {
    if (chart && chart.getDom() === node) {
      draw();
      return;
    }
    chart?.dispose();
    chart = undefined;
    try {
      runtime ??= await import('./wellbeing-chart-runtime.ts');
      if (disposed || container !== node) return;
      chart = runtime.init(node);
      chartError = '';
      draw();
    } catch {
      if (!disposed) chartError = '配速图表暂时无法显示，下方分段数据表仍可查看。';
    }
  }

  $effect(() => {
    const node = container;
    const count = samples.length;
    void samples;
    void avgPaceSecondsPerKm;
    if (node && count > 0) {
      void ensureChart(node);
      const observer = new ResizeObserver(() => chart?.resize());
      observer.observe(node);
      return () => observer.disconnect();
    }
    chart?.dispose();
    chart = undefined;
  });

  onMount(() => {
    const stopTheme = watchSystemTheme(() => draw());
    return () => {
      disposed = true;
      stopTheme();
      chart?.dispose();
      chart = undefined;
    };
  });
</script>

<section class="section-rule pace-section" aria-labelledby="pace-chart-title" data-testid="activity-pace-section">
  <div class="section-head">
    <h2 id="pace-chart-title">配速曲线</h2>
    {#if sectionMeta}<span class="section-meta mono-meta">{sectionMeta}</span>{/if}
  </div>

  {#if !hasRoute}
    <p class="pace-empty">此活动没有路线，暂无法绘制配速曲线。</p>
  {:else if error}
    <div class="pace-feedback">
      <FeedbackState kind="error" title={error}>
        {#if onretry}<button type="button" class="button-secondary mt-3" onclick={onretry}>重新读取</button>{/if}
      </FeedbackState>
    </div>
  {:else if routeUnavailable}
    <p class="pace-empty">路线暂未就绪，重新读取路线后将自动加载配速曲线。</p>
  {:else if loading || !replay}
    <div class="pace-feedback">
      <FeedbackState kind="loading" title="正在读取配速曲线…" />
    </div>
  {:else if samples.length > 0}
    {#if chartError}<p role="status" class="pace-empty">{chartError}</p>{/if}
    <div
      bind:this={container}
      class="pace-canvas"
      role="img"
      aria-label={ariaLabel}
      data-testid="activity-pace-chart"
    ></div>
    {#if splits.length > 0}
      <details class="splits-table" data-testid="activity-splits-details">
        <summary>查看分段数据表</summary>
        <p class="splits-note">
          每公里分段由前端按回放轨迹的距离与移动时间采样推导，可能与服务端统计的总平均配速略有差异。
        </p>
        <div class="table-scroll" role="region" aria-label="每公里分段数据表">
          <table>
            <caption class="sr-only">本次跑步每公里配速与累计用时（按轨迹采样）</caption>
            <thead>
              <tr>
                <th scope="col">公里</th>
                <th scope="col" class="num">距离</th>
                <th scope="col" class="num">配速</th>
                <th scope="col" class="num">累计用时</th>
              </tr>
            </thead>
            <tbody>
              {#each splits as row (row.index)}
                <tr class:fastest={row.fastest}>
                  <th scope="row">{row.label}</th>
                  <td class="num">{(row.distanceM / 1000).toFixed(2)} km</td>
                  <td class="num">
                    {#if row.paceSecondsPerKm !== null}
                      {formatPace(row.paceSecondsPerKm)}{#if row.fastest}<span class="fastest-mark"> 最快</span>{/if}
                    {:else}
                      —<span class="sr-only">（缺失或无法可靠计算）</span>
                    {/if}
                  </td>
                  <td class="num">{formatDuration(row.cumulativeSeconds)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  {:else}
    <p class="pace-empty">此记录缺少可靠时间轨迹，暂无法绘制配速曲线。</p>
  {/if}
</section>

<style>
  .pace-section {
    margin-top: var(--space-8);
  }
  .mono-meta {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }
  .pace-canvas {
    width: 100%;
    height: 11.5rem;
    margin-top: var(--space-3);
  }
  .pace-feedback {
    margin-top: var(--space-4);
  }
  .pace-empty {
    margin-top: var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .splits-table {
    margin-top: var(--space-3);
    font-size: var(--text-small);
  }
  .splits-table summary {
    padding-block: 0.625rem;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .splits-note {
    margin-top: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .table-scroll {
    margin-top: var(--space-2);
    max-height: 18rem;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 0.625rem var(--space-3) 0.625rem 0;
    border-top: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    border-top: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
  }
  tbody th {
    font-family: var(--font-mono);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
  }
  .num {
    text-align: right;
  }
  tr.fastest td {
    font-weight: var(--weight-semibold);
  }
  .fastest-mark {
    margin-left: var(--space-1);
    color: var(--primary);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
  }
</style>
