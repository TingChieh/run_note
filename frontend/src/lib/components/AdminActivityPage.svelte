<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import {
    ActivityError,
    activityDuration,
    formatDate,
    formatDistance,
    formatDuration,
    formatPace,
    formatStartTime,
    qualityEntries,
    qualityLabel,
    type Activity,
    type ActivityList,
    type Route,
  } from '#lib/api/activities.ts';
  import { readAdminActivities, readAdminActivity, readAdminRoute } from '#lib/api/admin-readonly-activities.ts';
  import { AdminUserError, readAdminUser, type AdminUser } from '#lib/api/admin-users.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import DeviceMetrics from '#lib/components/DeviceMetrics.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import RouteMap from '#lib/components/RouteMap.svelte';
  let { detail = false }: { detail?: boolean } = $props();
  let user = $state<AdminUser | null>(null),
    records = $state<ActivityList | null>(null),
    activity = $state<Activity | null>(null),
    route = $state.raw<Route | null>(null);
  let loading = $state(true),
    message = $state(''),
    routeMessage = $state(''),
    disposed = false,
    token = 0;
  let mounted = $state(false);
  const userId = $derived(page.params.id ?? '');
  const base = $derived(`/admin/users/${userId}/activities`);
  function fail(cause: unknown) {
    if ((cause instanceof ActivityError || cause instanceof AdminUserError) && cause.status === 401) {
      user = null;
      records = null;
      activity = null;
      route = null;
      window.location.replace('/admin?reason=expired');
      return;
    }
    message = cause instanceof Error ? cause.message : '无法读取记录';
  }
  async function load(offset = 0) {
    const current = ++token;
    loading = true;
    message = '';
    routeMessage = '';
    user = null;
    records = null;
    activity = null;
    route = null;
    try {
      const subject = await readAdminUser(userId);
      if (disposed || current !== token) return;
      user = subject;
      if (!detail) {
        const result = await readAdminActivities(userId, offset);
        if (!disposed && current === token) records = result;
      } else {
        const result = await readAdminActivity(userId, page.params.activityId ?? '');
        if (disposed || current !== token) return;
        activity = result;
        if (result.has_route) {
          try {
            const resultRoute = await readAdminRoute(userId, result.id);
            if (!disposed && current === token) route = resultRoute;
          } catch (cause) {
            if (!disposed && current === token) {
              if (cause instanceof ActivityError && cause.status === 401) fail(cause);
              else routeMessage = cause instanceof Error ? cause.message : '无法读取路线';
            }
          }
        }
      }
    } catch (cause) {
      if (!disposed && current === token) fail(cause);
    } finally {
      if (!disposed && current === token) loading = false;
    }
  }
  $effect(() => {
    const id = page.params.id;
    const activityId = page.params.activityId;
    if (mounted && id && (!detail || activityId)) untrack(() => void load());
  });
  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
      ++token;
    };
  });
</script>

<div class="editorial-page admin-readonly-page">
  <PageHeader
    title={detail ? activity?.title || '运动记录详情' : '运动记录'}
    meta={detail && activity
      ? `${formatDate(activity.activity_date)} · ${activity.timezone}`
      : records
        ? `共 ${records.total} 条`
        : undefined}
  >
    {#snippet actions()}
      <a class="button-secondary" href="/admin/users">返回用户管理</a>
      {#if detail}<a class="button-secondary" href={base}>返回记录列表</a>{/if}
    {/snippet}
  </PageHeader>

  {#if user}<div class="status-strip" role="status">正在查看 {user.display_name} 的记录（只读）</div>{/if}

  {#if message}
    <FeedbackState kind="error" title={message} />
  {:else if loading && !activity}
    <FeedbackState kind="loading" title="正在读取记录…" />
  {:else if records}
    <section class="section-rule readonly-section" aria-label="记录列表">
      {#if records.items.length}
        <ul class="hairline-rows readonly-list">
          {#each records.items as item (item.id)}
            <li class="readonly-row">
              <a class="readonly-row-link" href={`${base}/${item.id}`}>
                <span class="readonly-row-title">{item.title || '未命名活动'}</span>
                <span class="readonly-row-meta">{formatDate(item.activity_date)} · {formatDistance(item.distance_m)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <FeedbackState kind="empty" title={records.total ? '本页没有运动记录' : '暂无运动记录'} />
      {/if}
      {#if records.total > 0 || records.offset > 0}
        <nav class="readonly-pagination" aria-label="记录分页">
          <button
            type="button"
            class="button-secondary"
            disabled={records.offset === 0}
            onclick={() => load(Math.max(0, records!.offset - records!.limit))}>上一页</button
          >
          <span class="readonly-total">共 {records.total} 条</span>
          <button
            type="button"
            class="button-secondary"
            disabled={records.offset + records.limit >= records.total}
            onclick={() => load(records!.offset + records!.limit)}>下一页</button
          >
        </nav>
      {/if}
    </section>
  {:else if activity}
    <section class="section-rule readonly-section" aria-label="运动指标">
      <h2>运动指标</h2>
      <MetricSummary
        appearance="receipt"
        items={[
          { label: '距离', value: formatDistance(activity.distance_m), icon: 'distance' },
          {
            label: activity.timer_seconds != null ? '设备用时' : '经过时间',
            value: formatDuration(activityDuration(activity)),
            icon: 'duration',
          },
          { label: '平均配速', value: formatPace(activity.avg_pace_seconds_per_km), icon: 'pace' },
          ...(activity.timer_seconds != null
            ? [{ label: '经过时间', value: formatDuration(activity.elapsed_seconds), icon: 'elapsed' as const }]
            : []),
          {
            label: '平均心率',
            value: activity.avg_heart_rate_bpm == null ? '—' : `${activity.avg_heart_rate_bpm} bpm`,
            icon: 'heart',
          },
          {
            label: '热量',
            value: activity.calories_kcal == null ? '—' : `${activity.calories_kcal} kcal`,
            icon: 'calories',
          },
          { label: '步数', value: activity.steps == null ? '—' : `${activity.steps} 步`, icon: 'steps' },
        ]}
      />
      <p class="readonly-meta-line">开始时间：{formatStartTime(activity.started_at, activity.timezone)} · {activity.timezone}</p>
    </section>

    <section class="section-hairline readonly-section" aria-label="路线">
      <h2>路线</h2>
      {#if route}
        <RouteMap {route} appearance="sheet" spacious />
      {:else if routeMessage}
        <p class="readonly-note">{routeMessage}</p>
      {:else if loading}
        <p class="readonly-note">正在读取路线…</p>
      {:else}
        <p class="readonly-note">此活动没有路线。</p>
      {/if}
    </section>

    <DeviceMetrics metrics={activity} />

    <details class="section-hairline readonly-details">
      <summary>数据质量与指标说明</summary>
      <p class="readonly-note">{qualityLabel(activity.temporal_quality)} · 指标版本：{activity.metrics_version}</p>
      {#if Object.keys(activity.quality_summary).length}
        <dl class="quality-list">
          {#each qualityEntries(activity.quality_summary) as [key, value]}
            <div>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          {/each}
        </dl>
      {:else}
        <p class="readonly-note">没有额外质量提示。</p>
      {/if}
    </details>

    <section class="section-hairline readonly-section" aria-label="心率图表">
      <h2>心率图表</h2>
      {#if activity.min_heart_rate_bpm != null || activity.avg_heart_rate_bpm != null || activity.max_heart_rate_bpm != null}
        <div class="hr-meters">
          {#each [{ label: '最低心率', value: activity.min_heart_rate_bpm }, { label: '平均心率', value: activity.avg_heart_rate_bpm }, { label: '最高心率', value: activity.max_heart_rate_bpm }] as item}
            <div class="hr-row">
              <span>{item.label}：{item.value == null ? '—' : `${item.value} bpm`}</span>
              {#if item.value != null}
                <meter min="0" max="300" value={item.value} aria-label={item.label}></meter>
              {:else}
                <span class="sr-only">缺失数据</span>
              {/if}
            </div>
          {/each}
        </div>
        <details class="readonly-details-inner">
          <summary>心率数据表</summary>
          <table class="readonly-table">
            <caption>本次活动心率（bpm）</caption>
            <tbody>
              {#each [{ label: '最低心率', value: activity.min_heart_rate_bpm }, { label: '平均心率', value: activity.avg_heart_rate_bpm }, { label: '最高心率', value: activity.max_heart_rate_bpm }] as item}
                <tr>
                  <th scope="row">{item.label}</th>
                  <td>
                    {item.value ?? '—'}{#if item.value == null}<span class="sr-only">缺失数据</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
      {:else}
        <p class="readonly-note">没有可用的心率数据。</p>
      {/if}
    </section>

    <section class="section-hairline readonly-section" aria-label="备注">
      <h2>备注</h2>
      <p class="readonly-notes-body">{activity.notes || '无备注'}</p>
    </section>
  {/if}
</div>

<style>
  .admin-readonly-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    min-width: 0;
  }
  .readonly-section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .readonly-section h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .readonly-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .readonly-row-link {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) 0;
    color: var(--foreground);
    text-decoration: none;
  }
  @media (hover: hover) {
    .readonly-row-link:hover .readonly-row-title {
      color: var(--primary);
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  .readonly-row-title {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    overflow-wrap: anywhere;
  }
  .readonly-row-meta,
  .readonly-total,
  .readonly-meta-line {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .readonly-pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .readonly-note {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .readonly-details summary,
  .readonly-details-inner summary {
    cursor: pointer;
    color: var(--primary);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  .quality-list {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
    font-size: var(--text-small);
  }
  .quality-list > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }
  .quality-list dt {
    color: var(--muted-foreground);
  }
  .quality-list dd {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .hr-meters {
    display: grid;
    gap: var(--space-3);
  }
  .hr-row {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .hr-row meter {
    width: 100%;
    height: 0.5rem;
  }
  .readonly-table {
    width: 100%;
    margin-top: var(--space-2);
    border-collapse: collapse;
    text-align: left;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .readonly-table caption {
    text-align: left;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    margin-bottom: var(--space-2);
  }
  .readonly-table th,
  .readonly-table td {
    padding: var(--space-2) var(--space-3) var(--space-2) 0;
    border-top: 1px solid var(--border);
  }
  .readonly-table th {
    color: var(--muted-foreground);
    font-weight: var(--weight-medium);
  }
  .readonly-notes-body {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--line-height-body);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
