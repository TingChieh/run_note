<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import MetricSummary from './MetricSummary.svelte';
  import RouteThumbnail from './RouteThumbnail.svelte';
  import { activityAchievement } from '#lib/api/activity-labels.ts';
  import { formatDate, formatDistance, formatDuration, activityDuration, formatPace, qualityLabel, type Activity } from '#lib/api/activities.ts';
  let { activity, selectable = false, selected = false, disabled = false, onselect, onedit, ondelete }: {
    activity: Activity; selectable?: boolean; selected?: boolean; disabled?: boolean;
    onselect?: (selected: boolean) => void; onedit?: () => void; ondelete?: () => void;
  } = $props();
  const achievement = $derived(activityAchievement(activity.distance_m));
</script>
<article class="activity-card" class:selected>
  {#if selectable || onedit || ondelete}
    <div class="card-controls">
      {#if selectable}
        <label class="card-selection"><input type="checkbox" aria-label={`选择 ${activity.title}`} checked={selected} {disabled} onchange={event => onselect?.(event.currentTarget.checked)} /><span>选择</span></label>
      {/if}
      {#if onedit || ondelete}<div class="card-actions">
        {#if onedit}<button type="button" {disabled} onclick={onedit} aria-label={`编辑 ${activity.title}`}>编辑</button>{/if}
        {#if ondelete}<button type="button" {disabled} onclick={ondelete} aria-label={`删除 ${activity.title}`}>删除</button>{/if}
      </div>{/if}
    </div>
  {/if}
  <a href={view.href(`/activities/${activity.id}`)} class="card-link">
  <div class="record-heading">
    <div class="record-identity">
      <div class="record-meta"><time datetime={activity.activity_date}>{formatDate(activity.activity_date)}</time><span class="visibility">公开展示</span></div>
      <h3>{activity.title || '未命名活动'}</h3>
      {#if activity.category || activity.tags?.length || achievement}
        <div class="record-labels">
          {#if activity.category}<span class="record-chip category">{activity.category}</span>{/if}
          {#each activity.tags ?? [] as tag}<span class="record-chip">#{tag}</span>{/each}
          {#if achievement}<span class="record-chip achievement">{achievement}</span>{/if}
        </div>
      {/if}
    </div>
    <RouteThumbnail {activity} compact />
  </div>
  <MetricSummary compact items={[{ label: '距离', value: formatDistance(activity.distance_m) }, { label: '用时', value: formatDuration(activityDuration(activity)) }, { label: '配速', value: formatPace(activity.avg_pace_seconds_per_km) }]} />
  <div class="record-footer"><span>{qualityLabel(activity.temporal_quality)}</span><span class="record-entry">查看活动 <span aria-hidden="true">→</span></span></div>
  </a>
</article>
<style>
  .activity-card { min-width: 0; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); color: var(--foreground); }
  .activity-card:hover { border-color: var(--primary); }
  .activity-card.selected { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
  .card-link { display: block; min-width: 0; padding: var(--space-6); color: inherit; }
  .card-link:focus-visible { outline-offset: -3px; }
  .card-controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); }
  .card-selection { display: inline-flex; align-items: center; gap: .5rem; min-height: 2.75rem; color: var(--muted-foreground); font-size: .8125rem; cursor: pointer; }
  .card-selection input { width: 1.125rem; height: 1.125rem; accent-color: var(--primary); }
  .card-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-left: auto; }
  .card-actions button { min-height: 2.75rem; padding: .5rem .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); color: var(--foreground); font-size: .8125rem; }
  .card-actions button:hover:enabled { border-color: var(--primary); color: var(--primary); }
  .card-actions button:disabled { opacity: .5; cursor: not-allowed; }
  .record-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }
  .record-heading :global(.route-thumbnail) { flex-shrink: 0; }
  .record-identity { min-width: 0; flex: 1; }
  .record-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  time { color: var(--muted-foreground); font-size: .8125rem; font-variant-numeric: tabular-nums; }
  h3 { margin-top: .375rem; font-size: 1.25rem; font-weight: 700; overflow-wrap: anywhere; }
  .visibility { flex-shrink: 0; padding: .125rem .5rem; border-radius: .375rem; background: var(--muted); color: var(--muted-foreground); font-size: .75rem; }
  .record-labels { display: flex; flex-wrap: wrap; gap: .375rem; margin-top: .625rem; }
  .record-chip { max-width: 100%; padding: .25rem .5rem; border-radius: .5rem; background: var(--muted); color: var(--muted-foreground); font-size: .75rem; overflow-wrap: anywhere; }
  .category, .achievement { color: var(--primary); background: var(--route-thumbnail); }
  .achievement { font-weight: 700; }
  .record-footer { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: .75rem; }
  .record-entry { color: var(--primary); font-weight: 550; flex-shrink: 0; }
  @media (max-width: 639px) { .card-link { padding: var(--space-4); } }
</style>
