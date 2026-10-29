<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import PageSkeleton from './PageSkeleton.svelte';
  import WellbeingChart from './WellbeingChart.svelte';
  import WellbeingSideEffects from './WellbeingSideEffects.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { readTrends, type TrendDays, type Trends } from '#lib/api/wellbeing.ts';
  // Trend analysis over the last 7 / 14 / 30 account-local days. Charts show only what was recorded; every chart states which direction is better or worse.
  let days = $state<TrendDays>(7), data = $state<Trends | null>(null), loading = $state(true), message = $state('');
  let disposed = false, token = 0;
  async function load(range: TrendDays) {
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readTrends(range);
      if (disposed || mine !== token) return;
      data = result;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; data = null; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return; }
      message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => () => { disposed = true; token++; data = null; });
  $effect(() => { const range = days; untrack(() => { void load(range); }); });
</script>

<div class="trends" data-testid="wellbeing-trends">
  <section class="card" aria-labelledby="trend-title">
    <div class="head">
      <div><p class="eyebrow">变化趋势</p><h2 id="trend-title">趋势分析</h2></div>
      <div class="settings-tabs" role="group" aria-label="趋势范围">
        {#each [7, 14, 30] as range (range)}<button type="button" aria-pressed={days === range} onclick={() => { days = range as TrendDays; }}>近 {range} 天</button>{/each}
      </div>
    </div>
    <p class="hint">折线按日期连接实际记录；某天没有记录就是空白，不会被当成 0 分，也不会被插值补齐。注意每张图的方向：有的越高越严重，有的越高越好。</p>
    {#if data}<p class="summary" data-testid="wellbeing-trend-summary">{data.start} 至 {data.end}（{data.timezone}）：{days} 天中有 {data.recorded_days} 天填写了状态。</p>{/if}
  </section>

  {#if loading && !data}<PageSkeleton title="正在读取趋势…" />{/if}
  {#if message}<div data-testid="wellbeing-trends-error"><FeedbackState kind="error" title={message}><button type="button" class="button-secondary" onclick={() => { void load(days); }} aria-label="重试读取趋势">重试</button></FeedbackState></div>{/if}
  {#if data}
    <div class="charts" aria-busy={loading}>
      <WellbeingChart kind="mood" series={data.series} />
      <WellbeingChart kind="anxiety" series={data.series} />
      <WellbeingChart kind="energy_focus" series={data.series} />
      <WellbeingChart kind="functioning" series={data.series} />
      <WellbeingChart kind="sleep" series={data.series} />
      <WellbeingSideEffects series={data.series} />
    </div>
  {/if}
</div>

<style>
  .trends, .charts { display: grid; gap: var(--space-4); min-width: 0; }
  .card { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-4); }
  .eyebrow { margin-bottom: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint, .summary { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .summary { color: var(--foreground); }
  .card .settings-tabs { background: var(--muted); }
  .card .settings-tabs > button { color: var(--muted-foreground); }
  .card .settings-tabs > button[aria-pressed='true'] { color: var(--primary-foreground); }
  @media (max-width: 767px) { .card { padding: var(--space-4); } }
  @media (min-width: 1100px) { .charts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
