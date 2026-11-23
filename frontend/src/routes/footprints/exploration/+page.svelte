<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ExplorationMap, { type FocusTarget } from '#lib/components/ExplorationMap.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { FootprintError } from '#lib/api/footprints.ts';
  import {
    readCatalog,
    readCells,
    readDetail,
    readMarkers,
    type ExplorationCatalog,
    type ExplorationCells,
    type ExplorationDetail,
    type ExplorationMarker,
    type ExplorationMarkersResponse,
    type Layer,
    type Scope,
    type Viewport,
  } from '#lib/api/exploration.ts';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';

  type YearSelection = number | 'all';
  type KindFilter = 'all' | 'boundary' | 'nearby';
  type SortKey = 'distance' | 'count' | 'recent' | 'first';

  const view = useViewContext();
  const number = new Intl.NumberFormat('zh-CN');
  const metres = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const count = (value: number | null | undefined) => (value == null ? '—' : number.format(value));
  const km = (value: number | null | undefined) => (value == null ? '—' : `${metres.format(value / 1000)} km`);

  type NavState = { scope: Scope; code: string; year: YearSelection; layer: Layer };

  let pendingNav = $state<NavState | null>(null);
  let navSeq = 0;

  const section = $derived(page.url.searchParams.get('scope'));
  const urlScope = $derived<Scope>(section === 'region' || section === 'city' ? section : 'global');
  const urlCode = $derived(urlScope === 'global' ? 'all' : (page.url.searchParams.get('code') ?? 'all'));
  const urlLayer = $derived<Layer>(page.url.searchParams.get('layer') === 'new' ? 'new' : 'heatmap');
  const path = $derived(view.href('/footprints/exploration'));
  const currentYear = $derived(
    Number(
      new Intl.DateTimeFormat('en', {
        year: 'numeric',
        timeZone: page.data.user?.timezone ?? 'UTC',
      }).format(new Date()),
    ),
  );

  const urlYear = $derived.by<YearSelection | null>(() => {
    const raw = page.url.searchParams.get('year');
    if (raw === 'all') return 'all';
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1900 && parsed <= currentYear ? parsed : null;
  });

  const scope = $derived<Scope>(pendingNav?.scope ?? urlScope);
  const code = $derived(pendingNav?.code ?? urlCode);
  const layer = $derived<Layer>(pendingNav?.layer ?? urlLayer);
  const selectedYear = $derived<YearSelection>(pendingNav?.year ?? urlYear ?? (layer === 'new' ? currentYear : 'all'));
  const isAllYears = $derived(selectedYear === 'all');
  const numericYear = $derived(selectedYear === 'all' ? currentYear : selectedYear);
  const yearLabel = $derived(selectedYear === 'all' ? '全部年份' : `${selectedYear} 年`);

  const href = (
    nextScope: Scope,
    nextCode: string,
    nextYear: YearSelection = selectedYear,
    nextLayer: Layer = layer,
  ) => {
    const params = new URLSearchParams();
    if (nextScope !== 'global' || nextCode !== 'all') {
      params.set('scope', nextScope);
      params.set('code', nextCode);
    }
    params.set('year', String(nextYear));
    if (nextLayer !== 'heatmap') params.set('layer', nextLayer);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  let mounted = $state(false);
  let disposed = false;
  let mapRef = $state<ReturnType<typeof ExplorationMap> | undefined>(undefined);
  let catalog = $state.raw<ExplorationCatalog | null>(null);
  let markersData = $state.raw<ExplorationMarkersResponse | null>(null);
  let detail = $state.raw<ExplorationDetail | null>(null);
  let grid = $state.raw<ExplorationCells | null>(null);
  let viewport = $state.raw<Viewport | null>(null);
  let focusTarget = $state.raw<FocusTarget | null>(null);
  let focusSeq = 0;

  let kindFilter = $state<KindFilter>('all');
  let sortKey = $state<SortKey>('distance');
  let cityFilterText = $state('');

  let catalogError = $state('');
  let markersError = $state('');
  let detailError = $state('');
  let gridError = $state('');

  let catalogRetry = $state(0);
  let markersRetry = $state(0);
  let detailRetry = $state(0);
  let gridRetry = $state(0);

  let catalogId = 0;
  let markersId = 0;
  let detailId = 0;
  let gridId = 0;
  let identity: string | null | undefined;

  const years = $derived(
    Array.from(
      { length: currentYear - Math.min(numericYear, detail?.first_year ?? numericYear) + 1 },
      (_, i) => currentYear - i,
    ),
  );
  const peak = $derived(Math.max(1, ...(detail?.months.map((month) => month.new_cells ?? 0) ?? [])));
  const versionMatches = (a: { source_version: number; atlas_version: string }, b: typeof a) =>
    a.source_version === b.source_version && a.atlas_version === b.atlas_version;

  const rawMarkers = $derived(markersData?.items ?? []);
  const scopedMarkers = $derived.by(() => {
    if (scope === 'region') return rawMarkers.filter((item) => item.region_code === code);
    return rawMarkers;
  });

  const filteredCities = $derived.by(() => {
    const query = cityFilterText.trim().toLowerCase();
    const list = scopedMarkers.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (
        query &&
        !item.name.toLowerCase().includes(query) &&
        !(item.region_name ?? '').toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortKey === 'distance') {
        const diff = (b.distance_m ?? -1) - (a.distance_m ?? -1);
        if (diff !== 0) return diff;
      } else if (sortKey === 'count') {
        if (b.activity_count !== a.activity_count) return b.activity_count - a.activity_count;
      } else if (sortKey === 'first') {
        if (a.first_date !== b.first_date) return a.first_date.localeCompare(b.first_date);
      } else if (sortKey === 'recent') {
        if (b.last_date !== a.last_date) return b.last_date.localeCompare(a.last_date);
      }
      return b.activity_count - a.activity_count || a.code.localeCompare(b.code);
    });
  });

  const hasHistoricalData = $derived((catalog?.boundary_count ?? 0) + (catalog?.nearby_count ?? 0) > 0);

  function report(error: unknown) {
    if (error instanceof FootprintError && error.status === 401) {
      catalog = markersData = detail = grid = null;
      viewport = null;
      disposed = true;
      window.location.replace('/admin?reason=changed');
    }
    return error instanceof FootprintError ? error.message : '无法读取城市探索，请重试';
  }

  function retry() {
    catalogRetry += 1;
    markersRetry += 1;
    detailRetry += 1;
    gridRetry += 1;
  }

  function navigate(nextScope: Scope, nextCode: string, nextYear: YearSelection, nextLayer: Layer) {
    const token = ++navSeq;
    pendingNav = { scope: nextScope, code: nextCode, year: nextYear, layer: nextLayer };
    void goto(href(nextScope, nextCode, nextYear, nextLayer)).finally(() => {
      if (navSeq === token) pendingNav = null;
    });
  }

  function changeScope(input: string) {
    const [nextScope, nextCode] = input.split(':');
    if (nextScope === 'global' || nextScope === 'region' || nextScope === 'city') {
      if (nextScope === 'city') {
        const marker = rawMarkers.find((item) => item.code === nextCode);
        if (marker) {
          focusTarget = {
            bounds: marker.bounds,
            center: [marker.lon, marker.lat],
            zoom: marker.kind === 'nearby' ? 9.5 : 11,
            seq: ++focusSeq,
          };
        }
      } else if (nextScope === 'global') {
        focusTarget = null;
        mapRef?.resetToOverview();
      }
      navigate(nextScope, nextCode, selectedYear, layer);
    }
  }

  function selectCityMarker(marker: ExplorationMarker) {
    focusTarget = {
      bounds: marker.bounds,
      center: [marker.lon, marker.lat],
      zoom: marker.kind === 'nearby' ? 9.5 : 11,
      seq: ++focusSeq,
    };
    navigate('city', marker.code, selectedYear, layer);
  }

  function switchLayer(next: Layer) {
    if (layer === next) return;
    grid = null;
    const targetYear = next === 'new' && selectedYear === 'all' ? currentYear : selectedYear;
    navigate(scope, code, targetYear, next);
  }

  function switchYear(value: string) {
    if (value === 'all') {
      grid = null;
      navigate(scope, code, 'all', 'heatmap');
      return;
    }
    const nextYear = Number(value);
    if (Number.isInteger(nextYear)) {
      grid = null;
      navigate(scope, code, nextYear, layer);
    }
  }

  function switchToAllYearsHeatmap() {
    grid = null;
    navigate(scope, code, 'all', 'heatmap');
  }

  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
    };
  });

  $effect(() => {
    const owner = page.data.user?.id;
    if (owner === identity) return;
    identity = owner;
    catalog = markersData = detail = grid = null;
    viewport = null;
    retry();
  });

  $effect(() => {
    void catalogRetry;
    if (!mounted || !page.data.user) return;
    const id = ++catalogId;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    catalogError = '';
    async function load() {
      try {
        const result = await readCatalog(0, controller.signal);
        if (disposed || controller.signal.aborted || id !== catalogId) return;
        catalog = result;
        if (result.status === 'pending') {
          poll = setTimeout(() => {
            void load();
          }, 3500);
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted && id === catalogId) catalogError = report(error);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(poll);
    };
  });

  $effect(() => {
    const targetYear = selectedYear;
    void markersRetry;
    if (!mounted || !page.data.user) return;
    const id = ++markersId;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    markersError = '';
    async function load() {
      try {
        const result = await readMarkers(targetYear, controller.signal);
        if (disposed || controller.signal.aborted || id !== markersId) return;
        markersData = result;
        if (result.status === 'pending') {
          poll = setTimeout(() => {
            void load();
          }, 3500);
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted && id === markersId) markersError = report(error);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(poll);
    };
  });

  $effect(() => {
    const selected = scope;
    const selectedCode = code;
    const targetYear = numericYear;
    const cumulative = isAllYears;
    void detailRetry;
    detail = grid = null;
    viewport = null;
    detailError = gridError = '';
    if (!mounted || !page.data.user) return;
    const id = ++detailId;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await readDetail(selected, selectedCode, targetYear, controller.signal, cumulative);
        if (disposed || controller.signal.aborted || id !== detailId) return;
        detail = result;
        if (result.status === 'pending') {
          poll = setTimeout(() => {
            void load();
          }, 3500);
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted && id === detailId) detailError = report(error);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(poll);
    };
  });

  $effect(() => {
    const result = detail;
    const box = viewport;
    const mode = layer;
    const cumulative = isAllYears;
    const targetYear = numericYear;
    void gridRetry;
    if (!mounted || !result || result.status !== 'ready' || result.city?.kind === 'nearby') return;
    if (result.scope === 'global' && box === null) {
      grid = null;
      return;
    }
    const id = ++gridId;
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    gridError = '';
    void readCells(result.scope, result.code, targetYear, mode, box, controller.signal, cumulative)
      .then((data) => {
        if (disposed || controller.signal.aborted || id !== gridId) return;
        if (!versionMatches(result, data)) {
          retry();
          return;
        }
        grid = data;
        if (data.status === 'failed') gridError = '无法读取格网，请重试';
        if (data.status === 'pending') {
          poll = setTimeout(() => {
            gridRetry += 1;
          }, 3500);
        }
      })
      .catch((error) => {
        if (!disposed && !controller.signal.aborted && id === gridId) gridError = report(error);
      });
    return () => {
      controller.abort();
      clearTimeout(poll);
    };
  });
</script>

<svelte:head>
  <title>{pageTitle('城市探索', page.data.site)}</title>
</svelte:head>

<PageHeader title="城市探索">
  {#snippet actions()}
    <a class="button-secondary" href={view.href('/footprints')}>返回运动足迹</a>
  {/snippet}
</PageHeader>

{#snippet waiting(message: string)}
  <FeedbackState kind="loading" title={message}>
    <button type="button" class="button-secondary" onclick={retry}>重新读取</button>
  </FeedbackState>
{/snippet}
{#snippet failure(message: string, action: () => void)}
  <FeedbackState kind="error" title={message}>
    <button type="button" class="button-secondary" onclick={action}>重试</button>
  </FeedbackState>
{/snippet}

<div class="exploration">
  {#if catalogError}
    {@render failure(catalogError, retry)}
  {:else if markersError && !markersData}
    {@render failure(markersError, retry)}
  {:else if !catalog && !markersData}
    <PageSkeleton title="正在读取城市探索…" />
  {:else if catalog?.status === 'pending' && !markersData?.items.length}
    {@render waiting('正在整理历史足迹')}
  {:else if catalog?.status === 'failed'}
    {@render failure('城市探索整理失败，请稍后重试', retry)}
  {:else if catalog && catalog.activity_count === 0}
    <FeedbackState title="还没有跑步记录">
      <a class="button-secondary" href={view.href('/activities')}>查看活动</a>
    </FeedbackState>
  {:else if catalog && catalog.activity_count === catalog.no_track_count}
    <FeedbackState title="暂无带轨迹的活动" />
  {:else}
    {#if scope === 'city' && detail?.city?.kind === 'nearby'}
      <MetricSummary
        appearance="default"
        items={[
          { label: '附近有记录', value: `${count(detail.city.activity_count)} 条`, icon: 'count' },
          { label: '首次匹配到附近轨迹', value: detail.city.first_date, icon: 'days' },
          { label: '匹配方式', value: '附近点范围', icon: 'distance' },
        ]}
      />
    {:else if scope === 'city' && detail?.city}
      <MetricSummary
        appearance="default"
        items={[
          { label: '城市边界内累计跑量', value: km(detail.city.distance_m), icon: 'distance' },
          { label: '首次跑步记录', value: detail.city.first_date, icon: 'days' },
          {
            label: isAllYears ? '累计探索格网' : '所选年新增格网',
            value: `${count(isAllYears ? detail.cumulative_cells : detail.new_cells)} 格`,
            icon: 'count',
          },
        ]}
      />
    {:else}
      <MetricSummary
        items={[
          {
            label: '边界内城市',
            value: count(catalog?.boundary_count ?? markersData?.boundary_count),
            icon: 'count',
          },
          { label: '城市边界内累计跑量', value: km(catalog?.distance_m), icon: 'distance' },
          {
            label: isAllYears ? '累计探索格网' : '所选年新增格网',
            value: `${count(isAllYears ? detail?.cumulative_cells : detail?.new_cells)} 格`,
            icon: 'days',
          },
        ]}
      />
    {/if}

    <div class="filters">
      <div class="scope-heading">
        {#if scope !== 'global'}
          <nav class="breadcrumb" aria-label="探索层级">
            <button type="button" class="crumb-link" onclick={() => changeScope('global:all')}>全域</button>
            {#if detail?.city?.region_name}
              <span aria-hidden="true">/</span>
              <span>{detail.city.region_name}</span>
            {/if}
          </nav>
        {/if}
        <h2>{detail?.name ?? (scope === 'global' ? '全国及全球足迹总览' : '足迹覆盖')}</h2>
      </div>
      <div class="filter-controls">
        <label
          ><span>范围</span>
          <select
            class="text-field"
            value={`${scope}:${code}`}
            onchange={(event) => changeScope(event.currentTarget.value)}
          >
            <option value="global:all">全域</option>
            {#each markersData?.regions ?? catalog?.regions ?? [] as region (region.code)}
              <option value={`region:${region.code}`}>{region.name}</option>
            {/each}
            {#each rawMarkers as city (city.code)}
              <option value={`city:${city.code}`}>{city.name}</option>
            {/each}
            {#if scope === 'city' && !rawMarkers.some((item) => item.code === code)}
              <option value={`city:${code}`}>{detail?.name ?? '所选城市'}</option>
            {/if}
            {#if scope === 'region' && !(markersData?.regions ?? catalog?.regions ?? []).some((item) => item.code === code)}
              <option value={`region:${code}`}>{detail?.name ?? '所选区域'}</option>
            {/if}
          </select>
        </label>
        <label
          ><span>年份</span>
          <select
            class="text-field"
            value={String(selectedYear)}
            onchange={(event) => switchYear(event.currentTarget.value)}
          >
            <option value="all">全部年份</option>
            {#each years as option (option)}<option value={String(option)}>{option}</option>{/each}
          </select>
        </label>
      </div>
    </div>

    {#if detailError}
      {@render failure(detailError, retry)}
    {:else if detail?.status === 'failed'}
      {@render failure('足迹整理失败，请稍后重试', retry)}
    {/if}

    <div class="columns">
      <section class="panel map-panel">
        <div class="panel-header">
          <h2>足迹覆盖</h2>
          <div class="settings-tabs" role="group" aria-label="格网图层">
            <button type="button" aria-pressed={layer === 'heatmap'} onclick={() => switchLayer('heatmap')}
              >覆盖热图</button
            >
            <button type="button" aria-pressed={layer === 'new'} onclick={() => switchLayer('new')}>首次探索</button>
          </div>
        </div>

        {#if markersData?.status === 'pending' || detail?.status === 'pending'}
          <p class="status-note" role="status">正在整理部分足迹数据，当前先展示可用部分…</p>
        {/if}

        {#if layer === 'new' && detail?.status === 'ready' && detail.new_cells === 0 && hasHistoricalData}
          <div class="empty-year-banner" role="status">
            <span>{selectedYear} 年暂无新增探索格网。</span>
            <button type="button" class="button-secondary" onclick={switchToAllYearsHeatmap}>查看全部年份</button>
          </div>
        {/if}

        {#if gridError}
          {@render failure(gridError, () => {
            gridRetry += 1;
          })}
        {/if}
        {#if grid?.status === 'pending'}
          <p class="status-note" role="status">精细格网整理中…</p>
        {/if}

        <ExplorationMap
          bind:this={mapRef}
          markers={rawMarkers}
          data={grid}
          {layer}
          {scope}
          selectedCode={scope === 'city' ? code : ''}
          {yearLabel}
          {focusTarget}
          onviewport={(next) => {
            viewport = next;
          }}
          onselectcity={selectCityMarker}
          onresetscope={() => {
            if (scope !== 'global') navigate('global', 'all', selectedYear, layer);
          }}
        />
      </section>

      <div class="side-column">
        <section class="panel" aria-label="城市图鉴">
          <div class="panel-header">
            <h2>城市图鉴（{filteredCities.length}）</h2>
            <select class="text-field sort-select" aria-label="城市排序" bind:value={sortKey}>
              <option value="distance">按跑量</option>
              <option value="count">按次数</option>
              <option value="recent">按最近</option>
              <option value="first">按首跑</option>
            </select>
          </div>

          <div class="list-controls">
            <div class="mode-switch compact-switch" role="group" aria-label="城市类别筛选">
              <button type="button" aria-pressed={kindFilter === 'all'} onclick={() => (kindFilter = 'all')}
                >全部</button
              >
              <button type="button" aria-pressed={kindFilter === 'boundary'} onclick={() => (kindFilter = 'boundary')}
                >跑过</button
              >
              <button type="button" aria-pressed={kindFilter === 'nearby'} onclick={() => (kindFilter = 'nearby')}
                >附近</button
              >
            </div>
            <input
              type="search"
              class="text-field city-search"
              aria-label="筛选城市名称"
              placeholder="搜索城市或省份"
              bind:value={cityFilterText}
            />
          </div>

          {#if filteredCities.length}
            <ul class="cities">
              {#each filteredCities as city (city.code)}
                <li>
                  <a
                    href={href('city', city.code)}
                    class="city-link"
                    class:active={scope === 'city' && code === city.code}
                    aria-current={scope === 'city' && code === city.code ? 'page' : undefined}
                    onclick={(event) => {
                      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        selectCityMarker(city);
                      }
                    }}
                  >
                    <span>
                      <strong>
                        {city.name}
                        {#if city.is_new_in_year}<em class="new-badge">首跑</em>{/if}
                      </strong>
                      {#if city.region_name}<small>{city.region_name}</small>{/if}
                    </span>
                    <span>
                      <strong
                        >{city.distance_m === null ? `${count(city.activity_count)} 条` : km(city.distance_m)}</strong
                      >
                      <small>{city.kind === 'boundary' ? '首次跑步' : '附近匹配'} {city.first_date}</small>
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="secondary empty-list">当前筛选下暂无城市记录</p>
          {/if}
        </section>

        <section class="panel trend">
          <h2>覆盖趋势</h2>
          {#if detail?.city?.kind === 'nearby'}
            <p class="secondary">附近匹配城市不生成 100 m 边界格网，可切换至全域或具体边界城市查看格网趋势。</p>
            <button type="button" class="button-secondary mt-3" onclick={() => changeScope('global:all')}
              >回到全域总览</button
            >
          {:else if detail}
            <p class="cumulative">
              <strong>{count(detail.cumulative_cells)}</strong> 格
              <span class="secondary"
                >{isAllYears ? '全部年份累计' : numericYear === currentYear ? '截至当前累计' : '年末累计'}</span
              >
            </p>
            <p class="secondary">
              {isAllYears ? '各月首次探索分布（全部年份）' : `${numericYear} 年每月新增格网`}
            </p>
            <div class="chart" aria-hidden="true">
              {#each detail.months as month (month.month)}
                <div class="month">
                  <div class="bar-track">
                    <div class="bar" style:height={`${(100 * (month.new_cells ?? 0)) / peak}%`}></div>
                  </div>
                  {month.month}
                </div>
              {/each}
            </div>
            <details>
              <summary>查看逐月数据</summary>
              <table>
                <thead
                  ><tr><th scope="col">月份</th><th scope="col">新增格网</th><th scope="col">累计格网</th></tr></thead
                >
                <tbody>
                  {#each detail.months as month (month.month)}
                    <tr>
                      <th scope="row">{month.month} 月</th>
                      <td>{count(month.new_cells)}</td>
                      <td>{count(month.cumulative_cells)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </details>
          {:else}
            <p class="secondary">正在计算格网趋势…</p>
          {/if}
        </section>
      </div>
    </div>

    {#if catalog}
      <dl class="quality">
        <div>
          <dt>未分配跑量</dt>
          <dd>{km(catalog.unallocated_m)}</dd>
        </div>
        <div>
          <dt>无轨迹活动</dt>
          <dd>{count(catalog.no_track_count)} 条</dd>
        </div>
        {#if catalog.unmatched_count !== null}
          <div>
            <dt>未归入城市</dt>
            <dd>{count(catalog.unmatched_count)} 条</dd>
          </div>
        {/if}
        {#if (catalog.nearby_count ?? 0) > 0}
          <div>
            <dt>附近有记录的城市</dt>
            <dd>{count(catalog.nearby_count)} 座</dd>
          </div>
        {/if}
      </dl>
    {/if}

    <details class="method">
      <summary>统计口径</summary>
      <p>
        按轨迹在城市边界内的长度比例分摊活动里程。跨城活动可计入多个城市。首次跑步和新增格网以现存活动的最早运动日期为准。本地默认轮廓仅在浏览器内渲染，不向外部地图发送轨迹。
      </p>
    </details>
  {/if}
</div>

<style>
  .exploration {
    display: grid;
    gap: var(--space-4);
    padding-top: var(--space-3);
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .side-column {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .panel {
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: var(--space-4);
  }
  .panel h2,
  .filters h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .scope-heading {
    display: grid;
    gap: var(--space-1);
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .crumb-link {
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .panel-header,
  .filters,
  .filter-controls,
  .quality,
  .list-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .filters,
  .panel-header {
    justify-content: space-between;
  }
  .panel-header {
    margin-bottom: var(--space-3);
  }
  .list-controls {
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .filter-controls label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-foreground);
  }
  .filter-controls label span {
    white-space: nowrap;
  }
  select,
  .city-search {
    min-height: 2.75rem;
  }
  .filter-controls select {
    max-width: 12rem;
  }
  .sort-select {
    max-width: 7.5rem;
    font-size: var(--text-small);
  }
  .city-search {
    flex: 1 1 8.5rem;
    min-width: 0;
  }
  .secondary,
  small,
  .quality dt,
  .status-note {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .status-note {
    margin-bottom: var(--space-2);
  }
  .empty-year-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-3);
    border-radius: var(--radius-control);
    border: 1px solid var(--warning-border);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--text-small);
  }
  .cities {
    margin-top: var(--space-2);
    max-height: 22rem;
    overflow-y: auto;
  }
  .cities li + li {
    border-top: 1px solid var(--border);
  }
  .city-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2);
    border-radius: var(--radius-field);
  }
  .city-link:hover {
    background: var(--muted);
  }
  .city-link.active {
    background: var(--primary-soft);
  }
  .city-link strong,
  .city-link small {
    display: block;
    overflow-wrap: anywhere;
  }
  .city-link > span:last-child {
    text-align: end;
  }
  .new-badge {
    display: inline-block;
    margin-left: var(--space-1);
    padding: 0 0.35rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--warning-border);
    background: var(--warning-soft);
    color: var(--warning);
    font-style: normal;
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .empty-list {
    padding-block: var(--space-4);
  }
  .quality,
  .method {
    border-top: 1px solid var(--border);
    padding-block: var(--space-3);
  }
  .quality > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .cumulative {
    margin: var(--space-3) 0;
  }
  .cumulative strong {
    font-size: var(--text-stat);
    font-variant-numeric: tabular-nums;
  }
  .chart {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-1);
    min-height: 9rem;
    margin-block: var(--space-3);
  }
  .month {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: var(--space-1);
    text-align: center;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .bar-track {
    display: flex;
    align-items: end;
  }
  .bar {
    width: 100%;
    background: var(--chart-series);
    border-radius: var(--space-1) var(--space-1) 0 0;
  }
  .trend details {
    border-top: 1px solid var(--border);
  }
  summary {
    min-height: 2.75rem;
    padding-block: var(--space-2);
    cursor: pointer;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: start;
    padding: var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  @media (max-width: 980px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 360px) {
    .city-link {
      grid-template-columns: minmax(0, 1fr);
    }
    .city-link > span:last-child {
      text-align: start;
    }
  }
</style>
