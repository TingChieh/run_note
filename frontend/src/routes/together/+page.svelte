<script lang="ts">
  import '#lib/styles/activity-timeline.css';
  import { onMount } from 'svelte';
  import { warmMapLibrary } from '#lib/library-warmup.ts';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { pageTitle } from '#lib/site.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import ActivityTimeline from '#lib/components/ActivityTimeline.svelte';
  import {
    formatDate,
    formatDistance,
    formatDuration,
    activityDuration,
    formatPace,
    type Activity,
    type Route,
  } from '#lib/api/activities.ts';
  import FootprintMap from '#lib/components/FootprintMap.svelte';
  import TogetherRecordSheet from '#lib/components/TogetherRecordSheet.svelte';
  import { participantColors } from '#lib/map/together-colors.ts';
  import {
    readTogether,
    readFeed,
    appendRecent,
    TogetherError,
    parsePeriod,
    togetherPath,
    periodCopy,
    type Period,
    type Together,
  } from '#lib/api/together.ts';
  // Raw: every route coordinate of the feed and the map would otherwise be read through a reactive proxy.
  // The page only ever replaces it wholesale.
  let data = $state.raw<Together | null>(null),
    error = $state(''),
    loading = $state(true),
    period = $state<Period>('week'),
    selected = $state('');
  // Requested by the HTML itself instead of after hydration; the first load() below reuses the response.
  const firstRead = togetherPath(parsePeriod(page.url.searchParams.get('period')));
  let disposed = false,
    token = 0,
    citiesStarted = false,
    controller: AbortController,
    feedController: AbortController | undefined,
    cityWorker: Worker | undefined;
  let feedLoading = $state(false),
    feedError = $state('');
  let cityNames = $state<Record<string, string>>({});
  const colors = $derived(participantColors(data?.participants ?? []));
  const ranking = $derived(
    [...(data?.participants ?? [])].sort(
      (a, b) => b[`${period}_m`] - a[`${period}_m`] || a.username.localeCompare(b.username),
    ),
  );
  const footprints = $derived(data?.footprints ?? null);
  let currentId = $state<string | null>(null);
  // Phone widths stack the layout: a record opens in a bottom sheet instead of scrolling back up to the map.
  let narrow = $state(false),
    sheetId = $state<string | null>(null);
  const activities = $derived(
    (data?.recent ?? []).map((item): Activity => ({
      id: item.id,
      title: item.title,
      category: item.category,
      tags: item.tags,
      activity_date: item.activity_date,
      timezone: 'Asia/Shanghai',
      started_at: null,
      ended_at: null,
      distance_m: item.distance_m,
      elapsed_seconds: item.elapsed_seconds,
      timer_seconds: item.timer_seconds,
      avg_heart_rate_bpm: item.avg_heart_rate_bpm,
      avg_pace_seconds_per_km: item.avg_pace_seconds_per_km,
      temporal_quality: item.temporal_quality,
      visibility: 'public',
      allow_shared_route: false,
      quality_summary: {},
      metrics_version: '',
      has_route: item.geometry.length > 0,
      created_at: '',
    })),
  );
  const extras = $derived.by(() =>
    Object.fromEntries(
      (data?.recent ?? []).map((item) => {
        const features: Route['features'] = item.geometry.map((geometry, index) => ({
          type: 'Feature',
          geometry,
          properties: { segment_index: index, point_count: geometry.coordinates.length },
        }));
        const points = item.geometry.flatMap((g) => g.coordinates);
        const route: Route | null = points.length
          ? { type: 'FeatureCollection', features, start: points[0], end: points[points.length - 1] }
          : null;
        const person = data?.participants.find((p) => p.username === item.username);
        return [
          item.id,
          {
            route,
            runner: {
              name: item.display_name,
              city: cityNames[item.id],
              color: colors[item.username] ?? '#14785b',
              avatar: person?.avatar_version
                ? `/api/v1/showcase/users/${encodeURIComponent(item.username)}/avatar?v=${person.avatar_version}`
                : null,
            },
            href: `/p/${encodeURIComponent(item.username)}/activities/${item.id}`,
          },
        ];
      }),
    ),
  );
  const currentActivity = $derived(activities.find((item) => item.id === currentId) ?? null);
  const sheetActivity = $derived(narrow ? (activities.find((item) => item.id === sheetId) ?? null) : null);
  const selectedRecord = $derived(data?.recent.find((item) => item.id === currentId));
  const mapFootprints = $derived.by(() => {
    if (!footprints) return null;
    if (!selectedRecord || footprints.features.some((f) => f.properties?.activity_id === selectedRecord.id))
      return footprints;
    return {
      ...footprints,
      features: [
        ...footprints.features,
        ...selectedRecord.geometry.map((geometry, segment_index) => ({
          type: 'Feature' as const,
          geometry,
          properties: {
            activity_id: selectedRecord.id,
            username: selectedRecord.username,
            title: selectedRecord.title,
            activity_date: selectedRecord.activity_date,
            segment_index,
          },
        })),
      ],
    };
  });
  function openRecord(activity: Activity, event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (narrow) {
      sheetId = activity.id;
      return;
    }
    currentId = currentId === activity.id ? null : activity.id;
    selected = '';
  }
  const km = (meters: number) => (meters / 1000).toFixed(2);
  const amount = (runner: Together['participants'][number]) => runner[`${period}_m`];
  async function load() {
    const current = ++token;
    feedController?.abort();
    feedLoading = false;
    feedError = '';
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = '';
    try {
      const result = await readTogether(controller.signal, period);
      if (!disposed && current === token) {
        data = result;
        currentId = result.recent.find((item) => item.id === currentId)?.id ?? null;
        sheetId = result.recent.find((item) => item.id === sheetId)?.id ?? null;
        if (!citiesStarted) {
          citiesStarted = true;
          try {
            cityWorker = new Worker(new URL('../../lib/map/together-cities.worker.ts', import.meta.url), {
              type: 'module',
            });
            cityWorker.onmessage = (event: MessageEvent<Record<string, string>>) => {
              if (!disposed) cityNames = event.data;
            };
            cityWorker.postMessage(result.footprints.features);
          } catch {
            cityWorker = undefined;
          }
        }
      }
    } catch (cause) {
      if (disposed || current !== token) return;
      data = null;
      if (cause instanceof TogetherError && cause.status === 401) {
        window.location.replace('/admin?reason=expired');
        return;
      }
      error = cause instanceof Error ? cause.message : '读取失败';
    } finally {
      if (!disposed && current === token) loading = false;
    }
  }
  async function loadMore() {
    if (!data?.next_cursor || feedLoading || loading) return;
    const current = token,
      cursor = data.next_cursor;
    feedController?.abort();
    feedController = new AbortController();
    feedLoading = true;
    feedError = '';
    try {
      const result = await readFeed(feedController.signal, cursor);
      if (!disposed && current === token && data)
        data = { ...data, recent: appendRecent(data.recent, result.items), next_cursor: result.next_cursor };
    } catch (cause) {
      if (disposed || current !== token) return;
      if (cause instanceof TogetherError && cause.status === 401) {
        data = null;
        window.location.replace('/admin?reason=expired');
        return;
      }
      feedError = cause instanceof Error ? cause.message : '动态加载失败，请重试';
    } finally {
      if (!disposed && current === token) feedLoading = false;
    }
  }
  function selectPeriod(value: Period) {
    if (period === value) return;
    period = value;
    void load();
  }
  onMount(() => {
    const query = window.matchMedia('(max-width: 959px)');
    const sync = () => {
      narrow = query.matches;
      if (narrow) currentId = null;
      else sheetId = null;
    };
    sync();
    query.addEventListener('change', sync);
    const url = new URL(window.location.href);
    period = parsePeriod(url.searchParams.get('period'));
    if (url.search) {
      void goto(url.pathname, { state: page.state, shallow: true, replace: true }).catch(() => {});
    }
    void load();
    warmMapLibrary();
    return () => {
      query.removeEventListener('change', sync);
      disposed = true;
      token++;
      controller?.abort();
      feedController?.abort();
      cityWorker?.terminate();
    };
  });
</script>

<svelte:head>
  <title>{pageTitle('一起跑步', page.data.site)}</title>
  <link rel="preload" as="fetch" href={firstRead} crossorigin="anonymous" />
</svelte:head>
{#snippet avatar(runner: Together['participants'][number])}
  <span class="runner-avatar" aria-hidden="true"
    >{#if runner.avatar_version}<img
        src={`/api/v1/showcase/users/${encodeURIComponent(runner.username)}/avatar?v=${runner.avatar_version}`}
        alt=""
      />{:else}{Array.from(runner.display_name)[0]}{/if}</span
  >
{/snippet}
<div class="editorial-page together-stack">
  <PageHeader title="一起跑步" />
  {#if loading && !data}<div class="page-loading">
      <PageSkeleton title="正在读取一起跑步…" />
    </div>{:else if error}<FeedbackState kind="error" title={error}
      ><button type="button" class="button-secondary" onclick={load}>重试</button></FeedbackState
    >{:else if data}
    {#if !data.participants.length}<section class="section-hairline section">
        {#if page.data.user}<p>还没有人加入一起跑步</p>
          <p class="hint">在设置里打开『一起跑步』就能加入</p>
          <p>
            <a
              class="button-secondary"
              href={page.data.user.is_admin ? '/settings/preferences' : '/workspace/settings/preferences'}>去设置里加入</a
            >
          </p>{:else}<p>还没有人加入</p>{/if}
      </section>{:else}
      <section class="section-rule section together-milestone content-reveal">
        <h2 class="milestone-heading">
          <span class="milestone-label">{periodCopy(period)}我们一起跑了</span>{' '}
          <span class="milestone-figure"
            >{#key data.distance_m}<strong class="overview-distance content-reveal">{km(data.distance_m)}</strong
              >{/key}{' '}<span class="figure-unit">公里</span></span
          >
        </h2>
        <p class="overview-detail">{data.participants.length} 人 · {data.count} 次</p>
      </section>
      <section class="section-hairline section">
        <div class="section-head">
          <h2>里程排行榜</h2>
          <div class="underline-tabs period-tabs" role="group" aria-label="排行榜时间">
            <button type="button" aria-pressed={period === 'week'} onclick={() => selectPeriod('week')}>本周</button
            ><button type="button" aria-pressed={period === 'month'} onclick={() => selectPeriod('month')}>本月</button
            ><button type="button" aria-pressed={period === 'year'} onclick={() => selectPeriod('year')}>今年</button>
          </div>
        </div>
        {#if ranking.length}<ol class="rank-list hairline-rows">
            {#each ranking as runner, i (runner.user_id)}<li class="rank-row">
                {@render avatar(runner)}
                <div class="rank-content">
                  <div class="row">
                    <span
                      ><span class="rank-num">{i + 1}.</span>
                      <a href={`/p/${encodeURIComponent(runner.username)}/dashboard`}>{runner.display_name}</a></span
                    ><strong class="rank-km">{km(amount(runner))} km</strong>
                  </div>
                  <progress
                    style:--runner-color={colors[runner.username]}
                    max="100"
                    value={i === 0 ? 100 : amount(ranking[0]) ? (amount(runner) / amount(ranking[0])) * 100 : 0}
                    aria-label={`${runner.display_name}排行进度`}
                  ></progress>
                </div>
              </li>{/each}
          </ol>{:else}<p class="hint">暂无排行。</p>{/if}
      </section>
      <section id="together-feed" class="section-rule section">
        <div class="section-head">
          <h2>一起跑过的地方 · 最近动态</h2>
        </div>
        <p class="hint">地图展示所选时段最近最多 500 段经过简化的路线；动态不受时段或跑者筛选影响。</p>
        {#if data.tracks_truncated}<p class="status-strip">仅显示最近 500 条轨迹</p>{/if}
        <div class="feed-layout">
          <div class="feed-list">
            {#if data.recent.length}<ActivityTimeline
                items={activities}
                offset={0}
                total={activities.length}
                {extras}
                currentId={narrow ? sheetId : currentId}
                loadedSummary
                onopen={openRecord}
              />
              {#if data.next_cursor}<div class="feed-actions">
                  {#if feedError}<p class="status-strip" data-tone="error" role="alert">{feedError}</p>{/if}<button
                    type="button"
                    class="button-secondary"
                    disabled={feedLoading || loading}
                    onclick={loadMore}>{feedLoading ? '加载中…' : feedError ? '重试' : '加载更多'}</button
                  >
                </div>{/if}
            {:else}<p class="hint">暂无动态。</p>{/if}
          </div>
          <div class="feed-map" id="together-map">
            {#if mapFootprints}
              <FootprintMap
                data={mapFootprints}
                appearance="sheet"
                animateDataChanges
                compact
                mapLabel="一起跑步足迹地图"
                participantColors={colors}
                selectedRunner={selected}
                selectedActivity={currentId ?? ''}
                onclearRunner={() => {
                  selected = '';
                  currentId = null;
                }}
                detailHref={currentActivity && selectedRecord ? extras[currentActivity.id].href : undefined}
                quietCityFailure
                onretry={load}
              >
                {#if currentActivity && selectedRecord}<article
                    class="save-bar map-info"
                    data-testid="together-map-info"
                  >
                    <div class="map-info-title">
                      <strong>{currentActivity.title || '未命名活动'}</strong><span
                        style:color={colors[selectedRecord.username]}>{selectedRecord.display_name}</span
                      ><span>{formatDate(currentActivity.activity_date)}</span>
                    </div>
                    <span class="map-info-metrics"
                      >{formatDistance(currentActivity.distance_m)} · {formatDuration(
                        activityDuration(currentActivity),
                      )} · {formatPace(currentActivity.avg_pace_seconds_per_km)}{currentActivity.avg_heart_rate_bpm ==
                      null
                        ? ''
                        : ` · ${currentActivity.avg_heart_rate_bpm} bpm`}</span
                    >
                    {#if !mapFootprints.features.some((f) => f.properties?.activity_id === currentId)}<span
                        class="map-info-link"
                        role="status">暂无路线</span
                      >{/if}
                  </article>{/if}
              </FootprintMap>
              <div class="legend" role="region" aria-label="选择参与者">
                <button
                  type="button"
                  class="button-secondary"
                  aria-pressed={!selected}
                  onclick={() => {
                    selected = '';
                    currentId = null;
                  }}>全部</button
                >{#each data.participants as runner}<button
                    type="button"
                    class="button-secondary"
                    aria-pressed={selected === runner.username}
                    onclick={() => {
                      selected = runner.username;
                      currentId = null;
                    }}
                    ><span class="dot" style:background={colors[runner.username]}></span>{@render avatar(
                      runner,
                    )}{runner.display_name}</button
                  >{/each}
              </div>
              {#if selected && !footprints?.features.some((f) => f.properties?.username === selected)}<p
                  class="status-strip"
                  role="status"
                >
                  该跑者在此时段暂无路线，地图仍显示全部足迹。
                </p>{/if}
            {/if}
          </div>
        </div>
        {#if sheetActivity}{@const item = extras[sheetActivity.id]}<TogetherRecordSheet
            activity={sheetActivity}
            route={item.route}
            runner={{ name: item.runner.name, color: item.runner.color }}
            href={item.href}
            onclose={() => {
              sheetId = null;
            }}
          />{/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .together-stack {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-8);
    min-width: 0;
  }
  .section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .milestone-heading {
    display: grid;
    gap: var(--space-2);
    font-weight: var(--weight-regular);
  }
  .milestone-label {
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  .milestone-figure {
    display: inline-flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .overview-distance {
    color: var(--foreground);
    font-size: var(--text-figure);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
  }
  .milestone-figure .figure-unit {
    font-size: var(--text-section);
  }
  .overview-detail {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .period-tabs {
    width: max-content;
  }
  .rank-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rank-num {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
    margin-right: var(--space-1);
  }
  .rank-km {
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .row a {
    color: var(--foreground);
    font-weight: var(--weight-semibold);
    overflow-wrap: anywhere;
  }
  @media (hover: hover) {
    .row a:hover {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  .feed-layout {
    display: grid;
    grid-template-columns: minmax(20rem, 1fr) minmax(0, 1.55fr);
    gap: var(--space-6);
    align-items: start;
  }
  .feed-list {
    min-width: 0;
  }
  .feed-list :global(.month-pill) {
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-weight: var(--weight-bold);
  }
  .feed-list :global(.activity-card) {
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .feed-map {
    min-width: 0;
    position: sticky;
    top: calc(var(--top-navigation-height) + var(--top-navigation-offset) + var(--space-4));
    margin-top: calc(1.75rem + var(--space-3));
    display: grid;
    gap: var(--space-3);
  }
  @media (max-width: 959px) {
    .feed-layout {
      display: flex;
      flex-direction: column;
    }
    .feed-map {
      position: static;
      margin-top: 0;
      order: -1;
      width: 100%;
    }
    .feed-list {
      width: 100%;
    }
  }
  .map-info {
    position: absolute;
    z-index: 3;
    left: var(--space-3);
    bottom: max(var(--space-8), calc(var(--map-attribution-clearance, 0px) + var(--space-2)));
    width: max-content;
    min-width: min(15rem, calc(100% - 2rem));
    max-width: calc(100% - 2rem);
    max-height: calc(100% - 6rem);
    overflow: auto;
    overflow-wrap: anywhere;
    gap: var(--space-1);
    padding: var(--space-3);
    color: var(--foreground);
    font-size: var(--text-small);
  }
  .map-info-link {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .map-info-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }
  .feed-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
    min-width: 0;
  }
  .rank-content progress::-webkit-progress-value {
    transition: width var(--motion-reveal);
  }
  .rank-content progress::-moz-progress-bar {
    transition: width var(--motion-reveal);
  }
  @media (prefers-reduced-motion: reduce) {
    .rank-content progress::-webkit-progress-value {
      transition: none;
    }
    .rank-content progress::-moz-progress-bar {
      transition: none;
    }
  }
  .hint {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1);
  }
  .legend button {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .legend .runner-avatar {
    width: 1.75rem;
    height: 1.75rem;
    font-size: var(--text-small);
    margin-right: var(--space-1);
  }
  .rank-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .rank-content {
    flex: 1;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .rank-content .row {
    padding: 0;
    border: 0;
  }
  .rank-content progress {
    appearance: none;
    width: 100%;
    height: 0.25rem;
    border: 0;
    border-radius: 0;
    overflow: hidden;
    background: var(--recap-well);
    color: var(--runner-color, var(--primary));
  }
  .rank-content progress::-webkit-progress-bar {
    border-radius: 0;
    background: var(--recap-well);
  }
  .rank-content progress::-webkit-progress-value {
    border-radius: 0;
    background: var(--runner-color, var(--primary));
  }
  .rank-content progress::-moz-progress-bar {
    border-radius: 0;
    background: var(--runner-color, var(--primary));
  }
  .runner-avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
  @media (max-width: 640px) {
    .legend {
      gap: var(--space-1);
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .legend button {
      flex: none;
      white-space: nowrap;
      min-height: 2.5rem;
      padding: 0 var(--space-2);
      gap: var(--space-1);
    }
    .legend .runner-avatar {
      display: none;
    }
    .legend .dot {
      width: 0.5rem;
      height: 0.5rem;
      margin: 0;
      flex: none;
    }
  }
  .legend button[aria-pressed='true'] {
    border-color: var(--rule);
    background: var(--recap-well);
    color: var(--foreground);
  }
  .dot {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    flex: none;
  }
</style>
