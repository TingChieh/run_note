<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;
  const readAllFootprints = view.bind(scoped_readAllFootprints, 2);

  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { onMount } from 'svelte';
  import { warmMapLibrary } from '#lib/library-warmup.ts';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import { footprintDisplayData } from '#lib/map/footprint-display.ts';
  import { HEAT_LEVELS } from '#lib/map/footprint-colors.ts';
  import {
    readAllFootprints as scoped_readAllFootprints,
    allFootprintsPath,
    FootprintError,
  } from '#lib/api/footprints.ts';
  import type { Selection, FootprintsAll, FootprintSnapshot } from '#lib/api/footprints.ts';
  import {
    buildCacheNamespace,
    clearPrivateOfflineCache,
    extractFootprintMetadata,
    readFootprintMetaCache,
    saveFootprintMetaCache,
    type FootprintMetaSnapshot,
  } from '#lib/offline-cache.ts';
  const cacheNamespace = $derived(buildCacheNamespace(page.data.user?.id, view.manage ? 'owner' : view.href('/')));
  let offlineMeta = $state<FootprintMetaSnapshot | null>(null);
  let offlineMetaSavedAt = $state<number | null>(null);
  let mode = $state<Selection['mode']>('tracks');
  // Requested by the HTML itself instead of after hydration; the first load() below reuses the response.
  const firstRead = view.api(allFootprintsPath(page.url.searchParams.get('mode') === 'heatmap' ? 'heatmap' : 'tracks'));
  // Raw: a 50k-point collection must not be deep-proxied; it is only ever replaced wholesale.
  let data = $state.raw<FootprintsAll | null>(null),
    // Starts loading: the server already renders the screen-tall placeholder, so nothing moves on mount.
    loading = $state(true),
    message = $state(''),
    requestId = 0,
    mounted = $state(false);
  let status = $state<FootprintSnapshot['status'] | null>(null),
    generatedAt = $state<string | null>(null),
    refreshing = $state(false),
    refreshFailed = $state(false);
  let controller: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false;
  let mapVersion = $state(0);
  // Last ready result per mode: switching back renders instantly, then revalidates in the background.
  type Cached = { data: FootprintsAll; generatedAt: string | null; refreshing: boolean; refreshFailed: boolean };
  const cache = new Map<Selection['mode'], Cached>();
  const generatedLabel = $derived(
    generatedAt
      ? new Intl.DateTimeFormat('zh-CN', {
          timeZone: page.data.showcase?.timezone ?? 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(generatedAt))
      : '',
  );
  const headerMeta = $derived.by(() => {
    if (data) {
      return [
        '全部年份',
        `${data.visible_activity_count} / ${data.activity_count} 条路线`,
        refreshing ? '后台更新中' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (offlineMeta) {
      return ['离线缓存', `${offlineMeta.visible_activity_count} / ${offlineMeta.activity_count} 条路线`].join(' · ');
    }
    return '全部年份';
  });
  function changeMode(next: Selection['mode']) {
    if (mode === next) return;
    mode = next;
    const hit = cache.get(next);
    if (!hit) {
      void load();
      return;
    }
    clearTimeout(timer);
    loading = false;
    message = '';
    status = 'ready';
    data = hit.data;
    generatedAt = hit.generatedAt;
    refreshing = hit.refreshing;
    refreshFailed = hit.refreshFailed;
    void load(true);
  }
  function reload() {
    cache.clear();
    void load();
  }
  // silent: revalidate or poll without clearing what is already on screen.
  async function load(silent = false) {
    clearTimeout(timer);
    timer = undefined;
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (!silent) {
      loading = true;
      data = null;
      offlineMeta = null;
      offlineMetaSavedAt = null;
      message = '';
      status = null;
      generatedAt = null;
      refreshing = false;
      refreshFailed = false;
    }
    const requested = mode;
    const ns = cacheNamespace;
    try {
      const result = await readAllFootprints(requested, signal);
      if (disposed || id !== requestId) return;
      const next = result.result ? footprintDisplayData(result.result) : null;
      // Keep the same object when nothing changed, so the live map is not redrawn.
      if (!(next && data && generatedAt === result.generated_at)) data = next;
      offlineMeta = null;
      offlineMetaSavedAt = null;
      status = result.status;
      generatedAt = result.generated_at;
      refreshing = result.refreshing;
      refreshFailed = result.refresh_failed;
      message = '';
      const meta = extractFootprintMetadata(requested, result);
      if (meta) void saveFootprintMetaCache(ns, requested, meta);
      if (data) cache.set(requested, { data, generatedAt, refreshing, refreshFailed });
      else cache.delete(requested);
      if (result.status === 'failed') message = '足迹生成暂未完成，请稍后重新读取';
      if (result.status === 'pending')
        timer = setTimeout(() => {
          void load(true);
        }, 5000);
    } catch (cause) {
      if (disposed || id !== requestId || signal.aborted) return;
      if (cause instanceof FootprintError && cause.status === 401) {
        cache.clear();
        data = null;
        offlineMeta = null;
        status = null;
        generatedAt = null;
        refreshing = false;
        refreshFailed = false;
        void clearPrivateOfflineCache();
        window.location.replace('/admin?reason=changed');
        return;
      }
      if (silent && data) return;
      const networkDown =
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        !(cause instanceof FootprintError);
      if (networkDown) {
        const cached = await readFootprintMetaCache(ns, requested);
        if (disposed || id !== requestId) return;
        if (cached) {
          offlineMeta = cached.value;
          offlineMetaSavedAt = cached.savedAt;
          generatedAt = cached.value.generated_at;
          message = '';
          return;
        }
      }
      message = cause instanceof Error ? cause.message : '无法读取足迹，请重试';
    } finally {
      if (!disposed && id === requestId) loading = false;
    }
  }
  onMount(() => {
    disposed = false;
    const url = new URL(window.location.href);
    mode = url.searchParams.get('mode') === 'heatmap' ? 'heatmap' : 'tracks';
    if (url.search) {
      void goto(url.pathname, { state: page.state, shallow: true, replace: true }).catch(() => {});
    }
    mounted = true;
    void load();
    warmMapLibrary();
    return () => {
      disposed = true;
      ++requestId;
      clearTimeout(timer);
      controller?.abort();
    };
  });
</script>

<svelte:head>
  <title>{pageTitle('个人足迹', page.data.site)}</title>
  <link rel="preload" as="fetch" href={firstRead} crossorigin="anonymous" />
</svelte:head>
<!-- Editorial Receipt archive page (brand.md §2, §5, §6.2): compact yellow header, underline view tabs, 4px map sheet. -->
<div class="editorial-page footprints-page">
  <PageHeader title="个人足迹" meta={headerMeta}>
    {#snippet actions()}
      {#if data}
        <button type="button" class="button-secondary" onclick={reload}>重新读取足迹</button>
      {/if}
    {/snippet}
  </PageHeader>
  <div class="footprints-tabs-bar">
    <div class="footprints-tabs-left">
      <div class="underline-tabs" role="group" aria-label="地图模式">
        <button type="button" aria-pressed={mode === 'tracks'} disabled={!mounted} onclick={() => changeMode('tracks')}
          >轨迹叠加</button
        ><button
          type="button"
          aria-pressed={mode === 'heatmap'}
          disabled={!mounted}
          onclick={() => changeMode('heatmap')}>运动热力图</button
        >
      </div>
      {#if page.data.user && view.manage}
        <a class="exploration-tab-link" href={view.href('/footprints/exploration')}>城市探索</a>
      {/if}
    </div>
    <p class="mode-hint" data-testid="footprint-mode-hint">
      {mode === 'tracks' ? '看每次跑步的路线' : '看不同记录经过的区域'}
    </p>
  </div>
  {#if loading}<div class="page-loading"><PageSkeleton title="正在读取个人足迹…" /></div>{/if}
  {#if status === 'pending'}<FeedbackState kind="loading" title="正在生成全部足迹…"
      ><p>导入后会自动更新，完成后即可查看全部记录。页面会自动检查进度。</p>
      <button type="button" onclick={reload} class="button-secondary mt-3">重新读取足迹</button></FeedbackState
    >{/if}
  {#if message}<FeedbackState kind="error" title={message}
      ><button type="button" onclick={reload} class="button-secondary">重新读取足迹</button></FeedbackState
    >{/if}
  {#if offlineMeta && !data}
    <section class="section-hairline" data-testid="footprint-offline-meta" aria-label="离线足迹元数据">
      <FeedbackState
        kind="empty"
        title={`离线缓存足迹概览 · 全部 ${offlineMeta.activity_count} 条记录（地图可显示 ${offlineMeta.visible_activity_count} 条）`}
      >
        <p>
          模式：{offlineMeta.mode === 'heatmap' ? '运动热力图' : '轨迹叠加'} · 网格 {offlineMeta.grid_size_m} m
          {#if generatedLabel}· 快照更新于 {generatedLabel}{/if}
          {#if offlineMetaSavedAt}· 缓存于 {new Intl.DateTimeFormat('zh-CN', { timeZone: page.data.showcase?.timezone ?? 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(offlineMetaSavedAt))}{/if}
        </p>
        <p class="mt-2">离线模式仅展示已缓存的足迹元数据，在线底图与完整轨迹需联网后加载。</p>
        <button type="button" onclick={reload} class="button-secondary mt-3">重新读取足迹</button>
      </FeedbackState>
    </section>
  {/if}
  {#if data}
    {#if refreshFailed}<div class="status-strip" role="status" data-testid="footprint-refresh-failed">
        <strong>自动更新暂未完成，当前显示上次生成的足迹。</strong>后台会继续尝试更新，也可稍后重新读取。
      </div>{/if}
    <div class="result-summary" aria-live="polite">
      <p data-testid="footprint-summary">
        全部 <strong>{data.activity_count}</strong> 条运动记录，地图显示 <strong>{data.visible_activity_count}</strong> 条。
      </p>
      <p class="generated-label" data-testid="footprint-generated">
        更新于 {generatedLabel}{refreshing ? ' · 后台更新中' : ''}
      </p>
    </div>
    {#if data.unsupported_segment_count}<div class="status-strip" role="status">
        <strong>部分轨迹超出地图支持范围：</strong>{data.unsupported_segment_count} 个轨迹段包含超出 ±85.051129° 的极区部分，地图仅显示支持范围。
      </div>{/if}
    {#if data.features.length === 0}<FeedbackState title="还没有可显示的足迹"
        ><p>导入带路线的运动记录后，足迹会自动生成。</p>
        <a href={view.href('/activities')} class="button-secondary mt-3">导入 GPX 或查看运动记录</a></FeedbackState
      >
    {:else}
      {#key mapVersion}<FootprintMap
          {data}
          appearance="sheet"
          onretry={() => {
            mapVersion++;
          }}
        />{/key}
      {#if data.mode === 'heatmap'}<section class="section-hairline heat-legend" data-testid="heat-legend" aria-label="热度图例">
          <div class="section-head legend-heading">
            <h2>每格经过的不同运动记录数</h2>
            <span class="section-meta legend-peak">当前最高 {data.max_count} 次</span>
          </div>
          <div class="legend-levels">
            {#each HEAT_LEVELS as level}<span
                ><i style:background={level.color} aria-hidden="true"></i>{level.label}</span
              >{/each}
          </div>
          <p>热度按不同运动记录计数，不按 GPS 点数量。同一记录在同一格内只计一次。</p>
        </section>{/if}
    {/if}
  {/if}
  <details class="map-notes">
    <summary>地图说明与统计口径</summary>
    <div class="notes-content">
      <p>
        拖动地图探索，使用缩放按钮或键盘方向键移动；聚焦地图后按 + / −
        缩放。轨迹模式可点击重叠路线选择记录，也可从下方记录列表定位并进入详情；热图可点击热区，或展开热区数据查看计数。
      </p>
      <p>
        热图使用固定 100 × 100
        投影米网格（EPSG:3857）；实际地面尺度随纬度变化。同次运动的采样、绕圈和多个段只计一次，不同记录再次经过才增加热度。网格及色阶不随地图缩放变化。
      </p>
      <p>
        历史日期按活动保存时的当地日期归属。不同 GPX 轨迹段保持独立，不跨断点连线。底图由 OpenFreeMap 提供，使用
        OpenMapTiles 与 OpenStreetMap 数据；请求样式、字体、图标和当前视口瓦片，完整 GPX
        不发送给底图服务。底图不可用时仍可查看足迹。
      </p>
    </div>
  </details>
</div>

<style>
  .footprints-page {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .footprints-tabs-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .footprints-tabs-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-4);
    margin-bottom: -1px;
  }
  .exploration-tab-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition:
      color var(--transition-control),
      border-color var(--transition-control);
  }
  @media (hover: hover) {
    .exploration-tab-link:hover {
      color: var(--foreground);
    }
  }
  .mode-hint {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  summary {
    cursor: pointer;
    font-weight: var(--weight-semibold);
  }
  .result-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-1) var(--space-4);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .generated-label {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }
  .heat-legend {
    display: grid;
    gap: var(--space-2);
  }
  .legend-heading h2 {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
  }
  .legend-peak {
    font-family: var(--font-mono);
  }
  .legend-levels {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .legend-levels span {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .legend-levels i {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 0.125rem;
  }
  .heat-legend p {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .map-notes {
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
    font-size: var(--text-small);
  }
  .map-notes summary {
    color: var(--primary);
  }
  .notes-content {
    display: grid;
    gap: var(--space-3);
    color: var(--muted-foreground);
    margin-top: var(--space-3);
    line-height: var(--line-height-body);
  }
  @media (max-width: 767px) {
    .mode-hint {
      display: none;
    }
    .result-summary {
      display: grid;
      gap: var(--space-1);
    }
  }
</style>
