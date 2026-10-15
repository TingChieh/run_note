<script lang="ts">
  import { flushSync, onMount, tick } from 'svelte';
  import { ActivityError, readActivities, readActivityCategories, readActivity, readRoute, formatDate, formatDistance, formatDuration, formatPace, formatStartTime, type Activity, type Route } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  import RouteMap from './RouteMap.svelte';
  import RouteThumbnail from './RouteThumbnail.svelte';
  import MetricSummary from './MetricSummary.svelte';

  let categories = $state<string[]>([]), filter = $state('all'), categoryError = $state('');
  let items = $state<Activity[]>([]);
  let listLoading = $state(true), listError = $state('');
  let selectedId = $state(''), activity = $state<Activity | null>(null), route = $state<Route | null>(null);
  let detailLoading = $state(false), detailError = $state(''), routeLoading = $state(false), routeError = $state('');
  let active = false, listRequest = 0, selectionRequest = 0, categoriesRequest = 0;
  let strip = $state<HTMLUListElement>(), panel = $state<HTMLDivElement>();
  let detailAnimations: Animation[] = [];
  function stopDetailAnimations() { for (const animation of detailAnimations) animation.cancel(); detailAnimations = []; }
  async function animateDetails(out = false) {
    stopDetailAnimations();
    if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    detailAnimations = [...panel.querySelectorAll('.selected-heading, .explorer-metrics dd')].map(element =>
      element.animate(out ? [{ opacity: 1 }, { opacity: .4 }] : [{ opacity: .4 }, { opacity: 1 }],
        { duration: out ? 100 : 180, easing: 'ease-out', fill: out ? 'forwards' : 'none' }));
    await Promise.all(detailAnimations.map(animation => animation.finished.catch(() => {})));
  }
  const selectedIndex = $derived(items.findIndex(item => item.id === selectedId));
  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) {
      active = false; ++listRequest; ++selectionRequest; ++categoriesRequest;
      stopDetailAnimations();
      flushSync(() => { categories = []; items = []; activity = null; route = null; selectedId = ''; detailLoading = false; listLoading = false; detailError = ''; });
      window.location.replace('/login?reason=expired&next=%2Fdashboard'); return '';
    }
    return cause instanceof Error ? cause.message : '暂时无法读取运动记录';
  }
  async function loadCategories() {
    const token = ++categoriesRequest; categoryError = '';
    try { const result = await readActivityCategories(); if (active && token === categoriesRequest) categories = result; }
    catch (cause) { if (active) { const message = fail(cause); if (token === categoriesRequest) categoryError = message; } }
  }
  async function loadRoute(id: string, selection: number) {
    routeLoading = true; routeError = '';
    try { const result = await readRoute(id); if (active && selection === selectionRequest) route = result; }
    catch (cause) { if (active) { const message = fail(cause); if (selection === selectionRequest) routeError = message; } }
    finally { if (active && selection === selectionRequest) routeLoading = false; }
  }
  function revealSelection() {
    if (!strip) return;
    const button = strip.querySelector<HTMLButtonElement>(`[data-id="${selectedId}"]`);
    if (!button) return;
    const card = button.getBoundingClientRect(), viewport = strip.getBoundingClientRect();
    if (card.left < viewport.left) strip.scrollLeft += card.left - viewport.left;
    else if (card.right > viewport.right) strip.scrollLeft += card.right - viewport.right;
  }
  $effect(() => {
    const element = strip;
    if (!element) return;
    const observer = new ResizeObserver(() => revealSelection());
    observer.observe(element);
    return () => observer.disconnect();
  });
  async function choose(item: Activity) {
    if (item.id === selectedId && activity?.id === item.id && !detailError && !detailLoading) return;
    stopDetailAnimations();
    const token = ++selectionRequest;
    selectedId = item.id; detailError = ''; detailLoading = true;
    void tick().then(() => { if (active && token === selectionRequest) revealSelection(); });
    try {
      const result = await readActivity(item.id);
      if (!active || token !== selectionRequest) return;
      let nextRoute: Route | null = null, nextRouteError = '';
      if (result.has_route) {
        try { nextRoute = await readRoute(result.id); }
        catch (cause) { if (active) nextRouteError = fail(cause); }
      }
      if (!active || token !== selectionRequest) return;
      if (activity) await animateDetails(true);
      if (!active || token !== selectionRequest) return;
      activity = result; route = nextRoute; routeError = nextRouteError; routeLoading = false;
      await tick();
      if (active && token === selectionRequest) void animateDetails();
    } catch (cause) {
      if (active) { const message = fail(cause); if (token === selectionRequest) detailError = message; }
    } finally { if (active && token === selectionRequest) detailLoading = false; }
  }
  function shiftRecord(direction: -1 | 1) {
    if (!active || listLoading || selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target >= 0 && target < items.length) void choose(items[target]);
  }
  async function loadPage() {
    if (!active) return;
    const token = ++listRequest, category = filter === 'all' ? undefined : filter.slice(9);
    listLoading = true; listError = '';
    stopDetailAnimations();
    ++selectionRequest; selectedId = activity?.id ?? ''; detailError = ''; detailLoading = false;
    try {
      const result = await readActivities(fetch, 0, undefined, category);
      if (!active || token !== listRequest) return;
      items = result.items;
      if (items.length) await choose(items[0]);
      else { activity = null; route = null; selectedId = ''; routeError = ''; routeLoading = false; }
    } catch (cause) {
      if (active) { const message = fail(cause); if (token === listRequest) listError = message; }
    } finally { if (active && token === listRequest) listLoading = false; }
  }
  onMount(() => {
    active = true; void loadCategories(); void loadPage();
    return () => { active = false; ++listRequest; ++selectionRequest; ++categoriesRequest; stopDetailAnimations(); };
  });
</script>

{#snippet arrowIcon(direction: 'left' | 'right')}
  <svg class="arrow-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'M15 6 9 12 15 18' : 'M9 6 15 12 9 18'} /></svg>
{/snippet}

<section class="activity-explorer" aria-label="运动足迹">
  <div class="explorer-heading"><div><p class="eyebrow">回到每一次出发</p><h2>运动足迹</h2></div><div class="explorer-filters"><label>分类 <select aria-label="足迹分类" bind:value={filter} onchange={() => void loadPage()}><option value="all">全部</option><option value="category:">未分类</option>{#each categories.filter(value => value !== '') as category}<option value={`category:${category}`}>{category}</option>{/each}</select></label></div></div>
  {#if categoryError}<FeedbackState kind="error" title={categoryError}><button class="button-secondary" onclick={() => void loadCategories()}>重试足迹分类</button></FeedbackState>{/if}
  {#if activity || detailLoading || listLoading || detailError}
    <div class="selection-panel" bind:this={panel} aria-busy={detailLoading || listLoading}>
      <div class="selected-heading" aria-live="polite"><div><h3>{activity?.title || (detailLoading || listLoading ? '正在读取运动记录…' : '运动记录')}</h3><p>{activity ? `${formatDate(activity.activity_date)} · ${formatStartTime(activity.started_at, activity.timezone)} · ${activity.timezone}` : '—'}</p></div>{#if activity}<a href={`/activities/${activity.id}`} aria-disabled={detailLoading || listLoading || !!detailError || !!listError} tabindex={detailLoading || listLoading || detailError || listError ? -1 : undefined} class="button-secondary" class:inactive={detailLoading || listLoading || !!detailError || !!listError}>活动详情 ↗</a>{/if}</div>
      <div class="explorer-workspace">
        <button type="button" class="button-secondary record-arrow record-previous" aria-label="上一条运动记录" title="上一条运动记录" disabled={listLoading || selectedIndex <= 0} onclick={() => void shiftRecord(-1)}>{@render arrowIcon('left')}</button>
        <button type="button" class="button-secondary record-arrow record-next" aria-label="下一条运动记录" title="下一条运动记录" disabled={listLoading || selectedIndex < 0 || selectedIndex >= items.length - 1} onclick={() => void shiftRecord(1)}>{@render arrowIcon('right')}</button>
        <div class="explorer-route" aria-label={activity ? `${activity.title}的路线` : '运动路线'}>
          {#if route}<RouteMap {route} embedded />
          {:else}<div class="route-empty">
            {#if routeLoading || detailLoading || listLoading}<FeedbackState kind="loading" title="正在读取路线…" />
            {:else if routeError}<FeedbackState kind="error" title={routeError}><button class="button-secondary" onclick={() => void loadRoute(activity!.id, selectionRequest)}>重试运动路线</button></FeedbackState>
            {:else}<FeedbackState kind="empty" title="此活动没有路线。"><p>仍可查看本次运动指标。</p></FeedbackState>{/if}
          </div>{/if}
        </div>
        <div class="explorer-metrics" data-testid="explorer-metrics"><MetricSummary items={[
          {label:'距离',value:activity ? formatDistance(activity.distance_m) : '—',icon:'distance'},
          {label:'设备用时',value:formatDuration(activity?.timer_seconds ?? null),icon:'duration'},
          {label:'平均配速',value:formatPace(activity?.avg_pace_seconds_per_km ?? null),icon:'pace'},
          {label:'经过时间',value:formatDuration(activity?.elapsed_seconds ?? null),icon:'elapsed'},
          {label:'平均心率',value:activity?.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`,icon:'heart'},
          {label:'热量',value:activity?.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`,icon:'calories'},
          {label:'步数',value:activity?.steps == null ? '—' : `${activity.steps} 步`,icon:'steps'}
        ]} /></div>
      </div>
      {#if detailError}<div class="selection-overlay failure"><FeedbackState kind="error" title={detailError}><button class="button-secondary" onclick={() => { const selected = items.find(item => item.id === selectedId); if (selected) void choose(selected); }}>重试运动详情</button></FeedbackState></div>
      {:else if (detailLoading || listLoading) && activity}<p class="switch-status" role="status">正在切换运动记录…</p>{/if}
    </div>
  {/if}
  {#if listError}<FeedbackState kind="error" title={listError}><button class="button-secondary" onclick={() => void loadPage()}>重试足迹记录</button></FeedbackState>{/if}
  <div class="browse-controls"><p>左右滑动浏览最近记录 · 点击切换地图</p><span class="record-count" aria-live="polite">最近 {items.length} 条记录</span></div>
  {#if items.length}
    <ul class="activity-strip" bind:this={strip} aria-label="按时间浏览运动记录">
      {#each items as item (item.id)}<li><button class="history-card" class:selected={item.id === selectedId} data-id={item.id} aria-label={`选择运动 ${item.title}`} aria-pressed={item.id === selectedId} onclick={() => void choose(item)}><div class="history-copy"><time datetime={item.activity_date}>{formatDate(item.activity_date)}</time><strong>{item.title || '未命名活动'}</strong><span>{formatDistance(item.distance_m)} · {item.category || '未分类'}</span></div><RouteThumbnail activity={item} compact onauthrequired={cause => { fail(cause); }} /></button></li>{/each}
    </ul>
  {:else if !listLoading && !listError}<FeedbackState kind="empty" title="此分类下没有运动记录"><a href="/activities" class="button-secondary">查看跑步记录</a></FeedbackState>{/if}
  {#if listLoading && !items.length}<FeedbackState kind="loading" title="正在读取足迹记录…" />{/if}
</section>

<style>
  .activity-explorer { --explorer-padding: var(--space-4); --route-map-height: clamp(14rem, 36svh, 24rem); min-width: 0; padding: var(--explorer-padding); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .explorer-heading, .selected-heading, .browse-controls { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
  .eyebrow, .selected-heading p, .browse-controls p { color: var(--muted-foreground); font-size: .75rem; line-height: 1.6; }
  h2 { font-size: 1.25rem; font-weight: 700; } h3 { font-size: 1.375rem; font-weight: 700; overflow-wrap: anywhere; }
  .explorer-filters { display: flex; flex-wrap: wrap; gap: .75rem; }
  .explorer-heading label { display: flex; align-items: center; gap: .5rem; font-size: .875rem; max-width: 100%; }
  select { min-height: 2.75rem; max-width: 14rem; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); padding: .5rem; }
  .selected-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-content: center; } .selected-heading > div { min-width: 0; } .selected-heading h3 { font-size: 1.125rem; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .selected-heading p { margin-top: var(--space-1); min-height: 1.2rem; overflow-wrap: anywhere; }
  .explorer-workspace { position: relative; display: grid; grid-template-columns: minmax(0,1.7fr) minmax(17rem,1fr); gap: var(--space-4); margin-top: var(--space-2); }
  .explorer-route :global(.embedded) { margin-top: 0; }
  .record-arrow { position: absolute; top: calc(var(--route-map-height) / 2); transform: translateY(-50%); z-index: 3; display: grid; place-items: center; width: 2.75rem; height: 2.75rem; padding: 0; border-radius: 50%; line-height: 1; background: var(--surface); }
  .arrow-icon { display: block; width: 1.5rem; height: 1.5rem; }
  .record-previous { left: calc(0px - var(--explorer-padding) - .5px); transform: translate(-50%, -50%); } .record-next { right: calc(0px - var(--explorer-padding) - .5px); transform: translate(50%, -50%); }
  .explorer-route, .explorer-metrics { min-width: 0; }
  .selection-panel { position: relative; margin-top: var(--space-3); }
  .selection-overlay { position: absolute; top: 7.75rem; left: 1rem; right: 1rem; width: fit-content; max-width: calc(100% - 2rem); background: var(--surface); border-radius: .75rem; box-shadow: 0 .25rem 1rem #0001; z-index: 2; } .selection-overlay.failure { width: auto; }
  .selection-overlay :global(.feedback) { max-width: 100%; }
  .explorer-route { min-height: calc(var(--route-map-height) + 2.125rem); }
  .route-empty { min-height: var(--route-map-height); display: grid; align-content: center; border: 1px solid var(--border); border-radius: .75rem; background: var(--muted); }

  .explorer-metrics :global(.metrics) { grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--space-2); }
  .explorer-metrics :global(.metrics > div) { padding: var(--space-2); background: var(--muted); border: 0; border-radius: .75rem; }
  .explorer-metrics :global(.metrics.sport dt), .explorer-metrics :global(.metrics.sport dd) { padding-left: var(--space-8); }
  .explorer-metrics :global(.metrics dt) { font-size: .75rem; }
  .explorer-metrics :global(.metrics dd) { font-size: 1.125rem; }
  .explorer-metrics :global(.metrics.sport .metric-icon) { position: absolute; left: var(--space-2); top: 50%; transform: translateY(-50%); margin-bottom: 0; width: 1.5rem; height: 1.5rem; }
  .explorer-metrics :global(.metric-icon svg) { width: 16px; height: 16px; }
  .browse-controls { margin-top: var(--space-3); }
  .record-count { margin-left: auto; color: var(--muted-foreground); font-size: .75rem; white-space: nowrap; }
  .switch-status { position: absolute; top: -.25rem; right: 0; transform: translateY(-100%); color: var(--muted-foreground); font-size: .75rem; animation: explorer-pending 180ms step-end; }
  @keyframes explorer-pending { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .switch-status { animation: none; } }
  .activity-strip { display: flex; gap: var(--space-3); overflow-x: auto; scroll-snap-type: x proximity; margin-top: var(--space-1); padding: var(--space-1) .125rem var(--space-2); }
  .activity-strip li { flex: 0 0 19rem; max-width: 100%; min-width: 0; scroll-snap-align: start; }
  .history-card { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); width: 100%; min-height: 5.5rem; padding: var(--space-2); text-align: left; border: 1px solid var(--border); border-radius: 1rem; transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease; }
  .history-card.selected { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); background: var(--primary-soft); }
  .history-copy { display: grid; gap: .375rem; min-width: 0; } .history-copy strong { font-size: .875rem; overflow-wrap: anywhere; } .history-copy time, .history-copy > span { font-size: .75rem; color: var(--muted-foreground); overflow-wrap: anywhere; }
  .history-card :global(.route-thumbnail) { flex-shrink: 0; }
  a.inactive { pointer-events: none; opacity: .5; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  @media(min-width:1024px) {
    .explorer-metrics { align-self: start; }
    .explorer-metrics :global(.metrics) { height: calc(var(--route-map-height) + 2px); grid-auto-rows: minmax(0, 1fr); }
    .explorer-metrics :global(.metrics > div) { display: flex; flex-direction: column; justify-content: center; padding-block: var(--space-1); }
    .explorer-metrics :global(.metrics > div:last-child:nth-child(odd)) { grid-column: 1 / -1; }
  }
  @media(max-width:1023px) { .explorer-workspace { grid-template-columns: 1fr; } .explorer-metrics :global(.metrics) { grid-template-columns: repeat(4,minmax(0,1fr)); } }
  @media(max-width:639px) { .activity-explorer { --route-map-height: clamp(13rem, 32svh, 18rem); } .record-previous { left: calc(0px - var(--explorer-padding) + var(--space-2)); } .record-next { right: calc(0px - var(--explorer-padding) + var(--space-2)); } .selected-heading { grid-template-columns: 1fr; gap: var(--space-2); } .selected-heading > a { justify-self: start; } .selection-overlay { top: 8rem; } .explorer-metrics :global(.metrics) { grid-template-columns: repeat(2,minmax(0,1fr)); } .activity-strip li { flex-basis: 17rem; } }
</style>
