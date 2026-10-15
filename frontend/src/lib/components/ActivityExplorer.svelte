<script lang="ts">
  import { flushSync, onMount, tick } from 'svelte';
  import { ActivityError, readActivities, readActivityCategories, readActivity, readRoute, formatDate, formatDistance, formatDuration, formatPace, formatStartTime, qualityLabel, type Activity, type Route } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  import RouteMap from './RouteMap.svelte';
  import RouteThumbnail from './RouteThumbnail.svelte';
  import MetricSummary from './MetricSummary.svelte';

  let categories = $state<string[]>([]), filter = $state('all'), month = $state(''), categoryError = $state('');
  let items = $state<Activity[]>([]), total = $state(0), nextOffset = $state(0);
  let listLoading = $state(true), listError = $state('');
  let selectedId = $state(''), activity = $state<Activity | null>(null), route = $state<Route | null>(null);
  let detailLoading = $state(false), detailError = $state(''), routeLoading = $state(false), routeError = $state('');
  let active = false, listRequest = 0, selectionRequest = 0, categoriesRequest = 0;
  let strip = $state<HTMLUListElement>(), panel = $state<HTMLDivElement>();
  let detailAnimations: Animation[] = [];
  function stopDetailAnimations() { for (const animation of detailAnimations) animation.cancel(); detailAnimations = []; }
  function animateDetails() {
    stopDetailAnimations();
    if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    detailAnimations = [...panel.querySelectorAll('.selected-heading, .explorer-metrics')].map(element =>
      element.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }));
  }
  const hasMore = $derived(nextOffset < total);
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
    routeLoading = true; routeError = ''; route = null;
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
      activity = result; route = nextRoute; routeError = nextRouteError; routeLoading = false;
      await tick();
      if (active && token === selectionRequest) animateDetails();
    } catch (cause) {
      if (active) { const message = fail(cause); if (token === selectionRequest) detailError = message; }
    } finally { if (active && token === selectionRequest) detailLoading = false; }
  }
  async function shiftRecord(direction: -1 | 1) {
    if (!active || listLoading || selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target < 0) return;
    if (target < items.length) { void choose(items[target]); return; }
    if (!hasMore) return;
    const previous = selectedId, generation = listRequest;
    await loadPage();
    if (active && listRequest === generation + 1 && selectedId === previous && items[target]) void choose(items[target]);
  }
  function changeMonth(value: string) {
    if (!/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) || month === value) return;
    month = value; void loadPage(true);
  }
  function shiftMonth(direction: -1 | 1) {
    if (!month) return;
    const [year, number] = month.split('-').map(Number);
    const next = year * 12 + number - 1 + direction;
    if (next < 12 || next > 119999) return;
    changeMonth(`${String(Math.floor(next / 12)).padStart(4, '0')}-${String(next % 12 + 1).padStart(2, '0')}`);
  }
  async function loadPage(reset = false) {
    if (!active || !reset && listLoading) return;
    const token = ++listRequest, category = filter === 'all' ? undefined : filter.slice(9);
    listLoading = true; listError = '';
    if (reset) {
      stopDetailAnimations();
      ++selectionRequest; items = []; total = 0; nextOffset = 0; selectedId = ''; activity = null; route = null;
      detailError = ''; routeError = ''; detailLoading = false; routeLoading = false;
    }
    try {
      let result = await readActivities(fetch, reset ? 0 : nextOffset, undefined, category, month || undefined);
      if (!active || token !== listRequest) return;
      if (!month && result.items.length) {
        month = result.items[0].activity_date.slice(0, 7);
        result = await readActivities(fetch, 0, undefined, category, month);
      }
      if (!active || token !== listRequest) return;
      const known = new Set(items.map(item => item.id));
      items = [...items, ...result.items.filter(item => !known.has(item.id))];
      nextOffset = result.offset + result.items.length;
      total = result.items.length ? result.total : nextOffset;
      if (reset && items.length) void choose(items[0]);
    } catch (cause) {
      if (active) { const message = fail(cause); if (token === listRequest) listError = message; }
    } finally { if (active && token === listRequest) listLoading = false; }
  }
  onMount(() => {
    active = true; void loadCategories(); void loadPage(true);
    return () => { active = false; ++listRequest; ++selectionRequest; ++categoriesRequest; stopDetailAnimations(); };
  });
</script>

{#snippet arrowIcon(direction: 'left' | 'right')}
  <svg class="arrow-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'M15 6 9 12 15 18' : 'M9 6 15 12 9 18'} /></svg>
{/snippet}

<section class="activity-explorer" aria-label="运动足迹">
  <div class="explorer-heading"><div><p class="eyebrow">回到每一次出发</p><h2>运动足迹</h2></div><div class="explorer-filters"><label>分类 <select aria-label="足迹分类" bind:value={filter} onchange={() => void loadPage(true)}><option value="all">全部</option><option value="category:">未分类</option>{#each categories.filter(value => value !== '') as category}<option value={`category:${category}`}>{category}</option>{/each}</select></label></div></div>
  {#if categoryError}<FeedbackState kind="error" title={categoryError}><button class="button-secondary" onclick={() => void loadCategories()}>重试足迹分类</button></FeedbackState>{/if}
  {#if activity || detailLoading || listLoading || detailError}
    <div class="selection-panel" bind:this={panel} aria-busy={detailLoading || listLoading}>
      <div class="selected-heading" aria-live="polite"><div><h3>{activity?.title || (detailLoading || listLoading ? '正在读取运动记录…' : '运动记录')}</h3><p>{activity ? `${formatDate(activity.activity_date)} · ${formatStartTime(activity.started_at, activity.timezone)} · ${activity.timezone}` : '—'}</p></div>{#if activity}<a href={`/activities/${activity.id}`} data-sveltekit-reload aria-disabled={detailLoading || !!detailError} tabindex={detailLoading || detailError ? -1 : undefined} class="button-secondary" class:inactive={detailLoading || !!detailError}>活动详情 ↗</a>{/if}</div>
      <div class="explorer-workspace">
        <button type="button" class="button-secondary record-arrow record-previous" aria-label="上一条运动记录" title="上一条运动记录" disabled={listLoading || selectedIndex <= 0} onclick={() => void shiftRecord(-1)}>{@render arrowIcon('left')}</button>
        <button type="button" class="button-secondary record-arrow record-next" aria-label="下一条运动记录" title="下一条运动记录" disabled={listLoading || selectedIndex < 0 || selectedIndex >= items.length - 1 && !hasMore} onclick={() => void shiftRecord(1)}>{@render arrowIcon('right')}</button>
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
        ]} /><p class="quality-note">{activity ? qualityLabel(activity.temporal_quality) : '—'}</p></div>
      </div>
      {#if detailLoading || detailError}<div class="selection-overlay" class:failure={!!detailError}>
        {#if detailError}<FeedbackState kind="error" title={detailError}><button class="button-secondary" onclick={() => { const selected = items.find(item => item.id === selectedId); if (selected) void choose(selected); }}>重试运动详情</button></FeedbackState>
        {:else}<FeedbackState kind="loading" title="正在切换运动记录…" />{/if}
      </div>{/if}
    </div>
  {/if}
  {#if listError}<FeedbackState kind="error" title={listError}><button class="button-secondary" onclick={() => void loadPage(!items.length)}>重试足迹记录</button></FeedbackState>{/if}
  <div class="browse-controls"><p>左右滑动浏览当月记录 · 点击切换地图</p><div class="month-controls"><div class="month-switcher"><button type="button" class="button-secondary" aria-label="上个月" title="上个月" disabled={!month || month === '0001-01'} onclick={() => shiftMonth(-1)}>{@render arrowIcon('left')}</button><label><span class="sr-only">月份</span><input type="month" aria-label="足迹月份" value={month} onchange={event => changeMonth(event.currentTarget.value)} /></label><button type="button" class="button-secondary" aria-label="下个月" title="下个月" disabled={!month || month === '9999-12'} onclick={() => shiftMonth(1)}>{@render arrowIcon('right')}</button></div><span aria-live="polite">· {listLoading ? '读取中…' : `${total} 条记录`}</span></div></div>
  {#if items.length}
    <ul class="activity-strip" bind:this={strip} aria-label="按时间浏览运动记录">
      {#each items as item (item.id)}<li><button class="history-card" class:selected={item.id === selectedId} data-id={item.id} aria-label={`选择运动 ${item.title}`} aria-pressed={item.id === selectedId} onclick={() => void choose(item)}><div class="history-copy"><time datetime={item.activity_date}>{formatDate(item.activity_date)}</time><strong>{item.title || '未命名活动'}</strong><span>{formatDistance(item.distance_m)} · {item.category || '未分类'}</span></div><RouteThumbnail activity={item} compact onauthrequired={cause => { fail(cause); }} /></button></li>{/each}
      {#if hasMore}<li class="load-more"><button class="button-secondary" disabled={listLoading} onclick={() => void loadPage()}>加载当月更多记录</button></li>{/if}
    </ul>
  {:else if !listLoading && !listError}<FeedbackState kind="empty" title="此月份与分类下没有运动记录"><a href="/activities" data-sveltekit-reload class="button-secondary">查看跑步记录</a></FeedbackState>{/if}
  {#if listLoading}<FeedbackState kind="loading" title="正在读取足迹记录…" />{/if}
</section>

<style>
  .activity-explorer { --explorer-padding: 1.5rem; min-width: 0; padding: var(--explorer-padding); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .explorer-heading, .selected-heading, .browse-controls { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
  .eyebrow, .selected-heading p, .browse-controls p, .quality-note { color: var(--muted-foreground); font-size: .75rem; line-height: 1.6; }
  h2 { font-size: 1.25rem; font-weight: 700; } h3 { font-size: 1.375rem; font-weight: 700; overflow-wrap: anywhere; }
  .explorer-filters { display: flex; flex-wrap: wrap; gap: .75rem; }
  .explorer-heading label { display: flex; align-items: center; gap: .5rem; font-size: .875rem; max-width: 100%; }
  select, input[type="month"] { min-height: 2.75rem; max-width: 14rem; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); padding: .5rem; }
  .selected-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-content: center; } .selected-heading > div { min-width: 0; } .selected-heading h3 { height: 3.85rem; line-height: 1.4; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; } .selected-heading p { margin-top: .375rem; height: 2.4rem; overflow-wrap: anywhere; overflow: hidden; }
  .explorer-workspace { position: relative; display: grid; grid-template-columns: minmax(0,1.7fr) minmax(17rem,1fr); gap: 1.5rem; margin-top: .5rem; }
  .record-arrow { position: absolute; top: calc(1rem + clamp(18rem, 50svh, 32rem) / 2); transform: translateY(-50%); z-index: 3; display: grid; place-items: center; width: 2.75rem; height: 2.75rem; padding: 0; border-radius: 50%; line-height: 1; background: var(--surface); }
  .arrow-icon { display: block; width: 1.5rem; height: 1.5rem; }
  .record-previous { left: calc(0px - var(--explorer-padding) - .5px); transform: translate(-50%, -50%); } .record-next { right: calc(0px - var(--explorer-padding) - .5px); transform: translate(50%, -50%); }
  .explorer-route, .explorer-metrics { min-width: 0; }
  .selection-panel { position: relative; margin-top: 1.5rem; }
  .selection-overlay { position: absolute; top: 7.75rem; left: 1rem; right: 1rem; width: fit-content; max-width: calc(100% - 2rem); background: var(--surface); border-radius: .75rem; box-shadow: 0 .25rem 1rem #0001; z-index: 2; } .selection-overlay.failure { width: auto; }
  .selection-overlay :global(.feedback) { max-width: 100%; }
  .explorer-route { height: calc(clamp(18rem, 50svh, 32rem) + 4rem); overflow: auto; }
  .route-empty { height: 100%; display: grid; align-content: center; border: 1px solid var(--border); border-radius: .75rem; background: var(--muted); }

  .explorer-metrics { padding-top: 1rem; }
  .explorer-metrics :global(.metrics) { grid-template-columns: repeat(2,minmax(0,1fr)); gap: .75rem; }
  .explorer-metrics :global(.metrics > div) { padding: .875rem; background: var(--muted); border: 0; border-radius: .75rem; }
  .explorer-metrics :global(.metrics dt), .explorer-metrics :global(.metrics dd) { padding-left: 0; }
  .explorer-metrics :global(.metrics dt) { font-size: .75rem; }
  .explorer-metrics :global(.metrics dd) { font-size: 1.375rem; }
  .explorer-metrics :global(.metric-icon) { position: static; transform: none; margin-bottom: .5rem; width: 2rem; height: 2rem; }
  .explorer-metrics :global(.metric-icon svg) { width: 20px; height: 20px; }
  .quality-note { margin-top: .75rem; min-height: 1.2rem; }
  .browse-controls { margin-top: 1.5rem; } .month-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: .5rem; margin-left: auto; max-width: 100%; } .month-controls > span { white-space: nowrap; min-width: 4rem; } .month-switcher { display: flex; align-items: center; gap: .25rem; } .month-switcher button { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; padding: 0; line-height: 1; } .month-controls input { width: 8.25rem; min-width: 0; } .month-controls { color: var(--muted-foreground); font-size: .75rem; }
  .activity-strip { display: flex; gap: .75rem; overflow-x: auto; scroll-snap-type: x proximity; margin-top: .75rem; padding: .25rem .125rem .75rem; }
  .activity-strip li { flex: 0 0 19rem; max-width: 100%; min-width: 0; scroll-snap-align: start; }
  .history-card { display: flex; align-items: center; justify-content: space-between; gap: .75rem; width: 100%; min-height: 7rem; padding: .875rem; text-align: left; border: 1px solid var(--border); border-radius: 1rem; transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease; }
  .history-card.selected { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); background: var(--primary-soft); }
  .history-copy { display: grid; gap: .375rem; min-width: 0; } .history-copy strong { font-size: .875rem; overflow-wrap: anywhere; } .history-copy time, .history-copy > span { font-size: .75rem; color: var(--muted-foreground); overflow-wrap: anywhere; }
  .history-card :global(.route-thumbnail) { flex-shrink: 0; }
  .activity-strip .load-more { display: grid; align-content: center; flex-basis: 10rem; }
  a.inactive { pointer-events: none; opacity: .5; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  @media(max-width:1199px) { .explorer-workspace { grid-template-columns: 1fr; } .explorer-metrics :global(.metrics) { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  @media(max-width:639px) { .record-arrow { top: calc(1rem + clamp(17rem, 40svh, 22rem) / 2); width: 2rem; height: 2rem; min-height: 2rem; } .selected-heading { grid-template-columns: 1fr; gap: .75rem; } .selected-heading > a { justify-self: start; } .selection-overlay { top: 11.25rem; } .activity-explorer { --explorer-padding: 1rem; } .explorer-metrics :global(.metrics) { grid-template-columns: repeat(2,minmax(0,1fr)); } .explorer-route { height: calc(clamp(17rem, 40svh, 22rem) + 4rem); } .activity-strip li { flex-basis: 17rem; } }
</style>
