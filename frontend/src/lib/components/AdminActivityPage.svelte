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

<a class="button-secondary" href="/admin/users">返回用户管理</a>
{#if user}<div class="aux-panel mt-4" role="status">正在查看 {user.display_name} 的记录（只读）</div>{/if}
{#if detail}<a class="button-secondary mt-4" href={base}>返回记录列表</a>{/if}
{#if message}<div class="mt-4"><FeedbackState kind="error" title={message} /></div>
{:else if loading && !activity}<div class="mt-4"><FeedbackState kind="loading" title="正在读取记录…" /></div>
{:else if records}
  <h1 class="page-header mt-6">运动记录</h1>
  {#if records.items.length}
    <ul class="mt-4 grid gap-3">
      {#each records.items as item (item.id)}<li class="aux-panel">
          <a class="font-semibold" href={`${base}/${item.id}`}>{item.title || '未命名活动'}</a>
          <p class="text-muted-foreground">{formatDate(item.activity_date)} · {formatDistance(item.distance_m)}</p>
        </li>{/each}
    </ul>
  {:else}<FeedbackState kind="empty" title={records.total ? '本页没有运动记录' : '暂无运动记录'} />{/if}
  {#if records.total > 0 || records.offset > 0}<nav class="mt-4 flex gap-3" aria-label="记录分页">
      <button
        class="button-secondary"
        disabled={records.offset === 0}
        onclick={() => load(Math.max(0, records!.offset - records!.limit))}>上一页</button
      ><span>共 {records.total} 条</span><button
        class="button-secondary"
        disabled={records.offset + records.limit >= records.total}
        onclick={() => load(records!.offset + records!.limit)}>下一页</button
      >
    </nav>{/if}
{:else if activity}
  <h1 class="page-header mt-6">{activity.title || '未命名活动'}</h1>
  <p class="text-muted-foreground">{formatDate(activity.activity_date)} · {activity.timezone}</p>
  <section class="aux-panel mt-4" aria-label="运动指标">
    <h2>运动指标</h2>
    <MetricSummary
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
    <p class="mt-3">开始时间：{formatStartTime(activity.started_at, activity.timezone)} · {activity.timezone}</p>
  </section>
  <section class="aux-panel mt-4" aria-label="路线">
    <h2>路线</h2>
    {#if route}<RouteMap {route} spacious />{:else if routeMessage}<p>{routeMessage}</p>{:else if loading}<p>
        正在读取路线…
      </p>{:else}<p>此活动没有路线。</p>{/if}
  </section>
  <DeviceMetrics metrics={activity} />
  <details class="aux-panel mt-4">
    <summary>数据质量与指标说明</summary>
    <p>{qualityLabel(activity.temporal_quality)} · 指标版本：{activity.metrics_version}</p>
    {#if Object.keys(activity.quality_summary).length}<dl>
        {#each qualityEntries(activity.quality_summary) as [key, value]}<div>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>{/each}
      </dl>{:else}<p>没有额外质量提示。</p>{/if}
  </details>
  <section class="aux-panel mt-4" aria-label="心率图表">
    <h2>心率图表</h2>
    {#if activity.min_heart_rate_bpm != null || activity.avg_heart_rate_bpm != null || activity.max_heart_rate_bpm != null}
      <div class="mt-3 grid gap-3">
        {#each [{ label: '最低心率', value: activity.min_heart_rate_bpm }, { label: '平均心率', value: activity.avg_heart_rate_bpm }, { label: '最高心率', value: activity.max_heart_rate_bpm }] as item}
          <div>
            <span>{item.label}：{item.value == null ? '—' : `${item.value} bpm`}</span>{#if item.value != null}
              <meter min="0" max="300" value={item.value} aria-label={item.label}></meter>{:else}<span class="sr-only"
                >缺失数据</span
              >{/if}
          </div>
        {/each}
      </div>
      <details class="mt-3">
        <summary>心率数据表</summary>
        <table>
          <caption>本次活动心率（bpm）</caption><tbody
            >{#each [{ label: '最低心率', value: activity.min_heart_rate_bpm }, { label: '平均心率', value: activity.avg_heart_rate_bpm }, { label: '最高心率', value: activity.max_heart_rate_bpm }] as item}<tr
                ><th scope="row">{item.label}</th><td
                  >{item.value ?? '—'}{#if item.value == null}<span class="sr-only">缺失数据</span>{/if}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </details>
    {:else}<p>没有可用的心率数据。</p>{/if}
  </section>
  <section class="aux-panel mt-4" aria-label="备注">
    <h2>备注</h2>
    <p class="whitespace-pre-wrap break-words">{activity.notes || '无备注'}</p>
  </section>
{/if}
