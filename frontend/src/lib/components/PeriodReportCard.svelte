<script lang="ts">
  import { onMount } from 'svelte';
  import DatePicker from '#lib/components/DatePicker.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { ActivityError, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { currentYear } from '#lib/api/statistics.ts';
  import { recapHref } from '#lib/recap.ts';
  import { storyHref } from '#lib/story.ts';
  import {
    currentMonthValue,
    formatPeriodTitle,
    formatReportRange,
    shiftMonthValue,
    type PeriodReport,
    type ReportPeriod,
  } from '#lib/api/period-report.ts';

  let {
    timezone = 'UTC',
    readReport,
    onauthrequired,
  }: {
    timezone?: string;
    readReport: (period: ReportPeriod, year: number, month?: number) => Promise<PeriodReport>;
    onauthrequired: () => void;
  } = $props();

  const uid = $props.id();
  let period = $state<ReportPeriod>('month');
  let monthValue = $state('2026-01');
  let yearValue = $state(2026);
  let serverToday = $state<string | null>(null);
  let report = $state<PeriodReport | null>(null);
  let loading = $state(true);
  let error = $state('');
  let disposed = false;
  let requestToken = 0;

  const fallbackMonth = $derived(currentMonthValue(timezone));
  const fallbackYear = $derived(currentYear(timezone));
  const maxMonth = $derived(serverToday ? serverToday.slice(0, 7) : fallbackMonth);
  const maxYear = $derived(serverToday ? Number(serverToday.slice(0, 4)) : fallbackYear);
  const years = $derived(Array.from({ length: maxYear - 1900 + 1 }, (_, i) => maxYear - i));

  const selectedYear = $derived(period === 'month' ? Number(monthValue.slice(0, 4)) : yearValue);
  const selectedMonth = $derived(period === 'month' ? Number(monthValue.slice(5, 7)) : null);
  const requestedTitle = $derived(formatPeriodTitle(period, selectedYear, selectedMonth));
  // Every displayed heading, range, aria-label and empty title stays bound to the loaded report so
  // in-flight period switches never label previous-period metrics with the newly selected period.
  const shownTitle = $derived(report ? formatPeriodTitle(report.period, report.year, report.month) : '');
  const isCurrentSelection = $derived(period === 'month' ? monthValue === maxMonth : yearValue === maxYear);
  const rangeText = $derived(report ? formatReportRange(report) : '');

  const footnote = $derived.by(() => {
    if (!report || report.activity_count === 0) return '';
    const parts = [`共 ${report.activity_days.toLocaleString('zh-CN')} 个活动日`];
    if (report.missing_duration_count > 0) {
      parts.push(`其中 ${report.missing_duration_count} 次缺少有效用时，总用时与平均配速仅统计有效记录`);
    } else if (report.pace_eligible_count < report.activity_count) {
      parts.push(`平均配速仅按有效距离与用时加权计算（${report.pace_eligible_count}/${report.activity_count} 次）`);
    }
    if (report.is_partial && report.cutoff_date) {
      parts.push(`当前周期截至 ${report.cutoff_date}（不含之后日期）`);
    }
    return parts.join(' · ');
  });

  const emptyNote = $derived.by(() => {
    if (!report) return '';
    if (report.date_from === report.date_to) return `该周期尚未开始（当前日期 ${report.today}）。`;
    if (report.is_partial && report.cutoff_date) return `截至 ${report.cutoff_date} 还没有跑步记录。`;
    return `统计范围 ${rangeText} 内暂无跑步记录。`;
  });

  async function load(nextPeriod: ReportPeriod, nextYear: number, nextMonth?: number) {
    const mine = ++requestToken;
    loading = true;
    error = '';
    try {
      const result = await readReport(nextPeriod, nextYear, nextMonth);
      if (disposed || mine !== requestToken) return;
      report = result;
      serverToday = result.today;
    } catch (cause) {
      if (disposed || mine !== requestToken) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        disposed = true;
        requestToken++;
        report = null;
        onauthrequired();
        return;
      }
      report = null;
      error = cause instanceof Error ? cause.message : '报告读取失败，请稍后重试';
    } finally {
      if (!disposed && mine === requestToken) loading = false;
    }
  }

  function loadCurrent() {
    if (period === 'month') {
      const [y, m] = monthValue.split('-').map(Number);
      void load('month', y, m);
    } else {
      void load('year', yearValue);
    }
  }

  function switchPeriod(next: ReportPeriod) {
    if (period === next) return;
    period = next;
    if (next === 'year') {
      yearValue = Math.min(maxYear, Math.max(1900, Number(monthValue.slice(0, 4))));
    } else if (Number(monthValue.slice(0, 4)) !== yearValue) {
      const candidate = `${yearValue}-${monthValue.slice(5, 7)}`;
      monthValue = candidate > maxMonth ? maxMonth : candidate;
    }
    loadCurrent();
  }

  function selectMonth(value: string) {
    if (!/^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) {
      monthValue = maxMonth;
    } else {
      monthValue = value > maxMonth ? maxMonth : value;
    }
    yearValue = Number(monthValue.slice(0, 4));
    loadCurrent();
  }

  function stepMonth(delta: number) {
    const next = shiftMonthValue(monthValue, delta);
    if (next > maxMonth || next === monthValue) return;
    monthValue = next;
    yearValue = Number(next.slice(0, 4));
    loadCurrent();
  }

  function selectYear(value: number) {
    const clamped = Math.min(maxYear, Math.max(1900, value));
    if (
      clamped === yearValue &&
      period === 'year' &&
      !loading &&
      report &&
      report.period === 'year' &&
      report.year === clamped
    ) {
      return;
    }
    yearValue = clamped;
    loadCurrent();
  }

  function jumpToCurrent() {
    if (period === 'month') {
      monthValue = maxMonth;
      yearValue = maxYear;
    } else {
      yearValue = maxYear;
    }
    loadCurrent();
  }

  onMount(() => {
    monthValue = currentMonthValue(timezone);
    yearValue = currentYear(timezone);
    loadCurrent();
    return () => {
      disposed = true;
      requestToken++;
      report = null;
    };
  });
</script>

<section
  class="section-rule report-section"
  aria-labelledby={`${uid}-title`}
  aria-busy={loading}
  data-testid="period-report"
  data-loading={loading ? 'true' : 'false'}
>
  <div class="section-head report-head">
    <div>
      <p class="eyebrow">按月或按年</p>
      <h2 id={`${uid}-title`}>月度与年度报告</h2>
    </div>
    <div class="underline-tabs period-switch" role="group" aria-label="报告周期" data-testid="period-report-mode">
      <button
        type="button"
        aria-pressed={period === 'month'}
        onclick={() => {
          switchPeriod('month');
        }}>月度</button
      >
      <button
        type="button"
        aria-pressed={period === 'year'}
        onclick={() => {
          switchPeriod('year');
        }}>年度</button
      >
    </div>
  </div>

  <div class="report-toolbar">
    <div class="picker-group">
      {#if period === 'month'}
        <button
          type="button"
          class="button-secondary step-button"
          aria-label="上一个月"
          disabled={monthValue <= '1900-01'}
          onclick={() => {
            stepMonth(-1);
          }}>‹</button
        >
        <div class="month-picker">
          <DatePicker
            label="选择月份"
            granularity="month"
            min="1900-01"
            max={maxMonth}
            {timezone}
            bind:value={monthValue}
            onselect={selectMonth}
          />
        </div>
        <button
          type="button"
          class="button-secondary step-button"
          aria-label="下一个月"
          disabled={monthValue >= maxMonth}
          onclick={() => {
            stepMonth(1);
          }}>›</button
        >
      {:else}
        <button
          type="button"
          class="button-secondary step-button"
          aria-label="上一年"
          disabled={yearValue <= 1900}
          onclick={() => {
            selectYear(yearValue - 1);
          }}>‹</button
        >
        <div class="year-picker">
          <label for={`${uid}-year`}>选择年份</label>
          <select
            id={`${uid}-year`}
            class="text-field year-select"
            aria-label="选择年份"
            value={yearValue}
            onchange={(event) => {
              selectYear(Number(event.currentTarget.value));
            }}
          >
            {#each years as y (y)}<option value={y}>{y} 年</option>{/each}
          </select>
        </div>
        <button
          type="button"
          class="button-secondary step-button"
          aria-label="下一年"
          disabled={yearValue >= maxYear}
          onclick={() => {
            selectYear(yearValue + 1);
          }}>›</button
        >
      {/if}
      {#if !isCurrentSelection}
        <button type="button" class="button-secondary button-compact current-jump" onclick={jumpToCurrent}>
          {period === 'month' ? '回到本月' : '回到今年'}
        </button>
      {/if}
    </div>

    <p class="report-meta" data-testid="period-report-range">
      {#if report}
        <strong class="period-name">{shownTitle}</strong>
        {#if report.is_partial}<span class="tag" data-testid="period-report-partial">进行中</span>{/if}
        <span class="range-text">{rangeText}</span>
        {#if loading}
          <span class="tag loading-tag" role="status" data-testid="period-report-refreshing">
            正在读取 {requestedTitle}…
          </span>
        {/if}
        <a class="button-secondary button-compact current-jump" href={recapHref(report)}>查看跑步回顾</a>
        {#if report.period === 'year'}
          <a class="button-secondary button-compact current-jump" href={storyHref(report.year)}>查看年度故事</a>
        {/if}
      {:else if loading}
        <strong class="period-name">{requestedTitle}</strong>
        <span class="range-text">正在读取…</span>
      {:else}
        <strong class="period-name">{requestedTitle}</strong>
      {/if}
    </p>
  </div>

  {#if loading && !report}
    <div class="report-state" data-testid="period-report-loading">
      <FeedbackState kind="loading" title={`正在读取 ${requestedTitle} 报告…`} />
    </div>
  {:else if error}
    <div class="report-state" data-testid="period-report-error">
      <FeedbackState kind="error" title={error}>
        <button
          type="button"
          class="button-secondary retry"
          onclick={() => {
            loadCurrent();
          }}
          aria-label="重试读取周期报告">重试</button
        >
      </FeedbackState>
    </div>
  {:else if report}
    {#if report.activity_count === 0}
      <div class="report-state" data-testid="period-report-empty">
        <FeedbackState kind="empty" title={`${shownTitle}没有跑步记录`}>
          <p class="empty-note">{emptyNote}</p>
        </FeedbackState>
      </div>
    {:else}
      <div class="report-body" data-testid="period-report-ready">
        <dl class="report-metrics" aria-label={`${shownTitle}跑步报告核心指标`} data-testid="period-report-metrics">
          <div class="metric-cell">
            <dt>跑步次数</dt>
            <dd data-testid="period-report-count">{report.activity_count.toLocaleString('zh-CN')} 次</dd>
          </div>
          <div class="metric-cell">
            <dt>总里程</dt>
            <dd class="accent" data-testid="period-report-distance">{dashboardDistance(report.distance_m)}</dd>
          </div>
          <div class="metric-cell">
            <dt>总用时</dt>
            <dd data-testid="period-report-duration">
              {formatDuration(report.duration_sum_seconds)}{#if report.duration_sum_seconds === null}<span
                  class="sr-only">（缺失或无法可靠计算）</span
                >{/if}
            </dd>
          </div>
          <div class="metric-cell">
            <dt>平均配速</dt>
            <dd data-testid="period-report-pace">
              {formatPace(report.avg_pace_seconds_per_km)}{#if report.avg_pace_seconds_per_km === null}<span
                  class="sr-only">（缺失或无法可靠计算）</span
                >{/if}
            </dd>
          </div>
        </dl>
        {#if footnote}
          <p class="report-footnote" data-testid="period-report-footnote">{footnote}</p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .report-section {
    container-type: inline-size;
    min-width: 0;
  }
  .report-head {
    align-items: flex-end;
  }
  .eyebrow {
    margin-bottom: var(--space-1);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
  }
  .period-switch {
    width: max-content;
  }

  .report-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .picker-group {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }
  .month-picker,
  .year-picker {
    min-width: 0;
  }
  .year-picker {
    display: grid;
    gap: 0.35rem;
    font-size: var(--text-small);
  }
  .year-select {
    min-width: 8.5rem;
    min-height: 2.75rem;
    font-variant-numeric: tabular-nums;
  }
  .step-button {
    width: 2.75rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    font-size: var(--text-section);
    line-height: var(--line-height-solid);
  }
  .current-jump {
    min-height: 2.75rem;
  }
  .report-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .period-name {
    color: var(--foreground);
    font-family: var(--font-body);
    font-weight: var(--weight-semibold);
  }
  .tag {
    padding: 0.125rem var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--line-height-heading);
  }
  .loading-tag {
    border-color: var(--primary);
    color: var(--primary);
  }

  .report-state {
    margin-top: var(--space-4);
  }
  .empty-note {
    margin-top: var(--space-2);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .retry {
    margin-top: var(--space-3);
  }

  .report-body {
    margin-top: var(--space-6);
  }

  .report-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .metric-cell {
    min-width: 0;
    padding-inline: var(--space-6);
  }
  .metric-cell:first-child {
    padding-left: 0;
  }
  .metric-cell:last-child {
    padding-right: 0;
  }
  .metric-cell + .metric-cell {
    border-left: 1px solid var(--border);
  }
  .metric-cell dt {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .metric-cell dd {
    margin-top: var(--space-2);
    color: var(--foreground);
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .metric-cell dd.accent {
    color: var(--primary);
  }
  .report-footnote {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    font-variant-numeric: tabular-nums;
  }

  @container (max-width: 52rem) {
    .report-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--space-6);
    }
    .metric-cell {
      padding-inline: var(--space-4);
    }
    .metric-cell:nth-child(odd) {
      padding-left: 0;
      border-left: 0;
    }
    .metric-cell:nth-child(even) {
      padding-right: 0;
    }
    .metric-cell:nth-child(n + 3) {
      padding-top: var(--space-4);
      border-top: 1px solid var(--border);
    }
  }
  @container (max-width: 30rem) {
    .report-metrics {
      grid-template-columns: 1fr;
      row-gap: 0;
    }
    .metric-cell,
    .metric-cell:nth-child(odd),
    .metric-cell:nth-child(even) {
      padding-inline: 0;
      border-left: 0;
    }
    .metric-cell + .metric-cell {
      padding-top: var(--space-4);
      margin-top: var(--space-4);
      border-top: 1px solid var(--border);
    }
    .picker-group {
      width: 100%;
    }
    .month-picker,
    .year-picker {
      flex: 1 1 10rem;
    }
    .year-select {
      width: 100%;
    }
  }
</style>
