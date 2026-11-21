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
    recapIssueTag,
    recapMetrics,
    recapSelection,
    recapTitle,
    type Recap,
    type RecapPeriod,
  } from '#lib/recap.ts';

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

<div class="recap">
  <a class="back text-muted-foreground" href="/workspace/records">‹ 返回个人记录</a>
  <header class="masthead">
    <div class="masthead-lead">
      <div class="title-row">
        <h1>{recapTitle(shown)}</h1>
        {#if report?.cutoff_date}
          <span class="status-pill" data-testid="recap-partial-pill">
            进行中 · 截至 {monthDay(report.cutoff_date)}
          </span>
        {/if}
      </div>
      {#if report}
        <p class="range">{formatReportRange(report)}</p>
      {/if}
    </div>
    <div class="period-control">
      <div class="settings-tabs" role="group" aria-label="回顾周期">
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
          <DatePicker
            label="选择月份"
            granularity="month"
            min="1900-01"
            max={monthValue > maxMonth ? monthValue : maxMonth}
            {timezone}
            value={monthValue}
            onselect={selectMonth}
          />
        {:else}
          <select
            class="text-field"
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
          生成分享图
        </button>
      {/if}
    </div>
  </header>

  {#if loading && report}
    <p class="refresh" role="status">正在读取 {recapTitle(selected)}…</p>
  {/if}

  {#if !report && loading}
    <PageSkeleton title={`正在读取 ${recapTitle(selected)}…`} />
  {:else if error}
    <FeedbackState kind="error" title={error}>
      <button class="button-secondary" type="button" onclick={() => load(selected)}>重试</button>
    </FeedbackState>
  {:else if report}
    {#if !report.activity_count}
      <FeedbackState
        kind="empty"
        title={report.date_from === report.date_to ? '该周期尚未开始' : '这个周期还没有跑步记录'}
      />
    {:else}
      <!-- Chapter 01: Editorial Monolith -->
      <section class="monolith" aria-labelledby="recap-total" data-testid="recap-overview">
        <svg class="monolith-bg" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="recapTrackArcGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <g fill="none" stroke="url(#recapTrackArcGrad)" stroke-width="1.5">
            <rect x="440" y="-120" width="960" height="580" rx="290" />
            <rect x="480" y="-80" width="880" height="500" rx="250" />
            <rect x="520" y="-40" width="800" height="420" rx="210" />
            <rect x="560" y="0" width="720" height="340" rx="170" />
          </g>
        </svg>

        <div class="monolith-grid">
          <div class="monolith-lead">
            <div class="kicker">
              <span class="issue-code">{recapIssueTag(report)}</span>
              <span class="kicker-dot" aria-hidden="true"></span>
              <h2 id="recap-total">总里程</h2>
            </div>

            <p class="giant-distance">
              <strong>{heroDistanceText}</strong>
              <span class="giant-unit">km</span>
            </p>

            {#if heroMarathonsText || heroAvgRunText || (distribution && distribution.max > 0)}
              <div class="scale-facts">
                {#if heroMarathonsText}<span>等效 <strong>{heroMarathonsText}</strong></span>{/if}
                {#if heroAvgRunText}<span>单次均距 <strong>{heroAvgRunText}</strong></span>{/if}
                {#if distribution && distribution.max > 0 && distribution.derived.peakLabelCompact}
                  <span>
                    {distribution.derived.peakTied ? '并列峰值' : '峰值'}
                    <strong>{distribution.derived.peakLabelCompact} · {km(distribution.max, 1)} km</strong>
                  </span>
                {/if}
              </div>
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
            {/if}
          </div>

          <div class="monolith-ledger">
            <dl class="ledger-grid">
              {#each metrics as metric (metric.label)}
                <div class="ledger-item">
                  <dt>{metric.label}</dt>
                  <dd>
                    <strong>{metric.value}</strong>{#if metric.unit}
                      <span>{metric.unit}</span>{/if}{#if metric.value === '—'}<span class="sr-only">（数据缺失）</span
                      >{/if}
                  </dd>
                </div>
              {/each}
            </dl>
            {#if coverage}
              <p class="coverage">统计覆盖：{coverage}</p>
            {/if}
          </div>
        </div>
      </section>

      <!-- Chapter 02: Rhythm Terrain & Cumulative Trajectory -->
      <section class="chapter-section" aria-labelledby="recap-distribution">
        {#if trendError}
          <h2 id="recap-distribution" class="fallback-heading">里程分布</h2>
          <FeedbackState kind="error" title={trendError}>
            <button class="button-secondary" type="button" onclick={() => load(selected)}>重试读取分布</button>
          </FeedbackState>
        {:else if distribution}
          <RecapDistribution recap={distribution} bind:selectedIndex={selectedBucketIndex} />
        {/if}
      </section>

      <!-- Chapter 03: Dual Spread (Attendance Matrix + Pace Profile) -->
      {#if distribution}
        <RecapRhythmSpread recap={distribution} bind:selectedIndex={selectedBucketIndex} />

        <!-- Extension slot reserved for Work Item 19 (Annual Story chapters) -->

        <!-- Chapter 04: Keepsake Poster Dock & Native Share Dialog -->
        <RecapShare bind:this={shareComponent} recap={distribution} disabled={loading} />
      {/if}
    {/if}
  {/if}
</div>

<style>
  .recap {
    max-width: 72rem;
    margin-inline: auto;
    min-width: 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    font-size: var(--text-small);
  }
  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .masthead-lead {
    min-width: 0;
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  h1 {
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-title);
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--primary-soft);
    color: var(--primary);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .status-pill::before {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--primary);
  }
  .range,
  .refresh {
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .range {
    margin-top: var(--space-1);
  }
  .refresh {
    margin-bottom: var(--space-2);
  }
  .period-control,
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .picker {
    flex-wrap: nowrap;
    min-width: 0;
  }
  .period-control .settings-tabs {
    margin: 0;
    width: auto;
  }
  .period-control .button-secondary,
  .period-control .button-primary,
  .text-field,
  .period-control .settings-tabs button {
    min-height: 2.75rem;
  }
  .step {
    width: 2.75rem;
    padding: 0;
    font-size: var(--text-section);
    line-height: var(--line-height-solid);
    flex: none;
  }
  .text-field {
    width: auto;
  }

  /* Chapter 01: Editorial Monolith */
  .monolith {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-card);
    background: linear-gradient(135deg, var(--recap-forest) 0%, var(--recap-forest-deep) 100%);
    color: var(--recap-forest-ink);
    padding: clamp(1.5rem, 3.5vw, 2.75rem);
    border: 1px solid rgb(255 255 255 / 0.08);
    animation: recap-rise var(--motion-enter) both;
  }
  .monolith-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: var(--recap-gold);
    pointer-events: none;
  }
  .monolith-grid {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: clamp(1.5rem, 3.5vw, 3rem);
    align-items: stretch;
  }
  .monolith-lead {
    min-width: 0;
  }
  .kicker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--recap-forest-muted);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    font-variant-numeric: tabular-nums;
  }
  .kicker h2 {
    margin: 0;
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    color: inherit;
    line-height: var(--line-height-heading);
  }
  .issue-code {
    font-family: var(--font-mono);
  }
  .kicker-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--recap-gold);
  }
  .giant-distance {
    margin: var(--space-3) 0 0;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    column-gap: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  .giant-distance strong {
    font-size: var(--text-recap-hero);
    line-height: var(--line-height-hero);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
    color: var(--recap-hero-num);
    overflow-wrap: anywhere;
  }
  .giant-unit {
    font-size: var(--text-recap-unit);
    font-weight: var(--weight-semibold);
    color: var(--recap-gold);
  }
  .scale-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-top: var(--space-4);
    font-size: var(--text-small);
    color: var(--recap-forest-muted);
    font-variant-numeric: tabular-nums;
  }
  .scale-facts strong {
    color: var(--recap-forest-ink);
    font-weight: var(--weight-semibold);
  }
  .ruler {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid rgb(255 255 255 / 0.14);
  }
  .ruler-track {
    height: 6px;
    border-radius: var(--radius-pill);
    background: rgb(255 255 255 / 0.14);
    overflow: hidden;
  }
  .ruler-fill {
    height: 100%;
    border-radius: var(--radius-pill);
    background: linear-gradient(90deg, var(--recap-gold), #9ce4c3);
    transition: width 580ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .ruler-caption {
    margin-top: var(--space-2);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-caption);
    color: var(--recap-forest-muted);
    font-variant-numeric: tabular-nums;
  }
  .monolith-ledger {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-inline-start: clamp(0rem, 2.5vw, 2.25rem);
    border-inline-start: 1px solid rgb(255 255 255 / 0.16);
  }
  .ledger-grid {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4) var(--space-6);
    font-variant-numeric: tabular-nums;
  }
  .ledger-item {
    min-width: 0;
    padding-top: var(--space-3);
    border-top: 1px solid rgb(255 255 255 / 0.14);
  }
  .ledger-item dt {
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--recap-forest-muted);
    margin-bottom: var(--space-1);
  }
  .ledger-item dd {
    margin: 0;
    line-height: var(--line-height-heading);
    overflow-wrap: anywhere;
  }
  .ledger-item strong {
    font-size: var(--text-recap-ledger);
    line-height: var(--line-height-tight);
    font-weight: var(--weight-bold);
    color: var(--recap-forest-ink);
  }
  .ledger-item span {
    margin-inline-start: var(--space-1);
    font-size: var(--text-caption);
    color: var(--recap-forest-muted);
  }
  .coverage {
    margin-top: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: rgb(255 255 255 / 0.08);
    font-size: var(--text-caption);
    color: var(--recap-gold);
    font-variant-numeric: tabular-nums;
  }

  /* Chapter 02 container */
  .chapter-section {
    margin-top: var(--space-6);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    animation: recap-rise var(--motion-enter) both;
  }
  .fallback-heading {
    margin-bottom: var(--space-3);
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }

  @keyframes recap-rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .monolith,
    .chapter-section {
      animation: none;
    }
    .ruler-fill {
      transition: none;
    }
  }
  @media (max-width: 959px) {
    .monolith-grid {
      grid-template-columns: 1fr;
    }
    .monolith-ledger {
      padding-inline-start: 0;
      border-inline-start: 0;
      padding-top: var(--space-4);
      border-top: 1px solid rgb(255 255 255 / 0.16);
    }
  }
  @media (max-width: 639px) {
    .period-control {
      width: 100%;
    }
    .period-control .settings-tabs {
      width: 100%;
    }
    .period-control .button-primary {
      width: 100%;
    }
    .monolith {
      padding: var(--space-4);
    }
    .chapter-section {
      padding: var(--space-4);
    }
  }
  @media (forced-colors: active) {
    .monolith {
      background: Canvas;
      color: CanvasText;
      border-color: ButtonText;
    }
    .monolith-bg {
      display: none;
    }
    .giant-distance strong,
    .giant-unit,
    .ledger-item strong,
    .scale-facts strong,
    .coverage {
      color: CanvasText;
    }
    .kicker,
    .scale-facts,
    .ruler-caption,
    .ledger-item dt,
    .ledger-item span {
      color: GrayText;
    }
    .ruler-fill {
      forced-color-adjust: none;
      background: Highlight;
    }
  }
</style>
