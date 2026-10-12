<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { dashboardQuery, dashboardSelection } from '#lib/api/dashboard-query.ts';
  import { ActivityError, readActivities, formatDistance, formatDuration, formatPace, qualityLabel, type ActivityList } from '#lib/api/activities.ts';
  import { currentYear, readSummary, readCalendar, readTrends, type Summary, type Calendar, type Trends, type CalendarMetric } from '#lib/api/statistics.ts';
  import CalendarGrid from '#lib/components/CalendarGrid.svelte';
  import TrendChart from '#lib/components/TrendChart.svelte';
  let year = $state(2026), yearInput = $state('2026'), calendarMetric = $state<CalendarMetric>('distance'), period = $state<Trends['period']>('month'), trendMetric = $state<'distance' | 'count' | 'duration' | 'pace'>('distance');
  let annual = $state<Summary | null>(null), cumulative = $state<Summary | null>(null), calendar = $state<Calendar | null>(null), trends = $state<Trends | null>(null), records = $state<ActivityList | null>(null);
  let selectedDate = $state<string | null>(null), loading = $state(true), dayLoading = $state(false), trendLoading = $state(false), message = $state(''), dayMessage = $state(''), trendMessage = $state('');
  let disposed = false, yearRequest = 0, dayRequest = 0, trendRequest = 0;
  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) { disposed = true; annual = null; cumulative = null; calendar = null; trends = null; records = null; selectedDate = null; yearRequest++; dayRequest++; trendRequest++; window.location.replace('/login?reason=expired&next=%2Fdashboard'); return ''; }
    return cause instanceof Error ? cause.message : '读取失败，请稍后重试';
  }
  function saveSelection() {
    if (disposed) return;
    const url = new URL(window.location.href); url.search = dashboardQuery(url.searchParams, { year, metric: calendarMetric, period, day: selectedDate }).toString();
    replaceState(url, page.state);
  }
  async function loadYear(restoreDay: string | null = null) {
    const token = ++yearRequest, requestedYear = year; ++dayRequest; ++trendRequest;
    loading = true; annual = null; calendar = null; trends = null; records = null; selectedDate = null; message = ''; dayMessage = ''; trendMessage = '';
    // Observe every request rejection, including an expired session in a sibling request.
    const results = await Promise.allSettled([readSummary(requestedYear), readCalendar(requestedYear, calendarMetric)]);
    if (disposed) return;
    for (const result of results) if (result.status === 'rejected' && result.reason instanceof ActivityError && result.reason.status === 401) { fail(result.reason); return; }
    if (token !== yearRequest) return;
    if (results[0].status === 'fulfilled') annual = results[0].value; else message = fail(results[0].reason);
    if (results[1].status === 'fulfilled') calendar = results[1].value; else message = fail(results[1].reason);
    loading = false; void loadTrend();
    if (restoreDay && calendar && token === yearRequest) void selectDay(restoreDay);
  }
  async function loadCumulative() { try { const data = await readSummary(); if (!disposed) cumulative = data; } catch (cause) { if (!disposed) message = fail(cause); } }
  async function loadTrend() {
    const token = ++trendRequest; trendLoading = true; trends = null; trendMessage = '';
    try { const result = await readTrends(year, period); if (!disposed && token === trendRequest) trends = result; }
    catch (cause) { if (!disposed && (token === trendRequest || cause instanceof ActivityError && cause.status === 401)) trendMessage = fail(cause); }
    finally { if (!disposed && token === trendRequest) trendLoading = false; }
  }
  async function selectDay(date: string, offset = 0) {
    const token = ++dayRequest; selectedDate = date; saveSelection(); records = null; dayLoading = true; dayMessage = '';
    try { const result = await readActivities(fetch, offset, date); if (!disposed && token === dayRequest) records = result; }
    catch (cause) { if (!disposed && (token === dayRequest || cause instanceof ActivityError && cause.status === 401)) dayMessage = fail(cause); }
    finally { if (!disposed && token === dayRequest) dayLoading = false; }
  }
  function changeYear(event: SubmitEvent) { event.preventDefault(); const next = Number(yearInput); if (!/^\d{4}$/.test(yearInput) || !Number.isInteger(next) || next < 1900 || next > 2100) { message = '请输入 1900–2100 年'; return; } year = next; selectedDate = null; saveSelection(); void loadYear(); }
  onMount(() => { const selection = dashboardSelection(new URL(window.location.href).searchParams, currentYear(page.data.user?.timezone ?? 'UTC')); year = selection.year; calendarMetric = selection.metric; period = selection.period; yearInput = String(year); selectedDate = selection.day; saveSelection(); void loadYear(selection.day); void loadCumulative(); return () => { disposed = true; yearRequest++; dayRequest++; trendRequest++; annual = null; cumulative = null; calendar = null; trends = null; records = null; }; });
</script>
<svelte:head><title>运动统计 · Run Note</title></svelte:head>
<div class="flex flex-wrap items-end justify-between gap-4"><div><h1 class="text-3xl font-semibold">运动统计</h1><p class="mt-3 text-muted-foreground">回顾每一次跑步。仅统计你自己的活动。</p></div><a href="/activities" data-sveltekit-reload class="text-primary underline">导入与查看活动</a></div>
<form onsubmit={changeYear} class="mt-7 flex flex-wrap items-end gap-3"><label>年份<input aria-label="年份" type="number" min="1900" max="2100" step="1" required bind:value={yearInput} class="ml-3 w-28 rounded border border-border bg-white px-3 py-2" /></label><button class="rounded bg-primary px-4 py-2 text-white">查看年份</button><span class="text-sm text-muted-foreground">当前显示 {year} 年</span></form>
{#if message}<p role="alert" class="mt-4 text-red-700">{message}</p><button class="mt-2 text-primary underline" onclick={() => { void loadYear(selectedDate); void loadCumulative(); }}>重新读取统计</button>{/if}
{#if cumulative}<p class="mt-5 text-sm text-muted-foreground">累计：{cumulative.activity_count} 次活动 · {formatDistance(cumulative.distance_m)} · {cumulative.activity_days} 个活动日</p><p class="mt-2 text-sm leading-6 text-muted-foreground">累计已知耗时 {formatDuration(cumulative.duration_sum_seconds)}（已知 {cumulative.known_duration_count} 次 / 未知 {cumulative.missing_duration_count} 次）；累计可靠配速 {formatPace(cumulative.avg_pace_seconds_per_km)}（有效 {cumulative.pace_eligible_count} 次，覆盖 {formatDistance(cumulative.pace_eligible_distance_m)}）；累计含质量提示 {cumulative.quality_warning_count} 次。</p>{/if}
{#if loading}<p role="status" class="mt-6">正在读取 {year} 年统计…</p>{/if}
{#if annual}
  <div class="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">{#each [{label:'本年距离',value:formatDistance(annual.distance_m)},{label:'活动次数',value:`${annual.activity_count} 次`},{label:'活动天数',value:`${annual.activity_days} 天`},{label:'可靠平均配速',value:formatPace(annual.avg_pace_seconds_per_km)}] as card}<div class="rounded-xl border border-border bg-white p-5"><p class="text-sm text-muted-foreground">{card.label}</p><p class="mt-3 text-xl font-semibold">{card.value}</p></div>{/each}</div>
  <p class="mt-4 text-sm leading-6 text-muted-foreground">已知耗时合计 {formatDuration(annual.duration_sum_seconds)}；已知 {annual.known_duration_count} 次，未知 {annual.missing_duration_count} 次。配速按 {annual.pace_eligible_count} 次可靠活动的总耗时 / 总距离计算，覆盖 {formatDistance(annual.pace_eligible_distance_m)}。含质量提示 {annual.quality_warning_count} 次。</p>
{/if}
<section class="mt-8 rounded-xl border border-border bg-white p-5" aria-labelledby="calendar-title"><div class="flex flex-wrap items-center justify-between gap-3"><h2 id="calendar-title" class="text-xl font-semibold">{year} 年运动日历</h2><label class="text-sm">日历维度 <select aria-label="日历维度" bind:value={calendarMetric} onchange={saveSelection} class="ml-2 rounded border border-border px-2 py-1"><option value="distance">距离</option><option value="count">次数</option></select></label></div>{#if calendar}<CalendarGrid {calendar} metric={calendarMetric} selected={selectedDate} onselect={(date) => { void selectDay(date); }} />{#if calendar.activity_count === 0}<p class="mt-4 text-muted-foreground">这一年没有活动。可以点击日期查看，或先导入 GPX。</p>{/if}{/if}</section>
{#if selectedDate}<section class="mt-7" aria-labelledby="day-title"><h2 id="day-title" class="text-xl font-semibold">{selectedDate} 的活动{records ? `（${records.total}）` : ''}</h2>{#if dayLoading}<p role="status" class="mt-4">正在读取当天活动…</p>{:else if dayMessage}<p role="alert" class="mt-4 text-red-700">{dayMessage}</p><button onclick={() => { void selectDay(selectedDate!); }} class="mt-2 text-primary underline">重试当天活动</button>{:else if records}{#if records.items.length === 0}<p class="mt-4 text-muted-foreground">当天没有活动记录。</p>{:else}<ul class="mt-4 space-y-3">{#each records.items as activity (activity.id)}<li><a href={`/activities/${activity.id}`} data-sveltekit-reload class="block rounded-xl border border-border bg-white p-4 hover:border-primary"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">{activity.title || '未命名活动'}</h3><span>{formatDistance(activity.distance_m)}</span></div><p class="mt-2 text-sm text-muted-foreground">用时 {formatDuration(activity.elapsed_seconds)} · 配速 {formatPace(activity.avg_pace_seconds_per_km)} · {qualityLabel(activity.temporal_quality)}</p></a></li>{/each}</ul>{/if}<div class="mt-4 flex items-center gap-4"><button disabled={records.offset === 0} onclick={() => { void selectDay(selectedDate!, Math.max(0, records!.offset - 20)); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">上一页</button><span class="text-sm">第 {Math.floor(records.offset / 20) + 1} 页</span><button disabled={records.offset + records.items.length >= records.total} onclick={() => { void selectDay(selectedDate!, records!.offset + 20); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">下一页</button></div>{/if}</section>{/if}
<section class="mt-8 rounded-xl border border-border bg-white p-5" aria-labelledby="trend-title"><div class="flex flex-wrap items-center justify-between gap-3"><h2 id="trend-title" class="text-xl font-semibold">本年趋势</h2><div class="flex flex-wrap gap-3"><label class="text-sm">周期 <select aria-label="趋势周期" bind:value={period} onchange={() => { saveSelection(); void loadTrend(); }} class="rounded border border-border px-2 py-1"><option value="week">周</option><option value="month">月</option></select></label><label class="text-sm">指标 <select aria-label="趋势指标" bind:value={trendMetric} class="rounded border border-border px-2 py-1"><option value="distance">距离</option><option value="count">次数</option><option value="duration">已知耗时</option><option value="pace">可靠配速</option></select></label></div></div><p class="mt-3 text-sm text-muted-foreground">自然周从周一开始；范围不足完整周期时标记“部分”。未知耗时与配速留空。</p>{#if trendLoading}<p role="status" class="mt-4">正在读取趋势…</p>{:else if trendMessage}<p role="alert" class="mt-4 text-red-700">{trendMessage}</p><button onclick={() => { void loadTrend(); }} class="mt-2 text-primary underline">重新读取趋势</button>{:else if trends}<TrendChart {trends} metric={trendMetric} />{/if}</section>
