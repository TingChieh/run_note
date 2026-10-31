<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import RecordsBanner from '#lib/components/RecordsBanner.svelte';
  import RecordsChart from '#lib/components/RecordsChart.svelte';
  import type { MonthlyMetric } from '#lib/components/records-chart.ts';
  import { ActivityError, formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { currentYear } from '#lib/api/statistics.ts';
  import { readRecords as scoped_readRecords, paceDelta, recordDate, signedDistance, type Records, type YearRow } from '#lib/api/records.ts';
  const view = useViewContext();
  const readRecords = view.bind(scoped_readRecords, 0);

  let data = $state<Records | null>(null), loading = $state(true), message = $state('');
  let metric = $state<MonthlyMetric>('distance');
  let disposed = false, token = 0;
  const year = $derived(currentYear(page.data.showcase?.timezone ?? 'UTC'));

  async function load() {
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readRecords();
      if (disposed || mine !== token) return;
      data = result;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; data = null; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return; }
      data = null; message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; token++; data = null; }; });

  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const empty = $derived(!!data && data.totals.activity_count === 0);
  const current = $derived(data?.yearly.find(row => row.is_partial) ?? null);

  /** Plain words first: this year's distance against the same period last year (both from the server). */
  const summary = $derived.by(() => {
    if (!data) return '';
    if (data.totals.activity_count === 0) return '还没有跑步记录。跑完第一次，这里会画出你的每个月、每一年。';
    if (!current || current.activity_count === 0) return '今年还没有跑步，出发吧。';
    const sentence = `今年已跑 ${dashboardDistance(current.distance_m)}`;
    if (!current.delta || current.delta_basis !== 'previous_year_same_period') return sentence;
    const delta = Number(current.delta.distance_m);
    if (!Number.isFinite(delta)) return sentence;
    return delta === 0 ? `${sentence}，和去年同期持平` : `${sentence}，比去年同期${delta > 0 ? '多' : '少'} ${dashboardDistance(Math.abs(delta))}`;
  });

  // Yearly review: latest year first; bar length is that year's distance against the longest year.
  const years = $derived(data ? [...data.yearly].reverse() : []);
  const longest = $derived(Math.max(0, ...years.map(row => Number(row.distance_m))));
  const share = (row: YearRow) => longest > 0 ? Number(row.distance_m) / longest : 0;
  const change = (row: YearRow) => !row.delta ? '' : `${row.delta_basis === 'previous_year_same_period' ? '较去年同期' : '较上一年'} ${signedDistance(row.delta.distance_m)}`;
  const direction = (row: YearRow) => !row.delta ? '' : Number(row.delta.distance_m) > 0 ? 'up' : Number(row.delta.distance_m) < 0 ? 'down' : 'flat';

  // Training rhythm: four levels of active days per week, and the weekday spread.
  const level = (days: number) => days === 0 ? 0 : days <= 2 ? 1 : days <= 4 ? 2 : 3;
  const weekWords = (start: string, days: number) => `${recordDate(start, year)}起的一周：${days ? `跑了 ${days} 天` : '没有跑步'}`;
  const weeksRun = $derived(data ? data.weekly.filter(week => week.active_days > 0).length : 0);
  const busiest = $derived(data ? Math.max(0, ...data.weekday.map(day => day.activity_count)) : 0);
  // Name the favourite weekday only when it stands out: one day, or two tied days; more ties say nothing.
  const favourite = $derived.by(() => {
    const top = data && busiest > 0 ? data.weekday.filter(day => day.activity_count === busiest) : [];
    return top.length >= 1 && top.length <= 2 ? top.map(day => weekdays[day.weekday]).join('、') : '';
  });
</script>

<svelte:head><title>{pageTitle('个人记录', page.data.site)}</title></svelte:head>
<PageHeader title="个人记录" description="全部历史的最佳成绩、每个月的里程与配速、逐年变化和训练规律。" />
<div class="records-page" data-testid={data ? (empty ? 'records-empty' : 'records-ready') : undefined}>
  {#if loading && !data}<PageSkeleton title="正在读取个人记录…" />{/if}
  {#if message}
    <div data-testid="records-error"><FeedbackState kind="error" title={message}><button type="button" class="button-secondary retry" onclick={() => { void load(); }} aria-label="重试读取个人记录">重试</button></FeedbackState></div>
  {/if}
  {#if data}
    <div class="lead">
      <RecordsBanner bests={data.personal_bests} totals={data.totals} variant="hero" {year} />
      <!-- Phrases stay whole so Chinese lines break after a comma, not mid-word. -->
      <p class="summary" data-testid="records-summary">{#each summary.split(/(?<=，|。)/) as phrase, i (i)}<span class="phrase">{phrase}</span>{/each}</p>
      {#if empty}<p><a class="button-secondary" href={view.href('/activities')}>查看跑步记录</a></p>{/if}
    </div>

    {#if !empty}
      <section class="records-card" aria-labelledby="monthly-title" data-testid="records-monthly">
        <div class="card-heading">
          <div><p class="eyebrow">每个月</p><h2 id="monthly-title">月度里程与配速</h2></div>
          <div class="settings-tabs metric-switch" role="group" aria-label="月度指标">
            <button type="button" aria-pressed={metric === 'distance'} onclick={() => { metric = 'distance'; }}>里程</button>
            <button type="button" aria-pressed={metric === 'pace'} onclick={() => { metric = 'pace'; }}>配速</button>
          </div>
        </div>
        <p class="hint">{metric === 'distance' ? '每根柱子是一个月的总里程，最深的是跑得最多的月份。' : '每月可靠跑步的平均配速，越高越快；缺少可靠用时的月份留空。'}</p>
        <RecordsChart monthly={data.monthly} {metric} />
      </section>

      <div class="records-pair"><div class="pair-grid">
        <section class="records-card" aria-labelledby="years-title" data-testid="records-years">
          <div class="card-heading"><div><p class="eyebrow">一年一年看</p><h2 id="years-title">逐年回顾</h2></div></div>
          <ol class="year-list">
            {#each years as row (row.year)}
              {@const words = change(row)}
              <li class="year-row" class:partial={row.is_partial} data-testid={`records-year-${row.year}`}>
                <span class="year">{row.year}</span>
                <span class="track" aria-hidden="true"><span class="fill" style:--share={share(row)}></span></span>
                <span class="km">{dashboardDistance(row.distance_m)}</span>
                {#if row.is_partial || words}
                  <p class="year-note">
                    {#if row.is_partial}<span class="tag">进行中</span>{/if}
                    {#if words}<span class="delta" data-direction={direction(row)}>{words}</span>{/if}
                  </p>
                {/if}
              </li>
            {/each}
          </ol>
          <details class="data-table">
            <summary>查看逐年数据</summary>
            <div class="table-scroll">
              <table>
                <caption class="sr-only">逐年次数、里程、活动天数、平均配速与变化</caption>
                <thead><tr><th scope="col">年份</th><th scope="col">次数</th><th scope="col">里程</th><th scope="col">活动天数</th><th scope="col">平均配速</th><th scope="col">变化</th></tr></thead>
                <tbody>
                  {#each years as row (row.year)}
                    <tr>
                      <th scope="row">{row.year}{row.is_partial ? '（进行中）' : ''}</th>
                      <td>{row.activity_count} 次</td>
                      <td>{dashboardDistance(row.distance_m)}</td>
                      <td>{row.activity_days} 天</td>
                      <td>{formatPace(row.avg_pace_seconds_per_km)}{#if row.avg_pace_seconds_per_km === null}<span class="sr-only">（无可靠配速）</span>{/if}</td>
                      <td>{#if row.delta}{change(row)} · 配速 {paceDelta(row.delta.avg_pace_seconds_per_km)}{#if row.delta.avg_pace_seconds_per_km === null}<span class="sr-only">（配速变化缺失：其中一年没有可靠配速）</span>{/if}{:else}—<span class="sr-only">（第一年，没有可比较的上一年）</span>{/if}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section class="records-card" aria-labelledby="rhythm-title" data-testid="records-rhythm">
          <div class="card-heading"><div><p class="eyebrow">跑得有多勤</p><h2 id="rhythm-title">训练规律</h2></div></div>
          <p class="hint">{weeksRun ? `最近 26 周里，有 ${weeksRun} 周出门跑过${favourite ? `；${favourite}跑得最多` : ''}。` : '最近 26 周还没有跑步。'}</p>
          <h3 class="sub">最近 26 周 · 每周跑步天数</h3>
          <ol class="weeks" aria-label="最近 26 周每周跑步天数">
            {#each data.weekly as week (week.week_start)}
              {@const words = weekWords(week.week_start, week.active_days)}
              <li><span class="dot" data-level={level(week.active_days)} role="img" title={words} aria-label={words} data-testid="records-week-dot"></span></li>
            {/each}
          </ol>
          <div class="weeks-foot">
            <span>{recordDate(data.weekly[0].week_start, year)}</span>
            <span class="legend" aria-hidden="true"><span class="dot" data-level="0"></span>0<span class="dot" data-level="1"></span>1–2<span class="dot" data-level="2"></span>3–4<span class="dot" data-level="3"></span>5+ 天</span>
            <span>本周</span>
          </div>
          <h3 class="sub">周内分布 · 全部历史</h3>
          <ol class="weekday-bars" aria-label="周一到周日的跑步次数">
            {#each data.weekday as day (day.weekday)}
              {@const peak = busiest > 0 && day.activity_count === busiest}
              <li class="weekday">
                <span class="count" aria-hidden="true">{day.activity_count}</span>
                <span class="column" aria-hidden="true"><span class="bar" class:peak style:--share={busiest > 0 ? day.activity_count / busiest : 0}></span></span>
                <span class="day" aria-hidden="true">{weekdays[day.weekday].slice(1)}</span>
                <span class="hit" role="img" title={`${weekdays[day.weekday]} 跑了 ${day.activity_count} 次`} aria-label={`${weekdays[day.weekday]} 跑了 ${day.activity_count} 次`} data-peak={peak ? 'true' : 'false'} data-testid="records-weekday-bar"></span>
              </li>
            {/each}
          </ol>
          <details class="data-table">
            <summary>查看训练规律数据</summary>
            <div class="table-scroll">
              <table>
                <caption class="sr-only">最近 26 周每周跑步天数</caption>
                <thead><tr><th scope="col">周起始（周一）</th><th scope="col">跑步天数</th></tr></thead>
                <tbody>{#each data.weekly as week (week.week_start)}<tr><th scope="row">{week.week_start}</th><td>{week.active_days} 天</td></tr>{/each}</tbody>
              </table>
              <table>
                <caption class="sr-only">周内分布：全部历史每个星期几的跑步次数</caption>
                <thead><tr><th scope="col">星期</th><th scope="col">跑步次数</th></tr></thead>
                <tbody>{#each data.weekday as day (day.weekday)}<tr><th scope="row">{weekdays[day.weekday]}</th><td>{day.activity_count} 次</td></tr>{/each}</tbody>
              </table>
            </div>
          </details>
        </section>
      </div></div>
    {/if}
  {/if}
</div>

<style>
  /* Flat cards, same as the dashboard: surface, hairline border, card radius; muted eyebrow + section title. */
  .records-page { display: grid; gap: var(--space-6); min-width: 0; margin-top: var(--space-6); }
  .lead { display: grid; gap: var(--space-4); min-width: 0; }
  .summary { color: var(--foreground); font-size: var(--text-body); line-height: var(--line-height-body); }
  .phrase { display: inline-block; }
  .retry { margin-top: var(--space-3); }
  .records-card { min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .card-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); }
  .eyebrow { margin-bottom: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint { margin-top: var(--space-2); color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .sub { margin-top: var(--space-6); color: var(--muted-foreground); font-size: var(--text-caption); font-weight: var(--weight-medium); }

  /* The header segmented control, placed on a surface card instead of the yellow page header. */
  .records-card .metric-switch { width: max-content; margin-top: 0; background: var(--muted); }
  .records-card .metric-switch > button { color: var(--muted-foreground); }
  .records-card .metric-switch > button[aria-pressed='true'] { color: var(--primary-foreground); }

  /* Side by side only when each card gets at least 28rem (by the row's own width, so the sidebar counts). */
  .records-pair { container-type: inline-size; min-width: 0; }
  .pair-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  @container (min-width: 57rem) { .pair-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  /* Yearly review: one row per year, bar length against the longest year. */
  .year-list { display: grid; gap: var(--space-4); margin-top: var(--space-6); }
  .year-row { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) auto; align-items: center; column-gap: var(--space-3); row-gap: var(--space-1); }
  .year { font-size: var(--text-small); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
  .track { display: block; height: .75rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--border) 45%, var(--surface)); }
  .fill { display: block; width: calc(var(--share) * 100%); min-width: 0; height: 100%; border-radius: inherit; background: var(--primary); transform-origin: left center; animation: grow 700ms cubic-bezier(.22, .61, .36, 1) both; }
  /* An unfinished year: same colour, lighter and striped. */
  .partial .fill { background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--primary) 70%, var(--surface)) 0 .3rem, color-mix(in srgb, var(--primary) 40%, var(--surface)) .3rem .6rem); }
  .km { min-width: 4.5rem; text-align: right; font-size: var(--text-small); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .year-note { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
  .tag { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--foreground); line-height: var(--line-height-heading); }
  .delta[data-direction='up'] { color: var(--primary); font-weight: var(--weight-semibold); }

  /* Training rhythm: one dot per week in four levels of the primary colour; 0 is an empty ring. */
  .weeks { display: grid; grid-template-columns: repeat(26, minmax(0, 1fr)); gap: var(--space-1); margin-top: var(--space-3); }
  .dot { display: block; aspect-ratio: 1; width: 100%; max-width: 1.25rem; border-radius: 50%; background: var(--primary); }
  .dot[data-level='0'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--border); }
  .dot[data-level='1'] { background: color-mix(in srgb, var(--primary) 38%, var(--surface)); }
  .dot[data-level='2'] { background: color-mix(in srgb, var(--primary) 68%, var(--surface)); }
  .weeks-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); color: var(--muted-foreground); font-size: var(--text-caption); }
  .legend { display: inline-flex; align-items: center; gap: var(--space-1); }
  .legend .dot { width: .625rem; margin-left: var(--space-1); }
  .weekday-bars { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-3); }
  .weekday { position: relative; display: grid; justify-items: center; gap: var(--space-1); }
  .count { color: var(--muted-foreground); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
  .column { display: flex; align-items: flex-end; width: 100%; max-width: 2.25rem; height: 4.5rem; }
  .bar { display: block; width: 100%; height: calc(var(--share) * 100%); min-height: 3px; border-radius: .375rem .375rem 2px 2px; background: color-mix(in srgb, var(--primary) 35%, var(--surface)); transform-origin: bottom; animation: rise 600ms cubic-bezier(.22, .61, .36, 1) both; }
  .bar.peak { background: var(--primary); }
  .day { color: var(--muted-foreground); font-size: var(--text-caption); }
  .hit { position: absolute; inset: 0; }
  @keyframes grow { from { transform: scaleX(0); } }
  @keyframes rise { from { transform: scaleY(0); } }
  @media (prefers-reduced-motion: reduce) { .fill, .bar { animation: none; } }

  /* Data tables under each chart. */
  .records-page :global(.data-table) { margin-top: var(--space-4); font-size: var(--text-small); }
  .records-page :global(.data-table summary) { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  /* position: relative keeps the sr-only notes inside wide tables from widening the page. */
  .records-page :global(.table-scroll) { position: relative; display: grid; gap: var(--space-4); max-height: 20rem; margin-top: var(--space-3); overflow: auto; }
  .records-page :global(.data-table table) { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
  .records-page :global(.data-table :is(th, td)) { padding: var(--space-1) var(--space-3) var(--space-1) 0; border-top: 1px solid var(--border); white-space: nowrap; }
  /* The last column (the change against the year before) may wrap, so the yearly table fits its card on a desktop instead of scrolling sideways by a few pixels. */
  .records-page :global(.data-table :is(th, td):last-child) { white-space: normal; }
  .records-page :global(.data-table thead th) { border-top: 0; color: var(--muted-foreground); font-weight: var(--weight-medium); }
  .records-page :global(.data-table tbody th) { font-weight: var(--weight-medium); }

  @media (max-width: 767px) {
    .records-card { padding: var(--space-4); }
    .records-page { gap: var(--space-4); }
  }
  @media (max-width: 639px) {
    .weeks { grid-template-columns: repeat(13, minmax(0, 1fr)); row-gap: var(--space-2); }
  }
</style>
