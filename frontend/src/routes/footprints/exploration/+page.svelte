<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ExplorationMap from '#lib/components/ExplorationMap.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { FootprintError } from '#lib/api/footprints.ts';
  import {
    readCatalog,
    readCells,
    readDetail,
    type ExplorationCatalog,
    type ExplorationCells,
    type ExplorationDetail,
    type Layer,
    type Scope,
    type Viewport,
  } from '#lib/api/exploration.ts';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';

  const view = useViewContext();
  const number = new Intl.NumberFormat('zh-CN');
  const metres = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const count = (value: number | null | undefined) => (value == null ? '—' : number.format(value));
  const km = (value: number | null | undefined) => (value == null ? '—' : `${metres.format(value / 1000)} km`);
  const section = $derived(page.url.searchParams.get('scope'));
  const scope = $derived<Scope | null>(
    section === 'global' || section === 'region' || section === 'city' ? section : null,
  );
  const code = $derived(page.url.searchParams.get('code') ?? 'all');
  const path = $derived(view.href('/footprints/exploration'));
  const currentYear = $derived(
    Number(
      new Intl.DateTimeFormat('en', {
        year: 'numeric',
        timeZone: page.data.user?.timezone ?? 'UTC',
      }).format(new Date()),
    ),
  );
  const year = $derived.by(() => {
    const value = Number(page.url.searchParams.get('year'));
    return Number.isInteger(value) && value >= 1900 && value <= currentYear ? value : currentYear;
  });
  const offset = $derived.by(() => {
    const value = Number(page.url.searchParams.get('offset'));
    return Number.isInteger(value) && value >= 0 && value <= 1000000 ? value : 0;
  });
  const href = (nextScope: Scope, nextCode: string, nextYear = year) =>
    `${path}?${new URLSearchParams({ scope: nextScope, code: nextCode, year: String(nextYear) })}`;
  const catalogHref = (nextOffset: number) => (nextOffset > 0 ? `${path}?offset=${nextOffset}` : path);

  let mounted = $state(false),
    disposed = false;
  let catalog = $state.raw<ExplorationCatalog | null>(null);
  let detail = $state.raw<ExplorationDetail | null>(null);
  let grid = $state.raw<ExplorationCells | null>(null);
  let viewport = $state.raw<Viewport | null>(null);
  let layer = $state<Layer>('heatmap');
  let catalogError = $state(''),
    detailError = $state(''),
    gridError = $state('');
  let catalogRetry = $state(0),
    detailRetry = $state(0),
    gridRetry = $state(0);
  let catalogId = 0,
    detailId = 0,
    gridId = 0;
  let identity: string | null | undefined;
  const boundary = $derived(catalog?.items.filter((city) => city.kind === 'boundary') ?? []);
  const nearby = $derived(catalog?.items.filter((city) => city.kind === 'nearby') ?? []);
  const years = $derived(
    Array.from({ length: currentYear - Math.min(year, detail?.first_year ?? year) + 1 }, (_, i) => currentYear - i),
  );
  const peak = $derived(Math.max(1, ...(detail?.months.map((month) => month.new_cells ?? 0) ?? [])));
  const versionMatches = (a: { source_version: number; atlas_version: string }, b: typeof a) =>
    a.source_version === b.source_version && a.atlas_version === b.atlas_version;

  function report(error: unknown) {
    if (error instanceof FootprintError && error.status === 401) {
      catalog = detail = grid = null;
      viewport = null;
      disposed = true;
      window.location.replace('/admin?reason=changed');
    }
    return error instanceof FootprintError ? error.message : '无法读取城市探索，请重试';
  }
  function retry() {
    catalogRetry += 1;
    detailRetry += 1;
    gridRetry += 1;
  }
  function changeScope(input: string) {
    const [nextScope, nextCode] = input.split(':');
    if (nextScope === 'global' || nextScope === 'region' || nextScope === 'city') {
      void goto(href(nextScope, nextCode));
    }
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
    catalog = detail = grid = null;
    viewport = null;
    retry();
  });
  $effect(() => {
    const currentOffset = offset;
    void catalogRetry;
    if (!mounted || !page.data.user) return;
    const id = ++catalogId,
      controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    catalogError = '';
    catalog = null;
    async function load() {
      try {
        const result = await readCatalog(currentOffset, controller.signal);
        if (disposed || controller.signal.aborted || id !== catalogId) return;
        catalog = result;
        if (result.status === 'pending')
          poll = setTimeout(() => {
            void load();
          }, 3500);
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
    const selected = scope,
      selectedCode = code,
      selectedYear = year;
    void detailRetry;
    detail = grid = null;
    viewport = null;
    detailError = gridError = '';
    if (!mounted || !page.data.user || !selected) return;
    const id = ++detailId,
      controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    async function load(target: Scope) {
      try {
        const result = await readDetail(target, selectedCode, selectedYear, controller.signal);
        if (disposed || controller.signal.aborted || id !== detailId) return;
        detail = result;
        if (result.status === 'pending')
          poll = setTimeout(() => {
            void load(target);
          }, 3500);
      } catch (error) {
        if (!disposed && !controller.signal.aborted && id === detailId) detailError = report(error);
      }
    }
    void load(selected);
    return () => {
      controller.abort();
      clearTimeout(poll);
    };
  });
  $effect(() => {
    const result = detail,
      box = viewport,
      mode = layer;
    void gridRetry;
    if (!mounted || !result || result.status !== 'ready' || result.city?.kind === 'nearby') return;
    const id = ++gridId,
      controller = new AbortController();
    let poll: ReturnType<typeof setTimeout>;
    gridError = '';
    void readCells(result.scope, result.code, result.year, mode, box, controller.signal)
      .then((data) => {
        if (disposed || controller.signal.aborted || id !== gridId) return;
        if (!versionMatches(result, data)) {
          retry();
          return;
        }
        grid = data;
        if (data.status === 'failed') gridError = '无法读取格网，请重试';
        if (data.status === 'pending')
          poll = setTimeout(() => {
            gridRetry += 1;
          }, 3500);
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
    <nav class="settings-tabs" aria-label="城市探索">
      <a href={path} aria-current={scope ? undefined : 'page'}>城市图鉴</a>
      <a href={href(scope ?? 'global', scope ? code : 'all')} aria-current={scope ? 'page' : undefined}>探索详情</a>
    </nav>
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
{#snippet cityList(title: string, items: NonNullable<typeof catalog>['items'])}
  <section class="panel">
    <h2>{title}</h2>
    {#if items.length}
      <ul class="cities">
        {#each items as city (city.code)}
          <li>
            <a href={href('city', city.code)} class="city-link">
              <span
                ><strong>{city.name}</strong>{#if city.region_name}<small>{city.region_name}</small>{/if}</span
              >
              <span
                ><strong>{city.distance_m === null ? `${count(city.activity_count)} 条` : km(city.distance_m)}</strong>
                <small>{city.kind === 'boundary' ? '首次跑步' : '首次附近匹配'} {city.first_date}</small></span
              >
            </a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="secondary">暂无记录</p>
    {/if}
  </section>
{/snippet}

<div class="exploration">
  <a class="back-link" href={view.href('/footprints')}>返回运动足迹</a>
  {#if !scope}
    {#if catalogError}
      {@render failure(catalogError, retry)}
    {:else if !catalog}
      <PageSkeleton title="正在读取城市图鉴…" />
    {:else if catalog.status === 'pending'}
      {@render waiting('正在整理历史足迹')}
    {:else if catalog.status === 'failed'}
      {@render failure('城市图鉴整理失败，请稍后重试', retry)}
    {:else if catalog.activity_count === 0}
      <FeedbackState title="还没有跑步记录">
        <a class="button-secondary" href={view.href('/activities')}>查看活动</a>
      </FeedbackState>
    {:else if catalog.activity_count === catalog.no_track_count}
      <FeedbackState title="暂无带轨迹的活动" />
    {:else}
      <MetricSummary
        items={[
          { label: '跑过的城市', value: count(catalog.boundary_count), icon: 'count' },
          { label: '城市边界内累计跑量', value: km(catalog.distance_m), icon: 'distance' },
          { label: '附近有记录的城市', value: count(catalog.nearby_count), icon: 'count' },
        ]}
      />
      <div class="columns">
        {@render cityList('跑过的城市', boundary)}
        {@render cityList('附近有记录', nearby)}
      </div>
      {#if catalog.total > catalog.limit}
        <nav class="pagination" aria-label="城市图鉴分页">
          {#if offset > 0}<a class="button-secondary" href={catalogHref(Math.max(0, offset - catalog.limit))}>上一页</a
            >{/if}
          <span>{offset + 1}–{offset + catalog.items.length} / {catalog.total}</span>
          {#if offset + catalog.limit < catalog.total}<a
              class="button-secondary"
              href={catalogHref(offset + catalog.limit)}>下一页</a
            >{/if}
        </nav>
      {/if}
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
      </dl>
    {/if}
  {:else}
    <div class="filters">
      <div>
        {#if detail?.city?.region_name}<p class="secondary">{detail.city.region_name}</p>{/if}
        <h2>{detail?.name ?? '足迹覆盖'}</h2>
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
            {#each catalog?.regions ?? [] as region (region.code)}
              <option value={`region:${region.code}`}>{region.name}</option>
            {/each}
            {#each catalog?.items ?? [] as city (city.code)}
              <option value={`city:${city.code}`}>{city.name}</option>
            {/each}
            {#if scope === 'city' && !catalog?.items.some((item) => item.code === code)}
              <option value={`city:${code}`}>{detail?.name ?? '所选城市'}</option>
            {/if}
            {#if scope === 'region' && !catalog?.regions.some((item) => item.code === code)}
              <option value={`region:${code}`}>{detail?.name ?? '所选区域'}</option>
            {/if}
          </select>
        </label>
        <label
          ><span>年份</span>
          <select
            class="text-field"
            value={year}
            onchange={(event) => {
              if (scope) void goto(href(scope, code, Number(event.currentTarget.value)));
            }}
          >
            {#each years as option (option)}<option value={option}>{option}</option>{/each}
          </select>
        </label>
      </div>
    </div>
    {#if detailError}
      {@render failure(detailError, retry)}
    {:else if !detail}
      <PageSkeleton title="正在读取探索详情…" />
    {:else if detail.status === 'pending'}
      {@render waiting('正在整理历史足迹')}
    {:else if detail.status === 'failed'}
      {@render failure('足迹整理失败，请稍后重试', retry)}
    {:else if detail.city?.kind === 'nearby'}
      <MetricSummary
        appearance="default"
        items={[
          { label: '附近有记录', value: `${count(detail.city.activity_count)} 条`, icon: 'count' },
          { label: '首次匹配到附近轨迹', value: detail.city.first_date, icon: 'days' },
        ]}
      />
      <a class="button-secondary" href={href('global', 'all')}>查看全域格网</a>
    {:else}
      <MetricSummary
        appearance="default"
        items={[
          ...(detail.city
            ? [
                { label: '城市边界内累计跑量', value: km(detail.city.distance_m), icon: 'distance' as const },
                { label: '首次跑步记录', value: detail.city.first_date, icon: 'days' as const },
              ]
            : []),
          { label: '所选年新增格网', value: `${count(detail.new_cells)} 格`, icon: 'count' },
        ]}
      />
      <div class="columns">
        <section class="panel">
          <div class="panel-header">
            <h2>足迹覆盖</h2>
            <div class="settings-tabs" role="group" aria-label="格网图层">
              <button
                type="button"
                aria-pressed={layer === 'heatmap'}
                onclick={() => {
                  layer = 'heatmap';
                  grid = null;
                }}>覆盖热图</button
              >
              <button
                type="button"
                aria-pressed={layer === 'new'}
                onclick={() => {
                  layer = 'new';
                  grid = null;
                }}>新增格网</button
              >
            </div>
          </div>
          {#if gridError}{@render failure(gridError, () => {
              gridRetry += 1;
            })}{/if}
          {#if grid?.status === 'pending'}{@render waiting('正在整理历史足迹')}{/if}
          {#if grid?.status === 'ready' && !grid.cells.length}
            <FeedbackState title={viewport ? '当前视口暂无格网' : '所选年份暂无格网'} />
          {/if}
          {#key `${scope}:${code}:${year}:${detail.source_version}`}
            <ExplorationMap
              data={grid}
              {layer}
              onviewport={(next) => {
                viewport = next;
              }}
            />
          {/key}
        </section>
        <section class="panel trend">
          <h2>覆盖趋势</h2>
          <p class="cumulative">
            <strong>{count(detail.cumulative_cells)}</strong> 格
            <span class="secondary">{year === currentYear ? '截至当前累计' : '年末累计'}</span>
          </p>
          <p class="secondary">{year} 年每月新增格网</p>
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
              <thead><tr><th scope="col">月份</th><th scope="col">新增格网</th><th scope="col">累计格网</th></tr></thead
              >
              <tbody>
                {#each detail.months as month (month.month)}
                  <tr
                    ><th scope="row">{month.month} 月</th><td>{count(month.new_cells)}</td><td
                      >{count(month.cumulative_cells)}</td
                    ></tr
                  >
                {/each}
              </tbody>
            </table>
          </details>
        </section>
      </div>
    {/if}
    <details class="method">
      <summary>统计口径</summary>
      <p>
        按轨迹在城市边界内的长度比例分摊活动里程。跨城活动可计入多个城市。首次跑步和新增格网以现存活动的最早运动日期为准。
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
  .back-link {
    justify-self: start;
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    color: var(--primary);
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
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
  .panel-header,
  .filters,
  .filter-controls,
  .pagination,
  .quality {
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
  .filter-controls label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-foreground);
  }
  .filter-controls label span {
    white-space: nowrap;
  }
  select {
    min-height: 2.75rem;
    max-width: 12rem;
  }
  .secondary,
  small,
  .quality dt {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .cities {
    margin-top: var(--space-2);
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
  }
  .city-link:hover {
    background: var(--muted);
  }
  .city-link strong,
  .city-link small {
    display: block;
    overflow-wrap: anywhere;
  }
  .city-link > span:last-child {
    text-align: end;
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
