<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ExplorationMap, { type FocusTarget } from '#lib/components/ExplorationMap.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
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
  const kmNum = (value: number | null | undefined) => (value == null ? '—' : metres.format(value / 1000));
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
  const peakValue = $derived(Math.max(0, ...(detail?.months.map((month) => month.new_cells ?? 0) ?? [])));
  const peak = $derived(Math.max(1, peakValue));
  const peakMonth = $derived(
    peakValue > 0 ? (detail?.months.find((month) => (month.new_cells ?? 0) === peakValue)?.month ?? null) : null,
  );
  const headerMeta = $derived.by(() => {
    const boundary = catalog?.boundary_count ?? markersData?.boundary_count;
    return [
      yearLabel,
      boundary != null ? `${count(boundary)} 城` : '',
      catalog?.distance_m != null ? km(catalog.distance_m) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });
  const trendAriaLabel = $derived.by(() => {
    const prefix = isAllYears ? '历史各月首次探索格网分布' : `${numericYear} 年每月新增格网分布`;
    if (peakMonth !== null) return `${prefix}，${peakMonth} 月最多 ${count(peakValue)} 格`;
    return `${prefix}，暂无新增格网`;
  });
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

  const maxCityDistance = $derived(Math.max(1, ...filteredCities.map((city) => city.distance_m ?? 0)));
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

<!-- Editorial Receipt archive page (brand.md §2, §5, §6.2; web-audit W-02/W-04/W-06/W-11): rules, hairlines and 4px map sheet. -->
<div class="editorial-page exploration-page">
  <PageHeader title="城市探索" meta={headerMeta}>
    {#snippet actions()}
      <a class="button-secondary" href={view.href('/footprints')}>返回运动足迹</a>
    {/snippet}
  </PageHeader>

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
      <div class="exploration-bar">
        <div class="underline-tabs layer-tabs" role="group" aria-label="格网图层">
          <button type="button" aria-pressed={layer === 'heatmap'} onclick={() => switchLayer('heatmap')}
            >覆盖热图</button
          >
          <button type="button" aria-pressed={layer === 'new'} onclick={() => switchLayer('new')}>首次探索</button>
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
        <section class="map-stage" aria-labelledby="exploration-scope-heading">
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
            <h2 id="exploration-scope-heading">{detail?.name ?? (scope === 'global' ? '全国及全球足迹总览' : '足迹覆盖')}</h2>
          </div>

          {#if markersData?.status === 'pending' || detail?.status === 'pending'}
            <p class="status-note" role="status">正在整理部分足迹数据，当前先展示可用部分…</p>
          {/if}

          {#if layer === 'new' && detail?.status === 'ready' && detail.new_cells === 0 && hasHistoricalData}
            <div class="status-strip empty-year-banner" role="status">
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
            appearance="sheet"
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

        <aside class="side-column">
          {#if scope === 'city' && detail?.city?.kind === 'nearby'}
            <dl class="fp-sum" aria-label="附近匹配摘要">
              <div>
                <dt>附近有记录</dt>
                <dd>{count(detail.city.activity_count)} <span class="figure-unit">条</span></dd>
              </div>
              <div>
                <dt>首次匹配</dt>
                <dd class="sum-compact">{detail.city.first_date}</dd>
              </div>
              <div>
                <dt>匹配方式</dt>
                <dd class="sum-compact">附近点范围</dd>
              </div>
            </dl>
          {:else if scope === 'city' && detail?.city}
            <dl class="fp-sum" aria-label="城市探索摘要">
              <div>
                <dt>城市内跑量</dt>
                <dd>
                  {kmNum(detail.city.distance_m)}{#if detail.city.distance_m !== null}
                    {' '}<span class="figure-unit">km</span>{/if}{#if detail.city.distance_m === null}<span class="sr-only"
                      >（无边界内里程）</span
                    >{/if}
                </dd>
              </div>
              <div>
                <dt>首次跑步</dt>
                <dd class="sum-compact">{detail.city.first_date}</dd>
              </div>
              <div>
                <dt>{isAllYears ? '探索格网' : '新增格网'}</dt>
                <dd>
                  {count(isAllYears ? detail.cumulative_cells : detail.new_cells)}{#if (isAllYears ? detail.cumulative_cells : detail.new_cells) != null}
                    {' '}<span class="figure-unit">格</span>{/if}
                </dd>
              </div>
            </dl>
          {:else}
            <dl class="fp-sum" aria-label="足迹探索摘要">
              <div>
                <dt>边界内城市</dt>
                <dd>
                  {count(catalog?.boundary_count ?? markersData?.boundary_count)}{#if (catalog?.boundary_count ?? markersData?.boundary_count) != null}
                    {' '}<span class="figure-unit">城</span>{/if}
                </dd>
              </div>
              <div>
                <dt>城市内里程</dt>
                <dd>
                  {kmNum(catalog?.distance_m)}{#if catalog?.distance_m != null}
                    {' '}<span class="figure-unit">km</span>{/if}
                </dd>
              </div>
              <div>
                <dt>{isAllYears ? '探索格网' : '新增格网'}</dt>
                <dd>
                  {count(isAllYears ? detail?.cumulative_cells : detail?.new_cells)}{#if (isAllYears ? detail?.cumulative_cells : detail?.new_cells) != null}
                    {' '}<span class="figure-unit">格</span>{/if}
                </dd>
              </div>
            </dl>
          {/if}

          <section class="section-rule atlas-section" aria-label="城市图鉴">
            <div class="section-head atlas-head">
              <h2>城市图鉴（{filteredCities.length}）</h2>
              <select class="text-field sort-select" aria-label="城市排序" bind:value={sortKey}>
                <option value="distance">按跑量</option>
                <option value="count">按次数</option>
                <option value="recent">按最近</option>
                <option value="first">按首跑</option>
              </select>
            </div>

            <div class="list-controls">
              <div class="underline-tabs kind-tabs" role="group" aria-label="城市类别筛选">
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
                      <span class="city-name">
                        <strong>
                          {city.name}{#if city.is_new_in_year}<em class="city-tag is-new">首跑</em>{/if}{#if city.kind === 'nearby'}<em
                              class="city-tag">附近</em
                            >{/if}
                        </strong>
                        {#if city.region_name}<small>{city.region_name}</small>{/if}
                      </span>
                      <span class="city-metrics">
                        <strong
                          >{city.distance_m === null ? `${count(city.activity_count)} 条` : km(city.distance_m)}</strong
                        >
                        <small>{city.kind === 'boundary' ? '首次跑步' : '附近匹配'} {city.first_date}</small>
                      </span>
                      {#if city.distance_m !== null}
                        <span class="city-share-track" aria-hidden="true"
                          ><i style:width={`${Math.max(4, Math.round((city.distance_m / maxCityDistance) * 100))}%`}
                          ></i></span
                        >
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="secondary empty-list">当前筛选下暂无城市记录</p>
            {/if}
          </section>

          <section class="section-rule trend">
            <div class="section-head">
              <h2>覆盖趋势</h2>
              <span class="section-meta">{isAllYears ? '逐月 · 全部年份' : `${numericYear} 年`}</span>
            </div>
            {#if detail?.city?.kind === 'nearby'}
              <p class="secondary trend-sub">附近匹配城市不生成 100 m 边界格网，可切换至全域或具体边界城市查看格网趋势。</p>
              <button type="button" class="button-secondary mt-3" onclick={() => changeScope('global:all')}
                >回到全域总览</button
              >
            {:else if detail}
              <p class="cumulative">
                <strong>{count(detail.cumulative_cells)}</strong> <span class="figure-unit">格</span>
                <span class="secondary"
                  >{isAllYears ? '全部年份累计' : numericYear === currentYear ? '截至当前累计' : '年末累计'}</span
                >
              </p>
              <p class="secondary trend-sub">
                {isAllYears ? '各月首次探索分布（全部年份）' : `${numericYear} 年每月新增格网`}
              </p>
              <div class="chart" role="img" aria-label={trendAriaLabel}>
                {#each detail.months as month (month.month)}
                  {@const value = month.new_cells ?? 0}
                  {@const isPeak = peakMonth === month.month && value > 0}
                  {@const isEmpty = value === 0}
                  <div class="month" class:peak={isPeak} class:empty={isEmpty}>
                    <span class="bar-val" aria-hidden="true">{isPeak ? count(value) : ''}</span>
                    <div class="bar-track">
                      <div
                        class="bar"
                        style:height={isEmpty ? undefined : `${Math.max(6, Math.round((100 * value) / peak))}%`}
                      ></div>
                    </div>
                    <span class="month-lbl">{month.month}</span>
                  </div>
                {/each}
              </div>
              <details>
                <summary>查看逐月数据</summary>
                <table>
                  <thead
                    ><tr><th scope="col">月份</th><th scope="col" class="num-col">新增格网</th><th scope="col" class="num-col"
                        >累计格网</th
                      ></tr
                    ></thead
                  >
                  <tbody>
                    {#each detail.months as month (month.month)}
                      <tr>
                        <th scope="row">{month.month} 月</th>
                        <td class="num-col">{count(month.new_cells)}</td>
                        <td class="num-col">{count(month.cumulative_cells)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </details>
            {:else}
              <p class="secondary trend-sub">正在计算格网趋势…</p>
            {/if}
          </section>
        </aside>
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
</div>

<style>
  .exploration-page {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .exploration {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .exploration-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .layer-tabs {
    margin-bottom: 0;
  }
  @media (min-width: 768px) {
    .layer-tabs {
      margin-bottom: calc(-1 * var(--space-2) - 1px);
    }
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22.5rem;
    gap: var(--space-8);
    align-items: start;
    min-width: 0;
  }
  .map-stage {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .side-column {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .scope-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }
  .scope-heading h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
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
  .filter-controls,
  .quality,
  .list-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .filter-controls label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .filter-controls label span {
    white-space: nowrap;
  }
  .exploration-page .text-field {
    border-color: var(--control-border);
    border-radius: var(--radius-control);
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
  .list-controls {
    justify-content: space-between;
    margin-top: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .kind-tabs {
    border-bottom: 1px solid var(--border);
    gap: 0 var(--space-3);
  }
  .city-search {
    flex: 1 1 8.5rem;
    min-width: 0;
  }
  /* 3-column hairline summary (web-footprints prototype & brand.md §6.5). */
  .fp-sum {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: 2px solid var(--rule);
  }
  .fp-sum > div {
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-end;
    min-width: 0;
    padding: var(--space-3) 0 var(--space-3) var(--space-3);
    border-left: 1px solid var(--border);
  }
  .fp-sum > div:first-child {
    padding-left: 0;
    border-left: 0;
  }
  .fp-sum dt {
    margin-top: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .fp-sum dd {
    font-size: var(--text-stat);
    line-height: var(--line-height-tight);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .fp-sum dd.sum-compact {
    font-size: var(--text-body);
    letter-spacing: 0;
    white-space: nowrap;
  }
  .fp-sum dd .figure-unit {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .atlas-head {
    align-items: center;
  }
  .secondary,
  small,
  .quality dt,
  .status-note {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .empty-year-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .cities {
    margin-top: var(--space-1);
    max-height: 22rem;
    overflow-y: auto;
  }
  .cities li {
    border-bottom: 1px solid var(--border);
  }
  .city-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-3) var(--space-2);
    transition: background-color var(--transition-control);
  }
  @media (hover: hover) {
    .city-link:hover {
      background: color-mix(in srgb, var(--foreground) 3%, transparent);
    }
  }
  .city-link.active {
    background: var(--recap-well);
    box-shadow: inset 3px 0 0 var(--rule);
  }
  .city-link strong,
  .city-link small {
    display: block;
    overflow-wrap: anywhere;
  }
  .city-name strong {
    font-weight: var(--weight-semibold);
    font-size: var(--text-body);
  }
  .city-name small {
    font-size: var(--text-caption);
  }
  .city-metrics {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  .city-metrics strong {
    font-weight: var(--weight-bold);
    font-size: var(--text-body);
  }
  .city-metrics small {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }
  .city-tag {
    display: inline-block;
    margin-left: var(--space-2);
    font-style: normal;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
  }
  .city-tag.is-new {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .city-share-track {
    grid-column: 1 / -1;
    display: block;
    position: relative;
    height: 3px;
    margin-top: var(--space-1);
    background: var(--border);
  }
  .city-share-track > i {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--primary);
  }
  .empty-list {
    padding-block: var(--space-4);
  }
  .quality {
    gap: var(--space-2) var(--space-8);
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
    font-variant-numeric: tabular-nums;
  }
  .quality > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .quality dd {
    font-weight: var(--weight-semibold);
    font-size: var(--text-small);
  }
  .method {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .method summary {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .method p {
    margin-top: var(--space-2);
    line-height: var(--line-height-body);
  }
  .cumulative {
    margin-top: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  .cumulative strong {
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
  }
  .cumulative .figure-unit {
    font-size: var(--text-small);
  }
  .trend-sub {
    margin-top: var(--space-1);
  }
  /* Rectangular bar chart (brand.md §5 & §12 #5): --primary bars, --receipt-mark peak (+ 1px ink stroke in light mode), 2px --border empty ticks. */
  .chart {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-1);
    height: 7.5rem;
    margin-block: var(--space-3);
  }
  .month {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--space-1);
    text-align: center;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }
  .bar-val {
    min-height: 1rem;
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    color: var(--foreground);
  }
  .bar-track {
    display: flex;
    align-items: flex-end;
    min-height: 0;
  }
  .bar {
    width: 100%;
    background: var(--primary);
    border-radius: 0;
  }
  .month.peak .bar {
    background: var(--receipt-mark);
    box-shadow: inset 0 0 0 1px var(--foreground);
  }
  :global(:root[data-theme='dark']) .month.peak .bar {
    box-shadow: none;
  }
  .month.peak .month-lbl {
    color: var(--foreground);
    font-weight: var(--weight-bold);
  }
  .month.empty .bar {
    height: 2px;
    background: var(--border);
  }
  .trend details {
    border-top: 1px solid var(--border);
  }
  summary {
    min-height: 2.75rem;
    padding-block: var(--space-2);
    cursor: pointer;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
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
    padding: var(--space-2) var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  .num-col {
    text-align: end;
    font-family: var(--font-mono);
  }
  @media (max-width: 1023px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
    }
  }
  @media (max-width: 479px) {
    .fp-sum dd {
      font-size: var(--text-section);
    }
    .fp-sum dd.sum-compact {
      font-size: var(--text-small);
    }
  }
  @media (max-width: 360px) {
    .city-link {
      grid-template-columns: minmax(0, 1fr);
    }
    .city-metrics {
      text-align: start;
    }
  }
</style>
