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
  let { activity, manage = false, busy = false, appearance = 'default', onedit, ondelete, suppliedRoute, runner, href, routeColor }: { suppliedRoute?: Route | null; runner?: {name: string; color: string}; href?: string; routeColor?: string; activity: Activity; manage?: boolean; busy?: boolean; appearance?: 'default' | 'ledger'; onedit?: () => void; ondelete?: () => void } = $props();
  // The map keeps the previous route while the next record's route loads, so the MapLibre instance is updated in place instead of rebuilt.
  let route = $state.raw<Route | null>(null), loading = $state(false), error = $state('');
  let token = 0, disposed = false;
  const achievement = $derived(activityAchievement(activity.distance_m));
  const ledger = $derived(appearance === 'ledger');
  const splitFigure = (value: string) => {
    const match = /^(.*\d)\s+(\S+)$/.exec(value);
    return match ? { number: match[1], unit: match[2] } : { number: value, unit: '' };
  };
  const distance = $derived(splitFigure(formatDistance(activity.distance_m)));
  const durationText = $derived(formatDuration(activityDuration(activity)));
  const pace = $derived(splitFigure(formatPace(activity.avg_pace_seconds_per_km)));
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
    if (suppliedRoute !== undefined) { ++token; route = suppliedRoute; loading = false; error = ''; return; }
    untrack(() => { if (hasRoute) void load(id); else { ++token; route = null; loading = false; error = ''; } });
  });
  onMount(() => () => { disposed = true; ++token; });
</script>
<article class="preview" class:ledger class:section-rule={ledger} aria-labelledby="preview-title" data-testid="activity-preview">
  {#if ledger}
    <header class="preview-head">
      <p id="preview-title" class="preview-title">{activity.title || '未命名活动'}</p>
      <a class="preview-open button-text" href={href ?? view.href(`/activities/${activity.id}`)}>查看完整详情 →</a>
    </header>
    {#if runner}<p class="preview-runner" style:color={runner.color}>{runner.name}</p>{/if}
    <p class="preview-when">{formatDate(activity.activity_date)}{runner ? '' : ` · ${activity.timezone}`}</p>
    {#if achievement || activity.category || activity.tags?.length}
      <p class="preview-meta">
        {#if achievement}<span class="meta-accent">{achievement}</span>{/if}
        {#if activity.category}<span class="meta-accent">{activity.category}</span>{/if}
        {#each activity.tags ?? [] as tag}<span>#{tag}</span>{/each}
      </p>
    {/if}
    <div class="preview-map">
      {#if route}
        <RouteMap {route} color={routeColor} embedded />
        {#if loading}<p class="map-note" role="status">正在读取路线…</p>{/if}
      {:else if loading}<FeedbackState kind="loading" title="正在读取路线…" />
      {:else if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary" onclick={() => void load(activity.id)}>重新读取路线</button></FeedbackState>
      {:else}<p class="no-route">这条记录没有路线。</p>{/if}
    </div>
    <dl class="preview-trio">
      <div>
        <dt>距离</dt>
        <dd>{distance.number}{#if distance.unit}{' '}<span class="figure-unit">{distance.unit}</span>{/if}{#if distance.number === '—'}<span class="sr-only">（缺失）</span>{/if}</dd>
      </div>
      <div>
        <dt>{activity.timer_seconds != null ? '设备用时' : '用时'}</dt>
        <dd class:muted={durationText === '—'}>{durationText}{#if durationText === '—'}<span class="sr-only">（缺失）</span>{/if}</dd>
      </div>
      <div>
        <dt>平均配速</dt>
        <dd class:muted={pace.number === '—'}>{pace.number}{#if pace.unit}{' '}<span class="figure-unit">{pace.unit}</span>{/if}{#if pace.number === '—'}<span class="sr-only">（缺失）</span>{/if}</dd>
      </div>
    </dl>
    <dl class="preview-ledger">
      <div><dt>平均心率</dt><dd class:muted={activity.avg_heart_rate_bpm == null}>{activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`}{#if activity.avg_heart_rate_bpm == null}<span class="sr-only">（缺失）</span>{/if}</dd></div>
      {#if !runner}
        <div><dt>热量</dt><dd class:muted={activity.calories_kcal == null}>{activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`}{#if activity.calories_kcal == null}<span class="sr-only">（缺失）</span>{/if}</dd></div>
        <div><dt>步数</dt><dd class:muted={activity.steps == null}>{activity.steps == null ? '—' : `${activity.steps} 步`}{#if activity.steps == null}<span class="sr-only">（缺失）</span>{/if}</dd></div>
        <div><dt>开始时间</dt><dd class:muted={!activity.started_at}>{formatStartTime(activity.started_at, activity.timezone)}{#if !activity.started_at}<span class="sr-only">（缺失）</span>{/if}</dd></div>
        <div><dt>数据完整度</dt><dd>{qualityLabel(activity.temporal_quality)}</dd></div>
      {/if}
    </dl>
    {#if manage}<div class="preview-actions">
      <button type="button" class="button-secondary" disabled={busy} onclick={onedit}>编辑记录</button>
      {#if activity.has_route}<ActivityPosterDialog activityId={activity.id} label="本次分享图" />{/if}
      <button type="button" class="button-text delete" disabled={busy} onclick={ondelete}>删除记录</button>
    </div>{/if}
  {:else}
    <header class="preview-head">
      <div class="preview-copy">
        <p id="preview-title" class="preview-title">{activity.title || '未命名活动'}</p>
        {#if runner}<p style:color={runner.color}>{runner.name}</p>{/if}
        <p class="preview-when">{formatDate(activity.activity_date)}{runner ? '' : ` · ${activity.timezone}`}</p>
        {#if achievement || activity.category || activity.tags?.length}<p class="preview-labels">
          {#if achievement}<span class="chip achievement">{achievement}</span>{/if}
          {#if activity.category}<span class="chip category">{activity.category}</span>{/if}
          {#each activity.tags ?? [] as tag}<span class="chip">#{tag}</span>{/each}
        </p>{/if}
      </div>
      <div class="preview-links">
        {#if manage && activity.has_route}<ActivityPosterDialog activityId={activity.id} label="本次分享图" />{/if}
        <a class="preview-open button-secondary" href={href ?? view.href(`/activities/${activity.id}`)}>查看完整详情 →</a>
      </div>
    </header>
    <div class="preview-map">
      {#if route}
        <RouteMap {route} color={routeColor} embedded />
        {#if loading}<p class="map-note" role="status">正在读取路线…</p>{/if}
      {:else if loading}<FeedbackState kind="loading" title="正在读取路线…" />
      {:else if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary" onclick={() => void load(activity.id)}>重新读取路线</button></FeedbackState>
      {:else}<p class="no-route">这条记录没有路线。</p>{/if}
    </div>
    <dl class="facts">
      <div><dt>距离</dt><dd>{formatDistance(activity.distance_m)}</dd></div>
      <div><dt>{activity.timer_seconds != null ? '设备用时' : '用时'}</dt><dd>{durationText}</dd></div>
      <div><dt>平均配速</dt><dd>{formatPace(activity.avg_pace_seconds_per_km)}</dd></div>
      <div><dt>平均心率</dt><dd>{activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`}</dd></div>
    </dl>
    {#if !runner}<dl class="more">
      <div><dt>热量</dt><dd>{activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`}</dd></div>
      <div><dt>步数</dt><dd>{activity.steps == null ? '—' : `${activity.steps} 步`}</dd></div>
      <div><dt>开始时间</dt><dd>{formatStartTime(activity.started_at, activity.timezone)}</dd></div>
      <div><dt>数据完整度</dt><dd>{qualityLabel(activity.temporal_quality)}</dd></div>
    </dl>{/if}
    {#if manage}<div class="preview-actions">
      <button type="button" class="button-secondary" disabled={busy} onclick={onedit}>编辑记录</button>
      <button type="button" class="button-secondary delete" disabled={busy} onclick={ondelete}>删除记录</button>
    </div>{/if}
  {/if}
</article>
<style>
  .preview { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; min-width: 0; }
  .preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-6) var(--space-3); }
  .preview-copy { min-width: 0; }
  .preview-title { font-size: var(--text-card); line-height: var(--line-height-heading); font-weight: var(--weight-semibold); overflow-wrap: anywhere; }
  .preview-when { margin-top: .125rem; color: var(--muted-foreground); font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  .preview-labels { display: flex; flex-wrap: wrap; gap: .25rem .375rem; margin-top: .5rem; }
  .chip { padding: .0625rem .5rem; border-radius: .4rem; background: var(--muted); color: var(--muted-foreground); font-size: var(--text-caption); }
  .chip.achievement, .chip.category { color: var(--primary); background: var(--route-thumbnail); }
  .chip.achievement { font-weight: var(--weight-bold); }
  .preview-links { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
  .preview-links :global(.button-secondary) { min-height: 2.25rem; padding: .375rem .875rem; white-space: nowrap; }
  .preview-map { position: relative; --route-map-height: 18rem; border-block: 1px solid var(--border); background: var(--route-thumbnail); }
  .preview-map :global(> div) { margin-top: 0; border: 0; border-radius: 0; }
  .preview-map :global(details) { display: none; }
  .preview-map > :global(.feedback-state), .no-route { padding: var(--space-8) var(--space-6); }
  .no-route { text-align: center; color: var(--muted-foreground); font-size: var(--text-small); }
  .map-note { position: absolute; right: .75rem; bottom: 2rem; padding: .25rem .625rem; border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-caption); }
  .facts, .more { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .facts > div, .more > div { min-width: 0; padding: var(--space-3) var(--space-6); border-right: 1px solid var(--border); }
  .facts > div:last-child, .more > div:last-child { border-right: 0; }
  dt { color: var(--muted-foreground); font-size: var(--text-caption); }
  dd { margin-top: .125rem; font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .facts dd { font-size: var(--text-stat); font-weight: var(--weight-bold); }
  .more { border-top: 1px solid var(--border); }
  .preview-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3) var(--space-6); border-top: 1px solid var(--border); }
  .delete { color: var(--error); }
  @media (max-width: 1279px) { .facts, .more { grid-template-columns: repeat(2, minmax(0, 1fr)); } .facts > div:nth-child(2n), .more > div:nth-child(2n) { border-right: 0; } }

  /* Editorial Receipt ledger preview sidebar (brand.md §4, §6.7; web-audit W-08). */
  .preview.ledger {
    background: transparent;
    border: 0;
    border-top: 2px solid var(--rule);
    border-radius: 0;
    overflow: visible;
    padding-top: var(--space-4);
  }
  .preview.ledger .preview-head {
    align-items: baseline;
    gap: var(--space-3);
    padding: 0;
  }
  .preview.ledger .preview-title {
    font-size: var(--text-section);
    line-height: var(--line-height-title);
    font-weight: var(--weight-semibold);
  }
  .preview.ledger .preview-open {
    flex: none;
    white-space: nowrap;
  }
  .preview.ledger .preview-runner {
    margin-top: var(--space-1);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .preview.ledger .preview-when {
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .preview.ledger .preview-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 .35rem;
    margin-top: var(--space-1);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .preview.ledger .preview-meta > span:not(:last-child)::after {
    content: '·';
    margin-left: .35rem;
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .preview.ledger .meta-accent {
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .preview.ledger .preview-map {
    --route-map-height: 14rem;
    margin-top: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    overflow: hidden;
    background: var(--recap-well);
  }
  .preview-trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: var(--space-4);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .preview-trio > div {
    display: flex;
    flex-direction: column-reverse;
    min-width: 0;
    padding: var(--space-3) var(--space-2) var(--space-2) var(--space-3);
    border-left: 1px solid var(--border);
  }
  .preview-trio > div:first-child {
    padding-left: 0;
    border-left: 0;
  }
  .preview-trio dt {
    margin-top: var(--space-1);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .preview-trio dd {
    margin-top: 0;
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .preview-trio dd .figure-unit {
    font-size: var(--text-caption);
  }
  .preview-ledger {
    display: block;
    margin-top: var(--space-1);
  }
  .preview-ledger > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: .625rem 0;
    border-bottom: 1px solid var(--border);
  }
  .preview-ledger > div:last-child {
    border-bottom: 0;
  }
  .preview-ledger dt {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .preview-ledger dd {
    margin-top: 0;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .preview.ledger dd.muted {
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .preview.ledger .preview-actions {
    align-items: center;
    padding: var(--space-4) 0 0;
    border-top: 0;
  }
  .preview.ledger .preview-actions .delete {
    margin-left: auto;
    color: var(--error);
  }
  @media (max-width: 1279px) {
    .preview-trio dd {
      font-size: var(--text-section);
    }
  }
</style>
