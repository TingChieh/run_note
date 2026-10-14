<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import { page } from '$app/state';
  import SharePanel from '#lib/components/SharePanel.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import WallCard from '#lib/components/WallCard.svelte';
  import { ActivityError, readActivity, readRoute, formatDate, formatDistance, formatDuration, formatPace, qualityLabel, qualityEntries, type Activity, type Route } from '#lib/api/activities.ts';
  let activity = $state<Activity | null>(null), route = $state<Route | null>(null), loading = $state(true), routeLoading = $state(false), message = $state(''), routeError = $state(''), disposed = false;
  function expired(cause: unknown): boolean {
    if (!(cause instanceof ActivityError) || cause.status !== 401) return false;
    activity = null; route = null; message = ''; routeError = ''; window.location.replace('/login?reason=expired'); return true;
  }
  async function loadRoute(id: string) {
    routeLoading = true; route = null; routeError = '';
    try { const result = await readRoute(id); if (!disposed) route = result; }
    catch (cause) { if (!disposed && !expired(cause)) routeError = cause instanceof Error ? cause.message : '无法读取路线'; }
    finally { if (!disposed) routeLoading = false; }
  }
  async function loadActivity() {
    if (disposed) return;
    loading = true; message = ''; activity = null; route = null; routeError = '';
    try {
      const result = await readActivity(page.params.id ?? ''); if (disposed) return;
      activity = result; if (result.has_route) await loadRoute(result.id);
    } catch (cause) { if (!disposed && !expired(cause)) message = cause instanceof Error ? cause.message : '无法读取活动'; }
    finally { if (!disposed) loading = false; }
  }
  onMount(() => { void loadActivity(); return () => { disposed = true; }; });
</script>
<svelte:head><title>{activity?.title || '活动详情'} · Run Note</title></svelte:head>
<a href="/activities" data-sveltekit-reload class="text-sm font-medium text-primary underline">← 返回跑步记录</a>
{#if message}<div class="mt-6"><FeedbackState kind="error" title={message}><button onclick={() => void loadActivity()} class="button-secondary">重新读取活动详情</button></FeedbackState></div>
{:else if activity}
  <section class="sport-hero" data-testid="sport-hero" aria-labelledby="activity-title">
    <div class="hero-copy"><p class="hero-kicker"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m5 19 5-5 4 3 4-7 M3 8h4 M3 12h2" /><circle cx="15" cy="5" r="2" /></svg>跑步详情</p><h1 id="activity-title">{activity.title || '未命名活动'}</h1><p class="hero-date">{formatDate(activity.activity_date)} <span>· {activity.timezone}</span></p></div>
    <div class="hero-distance" aria-hidden="true"><span>本次距离</span><strong>{formatDistance(activity.distance_m)}</strong></div>
  </section>
  <div class="detail-workspace">
    <section class="metric-panel" aria-label="运动指标"><div class="panel-heading"><h2>每一步，都算数</h2><p class="section-caption">本次运动概览</p></div>
      <div class="metric-cards"><MetricSummary stacked appearance="sport" items={[{ label: '距离', value: formatDistance(activity.distance_m), testId: 'activity-distance', icon: 'distance' }, { label: '经过时间', value: formatDuration(activity.elapsed_seconds), icon: 'duration' }, { label: '平均配速', value: formatPace(activity.avg_pace_seconds_per_km), icon: 'pace' }]} /></div>
      {#if activity.temporal_quality !== 'complete'}<p class="metric-note">{qualityLabel(activity.temporal_quality)} · 缺失或无法可靠计算的指标以“—”显示，详情见数据质量说明。</p>{/if}
    </section>
    <section class="route-panel" aria-labelledby="route-title"><div class="panel-heading"><div class="route-heading"><h2 id="route-title">路线</h2><span class="route-tag">{activity.has_route ? '个人轨迹' : '运动记录'}</span></div><p class="section-caption">本次运动轨迹</p></div>
      {#if route}<RouteMap {route} spacious />{:else if routeLoading}<div class="route-placeholder"><FeedbackState kind="loading" title="正在读取路线…" /></div>{:else if routeError}<div class="route-placeholder"><FeedbackState kind="error" title={routeError}><button onclick={() => void loadRoute(activity!.id)} class="button-secondary">重新读取路线</button></FeedbackState></div>{:else}<div class="route-placeholder"><FeedbackState kind="empty" title="此活动没有路线。"><p>运动指标仍可查看，路线仅在记录包含轨迹时显示。</p></FeedbackState></div>{/if}
    </section>
  </div>
  <details class="quality-details">
    <summary>数据质量与指标说明</summary>
    <div class="mt-4"><p>{qualityLabel(activity.temporal_quality)}</p><p class="mt-2 text-sm text-muted-foreground">“—”表示缺失或无法可靠计算。指标版本：{activity.metrics_version}</p>
      {#if Object.keys(activity.quality_summary).length}<dl class="mt-4 grid gap-3 sm:grid-cols-2">{#each qualityEntries(activity.quality_summary) as [key, value]}<div class="min-w-0"><dt class="text-sm font-medium">{key}</dt><dd class="mt-1 break-all text-sm text-muted-foreground">{value}</dd></div>{/each}</dl>{:else}<p class="mt-3 text-sm text-muted-foreground">没有额外质量提示。</p>{/if}
    </div>
  </details>
  <section class="activity-wall-card" aria-label="本次足迹卡片"><div><h2>本次足迹卡片</h2><p>每次跑步，留下属于你的路线记忆。</p><a href="/activities/wall" data-sveltekit-reload class="button-secondary">查看全部足迹</a></div><div class="wall-card-preview"><WallCard {activity} {route} managedRoute {routeLoading} {routeError} /></div></section>
  <SharePanel {activity} />
{:else if loading}<div class="mt-6"><FeedbackState kind="loading" title="正在读取活动…" /></div>{/if}
<style>
  .activity-wall-card{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1.5rem;margin-top:1.5rem;border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);padding:1.5rem;}.activity-wall-card h2{font-size:1.25rem;font-weight:700;}.activity-wall-card p{color:var(--muted-foreground);margin:.5rem 0 1rem;font-size:.875rem;}.wall-card-preview{width:20rem;max-width:100%;}
  .sport-hero { display: flex; justify-content: space-between; align-items: center; gap: 2rem; background: var(--sport-yellow); border-radius: var(--radius-card); padding: clamp(1.5rem, 3vw, 2rem); margin-top: 1.5rem; color: #263120; }
  .hero-copy { min-width: 0; }
  .hero-kicker { display: flex; align-items: center; gap: .5rem; font-size: .875rem; font-weight: 600; }
  .sport-hero h1 { margin-top: .75rem; font-size: clamp(2rem, 3vw, 2.5rem); font-weight: 750; line-height: 1.2; }
  .hero-date { margin-top: 1rem; font-size: .875rem; }
  .hero-date span { opacity: .8; }
  .hero-distance { display: grid; flex-shrink: 0; gap: .25rem; text-align: right; font-variant-numeric: tabular-nums; }
  .hero-distance span { font-size: .8125rem; }
  .hero-distance strong { font-size: clamp(2rem, 3vw, 2.75rem); line-height: 1.2; letter-spacing: -.04em; }
  .detail-workspace { --detail-content-height: 32.5rem; display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 1.5rem; margin-top: 1.5rem; align-items: start; padding: 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .metric-panel, .route-panel { min-width: 0; }
  .route-panel { padding-left: 1.5rem; border-left: 1px solid var(--border); }
  .metric-panel h2, .route-panel h2 { font-size: 1.25rem; font-weight: 700; }
  .panel-heading { min-height: 3.5rem; }
  .section-caption { margin-top: .25rem; color: var(--muted-foreground); font-size: .875rem; }
  .metric-cards { margin-top: 1rem; }
  .metric-cards :global(.metrics) { gap: 0; }
  .metric-cards :global(.metrics > div) { padding: 1rem 0; border: 0; border-radius: 0; background: transparent; }
  .metric-cards :global(.metrics > div + div) { border-top: 1px solid var(--border); }
  .metric-cards :global(.metrics dt), .metric-cards :global(.metrics dd) { padding-left: 3.75rem; }
  .metric-cards :global(.metrics dd) { font-size: 1.875rem; }
  .metric-cards :global(.metric-icon) { left: 0; width: 2.75rem; height: 2.75rem; }
  .route-panel :global(.spacious) { border-radius: var(--radius-card); }
  .route-panel :global(.spacious .route-map) { height: var(--detail-content-height); }
  .metric-note { margin-top: 1rem; color: var(--muted-foreground); font-size: .8125rem; }
  .route-heading { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: space-between; align-items: center; }
  .route-tag { padding: .25rem .625rem; border-radius: 2rem; background: var(--primary-soft); color: var(--primary); font-size: .75rem; font-weight: 600; }
  .route-placeholder { display: grid; align-content: center; min-height: var(--detail-content-height); margin-top: 1rem; }
  .quality-details { margin-top: var(--space-6); padding: var(--space-4) var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  summary { color: var(--foreground); font-size: .9375rem; font-weight: 600; }
  @media (max-width: 1199px) { .detail-workspace { --detail-content-height: clamp(22.5rem, 55svh, 32.5rem); grid-template-columns: 1fr; } .route-panel { border-left: 0; border-top: 1px solid var(--border); padding-left: 0; padding-top: 1.5rem; } }
  @media (max-width: 639px) { .quality-details { padding: var(--space-4); } .sport-hero { flex-direction: column; align-items: stretch; gap: 1rem; } .hero-distance { text-align: left; border-top: 1px solid #b5a43d; padding-top: 1rem; } .hero-distance strong { font-size: 2.25rem; } .detail-workspace { padding: 1rem; } .metric-cards :global(.metrics dd) { font-size: 1.75rem; } }
</style>
