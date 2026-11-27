<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    currentMonthValue,
    formatReportRange,
    readPeriodReport,
    shiftMonthValue,
    type PeriodReport,
  } from '#lib/api/period-report.ts';
  import { readOwnTrends } from '#lib/api/statistics.ts';
  import DatePicker from '#lib/components/DatePicker.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RecapDistribution from '#lib/components/RecapDistribution.svelte';
  import RecapRhythmSpread from '#lib/components/RecapRhythmSpread.svelte';
  import RecapShare from '#lib/components/RecapShare.svelte';
  import {
    buildRecap,
    defaultRecapBucketIndex,
    km,
    monthDay,
    recapCoverage,
    recapHref,
    recapMetrics,
    recapSelection,
    recapTitle,
    type Recap,
    type RecapPeriod,
  } from '#lib/recap.ts';
  import { storyHref } from '#lib/story.ts';

  const PUNCH_MAX_BLOCKS = 10;

  let mounted = $state(false);
  let disposed = false;
  let requestToken = 0;
  let controller: AbortController | undefined;
  let report = $state<PeriodReport | null>(null);
  let distribution = $state<Recap | null>(null);
  let serverToday = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let trendError = $state('');
  let selectedBucketIndex = $state(-1);

  let shareComponent = $state<RecapShare | null>(null);
  let headerShareBtn = $state<HTMLButtonElement | null>(null);

  // Subtle hero distance count-up that respects prefers-reduced-motion and settles cleanly.
  let animatedDistance = $state<string | null>(null);
  let rafId = 0;

  const timezone = $derived(page.data.user?.timezone ?? 'UTC');
  const localMonth = $derived(currentMonthValue(timezone));
  const selected = $derived(recapSelection(page.url.searchParams, localMonth));
  const monthValue = $derived(
    `${selected.year}-${String(selected.month ?? Number(localMonth.slice(5))).padStart(2, '0')}`,
  );
  const shown = $derived(report ?? selected);
  const metrics = $derived(report ? recapMetrics(report) : []);
  const coverage = $derived(report ? recapCoverage(report) : '');
  const totalDistanceM = $derived(report ? Number(report.distance_m) : 0);
  const exactDistanceText = $derived(km(totalDistanceM));
  const heroDistanceText = $derived(animatedDistance ?? exactDistanceText);
  const heroMarathonsText = $derived.by(() => {
    if (totalDistanceM <= 0) return '';
    const count = totalDistanceM / 42195;
    return `${count >= 100 ? Math.round(count).toLocaleString('zh-CN') : count.toFixed(1)} 场全马`;
  });
  const heroAvgRunText = $derived(
    report && report.activity_count > 0 && totalDistanceM > 0
      ? `${km(totalDistanceM / report.activity_count, 1)} km`
      : '',
  );
  const peakRulerWidth = $derived.by(() => {
    if (!distribution) return 0;
    if (distribution.derived.peakSharePct > 0) {
      return Math.min(100, Math.max(12, distribution.derived.peakSharePct * 2.1));
    }
    if (distribution.derived.observedCount > 0 && distribution.derived.activeCount > 0) {
      return Math.round((distribution.derived.activeCount / distribution.derived.observedCount) * 100);
    }
    return 0;
  });

  const activeBucketIndex = $derived(
    distribution
      ? selectedBucketIndex >= 0 && selectedBucketIndex < distribution.buckets.length
        ? selectedBucketIndex
        : defaultRecapBucketIndex(distribution)
      : -1,
  );

  // Punch-card rhythm columns (brand.md §5.3, W-11): each block ≈ peak / 10, synced with distribution & spread.
  const punchColumns = $derived.by(() => {
    if (!distribution) return [];
    const max = distribution.max;
    const cutoff = distribution.isPartial ? distribution.cutoff : null;
    return distribution.buckets.map((bucket, index) => {
      const hasDist = !bucket.future && bucket.distance !== null && bucket.distance > 0 && max > 0;
      const blocks = hasDist ? Math.max(1, Math.round((bucket.distance! / max) * PUNCH_MAX_BLOCKS)) : 1;
      const compactLabel = distribution!.period === 'year' ? String(index + 1) : bucket.shortLabel;
      const inProgress = Boolean(
        cutoff &&
        !bucket.future &&
        ((bucket.start <= cutoff && bucket.last >= cutoff) || (distribution!.period === 'year' && bucket.partial)),
      );
      return {
        bucket,
        index,
        hasDist,
        blocks,
        compactLabel,
        inProgress,
        valueText: bucket.future ? '未到' : `${km(bucket.distance ?? 0, 1)} km`,
      };
    });
  });

  const hasInProgressPunch = $derived(punchColumns.some((col) => col.inProgress));

  const punchUnitText = $derived(
    distribution && distribution.max > 0 ? `每格 ≈ ${km(distribution.max / PUNCH_MAX_BLOCKS, 1)} km` : '',
  );

  const maxMonth = $derived(serverToday?.slice(0, 7) ?? localMonth);
  const maxYear = $derived(Number(maxMonth.slice(0, 4)));
  const years = $derived(
    Array.from({ length: Math.max(maxYear, selected.year) - 1899 }, (_, i) => Math.max(maxYear, selected.year) - i),
  );
  const current = $derived(selected.period === 'year' ? selected.year === maxYear : monthValue === maxMonth);
  const previousDisabled = $derived(selected.period === 'year' ? selected.year <= 1900 : monthValue <= '1900-01');
  const nextDisabled = $derived(selected.period === 'year' ? selected.year >= maxYear : monthValue >= maxMonth);

  function stopCountUp() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    animatedDistance = null;
  }

  function startCountUp(targetMetres: number) {
    stopCountUp();
    if (!mounted || targetMetres <= 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const duration = 520;
    const startTime = performance.now();
    const stepFrame = (now: number) => {
      if (disposed) return;
      const t = Math.min(1, (now - startTime) / duration);
      const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t);
      if (t >= 1) {
        rafId = 0;
        animatedDistance = null;
      } else {
        animatedDistance = km(targetMetres * eased);
        rafId = requestAnimationFrame(stepFrame);
      }
    };
    rafId = requestAnimationFrame(stepFrame);
  }

  onMount(() => {
    mounted = true;
    const onBeforePrint = () => stopCountUp();
    window.addEventListener('beforeprint', onBeforePrint);
    return () => {
      disposed = true;
      window.removeEventListener('beforeprint', onBeforePrint);
      stopCountUp();
      controller?.abort();
    };
  });

  $effect(() => {
    if (mounted) {
      const period = selected;
      untrack(() => void load(period));
    }
  });

  function select(period: RecapPeriod) {
    const href = recapHref(period);
    if (href !== page.url.pathname + page.url.search) void goto(href, { reset: false });
  }

  function selectMonth(value: string) {
    if (!/^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) value = maxMonth;
    const [year, month] = value.split('-').map(Number);
    select({ period: 'month', year, month });
  }

  function step(delta: number) {
    if (selected.period === 'month') selectMonth(shiftMonthValue(monthValue, delta));
    else select({ period: 'year', year: selected.year + delta, month: null });
  }

  function switchPeriod(period: 'month' | 'year') {
    if (selected.period === period) return;
    if (period === 'year') select({ period, year: selected.year, month: null });
    else selectMonth(monthValue > maxMonth && selected.year === maxYear ? maxMonth : monthValue);
  }

  function jumpToCurrent() {
    if (selected.period === 'month') selectMonth(maxMonth);
    else select({ period: 'year', year: maxYear, month: null });
  }

  async function load(selection: RecapPeriod) {
    const mine = ++requestToken;
    controller?.abort();
    const { signal } = (controller = new AbortController());
    const fetcher: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    const active = () => !disposed && mine === requestToken;
    loading = true;
    error = '';
    trendError = '';
    let result: PeriodReport | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        result = null;
        const candidate = await readPeriodReport(
          selection.period,
          selection.year,
          selection.month ?? undefined,
          fetcher,
        );
        if (!active()) return;
        if (
          candidate.period !== selection.period ||
          candidate.year !== selection.year ||
          candidate.month !== selection.month
        ) {
          throw new ActivityError('报告服务返回了无效响应，请重试', 502, 'INVALID_RESPONSE');
        }
        result = candidate;
        let next: Recap | null = null;
        if (result.activity_count > 0 && result.date_from < result.date_to) {
          const trends = await readOwnTrends(
            result.date_from,
            result.date_to,
            result.period === 'year' ? 'month' : 'week',
            fetcher,
          );
          if (!active()) return;
          try {
            next = buildRecap(result, trends);
          } catch (cause) {
            if (attempt === 0 && cause instanceof ActivityError && cause.code === 'RECAP_TRENDS_MISMATCH') continue;
            throw cause;
          }
        }
        report = result;
        serverToday = result.today;
        distribution = next;
        selectedBucketIndex = next ? defaultRecapBucketIndex(next) : -1;
        startCountUp(Number(result.distance_m));
        break;
      }
    } catch (cause) {
      if (!active()) return;
      distribution = null;
      selectedBucketIndex = -1;
      stopCountUp();
      if (cause instanceof ActivityError && cause.status === 401) {
        report = null;
        disposed = true;
        window.location.replace(
          '/admin?reason=expired&next=' + encodeURIComponent(page.url.pathname + page.url.search),
        );
        return;
      }
      report = result;
      if (result) {
        serverToday = result.today;
        trendError = cause instanceof Error ? cause.message : '里程分布读取失败';
      } else {
        error = cause instanceof Error ? cause.message : '跑步回顾读取失败';
      }
    } finally {
      if (active()) loading = false;
    }
  }
</script>

<svelte:head><title>{recapTitle(shown)} · RunNote</title></svelte:head>

<div class="editorial-page recap-page" data-testid="recap-page">
  <header class="masthead">
    <div class="masthead-lead">
      <a class="crumb" href="/workspace/records">‹ 返回个人记录</a>
      <h1>{recapTitle(shown)}</h1>
    </div>

    <div class="period-control">
      <div class="underline-tabs period-tabs" role="group" aria-label="回顾周期">
        <button type="button" aria-pressed={selected.period === 'month'} onclick={() => switchPeriod('month')}>
          月度
        </button>
        <button type="button" aria-pressed={selected.period === 'year'} onclick={() => switchPeriod('year')}>
          年度
        </button>
      </div>

      <div class="picker">
        <button
          type="button"
          class="button-secondary step"
          aria-label={selected.period === 'month' ? '上一个月' : '上一年'}
          disabled={previousDisabled}
          onclick={() => step(-1)}>‹</button
        >
        {#if selected.period === 'month'}
          <div class="month-picker-wrap">
            <DatePicker
              label="选择月份"
              granularity="month"
              min="1900-01"
              max={monthValue > maxMonth ? monthValue : maxMonth}
              {timezone}
              value={monthValue}
              onselect={selectMonth}
            />
          </div>
        {:else}
          <select
            class="text-field year-select"
            aria-label="选择年份"
            value={selected.year}
            onchange={(event) => select({ period: 'year', year: Number(event.currentTarget.value), month: null })}
          >
            {#each years as year (year)}<option value={year}>{year} 年</option>{/each}
          </select>
        {/if}
        <button
          type="button"
          class="button-secondary step"
          aria-label={selected.period === 'month' ? '下一个月' : '下一年'}
          disabled={nextDisabled}
          onclick={() => step(1)}>›</button
        >
      </div>

      {#if !current}
        <button type="button" class="button-secondary" onclick={jumpToCurrent}>
          {selected.period === 'year' ? '回到今年' : '回到本月'}
        </button>
      {/if}

      {#if distribution}
        <button
          type="button"
          bind:this={headerShareBtn}
          class="button-primary"
          disabled={loading || !mounted}
          onclick={() => shareComponent?.open(headerShareBtn)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 15V3 M7 8l5-5 5 5 M5 13v7h14v-7" />
          </svg>
          生成分享图
        </button>
      {/if}
    </div>
  </header>

  {#if loading && report}
    <p class="status-strip refresh-strip" role="status">正在读取 {recapTitle(selected)}…</p>
  {/if}

  {#if !report && loading}
    <PageSkeleton title={`正在读取 ${recapTitle(selected)}…`} />
  {:else if error}
    <div class="section-rule state-block">
      <FeedbackState kind="error" title={error}>
        <button class="button-secondary" type="button" onclick={() => load(selected)}>重试</button>
      </FeedbackState>
    </div>
  {:else if report}
    {#if !report.activity_count}
      <div class="section-rule state-block">
        <FeedbackState
          kind="empty"
          title={report.date_from === report.date_to ? '该周期尚未开始' : '这个周期还没有跑步记录'}
        >
          <a class="button-secondary" href="/workspace/activities">查看跑步记录</a>
        </FeedbackState>
      </div>
    {:else}
      <div class="report-layout" class:has-share-desk={Boolean(distribution)}>
        <div class="report-main">
          <!-- Primary Receipt Sheet (brand.md §2, §4, §5.3) -->
          <article class="receipt-sheet report-sheet" aria-labelledby="recap-total" data-testid="recap-overview">
            <div class="receipt-header">
              <span>{recapTitle(report)}</span>
              <span class="receipt-header-meta">
                {formatReportRange(report)}
                {#if report.cutoff_date}
                  · <span data-testid="recap-partial-pill">进行中 · 截至 {monthDay(report.cutoff_date)}</span>
                {:else}
                  · 已封存
                {/if}
              </span>
            </div>

            <div class="rep-head">
              <h2 id="recap-total" class="rep-label">总里程</h2>
              {#if distribution}
                <p class="rep-active-ratio">{distribution.derived.activeRatioText}</p>
              {/if}
            </div>

            <p class="giant-distance">
              <strong>{heroDistanceText}</strong>
              <span class="figure-unit giant-unit">km</span>
            </p>

            {#if heroMarathonsText || heroAvgRunText || (distribution && distribution.max > 0)}
              <p class="scale-facts">
                {#if heroMarathonsText}<span>等效 <strong>{heroMarathonsText}</strong></span>{/if}
                {#if heroAvgRunText}<span>单次均距 <strong>{heroAvgRunText}</strong></span>{/if}
                {#if distribution && distribution.max > 0 && distribution.derived.peakLabelCompact}
                  <span>
                    {distribution.derived.peakTied ? '并列峰值' : '峰值'}
                    <strong>{distribution.derived.peakLabelCompact} · {km(distribution.max, 1)} km</strong>
                  </span>
                {/if}
              </p>
            {/if}

            {#if distribution}
              <div class="ruler">
                <div class="ruler-track" aria-hidden="true">
                  <div class="ruler-fill" style:width={`${peakRulerWidth}%`}></div>
                </div>
                <div class="ruler-caption">
                  <span>
                    {distribution.derived.peakSharePct > 0
                      ? `峰值占比 ${distribution.derived.peakSharePct}%`
                      : '本期暂无有效里程'}
                  </span>
                  <span>{distribution.derived.activeRatioText}</span>
                </div>
              </div>

              <div class="receipt-perforation" aria-hidden="true"></div>

              <!-- Punch-Card Rhythm (brand.md §5.3) -->
              <section class="punch-section" aria-labelledby="recap-punch-title" data-testid="recap-punch-rhythm">
                <div class="section-head punch-head">
                  <h2 id="recap-punch-title">{distribution.period === 'year' ? '逐月节律' : '逐周节律'}</h2>
                  <span class="section-meta mono">
                    {#if distribution.max > 0 && distribution.derived.peakLabelCompact}
                      {punchUnitText} · 最高 {distribution.derived.peakLabelCompact}
                      {km(distribution.max, 1)} km{#if hasInProgressPunch}
                        · 斜线为进行中{/if}
                    {:else}
                      本期暂无有效里程
                    {/if}
                  </span>
                </div>

                <div
                  class="punch-grid"
                  class:punch-grid-month={distribution.period === 'month'}
                  role="group"
                  aria-label={distribution.period === 'year' ? '逐月里程打孔节律' : '逐周里程打孔节律'}
                >
                  {#each punchColumns as col (col.bucket.start)}
                    {@const isSelected = col.index === activeBucketIndex}
                    <button
                      type="button"
                      class="punch-col"
                      class:is-peak={col.bucket.peak}
                      class:is-partial={col.inProgress}
                      class:is-empty={!col.hasDist}
                      class:is-future={col.bucket.future}
                      class:is-selected={isSelected}
                      data-date={col.bucket.start}
                      data-partial={col.inProgress ? 'true' : undefined}
                      aria-pressed={isSelected}
                      aria-label={`${col.bucket.rangeShort}，${col.valueText}${col.bucket.peak ? '，最高' : ''}${col.inProgress ? '，进行中（未结束）' : ''}`}
                      onclick={() => {
                        selectedBucketIndex = col.index;
                      }}
                    >
                      <span class="punch-stack" aria-hidden="true">
                        {#each Array.from({ length: col.blocks }) as _, blockIdx (blockIdx)}
                          <i class="punch-blk"></i>
                        {/each}
                      </span>
                      <span class="punch-lbl punch-lbl-full">{col.bucket.shortLabel}</span>
                      <span class="punch-lbl punch-lbl-compact" aria-hidden="true">{col.compactLabel}</span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}

            <div class="receipt-perforation" aria-hidden="true"></div>

            <!-- Totals Ledger & Annual Story Link -->
            <div class="rep-cols" class:rep-cols-single={!distribution || distribution.period !== 'year'}>
              <section aria-labelledby="recap-summary-title">
                <div class="section-head rep-subhead">
                  <h2 id="recap-summary-title">{report.period === 'year' ? '全年合计' : '本月合计'}</h2>
                </div>
                <dl class="rep-ledger">
                  {#each metrics as metric (metric.label)}
                    <div class="leader-row rep-ledger-row">
                      <dt>{metric.label}</dt>
                      <dd>
                        <strong>{metric.value}</strong>{#if metric.unit}
                          <span class="figure-unit ledger-unit">{metric.unit}</span>{/if}{#if metric.value === '—'}<span
                            class="sr-only">（数据缺失）</span
                          >{/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
                {#if coverage}
                  <p class="status-strip coverage-strip">统计覆盖：{coverage}</p>
                {/if}
              </section>

              {#if distribution && distribution.period === 'year'}
                <section class="story-entry" aria-label="跑步年度故事入口" data-testid="recap-story-entry">
                  <div class="section-head rep-subhead">
                    <h2>{distribution.year} 跑步年度故事</h2>
                  </div>
                  <p class="story-entry-meta">
                    查看该年度的第一跑、最长路线、最佳表现、探索城市、最常跑路线与年度足迹动画。
                  </p>
                  <div class="story-entry-action">
                    <a class="button-secondary" href={storyHref(distribution.year)}>查看年度故事</a>
                  </div>
                </section>
              {/if}
            </div>
          </article>

          <!-- Chapter 02: Rhythm Terrain & Cumulative Trajectory -->
          <section class="section-rule chapter-section" aria-labelledby="recap-distribution">
            {#if trendError}
              <h2 id="recap-distribution" class="fallback-heading">里程分布</h2>
              <FeedbackState kind="error" title={trendError}>
                <button class="button-secondary" type="button" onclick={() => load(selected)}>重试读取分布</button>
              </FeedbackState>
            {:else if distribution}
              <RecapDistribution recap={distribution} bind:selectedIndex={selectedBucketIndex} />
            {/if}
          </section>

          <!-- Chapter 03: Dual Spread (Attendance Rhythm + Pace Profile) -->
          {#if distribution}
            <RecapRhythmSpread recap={distribution} bind:selectedIndex={selectedBucketIndex} />
          {/if}
        </div>

        <!-- Sticky Share Desk & Native Share Dialog -->
        {#if distribution}
          <aside class="report-desk-col" aria-label="分享图工作台">
            <RecapShare bind:this={shareComponent} recap={distribution} disabled={loading} />
          </aside>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .recap-page {
    min-width: 0;
  }

  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4) var(--space-6);
    margin-bottom: var(--space-6);
  }
  .masthead-lead {
    min-width: 0;
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
  }
  .crumb:hover {
    color: var(--foreground);
  }
  h1 {
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-title);
    letter-spacing: 0;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  .period-control,
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .period-tabs {
    margin-inline-end: var(--space-2);
  }
  .picker {
    flex-wrap: nowrap;
    min-width: 0;
  }
  .month-picker-wrap {
    min-width: 0;
  }
  .month-picker-wrap :global(.date-field > label) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .month-picker-wrap :global(.date-control) {
    border-color: var(--control-border);
    border-radius: var(--radius-control);
    background: transparent;
  }
  .step {
    width: 2.75rem;
    min-width: 2.75rem;
    padding: 0;
    font-size: var(--text-section);
    line-height: var(--line-height-solid);
    flex: none;
  }
  .year-select,
  .recap-page :global(select.year-select.rn-liquid-select) {
    width: auto;
    min-height: 2.75rem;
    border-color: var(--control-border);
    border-radius: var(--radius-control);
    background-color: transparent;
    box-shadow: none;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .refresh-strip {
    margin-bottom: var(--space-4);
    font-variant-numeric: tabular-nums;
  }
  .state-block {
    margin-top: var(--space-4);
  }

  /* Two-column editorial layout: receipt + analysis left, sticky share desk right on wide desktop */
  .report-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-8);
    align-items: start;
    min-width: 0;
  }
  .report-layout.has-share-desk {
    grid-template-columns: minmax(0, 1fr) 20rem;
  }
  .report-main {
    min-width: 0;
  }
  .report-desk-col {
    position: sticky;
    top: calc(var(--top-navigation-height) + var(--space-6));
    min-width: 0;
  }

  /* Primary Receipt Sheet */
  .report-sheet {
    --sheet-pad: clamp(1.25rem, 3vw, 2.5rem);
    --perforation-ground: var(--background);
  }
  .receipt-header-meta {
    font-variant-numeric: tabular-nums;
  }
  .rep-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }
  .rep-label {
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    line-height: var(--line-height-heading);
    color: var(--muted-foreground);
  }
  .rep-active-ratio {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .giant-distance {
    margin-top: var(--space-2);
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    column-gap: var(--space-3);
    font-variant-numeric: tabular-nums;
  }
  .giant-distance strong {
    font-size: var(--text-period-hero);
    line-height: var(--line-height-hero);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
    color: var(--foreground);
    overflow-wrap: anywhere;
  }
  .giant-unit {
    font-size: var(--text-stat);
    line-height: var(--line-height-solid);
  }
  .scale-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin-top: var(--space-3);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .scale-facts strong {
    color: var(--foreground);
    font-weight: var(--weight-semibold);
  }

  .ruler {
    margin-top: var(--space-6);
  }
  .ruler-track {
    height: 4px;
    background: var(--border);
    overflow: hidden;
  }
  .ruler-fill {
    height: 100%;
    background: var(--primary);
    transition: width 480ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .ruler-caption {
    margin-top: var(--space-2);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }

  /* Punch-Card Rhythm inside Receipt */
  .punch-section {
    min-width: 0;
  }
  .punch-head {
    margin-bottom: var(--space-4);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .punch-grid {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--space-2);
    align-items: end;
    min-height: 9rem;
  }
  .punch-grid-month {
    gap: var(--space-3);
  }
  .punch-col {
    display: grid;
    gap: var(--space-1);
    justify-items: center;
    align-content: end;
    min-width: 0;
    min-height: 2.75rem;
    padding: var(--space-1) 0;
    border: 0;
    border-radius: var(--radius-sheet);
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
    transition: background-color var(--transition-control);
  }
  .punch-col:hover {
    background: color-mix(in srgb, var(--foreground) 4%, transparent);
  }
  .punch-col.is-selected {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }
  .punch-col:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .punch-stack {
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 3px;
    width: 100%;
  }
  .punch-blk {
    display: block;
    width: min(100%, 2.5rem);
    height: 0.625rem;
    border-radius: 2px;
    background: var(--primary);
    opacity: 0.85;
  }
  .punch-col.is-peak .punch-blk {
    background: var(--receipt-mark);
    opacity: 1;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 30%, transparent);
  }
  :global(:root[data-theme='dark']) .punch-col.is-peak .punch-blk {
    box-shadow: none;
  }
  /* In-progress period (brand.md §3.2, W-11): hatched primary fill + 2px top cap on the uppermost block. */
  .punch-col.is-partial:not(.is-empty) .punch-blk {
    background: repeating-linear-gradient(
      135deg,
      var(--primary) 0 3px,
      color-mix(in srgb, var(--primary) 18%, var(--paper)) 3px 6px
    );
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 65%, transparent);
    opacity: 1;
  }
  .punch-col.is-partial:not(.is-empty) .punch-blk:last-child {
    border-top: 2px solid var(--primary);
  }
  .punch-col.is-peak.is-partial:not(.is-empty) .punch-blk {
    background: repeating-linear-gradient(
      135deg,
      var(--receipt-mark) 0 3px,
      color-mix(in srgb, var(--receipt-mark) 22%, var(--paper)) 3px 6px
    );
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 35%, transparent);
  }
  .punch-col.is-peak.is-partial:not(.is-empty) .punch-blk:last-child {
    border-top: 2px solid var(--foreground);
  }
  :global(:root[data-theme='dark']) .punch-col.is-peak.is-partial:not(.is-empty) .punch-blk {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--receipt-mark) 70%, transparent);
  }
  :global(:root[data-theme='dark']) .punch-col.is-peak.is-partial:not(.is-empty) .punch-blk:last-child {
    border-top-color: var(--receipt-mark);
  }
  .punch-col.is-empty .punch-blk {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--border);
    opacity: 1;
  }
  .punch-col.is-future .punch-blk {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border);
    opacity: 0.45;
  }
  .punch-lbl {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--line-height-solid);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .punch-lbl-compact {
    display: none;
  }
  .punch-col.is-peak .punch-lbl,
  .punch-col.is-selected .punch-lbl {
    color: var(--foreground);
    font-weight: var(--weight-bold);
  }

  /* Lower columns inside Receipt */
  .rep-cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8);
    align-items: start;
  }
  .rep-cols-single {
    grid-template-columns: minmax(0, 1fr);
  }
  .rep-subhead {
    margin-bottom: var(--space-3);
  }
  .rep-ledger {
    display: grid;
    gap: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  .rep-ledger-row {
    padding-block: var(--space-1);
  }
  .rep-ledger-row dt {
    font-size: var(--text-small);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .rep-ledger-row dd {
    text-align: right;
    white-space: nowrap;
  }
  .rep-ledger-row strong {
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    color: var(--foreground);
  }
  .ledger-unit {
    margin-inline-start: var(--space-1);
    font-size: var(--text-caption);
  }
  .coverage-strip {
    margin-top: var(--space-4);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .story-entry {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .story-entry-meta {
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
  }
  .story-entry-action {
    margin-top: var(--space-1);
  }

  /* Chapter 02 analysis section (flat editorial rule, no card) */
  .chapter-section {
    margin-top: var(--space-8);
  }
  .fallback-heading {
    margin-bottom: var(--space-3);
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }

  @media (prefers-reduced-motion: reduce) {
    .ruler-fill {
      transition: none;
    }
  }
  @media (max-width: 1079px) {
    .report-layout.has-share-desk {
      grid-template-columns: minmax(0, 1fr);
    }
    .report-desk-col {
      position: static;
    }
  }
  /* Release sticky on very short desktop viewports so share controls scroll naturally into reach. */
  @media (min-width: 1080px) and (max-height: 640px) {
    .report-desk-col {
      position: static;
    }
  }
  @media (max-width: 767px) {
    .rep-cols {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
    }
  }
  @media (max-width: 639px) {
    .period-control {
      width: 100%;
    }
    .period-control .button-primary {
      width: 100%;
    }
    .giant-distance strong {
      font-size: var(--text-recap-hero);
    }
    .giant-unit {
      font-size: var(--text-section);
    }
    .punch-grid {
      gap: var(--space-1);
    }
    .punch-blk {
      height: 0.5rem;
    }
  }
  @media (max-width: 479px) {
    .punch-lbl-full {
      display: none;
    }
    .punch-lbl-compact {
      display: inline;
    }
    .punch-grid {
      gap: 3px;
    }
  }
  @media (forced-colors: active) {
    .ruler-fill,
    .punch-blk {
      forced-color-adjust: none;
      background: Highlight;
    }
    .punch-col.is-peak .punch-blk {
      background: LinkText;
    }
  }
</style>
