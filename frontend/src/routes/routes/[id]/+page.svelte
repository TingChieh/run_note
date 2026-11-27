<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNextPaint, warmChartLibrary, warmMapLibrary } from '#lib/library-warmup.ts';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import RouteGroupTrend from '#lib/components/RouteGroupTrend.svelte';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import {
    readRouteGroup as scoped_readRouteGroup,
    shapeRoute,
    RouteGroupError,
    type RouteGroupDetail,
  } from '#lib/api/route-groups.ts';
  const view = useViewContext();
  const readRouteGroup = view.bind(scoped_readRouteGroup, 2);
  let data = $state<RouteGroupDetail | null>(null),
    loading = $state(true),
    message = $state('');
  let requestId = 0,
    disposed = false,
    controller: AbortController | undefined;
  const route = $derived(data ? shapeRoute(data.shape) : null);
  async function load() {
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    message = '';
    try {
      const result = await readRouteGroup(page.params.id ?? '', controller.signal);
      if (disposed || id !== requestId) return;
      data = result;
      afterNextPaint(() => {
        warmMapLibrary();
        warmChartLibrary();
      });
    } catch (cause) {
      if (disposed || id !== requestId || controller.signal.aborted) return;
      if (cause instanceof RouteGroupError && cause.status === 401) {
        data = null;
        window.location.replace('/admin?reason=changed');
        return;
      }
      data = null;
      message = cause instanceof Error ? cause.message : '无法读取路线，请重试';
    } finally {
      if (!disposed && id === requestId) loading = false;
    }
  }
  onMount(() => {
    disposed = false;
    void load();
    return () => {
      disposed = true;
      ++requestId;
      controller?.abort();
    };
  });
</script>

<svelte:head><title>{pageTitle('常跑路线详情', page.data.site)}</title></svelte:head>
<div class="editorial-page route-detail-shell">
  <PageHeader
    title={data ? `约 ${formatDistance(data.median_distance_m)} 路线` : '常跑路线'}
    meta={data ? `${data.first_date} – ${data.last_date} · 共 ${data.run_count} 次` : undefined}
  >
    {#snippet actions()}
      <a class="button-secondary" href={view.href('/routes')}>返回常跑路线</a>
    {/snippet}
  </PageHeader>
  <div class="detail">
    {#if loading}<div class="page-loading"><PageSkeleton title="正在读取路线…" /></div>{/if}
    {#if message}<FeedbackState kind="error" title={message}
        ><button type="button" class="button-secondary" onclick={load}>重新读取</button></FeedbackState
      >{/if}
    {#if data && route}
      <div data-testid="route-detail-ready" class="stack">
        <section class="section-rule" aria-label="路线指标">
          <dl class="facts">
            <div>
              <dt>最佳用时</dt>
              <dd>{formatDuration(data.best_duration_seconds)}</dd>
            </div>
            <div>
              <dt>平均用时</dt>
              <dd>{formatDuration(data.avg_duration_seconds)}</dd>
            </div>
            <div>
              <dt>最佳配速</dt>
              <dd class="accent">{formatPace(data.best_pace_seconds_per_km)}</dd>
            </div>
            <div>
              <dt>平均配速</dt>
              <dd>{formatPace(data.avg_pace_seconds_per_km)}</dd>
            </div>
          </dl>
        </section>
        <RouteMap {route} appearance="sheet" spacious />
        <section class="section-rule" aria-label="历次用时趋势">
          <div class="section-head">
            <h2>历次用时</h2>
            <span class="section-meta">{data.runs.length} 次记录</span>
          </div>
          <RouteGroupTrend runs={data.runs} />
        </section>
        <section class="section-hairline" aria-label="历次成绩">
          <div class="section-head">
            <h2>成绩列表</h2>
            <span class="section-meta">按日期倒序</span>
          </div>
          <div class="table-wrap" role="region" aria-label="常跑路线历次成绩表">
            <table>
              <thead><tr><th scope="col">日期</th><th scope="col">标题</th><th scope="col" class="num">距离</th><th scope="col" class="num">用时</th><th scope="col" class="num">配速</th></tr></thead><tbody>
                {#each data.runs as run (run.activity_id)}
                  <tr data-testid="route-run-row"
                    ><td class="mono">{run.activity_date}</td><td
                      ><a class="run-link" href={view.href(`/activities/${run.activity_id}`)}>{run.title || '未命名活动'}</a></td
                    ><td class="num">{formatDistance(run.distance_m)}</td><td class="num"
                      >{run.duration_seconds === null
                        ? '—'
                        : formatDuration(run.duration_seconds)}{#if run.duration_seconds === null}<span class="sr-only"
                          >未记录用时</span
                        >{/if}</td
                    ><td class="num">{formatPace(run.avg_pace_seconds_per_km)}</td></tr
                  >
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .route-detail-shell {
    min-width: 0;
  }
  .detail,
  .stack {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
  }
  .detail {
    margin-top: var(--space-6);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .facts > div {
    min-width: 0;
    padding-inline: var(--space-6);
  }
  .facts > div:first-child {
    padding-left: 0;
  }
  .facts > div:last-child {
    padding-right: 0;
  }
  .facts > div + div {
    border-left: 1px solid var(--border);
  }
  dt {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  dd {
    margin-top: var(--space-2);
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  dd.accent {
    color: var(--primary);
  }
  .table-wrap {
    margin-top: var(--space-4);
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  thead th {
    padding: var(--space-2) var(--space-4) var(--space-2) 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
  tbody td {
    padding: var(--space-3) var(--space-4) var(--space-3) 0;
    border-top: 1px solid var(--border);
    white-space: nowrap;
  }
  .num {
    text-align: right;
  }
  thead th.num,
  tbody td.num {
    padding-right: 0;
    padding-left: var(--space-4);
  }
  .mono {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
  }
  .run-link {
    color: var(--foreground);
    font-weight: var(--weight-semibold);
  }
  @media (hover: hover) {
    .run-link:hover {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  @media (max-width: 799px) {
    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--space-4);
    }
    .facts > div {
      padding-inline: var(--space-4);
    }
    .facts > div:nth-child(odd) {
      padding-left: 0;
      border-left: 0;
    }
    .facts > div:nth-child(even) {
      padding-right: 0;
    }
    .facts > div:nth-child(n + 3) {
      padding-top: var(--space-4);
      border-top: 1px solid var(--border);
    }
  }
  @media (max-width: 479px) {
    .facts {
      grid-template-columns: 1fr;
      row-gap: 0;
    }
    .facts > div,
    .facts > div:nth-child(odd),
    .facts > div:nth-child(even) {
      padding-inline: 0;
      border-left: 0;
    }
    .facts > div + div {
      padding-top: var(--space-3);
      margin-top: var(--space-3);
      border-top: 1px solid var(--border);
    }
  }
</style>
