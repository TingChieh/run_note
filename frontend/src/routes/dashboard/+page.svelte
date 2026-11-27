<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;
  const readActivities = view.bind(scoped_readActivities, 0);
  const readSummary = view.bind(scoped_readSummary, 1);
  const readCalendar = view.bind(scoped_readCalendar, 2);
  const readTrends = view.bind(scoped_readTrends, 2);

  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { dashboardSelection } from '#lib/api/dashboard-query.ts';
  import {
    ActivityError,
    readActivities as scoped_readActivities,
    formatDuration,
    activityDuration,
    formatPace,
    qualityLabel,
    type ActivityList,
  } from '#lib/api/activities.ts';
  import {
    currentYear,
    readSummary as scoped_readSummary,
    readCalendar as scoped_readCalendar,
    readTrends as scoped_readTrends,
    type Summary,
    type Calendar,
    type Trends,
    type CalendarMetric,
  } from '#lib/api/statistics.ts';
  import CalendarGrid from '#lib/components/CalendarGrid.svelte';
  import TrendChart from '#lib/components/TrendChart.svelte';
  import type { TrendMetric } from '#lib/components/trend-chart.ts';
  import GoalOverview from '#lib/components/GoalOverview.svelte';
  import ProvinceMap from '#lib/components/ProvinceMap.svelte';
  import ActivityExplorer from '#lib/components/ActivityExplorer.svelte';
  import RecordsBannerLoader from '#lib/components/RecordsBannerLoader.svelte';
  import {
    buildCacheNamespace,
    clearPrivateOfflineCache,
    readCalendarCache,
    readSummaryCache,
    readTrendsCache,
    saveCalendarCache,
    saveSummaryCache,
    saveTrendsCache,
  } from '#lib/offline-cache.ts';
  const cacheNamespace = $derived(buildCacheNamespace(page.data.user?.id, view.manage ? 'owner' : view.href('/')));
  let showingCachedData = $state(false);
  let cachedSavedAt = $state<number | null>(null);
  const isNetworkFailure = (cause: unknown) =>
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    (cause instanceof ActivityError && cause.code === 'NETWORK_ERROR');
  let year = $state(2026),
    yearInput = $state('2026'),
    calendarMetric = $state<CalendarMetric>('distance'),
    period = $state<Trends['period']>('month'),
    trendMetric = $state<'distance' | 'count' | 'duration' | 'pace'>('distance');
  let annual = $state<Summary | null>(null),
    cumulative = $state<Summary | null>(null),
    calendar = $state<Calendar | null>(null),
    trends = $state<Trends | null>(null),
    records = $state<ActivityList | null>(null);
  let shownDate = $state<string | null>(null),
    selectedDate = $state<string | null>(null),
    loading = $state(true),
    dayLoading = $state(false),
    trendLoading = $state(false),
    message = $state(''),
    cumulativeMessage = $state(''),
    yearMessage = $state(''),
    dayMessage = $state(''),
    trendMessage = $state('');
  const motionMs = (ms: number) =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  // Animate the card height when the day's content changes size (switching days, paging).
  function smoothHeight(node: HTMLElement) {
    const inner = node.firstElementChild as HTMLElement;
    // border-box height must include the node's own padding, and use the fractional content height so the last card's border is never clipped.
    const fit = () => {
      const style = getComputedStyle(node);
      const padding =
        style.boxSizing === 'border-box' ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0;
      node.style.height = `${inner.getBoundingClientRect().height + padding}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(inner);
    return { destroy: () => observer.disconnect() };
  }
  let disposed = false,
    yearRequest = 0,
    dayRequest = 0,
    trendRequest = 0;
  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) {
      disposed = true;
      annual = null;
      cumulative = null;
      calendar = null;
      trends = null;
      records = null;
      selectedDate = null;
      yearRequest++;
      dayRequest++;
      trendRequest++;
      void clearPrivateOfflineCache();
      window.location.replace('/admin?reason=expired&next=%2Fdashboard');
      return '';
    }
    return cause instanceof Error ? cause.message : '读取失败，请稍后重试';
  }
  async function loadYear(restoreDay: string | null = null) {
    const token = ++yearRequest,
      requestedYear = year;
    ++dayRequest;
    ++trendRequest;
    loading = true;
    annual = null;
    calendar = null;
    trends = null;
    records = null;
    selectedDate = null;
    message = '';
    dayMessage = '';
    trendMessage = '';
    showingCachedData = false;
    cachedSavedAt = null;
    const ns = cacheNamespace;
    // Observe every request rejection, including an expired session in a sibling request.
    const results = await Promise.allSettled([readSummary(requestedYear), readCalendar(requestedYear, calendarMetric)]);
    if (disposed) return;
    for (const result of results)
      if (result.status === 'rejected' && result.reason instanceof ActivityError && result.reason.status === 401) {
        fail(result.reason);
        return;
      }
    if (token !== yearRequest) return;
    if (results[0].status === 'fulfilled') {
      annual = results[0].value;
      void saveSummaryCache(ns, requestedYear, results[0].value);
    } else if (isNetworkFailure(results[0].reason)) {
      const cached = await readSummaryCache(ns, requestedYear);
      if (disposed || token !== yearRequest) return;
      if (cached) {
        annual = cached.value;
        showingCachedData = true;
        cachedSavedAt = cached.savedAt;
      } else {
        message = fail(results[0].reason);
      }
    } else {
      message = fail(results[0].reason);
    }
    if (results[1].status === 'fulfilled') {
      calendar = results[1].value;
      void saveCalendarCache(ns, requestedYear, calendarMetric, results[1].value);
    } else if (isNetworkFailure(results[1].reason)) {
      const cached = await readCalendarCache(ns, requestedYear, calendarMetric);
      if (disposed || token !== yearRequest) return;
      if (cached) {
        calendar = cached.value;
        showingCachedData = true;
        cachedSavedAt = cachedSavedAt ?? cached.savedAt;
      } else if (!showingCachedData) {
        message = fail(results[1].reason);
      }
    } else {
      message = fail(results[1].reason);
    }
    loading = false;
    void loadTrend();
    if (restoreDay && calendar && token === yearRequest) void selectDay(restoreDay);
  }
  async function loadCumulative() {
    cumulativeMessage = '';
    const ns = cacheNamespace;
    try {
      const data = await readSummary();
      if (!disposed) {
        cumulative = data;
        void saveSummaryCache(ns, 'all', data);
      }
    } catch (cause) {
      if (disposed) return;
      if (isNetworkFailure(cause)) {
        const cached = await readSummaryCache(ns, 'all');
        if (disposed) return;
        if (cached) {
          cumulative = cached.value;
          showingCachedData = true;
          cachedSavedAt = cachedSavedAt ?? cached.savedAt;
          return;
        }
      }
      cumulativeMessage = fail(cause);
    }
  }
  async function loadTrend() {
    const token = ++trendRequest;
    trendLoading = true;
    trends = null;
    trendMessage = '';
    const ns = cacheNamespace;
    try {
      const result = await readTrends(year, period);
      if (!disposed && token === trendRequest) {
        trends = result;
        void saveTrendsCache(ns, year, period, result);
      }
    } catch (cause) {
      if (disposed) return;
      if (token === trendRequest && isNetworkFailure(cause)) {
        const cached = await readTrendsCache(ns, year, period);
        if (disposed || token !== trendRequest) return;
        if (cached) {
          trends = cached.value;
          showingCachedData = true;
          cachedSavedAt = cachedSavedAt ?? cached.savedAt;
          return;
        }
      }
      if (!disposed && (token === trendRequest || (cause instanceof ActivityError && cause.status === 401)))
        trendMessage = fail(cause);
    } finally {
      if (!disposed && token === trendRequest) trendLoading = false;
    }
  }
  async function selectDay(date: string, offset = 0) {
    const token = ++dayRequest;
    if (!selectedDate) {
      records = null;
      shownDate = null;
    }
    selectedDate = date;
    dayLoading = true;
    dayMessage = '';
    try {
      const result = await readActivities(fetch, offset, date);
      if (!disposed && token === dayRequest) {
        records = result;
        shownDate = date;
      }
    } catch (cause) {
      if (!disposed && (token === dayRequest || (cause instanceof ActivityError && cause.status === 401))) {
        dayMessage = fail(cause);
        records = null;
      }
    } finally {
      if (!disposed && token === dayRequest) dayLoading = false;
    }
  }
  function setYear(next: number) {
    if (next < 1900 || next > 2100) return;
    yearMessage = '';
    year = next;
    yearInput = String(next);
    selectedDate = null;
    void loadYear();
  }
  function changeYear(value: string) {
    yearInput = value;
    const next = Number(value);
    if (!/^\d{4}$/.test(value) || next < 1900 || next > 2100) {
      yearMessage = '请输入 1900–2100 年';
      return;
    }
    yearMessage = '';
    if (next !== year) setYear(next);
  }
  let trendHint = $derived(
    trendMetric === 'pace'
      ? `每${period === 'week' ? '周' : '月'}可靠跑步的平均配速，越高越快；缺少可靠用时的${period === 'week' ? '周' : '月'}留空。`
      : `每根柱子是一${period === 'week' ? '周' : '个月'}的${trendMetric === 'distance' ? '总里程' : trendMetric === 'count' ? '活动次数' : '已知耗时'}，黄色是最多的那${period === 'week' ? '周' : '个月'}，斜线是尚未结束的${period === 'week' ? '周' : '月'}。`,
  );
  // Number and unit printed apart: the unit in lower-case mono (brand.md §4); "—" has no unit.
  const figure = (value: string) => {
    const match = /^(.*\d)\s+(\S+)$/.exec(value);
    return match ? { number: match[1], unit: match[2] } : { number: value, unit: '' };
  };
  const today = $derived(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: page.data.showcase?.timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  // Header meta: the period, and "as of" while the year is still running.
  const headerMeta = $derived(
    [
      `${year}`,
      year === Number(today.slice(0, 4)) ? `截至 ${today.slice(5, 7)}.${today.slice(8, 10)}` : '全年',
      showingCachedData ? '离线缓存' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  let hasTrendActivities = $derived(trends?.buckets.some((bucket) => bucket.activity_count > 0) ?? false);
  onMount(() => {
    const url = new URL(window.location.href);
    const selection = dashboardSelection(url.searchParams, currentYear(page.data.showcase?.timezone ?? 'UTC'));
    if (url.search) {
      void goto(url.pathname, { state: page.state, shallow: true, replace: true }).catch(() => {});
    }
    year = selection.year;
    calendarMetric = selection.metric;
    period = selection.period;
    yearInput = String(year);
    selectedDate = selection.day;
    void loadYear(selection.day);
    void loadCumulative();
    return () => {
      disposed = true;
      yearRequest++;
      dayRequest++;
      trendRequest++;
      annual = null;
      cumulative = null;
      calendar = null;
      trends = null;
      records = null;
    };
  });
</script>

<svelte:head><title>{pageTitle('数据汇总', page.data.site)}</title></svelte:head>
<!-- Editorial Receipt archive page (brand.md §2): rules, hairlines and the year's numbers carry the layout. -->
<div class="editorial-page dashboard-page">
  <PageHeader title="数据汇总" meta={headerMeta}>
    {#snippet actions()}
      <!-- One joined stepper, not three outlined buttons: the header stays a single quiet band. -->
      <div class="year-controls" role="group" aria-label="切换年份">
        <button
          type="button"
          class="year-arrow"
          aria-label="上一年"
          disabled={year <= 1900}
          onclick={() => setYear(year - 1)}>‹</button
        >
        <label class="sr-only" for="calendar-year">年份</label><input
          id="calendar-year"
          aria-describedby={yearMessage ? 'year-error' : undefined}
          aria-invalid={yearMessage ? true : undefined}
          type="text"
          inputmode="numeric"
          maxlength="4"
          value={yearInput}
          oninput={(event) => changeYear(event.currentTarget.value)}
        />
        <button
          type="button"
          class="year-arrow"
          aria-label="下一年"
          disabled={year >= 2100}
          onclick={() => setYear(year + 1)}>›</button
        >
      </div>
    {/snippet}
  </PageHeader>
  <div class="dashboard">
    {#if yearMessage}<p id="year-error" role="alert" class="status-strip" data-tone="error">{yearMessage}</p>{/if}
    {#if showingCachedData}<div data-testid="dashboard-offline-cache-notice">
        <FeedbackState
          kind="empty"
          title={`当前显示离线缓存数据${cachedSavedAt ? `（更新于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: page.data.showcase?.timezone ?? 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(cachedSavedAt))}）` : ''}`}
        >
          <button
            type="button"
            class="button-secondary mt-3"
            onclick={() => {
              void loadYear(selectedDate);
              void loadCumulative();
            }}>重新同步统计</button
          >
        </FeedbackState>
      </div>{/if}
    {#if cumulativeMessage}<FeedbackState kind="error" title={cumulativeMessage}
        ><button
          class="button-secondary"
          onclick={() => {
            void loadCumulative();
          }}>重试累计统计</button
        ></FeedbackState
      >{/if}
    {#if message}<FeedbackState kind="error" title={message}
        ><button
          class="button-secondary"
          onclick={() => {
            void loadYear(selectedDate);
          }}>重新读取统计</button
        ></FeedbackState
      >{/if}
    <!-- The year's milestone, then its goals as one compressed strip. -->
    <div class="milestone-section">
      <div class="hero section-rule">
        {#if annual}
          {@const distance = figure(dashboardDistance(annual.distance_m))}
          <dl class="annual-metrics content-reveal" aria-label={`${year} 年运动摘要`}>
            <div class="annual-primary">
              <dt>{year} 年度距离</dt>
              <dd data-testid="annual-distance">
                {distance.number}{#if distance.unit}{' '}<span class="figure-unit">{distance.unit}</span
                  >{/if}{#if distance.number === '—'}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}
              </dd>
            </div>
            {#each [{ label: '运动次数', value: `${annual.activity_count.toLocaleString('zh-CN')} 次`, id: 'annual-count' }, { label: '活动天数', value: `${annual.activity_days.toLocaleString('zh-CN')} 天`, id: 'annual-days' }, { label: '可靠平均配速', value: formatPace(annual.avg_pace_seconds_per_km), id: 'annual-pace' }] as card (card.id)}
              {@const value = figure(card.value)}
              <div>
                <dt>{card.label}</dt>
                <dd data-testid={card.id}>
                  {value.number}{#if value.unit}{' '}<span class="figure-unit">{value.unit}</span
                    >{/if}{#if value.number === '—'}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}
                </dd>
              </div>
            {/each}
          </dl>
        {:else if !message}
          <!-- Same grid with hidden text: the figures keep their height while they load. -->
          <dl class="annual-metrics placeholder" aria-hidden="true">
            <div class="annual-primary">
              <dt>年度距离</dt>
              <dd>0 <span class="figure-unit">km</span></dd>
            </div>
            {#each ['运动次数', '活动天数', '可靠平均配速'] as label}
              <div>
                <dt>{label}</dt>
                <dd>0</dd>
              </div>
            {/each}
          </dl>
        {/if}
        {#if cumulative}<p class="cumulative">
            累计 <strong>{dashboardDistance(cumulative.distance_m)}</strong><span aria-hidden="true">·</span
            >{cumulative.activity_count.toLocaleString('zh-CN')} 次活动<span aria-hidden="true">·</span
            >{cumulative.activity_days.toLocaleString('zh-CN')} 个活动日
          </p>{:else if !cumulativeMessage}
          <!-- Holds the line's height until the totals arrive, so the blocks below do not jump. -->
          <p class="cumulative placeholder" aria-hidden="true">
            累计 <strong>0 km</strong><span>·</span>0 次活动<span>·</span>0 个活动日
          </p>{/if}
      </div>
      {#if page.data.showcase}<GoalOverview user={page.data.showcase} readonly={!view.manage} />{/if}
    </div>
    <!-- Trend and geography share the second row on wide screens. -->
    <div class="analysis-row">
      <section class="section-rule trend-section" aria-labelledby="trend-title" aria-busy={trendLoading}>
        <div class="section-head">
          <h2 id="trend-title">运动趋势</h2>
          <div class="trend-controls">
            <div class="underline-tabs" role="group" aria-label="趋势周期">
              {#each [['week', '周'], ['month', '月']] as [value, text] (value)}<button
                  type="button"
                  aria-pressed={period === value}
                  onclick={() => {
                    if (period === value) return;
                    period = value as Trends['period'];
                    void loadTrend();
                  }}>{text}</button
                >{/each}
            </div>
            <div class="underline-tabs" role="group" aria-label="趋势指标">
              {#each [['distance', '距离'], ['count', '次数'], ['duration', '耗时'], ['pace', '配速']] as [value, text] (value)}<button
                  type="button"
                  aria-pressed={trendMetric === value}
                  onclick={() => {
                    trendMetric = value as TrendMetric;
                  }}>{text}</button
                >{/each}
            </div>
          </div>
        </div>
        <p class="hint">{trendHint}</p>
        <!-- Reserved height: the chart arrives after the year's figures and must not push the blocks below. -->
        <div class="trend-body">
          {#if trendLoading}<FeedbackState kind="loading" title="正在读取趋势…" />{:else if trendMessage}<FeedbackState
              kind="error"
              title={trendMessage}
              ><button
                onclick={() => {
                  void loadTrend();
                }}
                class="button-secondary">重新读取趋势</button
              ></FeedbackState
            >{:else if trends}
            {#if hasTrendActivities}<TrendChart {trends} metric={trendMetric} appearance="receipt" />{:else}<div
                data-testid="trend-empty"
              >
                <FeedbackState title="记录一次跑步，让趋势开始生长"
                  ><a href={view.href('/activities')} class="button-primary">查看跑步记录</a></FeedbackState
                >
              </div>{/if}
          {/if}
        </div>
      </section>
      <ProvinceMap appearance="ledger" />
    </div>
    <section class="section-hairline calendar-card" aria-labelledby="calendar-title" aria-busy={loading}>
      <div class="section-head">
        <h2 id="calendar-title">{year} 年运动日历</h2>
        <div class="calendar-toolbar">
          <label
            >日历维度 <select aria-label="日历维度" bind:value={calendarMetric}
              ><option value="distance">距离</option><option value="count">次数</option></select
            ></label
          >
          <p class="section-meta">选择日期查看记录<span class="keyboard-hint"> · 方向键移动</span></p>
        </div>
      </div>
      {#if loading}<PageSkeleton title={`正在读取 ${year} 年统计…`} />{:else if calendar}
        <div class="content-reveal calendar-body">
          <CalendarGrid
            {calendar}
            metric={calendarMetric}
            selected={selectedDate}
            enhanced
            onselect={(date) => {
              void selectDay(date);
            }}
          />
        </div>
        {#if calendar.activity_count === 0}<div class="mt-4">
            <FeedbackState title="这一年还没有运动记录"
              ><a href={view.href('/activities')} class="text-primary underline">查看跑步记录</a
              >，也可以切换年份查看历史。</FeedbackState
            >
          </div>{/if}
      {:else}<p class="mt-4 text-muted-foreground">日历未能加载，请重新读取统计。</p>{/if}
      {#if selectedDate}<div class="day-drawer" transition:slide={{ duration: motionMs(320), easing: cubicOut }}>
          <section class="day-panel" aria-labelledby="day-title" aria-busy={dayLoading}>
            <div class="section-head">
              <h3 id="day-title" class="day-title">
                {shownDate ?? selectedDate} 的活动{records ? `（${records.total}）` : ''}
              </h3>
              <button
                class="button-text"
                onclick={() => {
                  ++dayRequest;
                  selectedDate = null;
                  shownDate = null;
                  records = null;
                  dayLoading = false;
                  dayMessage = '';
                }}>收起当天记录</button
              >
            </div>
            <div class="day-height" use:smoothHeight>
              <div>
                {#if dayLoading && !records}<FeedbackState
                    kind="loading"
                    title="正在读取当天活动…"
                  />{:else if dayMessage}<FeedbackState kind="error" title={dayMessage}
                    ><button
                      onclick={() => {
                        void selectDay(selectedDate!);
                      }}
                      class="button-secondary">重试当天活动</button
                    ></FeedbackState
                  >{:else if records}{#key records}<div class="day-fade" class:stale={dayLoading}>
                      {#if records.items.length === 0}<FeedbackState title="当天没有活动记录"
                          >选择其他日期，或<a href={view.href('/activities')} class="text-primary underline"
                            >查看跑步记录</a
                          >。</FeedbackState
                        >{:else}
                        <ul class="day-list">
                          {#each records.items as activity (activity.id)}<li>
                              <a href={view.href(`/activities/${activity.id}`)} class="day-activity"
                                ><div class="flex flex-wrap justify-between gap-2">
                                  <h4 class="font-semibold">{activity.title || '未命名活动'}</h4>
                                  <strong>{dashboardDistance(activity.distance_m)}</strong>
                                </div>
                                <p class="mt-1 text-sm text-muted-foreground">
                                  用时 {formatDuration(activityDuration(activity))} · 配速 {formatPace(
                                    activity.avg_pace_seconds_per_km,
                                  )} · {qualityLabel(activity.temporal_quality)}
                                </p></a
                              >
                            </li>{/each}
                        </ul>
                      {/if}
                      {#if records.total > 20}<div class="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            disabled={records.offset === 0}
                            onclick={() => {
                              void selectDay(selectedDate!, Math.max(0, records!.offset - 20));
                            }}
                            class="button-secondary">上一页</button
                          ><span class="text-sm">第 {Math.floor(records.offset / 20) + 1} 页</span><button
                            disabled={records.offset + records.items.length >= records.total}
                            onclick={() => {
                              void selectDay(selectedDate!, records!.offset + 20);
                            }}
                            class="button-secondary">下一页</button
                          >
                        </div>{/if}
                    </div>{/key}{/if}
              </div>
            </div>
          </section>
        </div>{/if}
    </section>
    <RecordsBannerLoader />
    <ActivityExplorer />
    <details class="statistics-notes">
      <summary>统计口径与数据质量</summary>
      <div class="notes-content">
        <p>仅统计你自己的活动。历史日期按活动保存时的当地日期归属，不随当前时区改变。</p>
        <p>
          目标的当前周期截至今天，同期按相同日历进度比较；进度条上的竖线是按日期此刻应完成的位置。连续记录按活动当地日期计算，今日/本周尚未结束时保留昨日/上周延续。
        </p>
        {#if annual}<p>
            年度已知耗时合计 {formatDuration(annual.duration_sum_seconds)}；已知 {annual.known_duration_count} 次，未知 {annual.missing_duration_count}
            次。配速按 {annual.pace_eligible_count} 次可靠活动的总耗时 / 总距离计算，覆盖 {dashboardDistance(
              annual.pace_eligible_distance_m,
            )}。含质量提示 {annual.quality_warning_count} 次。
          </p>{/if}
        {#if cumulative}<p>
            累计已知耗时 {formatDuration(cumulative.duration_sum_seconds)}（已知 {cumulative.known_duration_count} 次 / 未知
            {cumulative.missing_duration_count} 次）；累计可靠配速 {formatPace(
              cumulative.avg_pace_seconds_per_km,
            )}（有效 {cumulative.pace_eligible_count}
            次，覆盖 {dashboardDistance(cumulative.pace_eligible_distance_m)}）；累计含质量提示 {cumulative.quality_warning_count}
            次。
          </p>{/if}
        <p>
          日历按本年最大值分为四档；零距离活动用浅绿，灰色为无记录。自然周从周一开始；范围不足完整周期时标记“部分”。趋势图的黄色柱为本年最高的周期，斜线柱为尚未结束的周期。未知耗时与配速留空。距离显示保留最多一位小数，不改变统计计算精度。
        </p>
      </div>
    </details>
  </div>
</div>

<style>
  .dashboard {
    display: grid;
    gap: var(--space-12);
    margin-top: var(--space-8);
    min-width: 0;
  }
  .dashboard > :global(.feedback),
  .dashboard > [data-testid='dashboard-offline-cache-notice'],
  .dashboard > .status-strip {
    margin-bottom: calc(var(--space-6) - var(--space-12));
  }
  .placeholder {
    visibility: hidden;
  }
  /* ‹ 2026 › as one control: a single outline, hairline dividers, 44px targets. */
  .year-controls {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--surface) 72%, transparent);
    overflow: hidden;
  }
  .year-arrow {
    display: grid;
    place-items: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--header-ink, var(--foreground));
    font-size: var(--text-section);
    line-height: var(--line-height-solid);
    transition: background-color var(--transition-control);
  }
  @media (hover: hover) {
    .year-arrow:not(:disabled):hover {
      background: color-mix(in srgb, var(--foreground) 7%, transparent);
    }
  }
  .year-arrow:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .year-arrow:focus-visible,
  .year-controls input:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .year-controls input {
    width: 4.5rem;
    min-height: 2.75rem;
    padding: 0 0.25rem;
    border: 0;
    border-inline: 1px solid var(--control-border);
    border-radius: 0;
    background: none;
    color: var(--header-ink, var(--foreground));
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  /* The year's milestone (primary) with its goal strip under it; then trend beside geography on wide screens. */
  .milestone-section {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
  }
  .analysis-row {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: var(--space-8);
    align-items: stretch;
    min-width: 0;
  }
  @media (max-width: 1023px) {
    .analysis-row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-12);
    }
  }
  .hero {
    display: grid;
    gap: var(--space-4);
  }
  /* One primary number, then three supporting figures between vertical hairlines. */
  .annual-metrics {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(3, minmax(0, 11rem));
    align-items: end;
    row-gap: var(--space-4);
  }
  .annual-metrics > div {
    min-width: 0;
    padding-inline: var(--space-4);
  }
  .annual-metrics > .annual-primary {
    padding-left: 0;
  }
  .annual-metrics > div:last-child {
    padding-right: 0;
  }
  .annual-metrics > div + div {
    border-left: 1px solid var(--border);
  }
  @media (max-width: 1023px) {
    .annual-metrics {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .annual-metrics > .annual-primary {
      grid-column: 1 / -1;
      padding-inline: 0;
    }
    .annual-metrics > div:nth-child(2) {
      padding-left: 0;
      border-left: 0;
    }
  }
  dt {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  dd {
    margin-top: var(--space-1);
    font-size: var(--text-stat);
    line-height: var(--line-height-tight);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Units sit on the number's baseline, lighter and untracked, so they read as a label of the figure. */
  dd .figure-unit {
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  .annual-primary dd {
    font-size: var(--text-period-hero);
    line-height: var(--line-height-solid);
  }
  .annual-primary dd .figure-unit {
    font-size: var(--text-recap-unit);
    font-weight: var(--weight-semibold);
  }
  .cumulative {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--text-small);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .cumulative strong {
    color: var(--foreground);
    font-weight: var(--weight-semibold);
  }
  .trend-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-8);
  }
  .hint {
    margin-top: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .trend-body {
    min-height: 20rem;
  }
  .calendar-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-small);
  }
  .calendar-body {
    margin-top: var(--space-4);
  }
  select {
    min-height: 2.75rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-control);
    padding: 0.45rem 0.5rem;
    margin-left: 0.3rem;
    background: var(--surface);
  }
  .statistics-notes {
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  summary {
    cursor: pointer;
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .notes-content {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
    line-height: var(--line-height-body);
  }
  .day-drawer {
    overflow: hidden;
  }
  .day-panel {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  .day-title {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
  }
  .day-list > li + li {
    border-top: 1px solid var(--border);
  }
  .day-activity {
    display: block;
    padding: var(--space-3) var(--space-2);
    transition: background-color var(--transition-control);
  }
  .day-activity strong {
    font-variant-numeric: tabular-nums;
  }
  @media (hover: hover) {
    .day-activity:hover {
      background: var(--muted);
    }
  }
  .day-height {
    overflow: hidden;
    padding: 3px;
    margin: calc(var(--space-2) - 3px) -3px -3px;
    transition: height 280ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .day-fade {
    animation: day-fade 240ms ease-out both;
    transition: opacity 160ms ease;
  }
  .day-fade.stale {
    opacity: 0.55;
  }
  @keyframes day-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .day-fade {
      animation: none;
    }
  }
  /* The year switch stays beside the 28px title on phones instead of taking a row of its own. */
  @media (max-width: 639px) {
    .dashboard-page :global(.page-actions) {
      width: auto;
    }
  }
  @media (max-width: 767px) {
    .dashboard {
      gap: var(--space-8);
      margin-top: var(--space-6);
    }
    .dashboard > :global(.feedback),
    .dashboard > [data-testid='dashboard-offline-cache-notice'],
    .dashboard > .status-strip {
      margin-bottom: calc(var(--space-4) - var(--space-8));
    }
    .analysis-row {
      gap: var(--space-8);
    }
    .annual-metrics > div {
      padding-inline: var(--space-3);
    }
    .trend-body {
      min-height: 17rem;
    }
    .calendar-card {
      display: none;
    }
    .keyboard-hint {
      display: none;
    }
  }
</style>
