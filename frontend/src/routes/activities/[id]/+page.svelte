<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readActivity = view.bind(scoped_readActivity, 1);
  const readRoute = view.bind(scoped_readRoute, 1);

  import { onMount, untrack } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import DeviceMetrics from '#lib/components/DeviceMetrics.svelte';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import SharePanel from '#lib/components/SharePanel.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import ActivityWallPreview from '#lib/components/ActivityWallPreview.svelte';
  import ActivityActions from '#lib/components/ActivityActions.svelte';
  import { ActivityError, readActivity as scoped_readActivity, readRoute as scoped_readRoute, formatDate, formatDistance, formatDuration, activityDuration, formatStartTime, formatPace, qualityLabel, qualityEntries, type Activity, type Route } from '#lib/api/activities.ts';
  let activity = $state<Activity | null>(null), route = $state<Route | null>(null), loading = $state(true), routeLoading = $state(false), message = $state(''), routeError = $state(''), disposed = false;
  let switching = $state(false), swapped = $state(false);
  // The map keeps showing the previous route while a switched record's route loads,
  // so the MapLibre instance is updated in place rather than torn down.
  let mapRoute = $state.raw<Route | null>(null);
  let mounted = $state(false), activityToken = 0, routeToken = 0;
  afterNavigate(({from, type, shallow}) => {
    if (shallow || type === 'enter' || type === 'popstate' || !from?.route.id
      || from.url.origin !== page.url.origin || /^\/(login|register)(\/|$)/.test(from.url.pathname)) return;
    // Keep the marker on this history entry so refreshing still permits a native Back.
    void goto(page.url.href, { shallow: true, replace: true, persistState: true,
      state: { ...page.state, activityBackAvailable: true } });
  });
  function goBack() {
    if (page.state.activityBackAvailable === true) window.history.back();
    else void goto(view.href('/activities'), { replace: true });
  }
  function expired(cause: unknown): boolean {
    if (!(cause instanceof ActivityError) || cause.status !== 401) return false;
    activityToken++; routeToken++; activity = null; route = null; message = ''; routeError = ''; window.location.replace('/admin?reason=expired'); return true;
  }
  async function loadRoute(id: string) {
    const token = ++routeToken;
    routeLoading = true; route = null; routeError = '';
    try { const result = await readRoute(id); if (!disposed && token === routeToken) { route = result; mapRoute = result; } }
    catch (cause) { if (!disposed && token === routeToken && !expired(cause)) { mapRoute = null; routeError = cause instanceof Error ? cause.message : '无法读取路线'; } }
    finally { if (!disposed && token === routeToken) routeLoading = false; }
  }
  async function loadActivity(id = page.shallow?.params?.id ?? page.params.id ?? '') {
    if (disposed) return;
    const token = ++activityToken; routeToken++;
    loading = true; message = ''; activity = null; route = null; mapRoute = null; routeLoading = false; routeError = ''; swapped = false;
    try {
      const result = await readActivity(id, fetch, view.manage); if (disposed || token !== activityToken) return;
      activity = result; if (result.has_route) await loadRoute(result.id);
    } catch (cause) { if (!disposed && token === activityToken && !expired(cause)) message = cause instanceof Error ? cause.message : '无法读取活动'; }
    finally { if (!disposed && token === activityToken) loading = false; }
  }
  async function switchActivity(id: string): Promise<boolean> {
    if (disposed || switching) return false;
    if (id === activity?.id) return true;
    const token = ++activityToken;
    switching = true;
    try {
      const next = await readActivity(id, fetch, view.manage);
      if (disposed || token !== activityToken) return false;
      // Replace this detail entry so Back still reaches the original list or wall page.
      await goto(view.href(`/activities/${id}`), { shallow: true, replace: true, persistState: true,
        reset: false, state: page.state });
      if (disposed || token !== activityToken) return false;
      routeToken++;
      activity = next; route = null; routeError = ''; routeLoading = false; loading = false; swapped = true;
      if (!next.has_route) mapRoute = null;
      // Commit the record first; its heavier route loads independently on demand.
      if (next.has_route) void loadRoute(next.id);
      return true;
    } catch (cause) {
      if (disposed || token !== activityToken || expired(cause)) return false;
      throw cause;
    } finally { if (!disposed && token === activityToken) switching = false; }
  }
  onMount(() => { mounted = true; return () => { disposed = true; activityToken++; routeToken++; }; });
  $effect(() => { const id = page.shallow?.params?.id ?? page.params.id; if (mounted && !switching) untrack(() => { if (activity?.id !== id) void loadActivity(id); }); });
</script>
<svelte:head><title>{pageTitle(activity?.title || '活动详情', page.data.site)}</title></svelte:head>
<button type="button" class="button-secondary" onclick={goBack}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>返回</button>
{#if message}<div class="mt-6"><FeedbackState kind="error" title={message}><button onclick={() => void loadActivity()} class="button-secondary">重新读取活动详情</button></FeedbackState></div>
{:else if activity}
  <section class="sport-hero" class:switching data-testid="sport-hero" aria-labelledby="activity-title" aria-busy={switching}>
    {#key activity.id}
    <div class="hero-copy" class:detail-swap={swapped}><p class="hero-kicker"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m5 19 5-5 4 3 4-7 M3 8h4 M3 12h2" /><circle cx="15" cy="5" r="2" /></svg>跑步详情</p><h1 id="activity-title">{activity.title || '未命名活动'}</h1><p class="hero-date">{formatDate(activity.activity_date)} <span>· {activity.timezone}</span></p></div>
    <div class="hero-distance" class:detail-swap={swapped} aria-hidden="true"><span>本次距离</span><strong>{formatDistance(activity.distance_m)}</strong></div>
    {/key}
  </section>
  {#key activity.id}{#if view.manage}<ActivityActions {activity} onupdated={(value) => { activity = value; }} />{/if}{/key}
  <div class="detail-workspace" class:switching aria-busy={switching}>
    <section class="metric-panel" aria-label="运动指标"><div class="panel-heading"><h2>每一步，都算数</h2><p class="section-caption">本次运动概览</p></div>
      {#key activity.id}<div class="metric-swap" class:detail-swap={swapped}>
      <div class="metric-cards"><MetricSummary stacked appearance="sport" items={[
        { label: '距离', value: formatDistance(activity.distance_m), testId: 'activity-distance', icon: 'distance' },
        { label: activity.timer_seconds != null ? '设备用时' : '经过时间', value: formatDuration(activityDuration(activity)), icon: 'duration' },
        { label: '平均配速', value: formatPace(activity.avg_pace_seconds_per_km), icon: 'pace' },
        ...(activity.timer_seconds != null ? [{ label: '经过时间', value: formatDuration(activity.elapsed_seconds), icon: 'elapsed' as const }] : []),
        { label: '平均心率', value: activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`, icon: 'heart' },
        { label: '热量', value: activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`, icon: 'calories' },
        { label: '步数', value: activity.steps == null ? '—' : `${activity.steps} 步`, icon: 'steps' }
      ]} /></div>
      <dl class="start-time"><div><dt>开始时间</dt><dd>{formatStartTime(activity.started_at, activity.timezone)} · {activity.timezone}</dd></div></dl>
      {#if activity.temporal_quality !== 'complete'}<p class="metric-note">{qualityLabel(activity.temporal_quality)} · 缺失或无法可靠计算的指标以“—”显示，详情见数据质量说明。</p>{/if}
      </div>{/key}
    </section>
    <section class="route-panel" aria-labelledby="route-title"><div class="panel-heading"><div class="route-heading"><h2 id="route-title">路线</h2><span class="route-tag">{activity.has_route ? '个人轨迹' : '运动记录'}</span></div><p class="section-caption">本次运动轨迹</p></div>
      {#if mapRoute}<div class="route-stage" class:stale={!route}><RouteMap route={mapRoute} spacious />{#if !route && routeLoading}<p class="route-swap-status" role="status">正在读取路线…</p>{/if}</div>{:else if routeLoading}<div class="route-placeholder"><FeedbackState kind="loading" title="正在读取路线…" /></div>{:else if routeError}<div class="route-placeholder"><FeedbackState kind="error" title={routeError}><button onclick={() => void loadRoute(activity!.id)} class="button-secondary">重新读取路线</button></FeedbackState></div>{:else}<div class="route-placeholder"><FeedbackState kind="empty" title="此活动没有路线。"><p>运动指标仍可查看，路线仅在记录包含轨迹时显示。</p></FeedbackState></div>{/if}
    </section>
  </div>
  <DeviceMetrics metrics={activity} />
  <details class="quality-details">
    <summary>数据质量与指标说明</summary>
    <div class="mt-4"><p>{qualityLabel(activity.temporal_quality)}</p><p class="mt-2 text-sm text-muted-foreground">“—”表示缺失或无法可靠计算。指标版本：{activity.metrics_version}</p>
      {#if Object.keys(activity.quality_summary).length}<dl class="mt-4 grid gap-3 sm:grid-cols-2">{#each qualityEntries(activity.quality_summary) as [key, value]}<div class="min-w-0"><dt class="text-sm font-medium">{key}</dt><dd class="mt-1 break-all text-sm text-muted-foreground">{value}</dd></div>{/each}</dl>{:else}<p class="mt-3 text-sm text-muted-foreground">没有额外质量提示。</p>{/if}
    </div>
  </details>
  <ActivityWallPreview {activity} {route} {routeLoading} {routeError} onauthrequired={expired} onswitch={switchActivity} />
  {#if view.manage}<p class="mt-6 text-sm text-muted-foreground">个人展示站公开全部记录和完整轨迹；以下分享设置仅控制旧版摘要链接。</p>{#key activity.id}<SharePanel {activity} />{/key}{/if}
{:else if loading}<div class="mt-6"><FeedbackState kind="loading" title="正在读取活动…" /></div>{/if}
<style>
  .sport-hero { display: flex; justify-content: space-between; align-items: center; gap: 2rem; background: var(--sport-yellow); border-radius: var(--radius-card); padding: clamp(1.5rem, 3vw, 2rem); margin-top: 1.5rem; color: var(--sport-detail-ink); }
  .hero-copy { min-width: 0; }
  .hero-kicker { display: flex; align-items: center; gap: .5rem; font-size: .875rem; font-weight: 600; }
  .sport-hero h1 { margin-top: .75rem; font-size: clamp(2rem, 3vw, 2.5rem); font-weight: 750; line-height: 1.2; }
  .hero-date { margin-top: 1rem; font-size: .875rem; }
  .hero-date span { opacity: .8; }
  .hero-distance { display: grid; flex-shrink: 0; gap: .25rem; text-align: right; font-variant-numeric: tabular-nums; }
  .hero-distance span { font-size: .8125rem; }
  .hero-distance strong { font-size: clamp(2rem, 3vw, 2.75rem); line-height: 1.2; letter-spacing: -.04em; }
  .detail-workspace { --detail-content-height: clamp(20rem, 44svh, 24rem); display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: var(--space-6); margin-top: var(--space-6); align-items: start; padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .metric-panel, .route-panel { min-width: 0; }
  /* Switching records keeps every surface in place: dim while reading, then lift the new values in. */
  .sport-hero > div, .detail-workspace { transition: opacity var(--motion-reveal); }
  .sport-hero.switching > div, .detail-workspace.switching { opacity: .6; }
  .route-placeholder :global(.feedback), .route-stage :global(.feedback) { animation: none; }
  .detail-swap { animation: detail-swap var(--motion-reveal) both; }
  .hero-distance.detail-swap, .metric-swap.detail-swap { animation-delay: 40ms; }
  @keyframes detail-swap { from { opacity: 0; transform: translate3d(0, .375rem, 0); } to { opacity: 1; transform: none; } }
  .route-stage { position: relative; }
  .route-stage :global(.route-map) { transition: opacity var(--motion-reveal); }
  .route-stage.stale :global(.route-map) { opacity: .45; }
  .route-swap-status { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: var(--space-2) var(--space-4); border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-foreground); font-size: .875rem; box-shadow: 0 var(--space-2) var(--space-6) var(--glass-shadow); pointer-events: none; }
  .route-panel { padding-left: 1.5rem; border-left: 1px solid var(--border); }
  .metric-panel h2, .route-panel h2 { font-size: 1.25rem; font-weight: 700; }
  .panel-heading { min-height: 3.5rem; }
  .section-caption { margin-top: .25rem; color: var(--muted-foreground); font-size: .875rem; }
  .metric-cards { margin-top: 1rem; }
  .metric-cards :global(.metrics) { gap: 0; }
  .metric-cards :global(.metrics > div) { padding: var(--space-1) 0; border: 0; border-radius: 0; background: transparent; }
  .metric-cards :global(.metrics > div + div) { border-top: 1px solid var(--border); }
  .metric-cards :global(.metrics dt), .metric-cards :global(.metrics dd) { padding-left: calc(var(--space-8) + var(--space-3)); }
  .metric-cards :global(.metrics dt) { font-size: .75rem; line-height: 1.25; }
  .metric-cards :global(.metrics dd) { margin-top: 0; font-size: 1.25rem; }
  .metric-cards :global(.metric-icon) { left: 0; width: var(--space-8); height: var(--space-8); }
  .metric-cards :global(.metric-icon svg) { width: var(--space-6); height: var(--space-6); }
  .start-time { margin-top: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--border); font-size: .875rem; overflow-wrap: anywhere; }
  .start-time dt { color: var(--muted-foreground); }
  .start-time dd { margin-top: .25rem; font-variant-numeric: tabular-nums; }
  .route-panel :global(.spacious) { border-radius: var(--radius-card); }
  .route-panel :global(.spacious .route-map) { height: var(--detail-content-height); }
  .metric-note { margin-top: 1rem; color: var(--muted-foreground); font-size: .8125rem; }
  .route-heading { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: space-between; align-items: center; }
  .route-tag { padding: .25rem .625rem; border-radius: 2rem; background: var(--primary-soft); color: var(--primary); font-size: .75rem; font-weight: 600; }
  .route-placeholder { display: grid; align-content: center; min-height: var(--detail-content-height); margin-top: 1rem; }
  .quality-details { margin-top: var(--space-6); padding: var(--space-4) var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  summary { color: var(--foreground); font-size: .9375rem; font-weight: 600; }
  @media (max-width: 1199px) { .detail-workspace { --detail-content-height: clamp(17.5rem, 38svh, 22rem); grid-template-columns: 1fr; } .route-panel { border-left: 0; border-top: 1px solid var(--border); padding-left: 0; padding-top: var(--space-6); } .metric-cards :global(.metrics) { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--space-6); } .metric-cards :global(.metrics > div + div) { border-top: 0; } .metric-cards :global(.metrics > div:nth-child(n + 3)) { border-top: 1px solid var(--border); } }
  @media (max-width: 639px) { .quality-details { padding: var(--space-4); } .sport-hero { flex-direction: column; align-items: stretch; gap: 1rem; } .hero-distance { text-align: left; border-top: 1px solid var(--sport-heading-border); padding-top: 1rem; } .hero-distance strong { font-size: 2.25rem; } .detail-workspace { padding: var(--space-4); } .metric-cards :global(.metrics) { gap: 0 var(--space-3); } .metric-cards :global(.metrics dt) { padding-left: var(--space-8); } .metric-cards :global(.metrics dd) { padding-left: 0; margin-top: var(--space-3); } .metric-cards :global(.metric-icon) { top: var(--space-1); transform: none; width: var(--space-6); height: var(--space-6); } .metric-cards :global(.metric-icon svg) { width: var(--space-4); height: var(--space-4); } }
</style>
