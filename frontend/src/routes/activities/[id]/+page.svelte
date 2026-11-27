<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;
  const readActivity = view.bind(scoped_readActivity, 1);
  const readRoute = view.bind(scoped_readRoute, 1);

  import { onMount, untrack } from 'svelte';
  import { afterNextPaint, warmMapLibrary } from '#lib/library-warmup.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import DeviceMetrics from '#lib/components/DeviceMetrics.svelte';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import SharePanel from '#lib/components/SharePanel.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import AnchoredPanel from '#lib/components/AnchoredPanel.svelte';
  import ActivityWallPreview from '#lib/components/ActivityWallPreview.svelte';
  import ActivityActions from '#lib/components/ActivityActions.svelte';
  import ActivityPosterDialog from '#lib/components/ActivityPosterDialog.svelte';
  import ActivityReplayDialog from '#lib/components/ActivityReplayDialog.svelte';
  import ActivityShareMenu from '#lib/components/ActivityShareMenu.svelte';
  import ActivityPaceChart from '#lib/components/ActivityPaceChart.svelte';
  import ActivityShoe from '#lib/components/shoes/ActivityShoe.svelte';
  import ActivityDiary from '#lib/components/ActivityDiary.svelte';
  import { ShoeError } from '#lib/api/shoes.ts';
  import { readReplay, type ReplayData } from '#lib/api/replay.ts';
  import {
    extractSplits,
    formatReceiptDate,
    formatReceiptTimeRange,
    splitFigure,
    visibilityLabel,
  } from '#lib/api/activity-splits.ts';
  import {
    ActivityError,
    readActivity as scoped_readActivity,
    readRoute as scoped_readRoute,
    formatDate,
    formatDistance,
    formatDuration,
    activityDuration,
    formatStartTime,
    formatPace,
    number as parseMetric,
    qualityLabel,
    qualityEntries,
    type Activity,
    type Route,
  } from '#lib/api/activities.ts';
  import {
    buildCacheNamespace,
    clearPrivateOfflineCache,
    readCachedActivity,
    upsertCachedActivities,
  } from '#lib/offline-cache.ts';
  const cacheNamespace = $derived(buildCacheNamespace(page.data.user?.id, view.manage ? 'owner' : view.href('/')));
  let showingCachedDetail = $state(false);
  const isNetworkFailure = (cause: unknown) =>
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    (cause instanceof ActivityError && cause.code === 'NETWORK_ERROR');
  let activity = $state<Activity | null>(null),
    // Raw like mapRoute below: a route is only ever replaced, never edited in place.
    route = $state.raw<Route | null>(null),
    replayData = $state.raw<ReplayData | null>(null),
    loading = $state(true),
    routeLoading = $state(false),
    replayLoading = $state(false),
    message = $state(''),
    routeError = $state(''),
    replayError = $state(''),
    disposed = false;
  let switching = $state(false);
  let manageBusy = $state(false);
  let editing = $state(false);
  // The map keeps showing the previous route while a switched record's route loads,
  // so the MapLibre instance is updated in place rather than torn down.
  let mapRoute = $state.raw<Route | null>(null);
  let replayFor = '';
  // The record's date and totals for the exported video's summary row; missing values are left out.
  const videoFacts = $derived.by((): [string, string][] => {
    if (!activity) return [];
    const facts: [string, string][] = [
      ['日期', formatDate(activity.activity_date)],
      ['总距离', formatDistance(activity.distance_m)],
      [activity.timer_seconds != null ? '设备用时' : '经过时间', formatDuration(activityDuration(activity))],
      ['平均配速', formatPace(activity.avg_pace_seconds_per_km)],
      ['平均心率', activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`],
      ['热量', activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`],
      ['步数', activity.steps == null ? '—' : `${activity.steps} 步`],
    ];
    return facts.filter(([, value]) => value !== '—');
  });
  const distance = $derived(activity ? splitFigure(formatDistance(activity.distance_m)) : { number: '—', unit: '' });
  const receiptDate = $derived(activity ? formatReceiptDate(activity.activity_date) : '—');
  const receiptTimeRange = $derived(
    activity ? formatReceiptTimeRange(activity.started_at, activity.ended_at, activity.timezone) : '',
  );
  const avgPaceNum = $derived(activity ? parseMetric(activity.avg_pace_seconds_per_km) : null);
  const splits = $derived(extractSplits(replayData));
  const leaderMetrics = $derived.by(() => {
    if (!activity) return [];
    const pace = splitFigure(formatPace(activity.avg_pace_seconds_per_km));
    const startTime = formatStartTime(activity.started_at, activity.timezone);
    const items: { label: string; value: string; unit?: string; missing?: boolean }[] = [
      {
        label: activity.timer_seconds != null ? '设备用时' : '经过时间',
        value: formatDuration(activityDuration(activity)),
        missing: activityDuration(activity) === null,
      },
      {
        label: '平均配速',
        value: pace.number,
        unit: pace.unit,
        missing: pace.number === '—',
      },
      ...(activity.timer_seconds != null
        ? [
            {
              label: '经过时间',
              value: formatDuration(activity.elapsed_seconds),
              missing: activity.elapsed_seconds === null,
            },
          ]
        : []),
      {
        label: '平均心率',
        value: activity.avg_heart_rate_bpm == null ? '—' : String(activity.avg_heart_rate_bpm),
        unit: activity.avg_heart_rate_bpm == null ? '' : 'bpm',
        missing: activity.avg_heart_rate_bpm == null,
      },
      {
        label: '热量',
        value: activity.calories_kcal == null ? '—' : String(activity.calories_kcal),
        unit: activity.calories_kcal == null ? '' : 'kcal',
        missing: activity.calories_kcal == null,
      },
      {
        label: '步数',
        value: activity.steps == null ? '—' : String(activity.steps),
        unit: activity.steps == null ? '' : '步',
        missing: activity.steps == null,
      },
      {
        label: '开始时间',
        value: startTime,
        missing: startTime === '—',
      },
      {
        label: '可见性',
        value: visibilityLabel(activity.visibility),
      },
    ];
    return items;
  });

  let poster = $state<ReturnType<typeof ActivityPosterDialog>>(),
    replay = $state<ReturnType<typeof ActivityReplayDialog>>(),
    actions = $state<ReturnType<typeof ActivityActions>>(),
    moreMenu = $state<ReturnType<typeof AnchoredPanel>>(),
    editButton = $state<HTMLButtonElement | null>(null);
  let mounted = $state(false),
    activityToken = 0,
    routeToken = 0,
    replayToken = 0;

  afterNavigate(({ from, type, shallow }) => {
    if (
      shallow ||
      type === 'enter' ||
      type === 'popstate' ||
      !from?.route.id ||
      from.url.origin !== page.url.origin ||
      /^\/(login|register)(\/|$)/.test(from.url.pathname)
    )
      return;
    // Keep the marker on this history entry so refreshing still permits a native Back.
    void goto(page.url.href, {
      shallow: true,
      replace: true,
      persistState: true,
      state: { ...page.state, activityBackAvailable: true },
    });
  });
  function goBack() {
    if (page.state.activityBackAvailable === true) window.history.back();
    else void goto(view.href('/activities'), { replace: true });
  }
  function expired(cause: unknown): boolean {
    if (!(cause instanceof ActivityError || cause instanceof ShoeError) || cause.status !== 401) return false;
    activityToken++;
    routeToken++;
    replayToken++;
    activity = null;
    route = null;
    mapRoute = null;
    replayData = null;
    replayFor = '';
    message = '';
    routeError = '';
    replayError = '';
    void clearPrivateOfflineCache();
    window.location.replace('/admin?reason=expired');
    return true;
  }
  function resetReplay() {
    replayToken++;
    replayData = null;
    replayFor = '';
    replayLoading = false;
    replayError = '';
  }
  async function loadReplay(id: string, force = false) {
    if (disposed || showingCachedDetail) return;
    if (!force && replayFor === id && (replayData || replayLoading || replayError)) return;
    const token = ++replayToken;
    replayFor = id;
    replayLoading = true;
    replayError = '';
    if (force) replayData = null;
    try {
      const result = await readReplay(id, fetch);
      if (!disposed && token === replayToken) {
        replayData = result;
      }
    } catch (cause) {
      if (!disposed && token === replayToken && !expired(cause)) {
        replayData = null;
        replayError = cause instanceof Error ? cause.message : '无法读取配速与回放数据';
      }
    } finally {
      if (!disposed && token === replayToken) replayLoading = false;
    }
  }
  function ensureReplay(id: string) {
    if (replayFor === id && (replayData || replayLoading || replayError)) return;
    void loadReplay(id, false);
  }
  async function loadRoute(id: string) {
    const token = ++routeToken;
    routeLoading = true;
    route = null;
    routeError = '';
    try {
      const result = await readRoute(id);
      if (!disposed && token === routeToken) {
        route = result;
        mapRoute = result;
        // Fetch replay samples once the route itself is ready so nothing competes with initial map framing.
        ensureReplay(id);
      }
    } catch (cause) {
      if (!disposed && token === routeToken && !expired(cause)) {
        mapRoute = null;
        routeError = cause instanceof Error ? cause.message : '无法读取路线';
      }
    } finally {
      if (!disposed && token === routeToken) routeLoading = false;
    }
  }
  async function loadActivity(id = page.shallow?.params?.id ?? page.params.id ?? '') {
    if (disposed) return;
    const token = ++activityToken;
    routeToken++;
    resetReplay();
    loading = true;
    message = '';
    activity = null;
    route = null;
    mapRoute = null;
    routeLoading = false;
    routeError = '';
    showingCachedDetail = false;
    const ns = cacheNamespace;
    try {
      const result = await readActivity(id, fetch, view.manage);
      if (disposed || token !== activityToken) return;
      activity = result;
      void upsertCachedActivities(ns, [result]);
      // The title is on screen: fetch the map library while the route is still on its way.
      if (result.has_route) afterNextPaint(warmMapLibrary);
      if (result.has_route) await loadRoute(result.id);
    } catch (cause) {
      if (disposed || token !== activityToken || expired(cause)) return;
      if (isNetworkFailure(cause)) {
        const cached = await readCachedActivity(ns, id);
        if (disposed || token !== activityToken) return;
        if (cached) {
          activity = cached.value;
          showingCachedDetail = true;
          if (cached.value.has_route) {
            routeError = '离线模式暂不支持加载未缓存路线与在线底图，联网后可重新读取路线。';
            replayError = '离线模式暂不支持加载配速曲线，联网后可重新读取。';
          }
          return;
        }
      }
      message = cause instanceof Error ? cause.message : '无法读取活动';
    } finally {
      if (!disposed && token === activityToken) loading = false;
    }
  }
  async function switchActivity(id: string): Promise<boolean> {
    if (disposed) return false;
    if (id === activity?.id) return true;
    const token = ++activityToken;
    switching = true;
    try {
      const next = await readActivity(id, fetch, view.manage);
      if (disposed || token !== activityToken) return false;
      // Replace this detail entry so Back still reaches the original list or wall page.
      await goto(view.href(`/activities/${id}`), {
        shallow: true,
        replace: true,
        persistState: true,
        reset: false,
        state: page.state,
      });
      if (disposed || token !== activityToken) return false;
      routeToken++;
      resetReplay();
      activity = next;
      route = null;
      routeError = '';
      routeLoading = false;
      loading = false;
      if (!next.has_route) mapRoute = null;
      // Commit the record first; its heavier route loads independently on demand.
      if (next.has_route) void loadRoute(next.id);
      return true;
    } catch (cause) {
      if (disposed || token !== activityToken || expired(cause)) return false;
      throw cause;
    } finally {
      if (!disposed && token === activityToken) switching = false;
    }
  }
  function chooseDelete() {
    moreMenu?.close();
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actions?.openDelete(trigger);
  }
  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
      activityToken++;
      routeToken++;
      replayToken++;
    };
  });
  $effect(() => {
    const id = page.shallow?.params?.id ?? page.params.id;
    if (mounted && !switching)
      untrack(() => {
        if (activity?.id !== id) void loadActivity(id);
      });
  });
</script>

<svelte:head><title>{pageTitle(activity?.title || '活动详情', page.data.site)}</title></svelte:head>
<div class="editorial-page detail-page">
  {#if message}
    <div class="detail-toolbar">
      <button type="button" class="back-crumb" onclick={goBack}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
        >返回
      </button>
    </div>
    <div class="mt-6">
      <FeedbackState kind="error" title={message}>
        <button type="button" onclick={() => void loadActivity()} class="button-secondary mt-3">重新读取活动详情</button>
      </FeedbackState>
    </div>
  {:else if activity}
    {#if showingCachedDetail}
      <div class="status-strip offline-strip" data-testid="activity-detail-offline-notice" role="status">
        <span>当前显示离线缓存详情，恢复网络后可重新同步最新数据。</span>
        <button type="button" class="button-text" onclick={() => void loadActivity(activity!.id)}>重新读取活动详情</button>
      </div>
    {/if}

    <div class="detail-stage" class:switching data-testid="sport-hero" aria-busy={switching}>
      <div class="detail-toolbar">
        <button type="button" class="back-crumb" onclick={goBack}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
          >返回
        </button>
        <div class="detail-actions">
          {#if activity.has_route}
            <ActivityShareMenu
              onposter={(from) => poster?.open(from)}
              onvideo={(from) => replay?.openExport(from)}
            />
          {/if}
          {#if view.manage}
            <button
              bind:this={editButton}
              type="button"
              class="button-secondary"
              disabled={manageBusy || editing}
              onclick={() => actions?.openEdit('title', editButton)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg
              >编辑记录
            </button>
            <AnchoredPanel bind:this={moreMenu} label="更多" panelLabel="更多操作">
              {#snippet trigger()}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg
                >
              {/snippet}
              <div class="more-menu">
                <button
                  type="button"
                  class="rn-menu-option danger-option"
                  data-tone="danger"
                  disabled={manageBusy}
                  onclick={chooseDelete}
                >
                  删除记录
                </button>
              </div>
            </AnchoredPanel>
          {/if}
        </div>
      </div>

      {#if view.manage}
        <ActivityActions
          bind:this={actions}
          {activity}
          onupdated={(value) => {
            activity = value;
          }}
          onbusychange={(value) => (manageBusy = value)}
          oneditingchange={(value) => (editing = value)}
        />
      {/if}

      <div class="detail-workspace">
        <section class="receipt-sheet stub" aria-label="运动指标">
          <div class="receipt-header">
            <span>{receiptDate}</span>
            {#if receiptTimeRange}<span>{receiptTimeRange}</span>{/if}
          </div>
          <h1 id="activity-title" class="stub-title">{activity.title || '未命名活动'}</h1>
          <p class="stub-sub">
            <span>{activity.timezone}</span>
            {#if activity.category}<span class="stub-category">{activity.category}</span>{/if}
            {#each activity.tags ?? [] as tag}<span>#{tag}</span>{/each}
          </p>
          <p class="stub-distance" data-testid="activity-distance">
            <span class="stub-distance-num">{distance.number}</span>{#if distance.unit}{' '}<span class="figure-unit stub-distance-unit">{distance.unit}</span>{/if}{#if distance.number === '—'}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}
          </p>
          <dl class="stub-leaders">
            {#each leaderMetrics as item (item.label)}
              <div class="leader-row">
                <dt>{item.label}</dt>
                <dd class:muted={item.missing}>
                  {item.value}{#if item.unit}{' '}<span class="figure-unit">{item.unit}</span>{/if}{#if item.missing}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}
                </dd>
              </div>
            {/each}
          </dl>
          {#if activity.temporal_quality !== 'complete'}
            <p class="stub-quality-note">
              {qualityLabel(activity.temporal_quality)} · 缺失或无法可靠计算的指标以“—”显示，详情见数据质量说明。
            </p>
          {/if}

          {#if splits.length > 0}
            <div class="receipt-perforation" aria-hidden="true"></div>
            <p class="stub-kicker">每公里配速</p>
            <ol class="splits-bars" aria-label="每公里配速" data-testid="activity-splits-bars">
              {#each splits as row (row.index)}
                <li class:fastest={row.fastest}>
                  <span class="split-km">{row.label}</span>
                  <span class="split-pace">
                    {#if row.paceSecondsPerKm !== null}
                      <strong>{formatDuration(row.paceSecondsPerKm)}</strong>{#if row.fastest}<span class="split-best">最快</span>{/if}
                    {:else}
                      <span class="muted">—<span class="sr-only">（缺失）</span></span>
                    {/if}
                  </span>
                  <span class="split-bar-track" aria-hidden="true">
                    {#if row.barRatio > 0}<i style:width={`${Math.round(row.barRatio * 100)}%`}></i>{/if}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}

          {#if view.manage}
            <div class="receipt-perforation" aria-hidden="true"></div>
            <div class="stub-notes">
              <p class="stub-notes-label">私人备注</p>
              {#if activity.notes}
                <p class="stub-notes-body">{activity.notes}</p>
              {:else}
                <button
                  type="button"
                  class="button-text stub-note-link"
                  disabled={manageBusy || editing}
                  onclick={() => actions?.openEdit('notes', editButton)}
                >
                  添加备注
                </button>
              {/if}
            </div>
          {/if}
        </section>

        <div class="detail-main">
          <section class="route-panel" aria-labelledby="route-title">
            <h2 id="route-title" class="sr-only">路线</h2>
            {#if mapRoute}
              <div class="route-stage" class:stale={!route}>
                <RouteMap route={mapRoute} appearance="sheet">
                  {#snippet controls()}
                    {#if activity?.has_route}
                      <button
                        type="button"
                        class="button-secondary replay-trigger"
                        disabled={!mounted}
                        onclick={(e) => replay?.open(e.currentTarget)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          aria-hidden="true"
                          ><circle cx="12" cy="12" r="9" /><path
                            d="M10 8.5v7l5.5-3.5z"
                            fill="currentColor"
                            stroke="none"
                          /></svg
                        >动态回放
                      </button>
                    {/if}
                  {/snippet}
                </RouteMap>
                {#if !route && routeLoading}
                  <p class="route-swap-status" role="status">正在读取路线…</p>
                {/if}
              </div>
            {:else if routeLoading}
              <div class="route-placeholder">
                <FeedbackState kind="loading" title="正在读取路线…" />
              </div>
            {:else if routeError}
              <div class="route-placeholder">
                <FeedbackState kind="error" title={routeError}>
                  <button type="button" onclick={() => void loadRoute(activity!.id)} class="button-secondary mt-3">
                    重新读取路线
                  </button>
                </FeedbackState>
              </div>
            {:else}
              <div class="route-placeholder">
                <FeedbackState kind="empty" title="此活动没有路线。">
                  <p>运动指标仍可查看，路线仅在记录包含轨迹时显示。</p>
                </FeedbackState>
              </div>
            {/if}
          </section>

          <ActivityPaceChart
            replay={replayData}
            loading={replayLoading}
            error={replayError}
            hasRoute={activity.has_route}
            avgPaceSecondsPerKm={avgPaceNum}
            onretry={() => void loadReplay(activity!.id, true)}
          />
        </div>
      </div>
    </div>

    {#if view.manage && page.data.user}
      {#key activity.id}
        <ActivityShoe id={activity.id} onauthrequired={expired} />
      {/key}
    {/if}
    <div class="device-metrics-wrap">
      <DeviceMetrics metrics={activity} />
    </div>
    <details class="section-hairline quality-details">
      <summary>数据质量与指标说明</summary>
      <div class="mt-4">
        <p>{qualityLabel(activity.temporal_quality)}</p>
        <p class="mt-2 text-sm text-muted-foreground">“—”表示缺失或无法可靠计算。指标版本：{activity.metrics_version}</p>
        {#if Object.keys(activity.quality_summary).length}
          <dl class="mt-4 grid gap-3 sm:grid-cols-2">
            {#each qualityEntries(activity.quality_summary) as [key, value]}
              <div class="min-w-0">
                <dt class="text-sm font-medium">{key}</dt>
                <dd class="mt-1 break-all text-sm text-muted-foreground">{value}</dd>
              </div>
            {/each}
          </dl>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">没有额外质量提示。</p>
        {/if}
      </div>
    </details>
    <ActivityWallPreview
      {activity}
      {route}
      {routeLoading}
      {routeError}
      onauthrequired={expired}
      onswitch={switchActivity}
    />
    {#if view.manage && page.data.user}
      {#key activity.id}
        <ActivityDiary id={activity.id} onauthrequired={expired} />
      {/key}
    {/if}
    {#if view.manage}<SharePanel {activity} />{/if}

    {#if activity.has_route}
      <ActivityPosterDialog bind:this={poster} activityId={activity.id} showTrigger={false} />
      <ActivityReplayDialog
        bind:this={replay}
        activityId={activity.id}
        facts={videoFacts}
        showTrigger={false}
        sharedReplay={replayData}
        sharedLoading={replayLoading}
        sharedError={replayError}
        onensure={() => ensureReplay(activity!.id)}
        onretry={() => void loadReplay(activity!.id, true)}
        onauthrequired={expired}
      />
    {/if}
  {:else if loading}
    <div class="page-loading mt-6"><FeedbackState kind="loading" title="正在读取活动…" /></div>
  {/if}
</div>

<style>
  .detail-page {
    min-width: 0;
  }
  .offline-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-4);
  }
  .detail-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .back-crumb {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 2.75rem;
    padding: 0 var(--space-2) 0 0;
    border: 0;
    background: none;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  @media (hover: hover) {
    .back-crumb:hover {
      color: var(--foreground);
    }
  }
  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .detail-actions :global(.anchored-trigger) {
    border-radius: var(--radius-control);
  }
  .more-menu {
    display: grid;
    gap: var(--space-1);
  }
  .more-menu :global(.rn-menu-option.danger-option),
  .more-menu :global(.rn-menu-option.danger-option:hover) {
    color: var(--error);
  }
  .detail-workspace {
    display: grid;
    grid-template-columns: 25rem minmax(0, 1fr);
    gap: var(--space-8);
    align-items: start;
    transition: opacity var(--motion-reveal);
  }
  .detail-stage.switching .detail-workspace {
    opacity: 0.65;
    transition-delay: 150ms;
  }
  .stub {
    --perforation-ground: var(--background);
  }
  .stub-title {
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-title);
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }
  .stub-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.35rem;
    margin-top: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .stub-sub > span:not(:last-child)::after {
    content: '·';
    margin-left: 0.35rem;
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .stub-category {
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .stub-distance {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem;
    margin: var(--space-4) 0 var(--space-3);
    font-variant-numeric: tabular-nums;
  }
  .stub-distance-num {
    font-size: var(--text-figure);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    letter-spacing: var(--tracking-tight);
    color: var(--foreground);
  }
  .stub-distance-unit {
    font-size: var(--text-section);
  }
  .stub-leaders {
    display: grid;
    gap: 0;
    margin: 0;
  }
  .stub-leaders .leader-row {
    padding: 0.45rem 0;
  }
  .stub-leaders dt {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .stub-leaders dd {
    margin: 0;
    font-size: var(--text-small);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .stub-leaders dd.muted {
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .stub-leaders dd .figure-unit {
    font-size: var(--text-caption);
  }
  .stub-quality-note {
    margin-top: var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .stub-kicker {
    margin-bottom: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    color: var(--primary);
  }
  .splits-bars {
    list-style: none;
    margin: 0;
    padding: 0;
    font-variant-numeric: tabular-nums;
  }
  .splits-bars li {
    display: grid;
    grid-template-columns: 2.25rem 5.25rem minmax(0, 1fr);
    gap: var(--space-2);
    align-items: center;
    padding: 0.3rem 0;
    font-size: var(--text-small);
  }
  .split-km {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
  }
  .split-pace {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    white-space: nowrap;
  }
  .split-pace strong {
    font-weight: var(--weight-bold);
  }
  .split-best {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
  }
  .split-bar-track {
    display: block;
    min-width: 0;
  }
  .split-bar-track i {
    display: block;
    height: 0.625rem;
    background: var(--primary);
    opacity: 0.85;
  }
  .splits-bars li.fastest .split-bar-track i {
    background: var(--receipt-mark);
    opacity: 1;
  }
  .stub-notes-label {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .stub-notes-body {
    margin-top: var(--space-2);
    font-size: var(--text-body);
    line-height: var(--line-height-body);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .stub-note-link {
    margin-top: var(--space-1);
    min-height: 2.75rem;
  }
  .detail-main,
  .route-panel {
    min-width: 0;
  }
  .route-panel {
    --route-map-height: 35rem;
  }
  .route-stage {
    position: relative;
  }
  .route-stage :global(.route-map) {
    transition: opacity var(--motion-reveal);
  }
  .route-stage.stale :global(.route-map) {
    opacity: 0.45;
  }
  .route-placeholder :global(.feedback),
  .route-stage :global(.feedback) {
    animation: none;
  }
  .route-placeholder {
    display: grid;
    align-content: center;
    min-height: var(--route-map-height);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--recap-well);
  }
  .route-swap-status {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    box-shadow: 0 var(--space-2) var(--space-6) var(--glass-shadow);
    pointer-events: none;
  }
  .replay-trigger {
    min-height: 2.5rem;
    padding: 0.375rem 0.75rem;
    font-size: var(--text-small);
    white-space: nowrap;
  }
  .device-metrics-wrap :global(.device-metrics) {
    margin-top: var(--space-8);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  .quality-details {
    margin-top: var(--space-8);
  }
  .quality-details summary {
    padding-block: 0.625rem;
    color: var(--foreground);
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
  }
  .muted {
    color: var(--muted-foreground);
  }
  @media (max-width: 1199px) {
    .detail-workspace {
      grid-template-columns: 22.5rem minmax(0, 1fr);
      gap: var(--space-6);
    }
    .route-panel {
      --route-map-height: 30rem;
    }
  }
  @media (max-width: 1023px) {
    .detail-workspace {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
    }
    .route-panel {
      --route-map-height: 26rem;
    }
  }
  @media (max-width: 639px) {
    .route-panel {
      --route-map-height: clamp(18.5rem, 46svh, 23rem);
    }
    .splits-bars li {
      grid-template-columns: 2rem 4.75rem minmax(0, 1fr);
    }
  }
</style>
