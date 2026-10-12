<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import RouteMap from '#lib/components/RouteMap.svelte';
  import { ActivityError, readActivity, readRoute, formatDate, formatDistance, formatDuration, formatPace, qualityLabel, qualityEntries, type Activity, type Route } from '#lib/api/activities.ts';
  let activity = $state<Activity | null>(null), route = $state<Route | null>(null), loading = $state(true), routeLoading = $state(false), message = $state(''), routeError = $state(''), disposed = false;
  function expired(cause: unknown): boolean {
    if (!(cause instanceof ActivityError) || cause.status !== 401) return false;
    activity = null; route = null; message = ''; routeError = ''; window.location.replace('/login?reason=expired'); return true;
  }
  async function loadRoute(id: string) {
    routeLoading = true; route = null; routeError = '';
    try { const result = await readRoute(id); if (!disposed) route = result; }
    catch (cause) { if (!disposed && !expired(cause)) routeError = cause instanceof Error ? cause.message : '无法读取路线'; }
    finally { if (!disposed) routeLoading = false; }
  }
  onMount(() => {
    const id = page.params.id ?? '';
    void (async () => {
      try {
        const result = await readActivity(id); if (disposed) return;
        activity = result; if (result.has_route) await loadRoute(id);
      } catch (cause) { if (!disposed && !expired(cause)) message = cause instanceof Error ? cause.message : '无法读取活动'; }
      finally { if (!disposed) loading = false; }
    })();
    return () => { disposed = true; };
  });
</script>
<svelte:head><title>{activity?.title || '活动详情'} · Run Note</title></svelte:head>
<a href="/activities" data-sveltekit-reload class="text-primary underline">← 返回跑步记录</a>
{#if message}<p role="alert" class="mt-6 text-red-700">{message}</p>
{:else if activity}
  <h1 class="mt-5 text-3xl font-semibold">{activity.title || '未命名活动'}</h1>
  <p class="mt-3 text-muted-foreground"><time datetime={activity.activity_date}>{formatDate(activity.activity_date)}</time> · {activity.timezone} · {qualityLabel(activity.temporal_quality)}</p>
  <dl class="mt-6 grid gap-4 sm:grid-cols-3">
    <div class="rounded-xl border border-border bg-white p-5"><dt class="text-sm text-muted-foreground">距离</dt><dd data-testid="activity-distance" class="mt-2 text-2xl font-semibold">{formatDistance(activity.distance_m)}</dd></div>
    <div class="rounded-xl border border-border bg-white p-5"><dt class="text-sm text-muted-foreground">经过时间</dt><dd class="mt-2 text-2xl font-semibold">{formatDuration(activity.elapsed_seconds)}</dd></div>
    <div class="rounded-xl border border-border bg-white p-5"><dt class="text-sm text-muted-foreground">平均配速</dt><dd class="mt-2 text-2xl font-semibold">{formatPace(activity.avg_pace_seconds_per_km)}</dd></div>
  </dl>
  <p class="mt-2 text-sm text-muted-foreground">“—”表示缺失或无法可靠计算。指标版本：{activity.metrics_version}</p>
  <section class="mt-7" aria-labelledby="route-title"><h2 id="route-title" class="text-xl font-semibold">路线</h2>
    {#if route}<RouteMap {route} />{:else if routeLoading}<p role="status" class="mt-4">正在读取路线…</p>{:else if routeError}<p role="alert" class="mt-4 text-red-700">{routeError}</p><button onclick={() => void loadRoute(activity!.id)} class="mt-2 text-primary underline">重新读取路线</button>{:else}<p class="mt-4 text-muted-foreground">此活动没有路线。</p>{/if}
  </section>
  <section class="mt-7 rounded-xl border border-border bg-white p-5" aria-labelledby="quality-title"><h2 id="quality-title" class="text-xl font-semibold">数据质量</h2><p class="mt-3">{qualityLabel(activity.temporal_quality)}</p>
    {#if Object.keys(activity.quality_summary).length}<dl class="mt-3 space-y-2 text-sm">{#each qualityEntries(activity.quality_summary) as [key, value]}<div class="flex flex-wrap gap-2"><dt class="font-medium">{key}</dt><dd class="break-all text-muted-foreground">{value}</dd></div>{/each}</dl>{:else}<p class="mt-3 text-sm text-muted-foreground">没有额外质量提示。</p>{/if}
  </section>
{:else if loading}<p role="status" class="mt-6">正在读取活动…</p>{/if}
