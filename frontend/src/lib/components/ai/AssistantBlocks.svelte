<script lang="ts">
  import { onDestroy } from 'svelte';
  import { useViewContext } from '#lib/view-context.ts';
  import {
    ActivityError,
    formatDistance,
    formatDuration,
    formatPace,
    qualityLabel,
    readActivity as scoped_readActivity,
    readRoute as scoped_readRoute,
    type Activity,
    type Metric,
    type Route,
  } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { UUID_PATTERN, type UIBlock } from '#lib/api/ai-assistant.ts';
  import type { Trends, TrendBucket } from '#lib/api/statistics.ts';
  import type { MonthPoint } from '#lib/api/records.ts';
  import type { TrendMetric } from '../trend-chart';
  import type { MonthlyMetric } from '../records-chart';
  import MetricSummary from '../MetricSummary.svelte';
  import TrendChart from '../TrendChart.svelte';
  import RecordsChart from '../RecordsChart.svelte';
  import ActivityCard from '../ActivityCard.svelte';
  import RouteMap from '../RouteMap.svelte';
  import ProvinceMap from '../ProvinceMap.svelte';
  import FeedbackState from '../FeedbackState.svelte';

  const view = useViewContext();
  const readActivity = view.bind(scoped_readActivity, 1);
  const readRoute = view.bind(scoped_readRoute, 1);

  let { blocks, onauthrequired }: { blocks: UIBlock[]; onauthrequired?: () => void } = $props();

  let disposed = false;
  onDestroy(() => {
    disposed = true;
  });

  // Per-block chart metric selections keyed by block index.
  let trendMetrics = $state<Record<number, TrendMetric>>({});
  let recordsMetrics = $state<Record<number, MonthlyMetric>>({});
  let openFootprintMaps = $state<Record<number, boolean>>({});

  // Local owner-scoped activity backfill cache (D3: titles/tags stay local and never go to the model).
  let localActivities = $state<Record<string, Activity | 'loading' | 'failed'>>({});
  // On-demand local route preview cache (coordinates stay strictly browser <-> backend, never via AI).
  let routeStates = $state<Record<string, { open: boolean; loading: boolean; route: Route | null; error: string }>>({});

  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const metricVal = (v: unknown): Metric => (typeof v === 'number' || typeof v === 'string' ? v : null);
  const safeId = (v: unknown): string | null => (typeof v === 'string' && UUID_PATTERN.test(v) ? v : null);

  function formatHr(v: unknown): string {
    const n = num(v);
    return n === null ? '—' : `${n.toFixed(1)} bpm`;
  }

  function formatSignedPct(v: unknown): string {
    const n = num(v);
    if (n === null) return '无法比较';
    return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
  }

  function formatSignedDistance(meters: unknown): string {
    const n = num(meters);
    if (n === null) return '—';
    const km = n / 1000;
    const sign = km > 0 ? '+' : km < 0 ? '−' : '';
    return `${sign}${Math.abs(km).toFixed(2)} km`;
  }

  function formatSignedPace(seconds: unknown): string {
    const n = num(seconds);
    if (n === null) return '—';
    const rounded = Math.round(n);
    if (rounded === 0) return '持平';
    return rounded < 0 ? `快 ${Math.abs(rounded)} 秒/km` : `慢 ${rounded} 秒/km`;
  }

  function formatSignedCount(diff: unknown, unit: string): string {
    const n = num(diff);
    if (n === null) return '—';
    if (n === 0) return `0 ${unit}`;
    return `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`;
  }

  // Collect activity IDs referenced in activity_list / activity_detail_card to backfill local titles & tags.
  $effect(() => {
    const needed = new Set<string>();
    for (const block of blocks) {
      if (block.type === 'activity_list' && Array.isArray(block.data.items)) {
        for (const item of block.data.items) {
          if (isObj(item)) {
            const id = safeId(item.activity_id);
            if (id) needed.add(id);
          }
        }
      } else if (block.type === 'activity_detail_card') {
        const id = safeId(block.data.activity_id);
        if (id) needed.add(id);
      }
    }
    for (const id of needed) {
      if (localActivities[id]) continue;
      localActivities = { ...localActivities, [id]: 'loading' };
      void readActivity(id)
        .then((activity) => {
          if (disposed) return;
          localActivities = { ...localActivities, [id]: activity };
        })
        .catch((cause) => {
          if (disposed) return;
          if (cause instanceof ActivityError && cause.status === 401) {
            onauthrequired?.();
            return;
          }
          localActivities = { ...localActivities, [id]: 'failed' };
        });
    }
  });

  async function toggleRoutePreview(activityId: string) {
    const existing = routeStates[activityId];
    if (existing?.open) {
      routeStates = { ...routeStates, [activityId]: { ...existing, open: false } };
      return;
    }
    if (existing?.route) {
      routeStates = { ...routeStates, [activityId]: { ...existing, open: true } };
      return;
    }
    routeStates = { ...routeStates, [activityId]: { open: true, loading: true, route: null, error: '' } };
    try {
      const route = await readRoute(activityId);
      if (disposed) return;
      routeStates = { ...routeStates, [activityId]: { open: true, loading: false, route, error: '' } };
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        onauthrequired?.();
        return;
      }
      routeStates = {
        ...routeStates,
        [activityId]: {
          open: true,
          loading: false,
          route: null,
          error: cause instanceof Error ? cause.message : '暂时无法读取路线',
        },
      };
    }
  }

  function buildTrendsProp(data: Record<string, unknown>): Trends | null {
    const period = data.period;
    if ((period !== 'week' && period !== 'month') || !Array.isArray(data.buckets) || data.buckets.length === 0) {
      return null;
    }
    const buckets: TrendBucket[] = [];
    for (const raw of data.buckets) {
      if (!isObj(raw) || typeof raw.bucket_start !== 'string' || typeof raw.bucket_end !== 'string') continue;
      buckets.push({
        bucket_start: raw.bucket_start,
        bucket_end: raw.bucket_end,
        is_partial: raw.is_partial === true,
        activity_count: num(raw.activity_count) ?? 0,
        distance_m: metricVal(raw.distance_m) ?? 0,
        duration_sum_seconds: metricVal(raw.duration_sum_seconds),
        known_duration_count: num(raw.known_duration_count) ?? 0,
        missing_duration_count: num(raw.missing_duration_count) ?? 0,
        activity_days: num(raw.activity_days) ?? 0,
        pace_eligible_count: num(raw.pace_eligible_count) ?? 0,
        pace_eligible_distance_m: metricVal(raw.pace_eligible_distance_m) ?? 0,
        avg_pace_seconds_per_km: metricVal(raw.avg_pace_seconds_per_km),
        quality_warning_count: num(raw.quality_warning_count) ?? 0,
        date_assignment: 'activity_local_date',
      });
    }
    if (!buckets.length) return null;
    return {
      period,
      date_from: str(data.date_from),
      date_to: str(data.date_to),
      week_start: 'monday',
      date_assignment: 'activity_local_date',
      buckets,
    };
  }

  function buildMonthlyProp(data: Record<string, unknown>): MonthPoint[] {
    if (!Array.isArray(data.monthly)) return [];
    const points: MonthPoint[] = [];
    for (const raw of data.monthly) {
      if (!isObj(raw) || typeof raw.month_start !== 'string') continue;
      points.push({
        month_start: raw.month_start,
        activity_count: num(raw.activity_count) ?? 0,
        distance_m: metricVal(raw.distance_m) ?? 0,
        avg_pace_seconds_per_km: metricVal(raw.avg_pace_seconds_per_km),
      });
    }
    return points;
  }

  function summaryItems(summary: Record<string, unknown>) {
    return [
      { label: '总距离', value: dashboardDistance(metricVal(summary.distance_m)), icon: 'distance' as const },
      { label: '跑步次数', value: `${num(summary.activity_count) ?? 0} 次`, icon: 'count' as const },
      { label: '活跃天数', value: `${num(summary.activity_days) ?? 0} 天`, icon: 'days' as const },
      { label: '有效用时', value: formatDuration(metricVal(summary.duration_sum_seconds)), icon: 'duration' as const },
      { label: '平均配速', value: formatPace(metricVal(summary.avg_pace_seconds_per_km)), icon: 'pace' as const },
    ];
  }

  function goalPeriodName(period: string): string {
    return period === 'week' ? '本周目标' : period === 'month' ? '本月目标' : '今年目标';
  }
</script>

{#if blocks.length > 0}
  <div class="blocks-stack" data-testid="assistant-ui-blocks">
    {#each blocks as block, idx (`${block.type}-${idx}`)}
      {#if block.type === 'metrics_card' && isObj(block.data.summary)}
        {@const summary = block.data.summary}
        {@const device = isObj(block.data.device_metrics) ? block.data.device_metrics : null}
        {@const totalCount = num(summary.activity_count) ?? 0}
        <section class="block-card" aria-label="跑步数据汇总卡片" data-testid="block-metrics-card">
          <div class="block-head">
            <h4>跑步汇总</h4>
            <span class="block-sub">
              {block.data.scope === 'all_time'
                ? '全历史'
                : `${str(block.data.date_from)} 至 ${str(block.data.date_to)}（不含结束日）`}
            </span>
          </div>
          <MetricSummary items={summaryItems(summary)} appearance="receipt" compact />
          {#if device && totalCount > 0}
            <dl class="device-strip">
              <div>
                <dt>加权平均心率</dt>
                <dd>{formatHr(device.avg_heart_rate_bpm)}</dd>
                <span class="meta-cap">覆盖 {num(device.heart_rate_record_count) ?? 0} / {totalCount} 次</span>
              </div>
              <div>
                <dt>热量（小计）</dt>
                <dd>{num(device.calories_kcal) === null ? '—' : `${num(device.calories_kcal)} kcal`}</dd>
                <span class="meta-cap">覆盖 {num(device.calories_record_count) ?? 0} / {totalCount} 次</span>
              </div>
              <div>
                <dt>步数（小计）</dt>
                <dd>{num(device.steps) === null ? '—' : `${num(device.steps)} 步`}</dd>
                <span class="meta-cap">覆盖 {num(device.steps_record_count) ?? 0} / {totalCount} 次</span>
              </div>
            </dl>
          {/if}
          {#if (num(summary.quality_warning_count) ?? 0) > 0 || (num(summary.missing_duration_count) ?? 0) > 0}
            <p class="caveat-line">
              口径提示：{num(summary.missing_duration_count) ?? 0} 条缺少耗时、{num(summary.quality_warning_count) ?? 0} 条存在时间质量警告，缺失值不按零计入配速。
            </p>
          {/if}
        </section>

      {:else if block.type === 'trend_chart'}
        {@const trends = buildTrendsProp(block.data)}
        {@const currentMetric = trendMetrics[idx] ?? 'distance'}
        <section class="block-card" aria-label="跑步趋势图表" data-testid="block-trend-chart">
          <div class="block-head">
            <div>
              <h4>{block.data.period === 'month' ? '月度趋势' : block.data.period === 'year' ? '年度趋势' : '每周趋势'}</h4>
              <span class="block-sub">{str(block.data.date_from)} 至 {str(block.data.date_to)}</span>
            </div>
            {#if trends}
              <div class="underline-tabs" role="group" aria-label="趋势指标切换">
                <button
                  type="button"
                  aria-pressed={currentMetric === 'distance'}
                  onclick={() => { trendMetrics = { ...trendMetrics, [idx]: 'distance' }; }}
                >距离</button>
                <button
                  type="button"
                  aria-pressed={currentMetric === 'duration'}
                  onclick={() => { trendMetrics = { ...trendMetrics, [idx]: 'duration' }; }}
                >时长</button>
                <button
                  type="button"
                  aria-pressed={currentMetric === 'pace'}
                  onclick={() => { trendMetrics = { ...trendMetrics, [idx]: 'pace' }; }}
                >配速</button>
              </div>
            {/if}
          </div>
          {#if trends}
            <TrendChart {trends} metric={currentMetric} appearance="receipt" />
          {:else if Array.isArray(block.data.buckets) && block.data.buckets.length > 0}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
            <div class="mini-table-wrap" tabindex="0" role="region" aria-label="周期趋势数据表">
              <table>
                <thead><tr><th scope="col">开始日期</th><th scope="col">距离</th><th scope="col">次数</th><th scope="col">平均配速</th></tr></thead>
                <tbody>
                  {#each block.data.buckets as raw}
                    {#if isObj(raw)}
                      <tr>
                        <th scope="row">{str(raw.bucket_start)}</th>
                        <td>{dashboardDistance(metricVal(raw.distance_m))}</td>
                        <td>{num(raw.activity_count) ?? 0} 次</td>
                        <td>{formatPace(metricVal(raw.avg_pace_seconds_per_km))}</td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="caveat-line">该时间范围内暂无趋势数据。</p>
          {/if}
        </section>

      {:else if block.type === 'period_card'}
        <section class="block-card" aria-label="周期报告卡片" data-testid="block-period-card">
          <div class="block-head">
            <h4>
              {num(block.data.year) ?? ''} 年{block.data.period === 'month' && num(block.data.month) !== null ? ` ${num(block.data.month)} 月` : ''}报告
            </h4>
            {#if block.data.is_partial}
              <span class="status-pill warn">进行中 · 截至 {str(block.data.cutoff_date, str(block.data.today))}</span>
            {/if}
          </div>
          <MetricSummary items={summaryItems(block.data)} appearance="receipt" compact />
        </section>

      {:else if block.type === 'comparison_card' && isObj(block.data.period_a) && isObj(block.data.period_b) && isObj(block.data.delta)}
        {@const a = block.data.period_a}
        {@const b = block.data.period_b}
        {@const delta = block.data.delta}
        {@const aSum = isObj(a.summary) ? a.summary : {}}
        {@const bSum = isObj(b.summary) ? b.summary : {}}
        <section class="block-card" aria-label="双期数据对比卡片" data-testid="block-comparison-card">
          <div class="block-head">
            <h4>同期对比</h4>
            <span class="block-sub">服务端精确计算差值</span>
          </div>
          <div class="compare-grid">
            <div class="compare-col">
              <p class="compare-label">{str(a.label, '本期')}</p>
              <p class="meta-cap">{str(a.date_from)} 至 {str(a.date_to)}</p>
              <p class="compare-stat">{dashboardDistance(metricVal(aSum.distance_m))}</p>
              <p class="meta-cap">{num(aSum.activity_count) ?? 0} 次 · {num(aSum.activity_days) ?? 0} 天 · 配速 {formatPace(metricVal(aSum.avg_pace_seconds_per_km))}</p>
            </div>
            <div class="compare-col">
              <p class="compare-label">{str(b.label, '对比期')}</p>
              <p class="meta-cap">{str(b.date_from)} 至 {str(b.date_to)}</p>
              <p class="compare-stat">{dashboardDistance(metricVal(bSum.distance_m))}</p>
              <p class="meta-cap">{num(bSum.activity_count) ?? 0} 次 · {num(bSum.activity_days) ?? 0} 天 · 配速 {formatPace(metricVal(bSum.avg_pace_seconds_per_km))}</p>
            </div>
          </div>
          <div class="delta-row">
            <span class="delta-chip">距离：{formatSignedDistance(delta.distance_m_diff)}（{formatSignedPct(delta.distance_change_pct)}）</span>
            <span class="delta-chip">次数：{formatSignedCount(delta.activity_count_diff, '次')}</span>
            <span class="delta-chip">配速：{formatSignedPace(delta.avg_pace_seconds_per_km_diff)}</span>
            {#if num(delta.avg_heart_rate_bpm_diff) !== null}
              <span class="delta-chip">心率：{formatSignedCount(Math.round(num(delta.avg_heart_rate_bpm_diff)!), 'bpm')}</span>
            {/if}
          </div>
        </section>

      {:else if block.type === 'records_summary'}
        {@const bests = Array.isArray(block.data.personal_bests) ? block.data.personal_bests : []}
        {@const totals = isObj(block.data.totals) ? block.data.totals : null}
        {@const yearly = Array.isArray(block.data.yearly) ? block.data.yearly : []}
        <section class="block-card" aria-label="个人最佳成绩卡片" data-testid="block-records-summary">
          <div class="block-head">
            <h4>个人记录</h4>
            <a class="block-link" href={view.href('/records')}>查看全部记录 →</a>
          </div>
          {#if bests.length > 0}
            <div class="pb-grid">
              {#each bests as rawPb}
                {#if isObj(rawPb)}
                  {@const best = isObj(rawPb.best) ? rawPb.best : null}
                  {@const bestId = best ? safeId(best.activity_id) : null}
                  {@const gain = num(rawPb.pace_gain_seconds_per_km)}
                  <div class="pb-tile">
                    <span class="pb-cat">{str(rawPb.category).toUpperCase()} 最佳</span>
                    {#if best}
                      <p class="pb-pace">{formatPace(metricVal(best.avg_pace_seconds_per_km))}</p>
                      <p class="meta-cap">
                        {str(best.activity_date)} · {formatDistance(metricVal(best.distance_m))} · {formatDuration(metricVal(best.duration_seconds))}
                      </p>
                      {#if gain !== null && gain > 0}
                        <p class="pb-gain">比首跑快 {Math.round(gain)} 秒/km</p>
                      {/if}
                      {#if bestId}
                        <a class="block-link" href={view.href(`/activities/${bestId}`)}>查看本次跑步 →</a>
                      {/if}
                    {:else}
                      <p class="meta-cap">暂无符合条件的成绩</p>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
          {#if totals}
            <p class="totals-line">
              全历史累计 <strong>{dashboardDistance(metricVal(totals.distance_m))}</strong> · {num(totals.activity_count) ?? 0} 次 · {num(totals.activity_days) ?? 0} 天 · 平均配速 {formatPace(metricVal(totals.avg_pace_seconds_per_km))}
            </p>
          {/if}
          {#if yearly.length > 0}
            <details class="block-details">
              <summary>逐年汇总（{yearly.length} 年）</summary>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
              <div class="mini-table-wrap" tabindex="0" role="region" aria-label="逐年跑步汇总表">
                <table>
                  <thead><tr><th scope="col">年份</th><th scope="col">总里程</th><th scope="col">次数</th><th scope="col">平均配速</th></tr></thead>
                  <tbody>
                    {#each yearly as yr}
                      {#if isObj(yr)}
                        <tr>
                          <th scope="row">{num(yr.year) ?? ''}{yr.is_partial ? '（进行中）' : ''}</th>
                          <td>{dashboardDistance(metricVal(yr.distance_m))}</td>
                          <td>{num(yr.activity_count) ?? 0} 次</td>
                          <td>{formatPace(metricVal(yr.avg_pace_seconds_per_km))}</td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
            </details>
          {/if}
        </section>

      {:else if block.type === 'records_chart'}
        {@const monthly = buildMonthlyProp(block.data)}
        {@const currentMetric = recordsMetrics[idx] ?? 'distance'}
        <section class="block-card" aria-label="月度跑步图表" data-testid="block-records-chart">
          <div class="block-head">
            <div>
              <h4>月度趋势</h4>
              {#if block.data.truncated}<span class="block-sub">仅展示最近 {monthly.length} 个月</span>{/if}
            </div>
            {#if monthly.length > 0}
              <div class="underline-tabs" role="group" aria-label="月度图表指标切换">
                <button
                  type="button"
                  aria-pressed={currentMetric === 'distance'}
                  onclick={() => { recordsMetrics = { ...recordsMetrics, [idx]: 'distance' }; }}
                >里程</button>
                <button
                  type="button"
                  aria-pressed={currentMetric === 'pace'}
                  onclick={() => { recordsMetrics = { ...recordsMetrics, [idx]: 'pace' }; }}
                >配速</button>
              </div>
            {/if}
          </div>
          {#if monthly.length > 0}
            <RecordsChart {monthly} metric={currentMetric} />
          {:else}
            <p class="caveat-line">暂无月度统计数据。</p>
          {/if}
        </section>

      {:else if block.type === 'goals_streaks_card'}
        {@const streaks = isObj(block.data.streaks) ? block.data.streaks : null}
        {@const goals = isObj(block.data.goals) ? block.data.goals : null}
        <section class="block-card" aria-label="连续记录与跑量目标卡片" data-testid="block-goals-streaks">
          <div class="block-head">
            <h4>连续记录与跑量目标</h4>
            {#if str(block.data.today)}<span class="block-sub">截至 {str(block.data.today)}</span>{/if}
          </div>
          {#if streaks}
            <div class="streak-strip">
              <div class="streak-item">
                <span class="meta-cap">当前连续天数</span>
                <strong>{num(streaks.current_days) ?? 0} 天</strong>
              </div>
              <div class="streak-item">
                <span class="meta-cap">最长连续天数</span>
                <strong>{num(streaks.longest_days) ?? 0} 天</strong>
              </div>
              <div class="streak-item">
                <span class="meta-cap">当前连续周数</span>
                <strong>{num(streaks.current_weeks) ?? 0} 周</strong>
              </div>
              <div class="streak-item">
                <span class="meta-cap">最长连续周数</span>
                <strong>{num(streaks.longest_weeks) ?? 0} 周</strong>
              </div>
            </div>
          {/if}
          {#if goals}
            <div class="goal-list">
              {#each ['week', 'month', 'year'] as period}
                {#if isObj(goals[period])}
                  {@const g = goals[period]}
                  {@const target = num(g.target_km)}
                  {@const completed = num(g.completed_km) ?? 0}
                  {@const pct = num(g.progress_pct)}
                  <div class="goal-row">
                    <div class="goal-row-head">
                      <span>{goalPeriodName(period)}</span>
                      <span class="tabular">
                        {target !== null ? `${completed.toFixed(1)} / ${target.toFixed(1)} km（${pct?.toFixed(0) ?? 0}%）` : `已完成 ${completed.toFixed(1)} km · 未设置目标`}
                      </span>
                    </div>
                    {#if target !== null && pct !== null}
                      <div class="goal-bar" aria-hidden="true">
                        <span style:width={`${Math.min(100, Math.max(0, pct))}%`}></span>
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </section>

      {:else if block.type === 'activity_list'}
        {@const items = Array.isArray(block.data.items) ? block.data.items.filter(isObj) : []}
        {@const total = num(block.data.total) ?? items.length}
        <section class="block-card" aria-label="相关跑步记录" data-testid="block-activity-list">
          <div class="block-head">
            <h4>相关跑步记录</h4>
            <span class="block-sub">共匹配 {total} 条{#if items.length < total}，展示前 {items.length} 条{/if}</span>
          </div>
          {#if items.length === 0}
            <p class="caveat-line">没有找到符合条件的跑步记录。</p>
          {:else}
            <div class="activity-items">
              {#each items as item}
                {@const id = safeId(item.activity_id)}
                {#if id}
                  {@const local = localActivities[id]}
                  {@const preview = routeStates[id]}
                  <div class="activity-row-wrap">
                    {#if local && local !== 'loading' && local !== 'failed'}
                      <ActivityCard activity={local} />
                    {:else}
                      <a class="fallback-activity-card" href={view.href(`/activities/${id}`)} data-activity-id={id}>
                        <div class="fallback-head">
                          <strong>{str(item.activity_date)}{str(item.category) ? ` · ${str(item.category)}` : ''}</strong>
                          {#if str(item.temporal_quality) && str(item.temporal_quality) !== 'complete'}
                            <span class="status-pill warn">{qualityLabel(str(item.temporal_quality) as Activity['temporal_quality'])}</span>
                          {/if}
                        </div>
                        <p class="fallback-metrics">
                          <b>{formatDistance(metricVal(item.distance_m))}</b>
                          <span>{formatDuration(metricVal(item.duration_seconds))}</span>
                          <span>{formatPace(metricVal(item.avg_pace_seconds_per_km))}</span>
                          {#if num(item.avg_heart_rate_bpm) !== null}
                            <span>{num(item.avg_heart_rate_bpm)} bpm</span>
                          {/if}
                        </p>
                      </a>
                    {/if}
                    {#if item.has_route === true}
                      <div class="route-toggle-row">
                        <button
                          type="button"
                          class="button-secondary button-compact"
                          aria-expanded={preview?.open === true}
                          onclick={() => void toggleRoutePreview(id)}
                        >
                          {preview?.open ? '收起路线预览' : '预览本地路线'}
                        </button>
                      </div>
                      {#if preview?.open}
                        <div class="route-preview-box">
                          {#if preview.loading}
                            <FeedbackState kind="loading" title="正在读取本地路线…" />
                          {:else if preview.error}
                            <FeedbackState kind="error" title={preview.error} />
                          {:else if preview.route}
                            <RouteMap route={preview.route} appearance="sheet" embedded lazy />
                          {/if}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </section>

      {:else if block.type === 'activity_detail_card'}
        {@const id = safeId(block.data.activity_id)}
        {@const local = id ? localActivities[id] : undefined}
        {@const preview = id ? routeStates[id] : undefined}
        {@const provinces = Array.isArray(block.data.provinces) ? block.data.provinces.filter((v): v is string => typeof v === 'string') : []}
        {@const cities = Array.isArray(block.data.cities) ? block.data.cities.filter((v): v is string => typeof v === 'string') : []}
        <section class="block-card" aria-label="单次跑步指标卡片" data-testid="block-activity-detail">
          <div class="block-head">
            <div>
              <h4>
                {local && local !== 'loading' && local !== 'failed' && local.title
                  ? local.title
                  : `${str(block.data.activity_date)} 跑步记录`}
              </h4>
              <span class="block-sub">
                {str(block.data.activity_date)}
                {#if str(block.data.category)} · {str(block.data.category)}{/if}
                {#if provinces.length || cities.length} · {[...provinces, ...cities].join(' / ')}{/if}
              </span>
            </div>
            {#if id}
              <a class="block-link" href={view.href(`/activities/${id}`)}>查看详情 →</a>
            {/if}
          </div>
          <MetricSummary
            appearance="receipt"
            compact
            items={[
              { label: '距离', value: formatDistance(metricVal(block.data.distance_m)), icon: 'distance' },
              { label: '有效用时', value: formatDuration(metricVal(block.data.duration_seconds)), icon: 'duration' },
              { label: '平均配速', value: formatPace(metricVal(block.data.avg_pace_seconds_per_km)), icon: 'pace' },
              { label: '平均心率', value: formatHr(block.data.avg_heart_rate_bpm), icon: 'heart' },
            ]}
          />
          {#if id && block.data.has_route === true}
            <div class="route-toggle-row">
              <button
                type="button"
                class="button-secondary button-compact"
                aria-expanded={preview?.open === true}
                onclick={() => void toggleRoutePreview(id)}
              >
                {preview?.open ? '收起路线预览' : '预览本地路线'}
              </button>
            </div>
            {#if preview?.open}
              <div class="route-preview-box">
                {#if preview.loading}
                  <FeedbackState kind="loading" title="正在读取本地路线…" />
                {:else if preview.error}
                  <FeedbackState kind="error" title={preview.error} />
                {:else if preview.route}
                  <RouteMap route={preview.route} appearance="sheet" embedded lazy />
                {/if}
              </div>
            {/if}
          {/if}
        </section>

      {:else if block.type === 'footprint_summary_card'}
        {@const isChina = block.data.scope !== 'global'}
        {@const provinces = Array.isArray(block.data.provinces) ? block.data.provinces.filter(isObj) : []}
        {@const countries = Array.isArray(block.data.countries) ? block.data.countries.filter(isObj) : []}
        {@const mapOpen = openFootprintMaps[idx] === true}
        <section class="block-card" aria-label="跑步足迹汇总卡片" data-testid="block-footprint-summary">
          <div class="block-head">
            <div>
              <h4>{isChina ? '中国省份足迹' : '全球跑步足迹'}{num(block.data.year) !== null ? `（${num(block.data.year)} 年）` : ''}</h4>
              <span class="block-sub">
                {#if isChina}
                  已点亮 {num(block.data.visited_province_count) ?? 0} / {num(block.data.total_provinces) ?? 34} 个省级行政区 · 已定位 {num(block.data.located_activity_count) ?? 0} / {num(block.data.activity_count) ?? 0} 次活动
                {:else}
                  {num(block.data.country_count) ?? 0} 个国家/地区 · {num(block.data.region_count) ?? 0} 个省州 · {num(block.data.city_count) ?? 0} 座城市
                {/if}
              </span>
            </div>
            <a class="block-link" href={view.href('/footprints')}>前往个人足迹 →</a>
          </div>
          {#if block.data.cached_only === true}
            <p class="caveat-line">部分足迹缓存正在生成中，以下仅汇总已缓存的活动数据。</p>
          {/if}
          {#if isChina && provinces.length > 0}
            <ul class="place-chips">
              {#each provinces as p}
                <li><span>{str(p.name)}</span><b>{num(p.activity_count) ?? 0} 次</b></li>
              {/each}
            </ul>
          {:else if !isChina && countries.length > 0}
            <ul class="place-chips">
              {#each countries as c}
                <li>
                  <span>{str(c.name)}</span>
                  <b>{num(c.activity_count) ?? 0} 次</b>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="caveat-line">暂无已定位的足迹数据。</p>
          {/if}
          <div class="route-toggle-row">
            <button
              type="button"
              class="button-secondary button-compact"
              aria-expanded={mapOpen}
              onclick={() => { openFootprintMaps = { ...openFootprintMaps, [idx]: !mapOpen }; }}
            >
              {mapOpen ? '收起足迹地图' : '展开本地足迹地图'}
            </button>
          </div>
          {#if mapOpen}
            <div class="footprint-map-box">
              <ProvinceMap />
            </div>
          {/if}
        </section>

      {:else if block.type === 'route_group_list'}
        {@const groups = Array.isArray(block.data.groups) ? block.data.groups.filter(isObj) : []}
        {@const singleGroup = isObj(block.data.group) ? block.data.group : null}
        {@const runs = Array.isArray(block.data.runs) ? block.data.runs.filter(isObj) : []}
        <section class="block-card" aria-label="常跑路线汇总卡片" data-testid="block-route-groups">
          <div class="block-head">
            <h4>常跑路线</h4>
            <a class="block-link" href={view.href('/routes')}>查看全部常跑路线 →</a>
          </div>
          {#if block.data.building === true}
            <p class="caveat-line">常跑路线分组仍在后台构建中，当前展示为已识别结果。</p>
          {/if}
          {#if singleGroup}
            <div class="route-group-item">
              <div class="route-group-top">
                <strong>约 {formatDistance(metricVal(singleGroup.median_distance_m))} 路线 · {num(singleGroup.run_count) ?? 0} 次</strong>
                <span class="meta-cap">{str(singleGroup.first_date)} – {str(singleGroup.last_date)}</span>
              </div>
              <p class="meta-cap">
                最佳配速 {formatPace(metricVal(singleGroup.best_pace_seconds_per_km))} · 平均配速 {formatPace(metricVal(singleGroup.avg_pace_seconds_per_km))}
              </p>
            </div>
            {#if runs.length > 0}
              <ul class="group-runs">
                {#each runs as run}
                  {@const runId = safeId(run.activity_id)}
                  <li>
                    {#if runId}
                      <a href={view.href(`/activities/${runId}`)}>{str(run.activity_date)}</a>
                    {:else}
                      <span>{str(run.activity_date)}</span>
                    {/if}
                    <span>{formatDistance(metricVal(run.distance_m))}</span>
                    <span>{formatPace(metricVal(run.avg_pace_seconds_per_km))}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else if groups.length > 0}
            <div class="route-group-list">
              {#each groups as g}
                {@const gid = safeId(g.group_id)}
                <div class="route-group-item">
                  <div class="route-group-top">
                    {#if gid}
                      <a class="route-group-link" href={view.href(`/routes/${gid}`)}>
                        约 {formatDistance(metricVal(g.median_distance_m))} 路线 · {num(g.run_count) ?? 0} 次
                      </a>
                    {:else}
                      <strong>约 {formatDistance(metricVal(g.median_distance_m))} 路线 · {num(g.run_count) ?? 0} 次</strong>
                    {/if}
                    <span class="meta-cap">{str(g.first_date)} – {str(g.last_date)}</span>
                  </div>
                  <p class="meta-cap">
                    最佳配速 {formatPace(metricVal(g.best_pace_seconds_per_km))} · 平均配速 {formatPace(metricVal(g.avg_pace_seconds_per_km))} · 最佳用时 {formatDuration(metricVal(g.best_duration_seconds))}
                  </p>
                </div>
              {/each}
            </div>
          {:else}
            <p class="caveat-line">暂无已识别的常跑路线组。</p>
          {/if}
        </section>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .blocks-stack {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
  }
  .block-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
    max-width: 100%;
    overflow-x: clip;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--background);
  }
  @media (max-width: 479px) {
    .block-card :global(.metrics.compact) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .block-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .block-head h4 {
    margin: 0;
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .block-sub,
  .meta-cap {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
    font-variant-numeric: tabular-nums;
  }
  .block-link {
    color: var(--primary);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .device-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .device-strip > div {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .device-strip dt {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .device-strip dd {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 639px) {
    .device-strip {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .caveat-line {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--warning);
    border-radius: 0;
    background: var(--warning-soft);
    color: var(--foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .status-pill {
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-sheet);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
  }
  .status-pill.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .compare-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  @media (max-width: 639px) {
    .compare-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .compare-col {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .compare-label {
    margin: 0;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .compare-stat {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .delta-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .delta-chip {
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-sheet);
    border: 1px solid var(--border);
    background: var(--paper);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
  }
  .pb-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  @media (max-width: 639px) {
    .pb-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .pb-tile {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .pb-cat {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--primary);
  }
  .pb-pace {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .pb-gain {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .totals-line {
    margin: 0;
    font-size: var(--text-small);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .totals-line strong {
    color: var(--foreground);
  }
  .block-details summary {
    cursor: pointer;
    color: var(--primary);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  .mini-table-wrap {
    margin-top: var(--space-2);
    max-width: 100%;
    overflow-x: auto;
  }
  .mini-table-wrap table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .mini-table-wrap th,
  .mini-table-wrap td {
    padding: var(--space-1) var(--space-3) var(--space-1) 0;
    border-top: 1px solid var(--border);
    white-space: nowrap;
  }
  .mini-table-wrap thead th {
    border-top: 0;
    color: var(--muted-foreground);
    font-weight: var(--weight-medium);
  }
  .streak-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  @media (max-width: 639px) {
    .streak-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .streak-item {
    display: grid;
    gap: 0.15rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .streak-item strong {
    font-size: var(--text-card);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .goal-list {
    display: grid;
    gap: var(--space-2);
  }
  .goal-row {
    display: grid;
    gap: var(--space-1);
  }
  .goal-row-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-small);
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  .goal-bar {
    height: 0.25rem;
    border-radius: 0;
    background: var(--recap-well);
    overflow: hidden;
  }
  .goal-bar > span {
    display: block;
    height: 100%;
    border-radius: 0;
    background: var(--primary);
  }
  .activity-items,
  .route-group-list {
    display: grid;
    gap: var(--space-2);
  }
  .activity-row-wrap {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .fallback-activity-card {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
    color: var(--foreground);
  }
  .fallback-activity-card:hover {
    border-color: var(--primary);
  }
  .fallback-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-small);
  }
  .fallback-metrics {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .fallback-metrics b {
    color: var(--foreground);
  }
  .route-toggle-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .route-preview-box {
    min-height: 16rem;
    border-radius: var(--radius-sheet);
    overflow: hidden;
  }
  .footprint-map-box {
    min-width: 0;
    overflow: hidden;
    border-radius: var(--radius-sheet);
  }
  .place-chips {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .place-chips li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
    font-size: var(--text-small);
  }
  .place-chips b {
    color: var(--primary);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .route-group-item {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .route-group-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-small);
  }
  .route-group-link {
    color: var(--primary);
    font-weight: var(--weight-semibold);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .group-runs {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .group-runs li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-top: 1px solid var(--border);
  }
  .group-runs a {
    color: var(--primary);
    text-decoration: underline;
  }
</style>
