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
  import RecapShare from '#lib/components/RecapShare.svelte';
  import {
    buildRecap,
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

  const timezone = $derived(page.data.user?.timezone ?? 'UTC');
  const localMonth = $derived(currentMonthValue(timezone));
  const selected = $derived(recapSelection(page.url.searchParams, localMonth));
  const monthValue = $derived(
    `${selected.year}-${String(selected.month ?? Number(localMonth.slice(5))).padStart(2, '0')}`,
  );
  const shown = $derived(report ?? selected);
  const metrics = $derived(report ? recapMetrics(report) : []);
  const coverage = $derived(report ? recapCoverage(report) : '');
  const maxMonth = $derived(serverToday?.slice(0, 7) ?? localMonth);
  const maxYear = $derived(Number(maxMonth.slice(0, 4)));
  const years = $derived(
    Array.from({ length: Math.max(maxYear, selected.year) - 1899 }, (_, i) => Math.max(maxYear, selected.year) - i),
  );
  const current = $derived(selected.period === 'year' ? selected.year === maxYear : monthValue === maxMonth);
  const previousDisabled = $derived(selected.period === 'year' ? selected.year <= 1900 : monthValue <= '1900-01');
  const nextDisabled = $derived(selected.period === 'year' ? selected.year >= maxYear : monthValue >= maxMonth);

  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
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
        break;
      }
    } catch (cause) {
      if (!active()) return;
      distribution = null;
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
  <header>
    <div>
      <h1>{recapTitle(shown)}</h1>
      {#if report}
        <p class="range">
          {formatReportRange(report)}
          {#if report.cutoff_date}<span>进行中 · 截至 {monthDay(report.cutoff_date)}</span>{/if}
        </p>
      {/if}
    </div>
    <div class="period-control">
      <div class="settings-tabs" role="group" aria-label="回顾周期">
        <button type="button" aria-pressed={selected.period === 'month'} onclick={() => switchPeriod('month')}
          >月度</button
        >
        <button type="button" aria-pressed={selected.period === 'year'} onclick={() => switchPeriod('year')}
          >年度</button
        >
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
      {#if !current}<button type="button" class="button-secondary" onclick={jumpToCurrent}
          >{selected.period === 'year' ? '回到今年' : '回到本月'}</button
        >{/if}
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
      <section class="overview" aria-labelledby="recap-total" data-testid="recap-overview">
        <div class="total">
          <h2 id="recap-total">总里程</h2>
          <p><strong>{km(Number(report.distance_m))}</strong> <span>km</span></p>
        </div>
        <dl class="metrics">
          {#each metrics as metric (metric.label)}
            <div>
              <dt>{metric.label}</dt>
              <dd>
                <strong>{metric.value}</strong> <span>{metric.unit}</span>{#if metric.value === '—'}<span
                    class="sr-only">（数据缺失）</span
                  >{/if}
              </dd>
            </div>
          {/each}
        </dl>
        {#if coverage}<p class="coverage">{coverage}</p>{/if}
      </section>
      <section class="distribution" aria-labelledby="recap-distribution">
        <div class="distribution-heading">
          <h2 id="recap-distribution">里程分布</h2>
          {#if distribution}<RecapShare recap={distribution} disabled={loading} />{/if}
        </div>
        {#if trendError}
          <FeedbackState kind="error" title={trendError}>
            <button class="button-secondary" type="button" onclick={() => load(selected)}>重试读取分布</button>
          </FeedbackState>
        {:else if distribution}
          <RecapDistribution recap={distribution} />
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .recap {
    max-width: 68.75rem;
    margin-inline: auto;
    min-width: 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    font-size: var(--text-small);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  h1 {
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .range,
  .refresh,
  .coverage {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .range {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .refresh {
    margin-bottom: var(--space-2);
  }
  .range span {
    font-weight: var(--weight-semibold);
  }
  .period-control,
  .picker,
  .distribution-heading {
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
  .text-field,
  .period-control .settings-tabs button {
    min-height: 2.75rem;
  }
  .step {
    width: 2.75rem;
    padding: 0;
    font-size: var(--text-section);
    flex: none;
  }
  .text-field {
    width: auto;
  }
  .overview {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-8);
    min-height: 12.5rem;
    background: var(--header-tint);
    color: var(--header-ink);
    border-radius: var(--radius-card);
  }
  .total p {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    column-gap: var(--space-2);
    color: var(--primary);
  }
  .total strong {
    font-size: var(--text-display);
    line-height: var(--line-height-tight);
    overflow-wrap: anywhere;
  }
  .total span {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    border-inline-start: 1px solid color-mix(in srgb, var(--header-ink) 24%, transparent);
    padding-inline-start: var(--space-8);
  }
  .metrics dt,
  .metrics span {
    font-size: var(--text-small);
  }
  .metrics dt,
  .coverage {
    color: var(--header-ink-muted);
  }
  .total p,
  .metrics dd,
  .range {
    font-variant-numeric: tabular-nums;
  }
  .metrics dd {
    overflow-wrap: anywhere;
    line-height: var(--line-height-heading);
  }
  .metrics strong {
    font-size: var(--text-stat);
  }
  .coverage {
    grid-column: 1 / -1;
  }
  .distribution {
    margin-top: var(--space-6);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
  }
  .distribution-heading {
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  @media (max-width: 639px) {
    .period-control {
      width: 100%;
    }
    .period-control .settings-tabs {
      width: 100%;
    }
    .overview {
      grid-template-columns: 1fr;
      gap: var(--space-4);
      padding: var(--space-5);
    }
    .metrics {
      padding-inline-start: 0;
      border-inline-start: 0;
    }
    .distribution {
      padding: var(--space-4);
    }
  }
</style>
