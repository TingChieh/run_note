<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import RouteGroupTrend from '#lib/components/RouteGroupTrend.svelte';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { readRouteGroup as scoped_readRouteGroup, shapeRoute, RouteGroupError, type RouteGroupDetail } from '#lib/api/route-groups.ts';
  const view = useViewContext();
  const readRouteGroup = view.bind(scoped_readRouteGroup, 2);
  let data = $state<RouteGroupDetail | null>(null), loading = $state(true), message = $state('');
  let requestId = 0, disposed = false, controller: AbortController | undefined;
  const route = $derived(data ? shapeRoute(data.shape) : null);
  async function load() {
    const id = ++requestId; controller?.abort(); controller = new AbortController();
    loading = true; message = '';
    try {
      const result = await readRouteGroup(page.params.id ?? '', controller.signal);
      if (disposed || id !== requestId) return;
      data = result;
    } catch (cause) {
      if (disposed || id !== requestId || controller.signal.aborted) return;
      if (cause instanceof RouteGroupError && cause.status === 401) { data = null; window.location.replace('/admin?reason=changed'); return; }
      data = null; message = cause instanceof Error ? cause.message : '无法读取路线，请重试';
    } finally { if (!disposed && id === requestId) loading = false; }
  }
  onMount(() => { disposed = false; void load(); return () => { disposed = true; ++requestId; controller?.abort(); }; });
</script>
<svelte:head><title>{pageTitle('常跑路线详情', page.data.site)}</title></svelte:head>
<PageHeader title={data ? `约 ${formatDistance(data.median_distance_m)} 路线` : '常跑路线'} description={data ? `${data.first_date} – ${data.last_date} · 共 ${data.run_count} 次` : undefined} />
<div class="detail">
  <a class="button-secondary back" href={view.href('/routes')}>返回常跑路线</a>
  {#if loading}<PageSkeleton title="正在读取路线…" />{/if}
  {#if message}<FeedbackState kind="error" title={message}><button class="button-secondary" onclick={load}>重新读取</button></FeedbackState>{/if}
  {#if data && route}
    <div data-testid="route-detail-ready" class="stack">
      <dl class="facts">
        <div><dt>最佳用时</dt><dd>{formatDuration(data.best_duration_seconds)}</dd></div>
        <div><dt>平均用时</dt><dd>{formatDuration(data.avg_duration_seconds)}</dd></div>
        <div><dt>最佳配速</dt><dd>{formatPace(data.best_pace_seconds_per_km)}</dd></div>
        <div><dt>平均配速</dt><dd>{formatPace(data.avg_pace_seconds_per_km)}</dd></div>
      </dl>
      <RouteMap {route} spacious />
      <section aria-label="历次用时趋势"><h2>历次用时</h2><RouteGroupTrend runs={data.runs} /></section>
      <section aria-label="历次成绩"><h2>成绩列表</h2>
        <div class="table-wrap"><table><thead><tr><th>日期</th><th>标题</th><th>距离</th><th>用时</th><th>配速</th></tr></thead><tbody>
          {#each data.runs as run (run.activity_id)}
            <tr data-testid="route-run-row"><td>{run.activity_date}</td><td><a href={view.href(`/activities/${run.activity_id}`)}>{run.title || '未命名活动'}</a></td><td>{formatDistance(run.distance_m)}</td><td>{run.duration_seconds === null ? '—' : formatDuration(run.duration_seconds)}{#if run.duration_seconds === null}<span class="sr-only">未记录用时</span>{/if}</td><td>{formatPace(run.avg_pace_seconds_per_km)}</td></tr>
          {/each}
        </tbody></table></div>
      </section>
    </div>
  {/if}
</div>
<style>
  .detail, .stack { display: grid; gap: var(--space-4); min-width: 0; }
  .detail { margin-top: var(--space-6); }
  .back { justify-self: start; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .75rem; }
  dt { color: var(--muted-foreground); font-size: var(--text-small); }
  dd { font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  h2 { font-weight: var(--weight-semibold); margin-bottom: .5rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; text-align: left; font-size: var(--text-small); }
  th, td { padding: .5rem .75rem .5rem 0; white-space: nowrap; }
  tbody tr { border-top: 1px solid var(--border); }
</style>
