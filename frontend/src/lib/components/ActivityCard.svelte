<script lang="ts">
  import MetricSummary from './MetricSummary.svelte';
  import { formatDate, formatDistance, formatDuration, formatPace, qualityLabel, type Activity } from '#lib/api/activities.ts';
  let { activity }: { activity: Activity } = $props();
  const visibility = $derived(({ private: '私人', unlisted: '仅链接可见', public: '公开' })[activity.visibility] ?? '未标明');
</script>
<a href={`/activities/${activity.id}`} data-sveltekit-reload class="activity-card">
  <div class="record-heading">
    <div class="min-w-0"><time datetime={activity.activity_date}>{formatDate(activity.activity_date)}</time><h3>{activity.title || '未命名活动'}</h3></div>
    <span class="visibility">{visibility}</span>
  </div>
  <MetricSummary compact items={[{ label: '距离', value: formatDistance(activity.distance_m) }, { label: '用时', value: formatDuration(activity.elapsed_seconds) }, { label: '配速', value: formatPace(activity.avg_pace_seconds_per_km) }]} />
  <div class="record-footer"><span>{qualityLabel(activity.temporal_quality)}</span><span class="record-entry">查看活动 <span aria-hidden="true">→</span></span></div>
</a>
<style>
  .activity-card { display: block; padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); color: var(--foreground); }
  .activity-card:hover { border-color: var(--primary); }
  .record-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-6); }
  time { color: var(--muted-foreground); font-size: .8125rem; font-variant-numeric: tabular-nums; }
  h3 { margin-top: .375rem; font-size: 1.25rem; font-weight: 700; overflow-wrap: anywhere; }
  .visibility { flex-shrink: 0; padding: .125rem .5rem; border-radius: .375rem; background: var(--muted); color: var(--muted-foreground); font-size: .75rem; }
  .record-footer { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: .75rem; }
  .record-entry { color: var(--primary); font-weight: 550; flex-shrink: 0; }
  @media (max-width: 639px) { .activity-card { padding: var(--space-4); } .record-heading { margin-bottom: var(--space-4); } }
</style>
