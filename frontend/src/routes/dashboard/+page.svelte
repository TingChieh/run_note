<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from "#lib/view-context.ts";
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
  import { replaceState } from '$app/navigation';
  import { dashboardQuery, dashboardSelection } from '#lib/api/dashboard-query.ts';
  import { ActivityError, readActivities as scoped_readActivities, formatDuration, activityDuration, formatPace, qualityLabel, type ActivityList } from '#lib/api/activities.ts';
  import { currentYear, readSummary as scoped_readSummary, readCalendar as scoped_readCalendar, readTrends as scoped_readTrends, type Summary, type Calendar, type Trends, type CalendarMetric } from '#lib/api/statistics.ts';
  import CalendarGrid from '#lib/components/CalendarGrid.svelte';
  import TrendChart from '#lib/components/TrendChart.svelte';
  import GoalOverview from '#lib/components/GoalOverview.svelte';
  import ProvinceMap from '#lib/components/ProvinceMap.svelte';
  import ActivityExplorer from '#lib/components/ActivityExplorer.svelte';
  let year = $state(2026), yearInput = $state('2026'), calendarMetric = $state<CalendarMetric>('distance'), period = $state<Trends['period']>('month'), trendMetric = $state<'distance' | 'count' | 'duration' | 'pace'>('distance');
  let annual = $state<Summary | null>(null), cumulative = $state<Summary | null>(null), calendar = $state<Calendar | null>(null), trends = $state<Trends | null>(null), records = $state<ActivityList | null>(null);
  let shownDate = $state<string | null>(null), selectedDate = $state<string | null>(null), loading = $state(true), dayLoading = $state(false), trendLoading = $state(false), message = $state(''), cumulativeMessage = $state(''), yearMessage = $state(''), dayMessage = $state(''), trendMessage = $state('');
  const motionMs = (ms: number) => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  // Animate the card height when the day's content changes size (switching days, paging).
  function smoothHeight(node: HTMLElement) {
    const inner = node.firstElementChild as HTMLElement;
    // border-box height must include the node's own padding, and use the fractional content height so the last card's border is never clipped.
    const fit = () => {
      const style = getComputedStyle(node);
      const padding = style.boxSizing === 'border-box' ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0;
      node.style.height = `${inner.getBoundingClientRect().height + padding}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(inner);
    return { destroy: () => observer.disconnect() };
  }
  let disposed = false, yearRequest = 0, dayRequest = 0, trendRequest = 0;
  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) { disposed = true; annual = null; cumulative = null; calendar = null; trends = null; records = null; selectedDate = null; yearRequest++; dayRequest++; trendRequest++; window.location.replace('/admin?reason=expired&next=%2Fdashboard'); return ''; }
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
  async function loadCumulative() { cumulativeMessage = ''; try { const data = await readSummary(); if (!disposed) cumulative = data; } catch (cause) { if (!disposed) cumulativeMessage = fail(cause); } }
  async function loadTrend() {
    const token = ++trendRequest; trendLoading = true; trends = null; trendMessage = '';
    try { const result = await readTrends(year, period); if (!disposed && token === trendRequest) trends = result; }
    catch (cause) { if (!disposed && (token === trendRequest || cause instanceof ActivityError && cause.status === 401)) trendMessage = fail(cause); }
    finally { if (!disposed && token === trendRequest) trendLoading = false; }
  }
  async function selectDay(date: string, offset = 0) {
    const token = ++dayRequest; if (!selectedDate) { records = null; shownDate = null; } selectedDate = date; saveSelection(); dayLoading = true; dayMessage = '';
    try { const result = await readActivities(fetch, offset, date); if (!disposed && token === dayRequest) { records = result; shownDate = date; } }
    catch (cause) { if (!disposed && (token === dayRequest || cause instanceof ActivityError && cause.status === 401)) { dayMessage = fail(cause); records = null; } }
    finally { if (!disposed && token === dayRequest) dayLoading = false; }
  }
  function setYear(next: number) {
    if (next < 1900 || next > 2100) return;
    yearMessage = ''; year = next; yearInput = String(next); selectedDate = null; saveSelection(); void loadYear();
  }
  function changeYear(value: string) { yearInput = value; const next = Number(value); if (!/^\d{4}$/.test(value) || next < 1900 || next > 2100) { yearMessage = '请输入 1900–2100 年'; return; } yearMessage = ''; if (next !== year) setYear(next); }
  let hasTrendActivities = $derived(trends?.buckets.some(bucket => bucket.activity_count > 0) ?? false);
  onMount(() => { const selection = dashboardSelection(new URL(window.location.href).searchParams, currentYear(page.data.showcase?.timezone ?? 'UTC')); year = selection.year; calendarMetric = selection.metric; period = selection.period; yearInput = String(year); selectedDate = selection.day; saveSelection(); void loadYear(selection.day); void loadCumulative(); return () => { disposed = true; yearRequest++; dayRequest++; trendRequest++; annual = null; cumulative = null; calendar = null; trends = null; records = null; }; });
</script>
<svelte:head><title>{pageTitle('数据汇总', page.data.site)}</title></svelte:head>
<PageHeader title="数据汇总" description="查看你的跑步数据，探索记录、足迹与运动分析。" />
<div class="dashboard">
  {#if cumulative}<p class="cumulative">累计 <strong>{dashboardDistance(cumulative.distance_m)}</strong><span>·</span>{cumulative.activity_count.toLocaleString('zh-CN')} 次活动<span>·</span>{cumulative.activity_days.toLocaleString('zh-CN')} 个活动日</p>{/if}
  {#if cumulativeMessage}<FeedbackState kind="error" title={cumulativeMessage}><button class="button-secondary" onclick={() => { void loadCumulative(); }}>重试累计统计</button></FeedbackState>{/if}
  {#if message}<FeedbackState kind="error" title={message}><button class="button-secondary" onclick={() => { void loadYear(selectedDate); }}>重新读取统计</button></FeedbackState>{/if}
  {#if annual}
    <dl class="annual-metrics content-reveal" aria-label={`${year} 年运动摘要`}>
      {#each [{label:'年度距离',value:dashboardDistance(annual.distance_m),id:'annual-distance'},{label:'运动次数',value:`${annual.activity_count.toLocaleString('zh-CN')} 次`,id:'annual-count'},{label:'活动天数',value:`${annual.activity_days.toLocaleString('zh-CN')} 天`,id:'annual-days'},{label:'可靠平均配速',value:formatPace(annual.avg_pace_seconds_per_km),id:'annual-pace'}] as card}
        <div><dt><span class="annual-icon" aria-hidden="true">{card.id === 'annual-distance' ? '↗' : card.id === 'annual-count' ? '#' : card.id === 'annual-days' ? '▦' : '◷'}</span>{card.label}</dt><dd data-testid={card.id}>{card.value}{#if card.value === '—'}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}</dd></div>
      {/each}
    </dl>
  {/if}
  <div class="milestone-section">
    <div class="milestone-layout">
      {#if page.data.showcase}<GoalOverview user={page.data.showcase} readonly={!view.manage} />{/if}
      <ProvinceMap />
    </div>
    <p class="goal-explanation">当前周期截至今天，同期按相同日历进度比较；连续记录按活动当地日期计算，今日/本周尚未结束时保留昨日/上周延续。</p>
  </div>
  <nav class="feature-entrances" aria-label="功能入口">
    {#each [
      { href: '/activities', title: '跑步记录', description: '查看跑步活动与完整路线', icon: '↗' },
      { href: '/footprints', title: '个人足迹', description: '探索跑过的路线与运动热力图', icon: '◎' },
      { href: '/activities/wall', title: '足迹墙', description: '每次跑步一张卡片，回顾全部足迹', icon: '▧' },
      { href: '/ai', title: 'AI 分析', description: '回顾运动数据，查看已有分析', icon: '✦' },
      { href: '/settings', title: '设置', description: '管理账号资料与公开个人主页', icon: '⚙' }
    ].filter(feature => feature.href !== '/settings' || view.manage) as feature}
      <a href={view.href(feature.href)} class="feature-entrance">
        <span class="feature-icon" aria-hidden="true">{feature.icon}</span>
        <span class="min-w-0"><strong>{feature.title}</strong><span class="feature-description">{feature.description}</span></span>
        <span class="feature-arrow" aria-hidden="true">→</span>
      </a>
    {/each}
  </nav>
  <ActivityExplorer />
  <section class="dashboard-card calendar-card" aria-labelledby="calendar-title" aria-busy={loading}>
    <div class="card-heading"><div><p class="eyebrow">每一天，都算数</p><h2 id="calendar-title">{year} 年运动日历</h2></div>
      <div class="year-controls">
        <button type="button" class="button-secondary year-arrow" aria-label="上一年" disabled={year <= 1900} onclick={() => setYear(year - 1)}>‹</button>
        <label class="sr-only" for="calendar-year">年份</label><input id="calendar-year" aria-describedby={yearMessage ? 'year-error' : undefined} aria-invalid={yearMessage ? true : undefined} type="text" inputmode="numeric" maxlength="4" value={yearInput} oninput={event => changeYear(event.currentTarget.value)} />
        <button type="button" class="button-secondary year-arrow" aria-label="下一年" disabled={year >= 2100} onclick={() => setYear(year + 1)}>›</button>
      </div>
    </div>
    {#if yearMessage}<p id="year-error" role="alert" class="mt-3 text-destructive">{yearMessage}</p>{/if}
    <div class="calendar-toolbar"><label>日历维度 <select aria-label="日历维度" bind:value={calendarMetric} onchange={saveSelection}><option value="distance">距离</option><option value="count">次数</option></select></label><p>选择日期查看记录<span class="keyboard-hint"> · 方向键移动</span></p></div>
    {#if loading}<PageSkeleton title={`正在读取 ${year} 年统计…`} />{:else if calendar}
      <div class="content-reveal"><CalendarGrid {calendar} metric={calendarMetric} selected={selectedDate} enhanced onselect={(date) => { void selectDay(date); }} /></div>
      {#if calendar.activity_count === 0}<div class="mt-4"><FeedbackState title="这一年还没有运动记录"><a href={view.href("/activities")}  class="text-primary underline">查看跑步记录</a>，也可以切换年份查看历史。</FeedbackState></div>{/if}
    {:else}<p class="mt-4 text-muted-foreground">日历未能加载，请重新读取统计。</p>{/if}
  {#if selectedDate}<div class="day-drawer" transition:slide={{ duration: motionMs(320), easing: cubicOut }}><section class="day-panel" aria-labelledby="day-title" aria-busy={dayLoading}>
    <div class="card-heading"><h2 id="day-title" class="day-title">{shownDate ?? selectedDate} 的活动{records ? `（${records.total}）` : ''}</h2><button class="button-secondary" onclick={() => { ++dayRequest; selectedDate = null; shownDate = null; records = null; dayLoading = false; dayMessage = ''; saveSelection(); }}>收起当天记录</button></div>
    <div class="day-height" use:smoothHeight><div>{#if dayLoading && !records}<FeedbackState kind="loading" title="正在读取当天活动…" />{:else if dayMessage}<FeedbackState kind="error" title={dayMessage}><button onclick={() => { void selectDay(selectedDate!); }} class="button-secondary">重试当天活动</button></FeedbackState>{:else if records}{#key records}<div class="day-fade" class:stale={dayLoading}>
      {#if records.items.length === 0}<FeedbackState title="当天没有活动记录">选择其他日期，或<a href={view.href("/activities")}  class="text-primary underline">查看跑步记录</a>。</FeedbackState>{:else}
        <ul class="space-y-3">{#each records.items as activity (activity.id)}<li><a href={view.href(`/activities/${activity.id}`)} class="day-activity"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">{activity.title || '未命名活动'}</h3><strong>{dashboardDistance(activity.distance_m)}</strong></div><p class="mt-2 text-sm text-muted-foreground">用时 {formatDuration(activityDuration(activity))} · 配速 {formatPace(activity.avg_pace_seconds_per_km)} · {qualityLabel(activity.temporal_quality)}</p></a></li>{/each}</ul>
      {/if}
      {#if records.total > 20}<div class="mt-4 flex flex-wrap items-center gap-3"><button disabled={records.offset === 0} onclick={() => { void selectDay(selectedDate!, Math.max(0, records!.offset - 20)); }} class="button-secondary">上一页</button><span class="text-sm">第 {Math.floor(records.offset / 20) + 1} 页</span><button disabled={records.offset + records.items.length >= records.total} onclick={() => { void selectDay(selectedDate!, records!.offset + 20); }} class="button-secondary">下一页</button></div>{/if}
    </div>{/key}{/if}</div></div>
  </section></div>{/if}
  </section>
  <section class="dashboard-card" aria-labelledby="trend-title" aria-busy={trendLoading}>
    <div class="card-heading"><h2 id="trend-title">运动趋势</h2><div class="trend-controls"><label>周期 <select aria-label="趋势周期" bind:value={period} onchange={() => { saveSelection(); void loadTrend(); }}><option value="week">周</option><option value="month">月</option></select></label><label>指标 <select aria-label="趋势指标" bind:value={trendMetric}><option value="distance">距离</option><option value="count">次数</option><option value="duration">已知耗时</option><option value="pace">可靠配速</option></select></label></div></div>
    <div class="mt-4">{#if trendLoading}<FeedbackState kind="loading" title="正在读取趋势…" />{:else if trendMessage}<FeedbackState kind="error" title={trendMessage}><button onclick={() => { void loadTrend(); }} class="button-secondary">重新读取趋势</button></FeedbackState>{:else if trends}
      {#if hasTrendActivities}<TrendChart {trends} metric={trendMetric} enhanced />{:else}<div data-testid="trend-empty"><FeedbackState title="记录一次跑步，让趋势开始生长"><a href={view.href("/activities")}  class="button-primary">查看跑步记录</a></FeedbackState></div>{/if}
    {/if}</div>
  </section>
  <details class="statistics-notes"><summary>统计口径与数据质量</summary><div class="notes-content">
    <p>仅统计你自己的活动。历史日期按活动保存时的当地日期归属，不随当前时区改变。</p>
    {#if annual}<p>年度已知耗时合计 {formatDuration(annual.duration_sum_seconds)}；已知 {annual.known_duration_count} 次，未知 {annual.missing_duration_count} 次。配速按 {annual.pace_eligible_count} 次可靠活动的总耗时 / 总距离计算，覆盖 {dashboardDistance(annual.pace_eligible_distance_m)}。含质量提示 {annual.quality_warning_count} 次。</p>{/if}
    {#if cumulative}<p>累计已知耗时 {formatDuration(cumulative.duration_sum_seconds)}（已知 {cumulative.known_duration_count} 次 / 未知 {cumulative.missing_duration_count} 次）；累计可靠配速 {formatPace(cumulative.avg_pace_seconds_per_km)}（有效 {cumulative.pace_eligible_count} 次，覆盖 {dashboardDistance(cumulative.pace_eligible_distance_m)}）；累计含质量提示 {cumulative.quality_warning_count} 次。</p>{/if}
    <p>日历按本年最大值分为四档；零距离活动用浅绿，灰色为无记录。自然周从周一开始；范围不足完整周期时标记“部分”。未知耗时与配速留空。距离显示保留最多一位小数，不改变统计计算精度。</p>
  </div></details>
</div>
<style>
  .milestone-section{display:grid;gap:var(--dashboard-card-gap);min-width:0;}
  .milestone-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--dashboard-card-gap);align-items:stretch;}
  .goal-explanation{font-size: var(--text-caption);line-height: var(--line-height-body);color:var(--muted-foreground);}
  @media(max-width:1199px){.milestone-layout{grid-template-columns:1fr;}}
  .feature-entrances { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-4); }
  .feature-entrance { display:flex; align-items:center; gap:.85rem; min-width:0; padding:1.1rem; border:1px solid var(--border); border-radius:var(--radius-card); background:var(--surface); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .feature-entrance strong { font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .feature-entrance:hover { border-color:var(--primary); background:var(--muted); }
  .feature-icon { display:grid; place-items:center; flex-shrink:0; width:2.5rem; height:2.5rem; border-radius:50%; background:var(--sport-green); color:var(--sport-ink); font-size: var(--text-section); }
  .feature-entrance:nth-child(2) .feature-icon { background:var(--sport-blue); }
  .feature-entrance:nth-child(3) .feature-icon { background:var(--sport-yellow-accent); }
  .feature-entrance:nth-child(4) .feature-icon { background:var(--sport-coral); }
  .feature-description { display:block; margin-top:.25rem; font-size: var(--text-caption); color:var(--muted-foreground); }
  .feature-arrow { margin-left:auto; color:var(--primary); }
  @media (max-width:639px) { .feature-entrances { grid-template-columns:1fr; } }
  .annual-icon { display:inline-grid; place-items:center; width:2.5rem; height:2.5rem; flex-shrink:0; margin-right:.65rem; border-radius:50%; font-size: var(--text-section); font-weight: var(--weight-bold); background:var(--sport-green); color:var(--sport-ink); }
  .annual-metrics > div:nth-child(2) .annual-icon { background:var(--sport-blue); }
  .annual-metrics > div:nth-child(3) .annual-icon { background:var(--sport-yellow-accent); }
  .annual-metrics > div:nth-child(4) .annual-icon { background:var(--sport-coral); }
  .annual-metrics dt { display:flex; align-items:center; }

  .button-primary { display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .55rem 1rem; border-radius: var(--radius-control); background: var(--primary); color: var(--primary-foreground); font-weight: var(--weight-semibold); font-size: var(--text-small); }
  .button-primary:hover { background: var(--primary-hover); color: var(--primary-foreground); }
  .dashboard { --dashboard-card-gap:var(--space-4); display: grid; gap: var(--space-6); margin-top: var(--space-6); min-width: 0; }
  .cumulative { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; font-size: var(--text-small); color: var(--muted-foreground); }
  .cumulative strong { color: var(--foreground); font-weight: var(--weight-semibold); }
  .annual-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--dashboard-card-gap); }
  .annual-metrics > div { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  dt { font-size: var(--text-small); color: var(--muted-foreground); }
  dd { margin-top: .75rem; font-size: var(--text-stat); line-height: var(--line-height-tight); font-weight: var(--weight-bold); letter-spacing: 0; font-variant-numeric: tabular-nums; }
  .annual-metrics > div:first-child dd { color: var(--primary); }
  .dashboard-card { min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-6); }
  .card-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .calendar-card h2 { font-size: var(--text-section); }
  .eyebrow { color: var(--muted-foreground); font-size: var(--text-caption); margin-bottom: .25rem; }
  .year-controls { display: flex; gap: .4rem; align-items: center; }
  .year-controls input { width: 4.5rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-control); padding: .5rem; font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
  .year-arrow { min-width: 2.5rem; font-size: var(--text-small); font-weight: var(--weight-semibold); padding: .3rem .6rem; }
  .calendar-toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; margin-top: var(--space-6); font-size: var(--text-small); }
  .calendar-toolbar p { color: var(--muted-foreground); align-self: center; }
  select { border: 1px solid var(--border); border-radius: var(--radius-control); padding: .45rem .5rem; margin-left: .3rem; background: var(--surface); }
  .trend-controls { display: flex; flex-wrap: wrap; gap: .75rem; font-size: var(--text-small); }
  .statistics-notes { border-top: 1px solid var(--border); padding-top: var(--space-4); color: var(--muted-foreground); font-size: var(--text-small); }
  summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .notes-content { display: grid; gap: .75rem; margin-top: 1rem; line-height: var(--line-height-body); }
  .day-drawer { overflow: hidden; }
  .day-panel { margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--border); }
  .day-title { font-size: var(--text-section); font-weight: var(--weight-semibold); }
  .day-activity { display: block; border: 1px solid var(--border); border-radius: var(--radius-control); padding: 1rem; }
  .day-activity { transition: border-color var(--transition-control), background-color var(--transition-control), transform var(--motion-hover); }
  .day-activity:hover { border-color: var(--primary); background: var(--muted); }
  @media (hover: hover) and (pointer: fine) { .day-activity:hover { transform: translateX(2px); } }
  .day-height { overflow: hidden; padding: 3px; margin: calc(var(--space-4) - 3px) -3px -3px; transition: height 280ms cubic-bezier(.22,.61,.36,1); }
  .day-fade { animation: day-fade 240ms ease-out both; transition: opacity 160ms ease; }
  .day-fade.stale { opacity: .55; }
  @keyframes day-fade { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .day-fade { animation: none; } }
  @media (max-width: 767px) { .dashboard { --dashboard-card-gap:.75rem; } .annual-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } .annual-metrics > div { padding: 1rem; } .dashboard-card { padding: 1rem; } dd { font-size: var(--text-stat); font-weight: var(--weight-bold);} .calendar-card { display: none; } .keyboard-hint { display: none; } }
  @media (max-width: 359px) { dd { font-size: var(--text-stat); font-weight: var(--weight-bold);} }
</style>
