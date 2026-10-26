<script lang="ts">
  import { onMount } from 'svelte';
  import { useViewContext } from '#lib/view-context.ts';
  import { ActivityError, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { CATEGORY_NAMES, readRecords as scoped_readRecords, signedDistance, type Records } from '#lib/api/records.ts';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 2);
  let data = $state<Records | null>(null), loading = $state(true), message = $state('');
  let disposed = false, token = 0;
  const month = $derived(data ? Number(data.cutoff_date.slice(5, 7)) : 0);

  async function load() {
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readRecords();
      if (!disposed && mine === token) data = result;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; data = null; window.location.replace('/admin?reason=expired&next=%2Fdashboard'); return; }
      data = null; message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; }; });
</script>
<section class="records-card" aria-labelledby="records-card-title" aria-busy={loading} data-testid="records-card">
  <div class="records-card-head">
    <div><p class="eyebrow">个人记录</p><h2 id="records-card-title">最佳成绩与同期对比</h2></div>
    <a class="button-secondary" href={view.href('/records')}>查看全部</a>
  </div>
  {#if message}
    <p role="status">{message} <button class="button-secondary" onclick={() => { void load(); }}>重试</button></p>
  {:else if data}
    <dl class="records-card-metrics">
      {#each data.personal_bests as item (item.category)}
        <div><dt>{CATEGORY_NAMES[item.category]} 最佳</dt><dd data-testid={`records-card-${item.category}`}>{item.best ? formatPace(item.best.avg_pace_seconds_per_km) : '—'}{#if !item.best}<span class="sr-only">（暂无符合条件的记录）</span>{/if}</dd></div>
      {/each}
      <div><dt>{month} 月里程</dt><dd data-testid="records-card-month">{dashboardDistance(data.monthly[month - 1]?.distance_m ?? null)}</dd></div>
      <div><dt>较 {data.compare_year} 年同期</dt><dd data-testid="records-card-delta">{signedDistance(data.comparison.delta.distance_m)}</dd></div>
    </dl>
  {/if}
</section>
<style>
  .records-card { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .records-card-head { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: var(--space-3); }
  .eyebrow { color: var(--muted-foreground); font-size: var(--text-small); }
  .records-card-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); margin-top: var(--space-4); }
  .records-card-metrics dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .records-card-metrics dd { font-weight: var(--weight-semibold); }
  @media (max-width: 640px) { .records-card-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
