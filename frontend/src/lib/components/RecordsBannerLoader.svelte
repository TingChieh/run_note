<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { currentYear } from '#lib/api/statistics.ts';
  import { readRecords as scoped_readRecords, type Records } from '#lib/api/records.ts';
  import FeedbackState from './FeedbackState.svelte';
  import RecordsBanner from './RecordsBanner.svelte';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 0);
  let records = $state<Records | null>(null), loading = $state(true), message = $state('');
  let disposed = false, token = 0;
  const year = $derived(currentYear(page.data.showcase?.timezone ?? 'UTC'));

  async function load() {
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readRecords();
      if (!disposed && mine === token) records = result;
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; records = null; window.location.replace('/admin?reason=expired&next=%2Fdashboard'); return; }
      if (mine === token) { records = null; message = cause instanceof Error ? cause.message : '读取失败，请稍后重试'; }
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; token++; records = null; }; });
</script>

{#if records}
  <RecordsBanner bests={records.personal_bests} totals={records.totals} href={view.href('/records')} {year} />
{:else if message}
  <section aria-label="个人记录" data-testid="records-banner-slot">
    <FeedbackState kind="error" title="个人记录暂时读不到"><p>{message}</p><button type="button" class="button-secondary retry" onclick={() => { void load(); }} aria-label="重试读取个人记录">重试</button></FeedbackState>
  </section>
{:else}
  <!-- Same frame and roughly the same height as the banner, so the page below does not jump. -->
  <section class="records-slot" aria-label="个人记录" aria-busy={loading} data-testid="records-banner-slot">
    <FeedbackState kind="loading" title="正在读取个人记录…" />
  </section>
{/if}

<style>
  .records-slot { display: grid; align-content: center; min-width: 0; min-height: 18rem; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .retry { margin-top: var(--space-3); }
  @media (max-width: 639px) { .records-slot { min-height: 34rem; padding: 1.15rem; } }
</style>
