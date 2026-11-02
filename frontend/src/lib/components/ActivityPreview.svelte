<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readRoute = view.bind(scoped_readRoute, 1);

  import { onMount, untrack } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import RouteMap from './RouteMap.svelte';
  import ActivityPosterDialog from './ActivityPosterDialog.svelte';
  import { activityAchievement } from '#lib/api/activity-labels.ts';
  import { ActivityError, readRoute as scoped_readRoute, formatDate, formatDistance, formatDuration, activityDuration, formatStartTime, formatPace, qualityLabel, type Activity, type Route } from '#lib/api/activities.ts';
  let { activity, manage = false, busy = false, onedit, ondelete }: { activity: Activity; manage?: boolean; busy?: boolean; onedit?: () => void; ondelete?: () => void } = $props();
  // The map keeps the previous route while the next record's route loads, so the MapLibre instance is updated in place instead of rebuilt.
  let route = $state.raw<Route | null>(null), loading = $state(false), error = $state('');
  let token = 0, disposed = false;
  const achievement = $derived(activityAchievement(activity.distance_m));
  async function load(id: string) {
    const request = ++token;
    loading = true; error = '';
    try { const result = await readRoute(id, fetch); if (!disposed && request === token) route = result; }
    catch (cause) {
      if (disposed || request !== token) return;
      route = null;
      if (cause instanceof ActivityError && cause.status === 401) { window.location.replace('/admin?reason=expired&next=%2Factivities'); return; }
      error = cause instanceof Error ? cause.message : '无法读取路线';
    }
    finally { if (!disposed && request === token) loading = false; }
  }
  $effect(() => {
    const id = activity.id, hasRoute = activity.has_route;
    untrack(() => { if (hasRoute) void load(id); else { ++token; route = null; loading = false; error = ''; } });
  });
  onMount(() => () => { disposed = true; ++token; });
</script>
<article class="preview" aria-labelledby="preview-title" data-testid="activity-preview">
  <header class="preview-head">
    <div class="preview-copy">
      <p id="preview-title" class="preview-title">{activity.title || '未命名活动'}</p>
      <p class="preview-when">{formatDate(activity.activity_date)} · {activity.timezone}</p>
      {#if achievement || activity.category || activity.tags?.length}<p class="preview-labels">
        {#if achievement}<span class="chip achievement">{achievement}</span>{/if}
        {#if activity.category}<span class="chip category">{activity.category}</span>{/if}
        {#each activity.tags ?? [] as tag}<span class="chip">#{tag}</span>{/each}
      </p>{/if}
    </div>
    <a class="preview-open" href={view.href(`/activities/${activity.id}`)}>查看完整详情 →</a>
  </header>
  <div class="preview-map">
    {#if route}
      <RouteMap {route} embedded />
      {#if loading}<p class="map-note" role="status">正在读取路线…</p>{/if}
    {:else if loading}<FeedbackState kind="loading" title="正在读取路线…" />
    {:else if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary" onclick={() => void load(activity.id)}>重新读取路线</button></FeedbackState>
    {:else}<p class="no-route">这条记录没有路线。</p>{/if}
  </div>
  <dl class="facts">
    <div><dt>距离</dt><dd>{formatDistance(activity.distance_m)}</dd></div>
    <div><dt>{activity.timer_seconds != null ? '设备用时' : '用时'}</dt><dd>{formatDuration(activityDuration(activity))}</dd></div>
    <div><dt>平均配速</dt><dd>{formatPace(activity.avg_pace_seconds_per_km)}</dd></div>
    <div><dt>平均心率</dt><dd>{activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`}</dd></div>
  </dl>
  <dl class="more">
    <div><dt>热量</dt><dd>{activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`}</dd></div>
    <div><dt>步数</dt><dd>{activity.steps == null ? '—' : `${activity.steps} 步`}</dd></div>
    <div><dt>开始时间</dt><dd>{formatStartTime(activity.started_at, activity.timezone)}</dd></div>
    <div><dt>数据完整度</dt><dd>{qualityLabel(activity.temporal_quality)}</dd></div>
  </dl>
  {#if manage}<div class="preview-actions">
    <button type="button" class="button-secondary" disabled={busy} onclick={onedit}>编辑记录</button>
    {#if activity.has_route}<ActivityPosterDialog activityId={activity.id} />{/if}
    <button type="button" class="button-secondary delete" disabled={busy} onclick={ondelete}>删除记录</button>
  </div>{/if}
</article>
<style>
  .preview { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; min-width: 0; }
  .preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-6) var(--space-3); }
  .preview-copy { min-width: 0; }
  /* The title line is as tall as the month pill beside it (1.75rem) and both columns start 1rem + the card border below the top, so the two sit on one line. */
  .preview-title { font-size: var(--text-card); line-height: 1.75rem; font-weight: var(--weight-semibold); overflow-wrap: anywhere; }
  .preview-when { margin-top: .125rem; color: var(--muted-foreground); font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  .preview-labels { display: flex; flex-wrap: wrap; gap: .25rem .375rem; margin-top: .5rem; }
  .chip { padding: .0625rem .5rem; border-radius: .4rem; background: var(--muted); color: var(--muted-foreground); font-size: var(--text-caption); }
  .chip.achievement, .chip.category { color: var(--primary); background: var(--route-thumbnail); }
  .chip.achievement { font-weight: var(--weight-bold); }
  .preview-open { flex: none; padding: .375rem .875rem; border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--primary); font-size: var(--text-small); font-weight: var(--weight-semibold); white-space: nowrap; }
  @media (hover: hover) { .preview-open:hover { border-color: var(--primary); } }
  .preview-map { position: relative; --route-map-height: 18rem; border-block: 1px solid var(--border); background: var(--route-thumbnail); }
  .preview-map :global(> div) { margin-top: 0; border: 0; border-radius: 0; }
  .preview-map :global(details) { display: none; }
  .preview-map > :global(.feedback-state), .no-route { padding: var(--space-8) var(--space-6); }
  .no-route { text-align: center; color: var(--muted-foreground); font-size: var(--text-small); }
  .map-note { position: absolute; right: .75rem; bottom: 2rem; padding: .25rem .625rem; border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-caption); }
  dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  dl > div { min-width: 0; padding: var(--space-3) var(--space-6); border-right: 1px solid var(--border); }
  dl > div:last-child { border-right: 0; }
  dt { color: var(--muted-foreground); font-size: var(--text-caption); }
  dd { margin-top: .125rem; font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .facts dd { font-size: var(--text-stat); font-weight: var(--weight-bold); }
  .more { border-top: 1px solid var(--border); }
  .preview-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3) var(--space-6); border-top: 1px solid var(--border); }
  .delete { color: var(--error); }
  @media (max-width: 1279px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } dl > div:nth-child(2n) { border-right: 0; } }
</style>
