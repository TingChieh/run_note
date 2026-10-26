<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import PersonalBests from '#lib/components/PersonalBests.svelte';
  import RecordsChart from '#lib/components/RecordsChart.svelte';
  import { nullAfterCutoff, type ChartSpec } from '#lib/components/records-chart.ts';
  import { ActivityError, formatDistance, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { readRecords as scoped_readRecords, paceDelta, signedDistance, type Records } from '#lib/api/records.ts';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 2);

  let data = $state<Records | null>(null), loading = $state(true), message = $state('');
  let yearInput = $state(''), compareInput = $state(''), inputMessage = $state('');
  let disposed = false, token = 0;

  async function load(year?: number, compareYear?: number) {
    const mine = ++token; loading = true; message = ''; data = null;
    try {
      const result = await readRecords(year, compareYear);
      if (disposed || mine !== token) return;
      data = result; yearInput = String(result.year); compareInput = String(result.compare_year);
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; data = null; window.location.replace(`/admin?reason=expired&next=${encodeURIComponent(window.location.pathname)}`); return; }
      message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  function apply() {
    const year = Number(yearInput), compare = Number(compareInput);
    if (!/^\d{4}$/.test(yearInput) || !/^\d{4}$/.test(compareInput) || year < 1900 || year > 2100 || compare < 1900 || compare > 2100) { inputMessage = '请输入 1900–2100 年'; return; }
    if (year === compare) { inputMessage = '对比年份不能与年份相同'; return; }
    inputMessage = ''; void load(year, compare);
  }
  onMount(() => { void load(); return () => { disposed = true; }; });

  const km = (value: number) => `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} km`;
  const metres = (value: string | number | null) => value === null ? null : Number(value) / 1000;
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1} 月`);
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const cutoffMonth = (date: string) => { const month = Number(date.slice(5, 7)); return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12; };
  const empty = $derived(!!data && data.personal_bests.every(item => !item.best) && data.monthly.every(m => m.activity_count === 0) && data.compare_monthly.every(m => m.activity_count === 0) && data.weekly.every(w => w.active_days === 0));

  const monthlySpec = $derived<ChartSpec | null>(data && { labels: months, series: [{ name: `${data.year} 年`, type: 'bar', color: 'primary', data: data.monthly.map(m => metres(m.distance_m)) }], yName: '里程（km）', format: km, zeroBased: true });
  const paceSpec = $derived<ChartSpec | null>(data && { labels: months, series: [{ name: `${data.year} 年`, type: 'line', color: 'primary', data: data.monthly.map(m => m.avg_pace_seconds_per_km === null ? null : Number(m.avg_pace_seconds_per_km)) }], yName: '配速（越低越快）', format: value => formatPace(value), zeroBased: false });
  const weeklySpec = $derived<ChartSpec | null>(data && { labels: data.weekly.map(w => w.week_start.slice(5)), series: [{ name: '每周训练天数', type: 'bar', color: 'primary', data: data.weekly.map(w => w.active_days) }], yName: '训练天数', format: value => `${value} 天`, zeroBased: true });
  const weekdaySpec = $derived<ChartSpec | null>(data && { labels: weekdays, series: [{ name: `${data.year} 年`, type: 'bar', color: 'primary', data: data.weekday.map(d => d.activity_count) }], yName: '活动次数', format: value => `${value} 次`, zeroBased: true });
  const compareSpec = $derived<ChartSpec | null>(data && { labels: months, series: [
    { name: `${data.year} 年`, type: 'line', color: 'primary', data: nullAfterCutoff(data.monthly.map(m => metres(m.distance_m)), data.cutoff_date) },
    { name: `${data.compare_year} 年`, type: 'line', color: 'secondary', data: nullAfterCutoff(data.compare_monthly.map(m => metres(m.distance_m)), data.compare_cutoff_date) }
  ], yName: '月里程（km）', format: km, zeroBased: true });

  const monthRows = $derived(data ? data.monthly.map((m, i) => [months[i], String(m.activity_count), formatDistance(m.distance_m), formatPace(m.avg_pace_seconds_per_km)]) : []);
  const paceRows = $derived(data ? data.monthly.map((m, i) => [months[i], formatPace(m.avg_pace_seconds_per_km), String(m.activity_count)]) : []);
  const weekRows = $derived(data ? data.weekly.map(w => [w.week_start, `${w.active_days} 天`]) : []);
  const weekdayRows = $derived(data ? data.weekday.map(d => [weekdays[d.weekday], `${d.activity_count} 次`]) : []);
  const compareRows = $derived(data ? data.monthly.map((m, i) => [months[i], i + 1 > cutoffMonth(data!.cutoff_date) ? '—' : formatDistance(m.distance_m), i + 1 > cutoffMonth(data!.compare_cutoff_date) ? '—' : formatDistance(data!.compare_monthly[i].distance_m)]) : []);
</script>
<svelte:head><title>{pageTitle('个人记录', page.data.site)}</title></svelte:head>
<PageHeader title="个人记录" description="5K / 10K 最佳成绩、月度里程、配速进步、训练频率与同期对比。" />
<div class="records-page">
  <form class="year-form" onsubmit={event => { event.preventDefault(); apply(); }} aria-label="选择对比年份">
    <label class="block-field year-field">年份 <input class="text-field" type="number" min="1900" max="2100" inputmode="numeric" bind:value={yearInput} aria-describedby="records-year-message" /></label>
    <label class="block-field year-field">对比年份 <input class="text-field" type="number" min="1900" max="2100" inputmode="numeric" bind:value={compareInput} aria-describedby="records-year-message" /></label>
    <button class="button-secondary" type="submit" disabled={loading}>查看</button>
    <p id="records-year-message" class="year-message" class:is-empty={!inputMessage} role="status" data-testid="records-year-message">{inputMessage}</p>
  </form>
  {#if loading}<PageSkeleton />{/if}
  {#if message}<div data-testid="records-error"><FeedbackState kind="error" title={message}><button class="button-secondary" onclick={() => { void load(Number(yearInput) || undefined, Number(compareInput) || undefined); }}>重新读取</button></FeedbackState></div>{/if}
  {#if data && empty}
    <div data-testid="records-empty"><FeedbackState title="记录一次跑步，让纪录开始积累"><a href={view.href('/activities')} class="button-primary">查看跑步记录</a></FeedbackState></div>
  {:else if data && monthlySpec && paceSpec && weeklySpec && weekdaySpec && compareSpec}
    <div class="records-sections" data-testid="records-ready">
      <section aria-labelledby="bests-title"><h2 id="bests-title">最佳成绩</h2><PersonalBests bests={data.personal_bests} /></section>
      <section class="records-card" aria-labelledby="monthly-title"><h2 id="monthly-title">{data.year} 年月度里程</h2>
        <RecordsChart spec={monthlySpec} label="月度里程" columns={['月份', '次数', '里程', '可靠配速']} rows={monthRows} testid="records-chart-monthly" /></section>
      <section class="records-card" aria-labelledby="pace-title"><h2 id="pace-title">配速进步趋势</h2>
        <p class="hint">每月所有可靠跑步的平均配速，不区分距离；缺少可靠用时的月份留空。</p>
        <RecordsChart spec={paceSpec} label="月度配速" columns={['月份', '可靠配速', '活动次数']} rows={paceRows} testid="records-chart-pace" /></section>
      <section class="records-card" aria-labelledby="frequency-title"><h2 id="frequency-title">训练频率</h2>
        <h3>最近 26 周每周训练天数</h3>
        <RecordsChart spec={weeklySpec} label="每周训练天数" columns={['周起始（周一）', '训练天数']} rows={weekRows} testid="records-chart-weekly" />
        <h3>{data.year} 年周内分布</h3>
        <RecordsChart spec={weekdaySpec} label="周内分布" columns={['星期', '活动次数']} rows={weekdayRows} testid="records-chart-weekday" /></section>
      <section class="records-card" aria-labelledby="compare-title"><h2 id="compare-title">{data.year} 年 vs {data.compare_year} 年同期</h2>
        <p class="hint">统计截至 {data.cutoff_date}（对比年为 {data.compare_cutoff_date}）。</p>
        <dl class="compare-metrics">
          <div><dt>累计里程</dt><dd data-testid="records-compare-distance">{dashboardDistance(data.comparison.current.distance_m)}<small>{data.compare_year} 年 {dashboardDistance(data.comparison.previous.distance_m)} · {signedDistance(data.comparison.delta.distance_m)}</small></dd></div>
          <div><dt>活动次数</dt><dd data-testid="records-compare-count">{data.comparison.current.activity_count} 次<small>{data.compare_year} 年 {data.comparison.previous.activity_count} 次 · {data.comparison.delta.activity_count > 0 ? '+' : data.comparison.delta.activity_count < 0 ? '−' : ''}{Math.abs(data.comparison.delta.activity_count)} 次</small></dd></div>
          <div><dt>平均配速</dt><dd data-testid="records-compare-pace">{formatPace(data.comparison.current.avg_pace_seconds_per_km)}<small>{data.compare_year} 年 {formatPace(data.comparison.previous.avg_pace_seconds_per_km)} · {paceDelta(data.comparison.delta.avg_pace_seconds_per_km)}</small>{#if data.comparison.current.avg_pace_seconds_per_km === null || data.comparison.previous.avg_pace_seconds_per_km === null}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}</dd></div>
        </dl>
        <RecordsChart spec={compareSpec} label="月里程对比" columns={['月份', `${data.year} 年`, `${data.compare_year} 年`]} rows={compareRows} testid="records-chart-compare" /></section>
    </div>
  {/if}
</div>
<style>
  .records-page, .records-sections { display: grid; gap: var(--space-4); min-width: 0; }
  .records-card { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .records-card h3 { margin-top: var(--space-4); color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .hint { color: var(--muted-foreground); font-size: var(--text-small); }
  .year-form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
  .year-field { width: 7rem; }
  .year-form .text-field { width: 7rem; min-height: 2.75rem; }
  .year-message { flex-basis: 100%; color: var(--error); font-size: var(--text-small); }
  .year-message.is-empty { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); border: 0; background: transparent; white-space: nowrap; }
  .compare-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); margin: var(--space-4) 0; }
  .compare-metrics dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .compare-metrics dd { font-weight: var(--weight-semibold); }
  .compare-metrics small { display: block; color: var(--muted-foreground); font-weight: normal; }
  @media (max-width: 640px) { .compare-metrics { grid-template-columns: minmax(0, 1fr); } }
</style>
