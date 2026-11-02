<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import RouteThumbnail from './RouteThumbnail.svelte';
  import { activityAchievement } from '#lib/api/activity-labels.ts';
  import { formatDistance, formatDuration, activityDuration, formatPace, qualityLabel, type Activity } from '#lib/api/activities.ts';
  let { activity, selectable = false, selected = false, disabled = false, current = false, onselect, onedit, ondelete, onopen }: {
    activity: Activity; selectable?: boolean; selected?: boolean; disabled?: boolean; current?: boolean;
    onselect?: (selected: boolean) => void; onedit?: () => void; ondelete?: () => void; onopen?: (event: MouseEvent) => void;
  } = $props();
  const achievement = $derived(activityAchievement(activity.distance_m));
  const incomplete = $derived(activity.temporal_quality !== 'complete');
</script>
<article class="activity-card" class:selected class:current>
  {#if selectable}<label class="card-selection"><input type="checkbox" aria-label={`选择 ${activity.title}`} checked={selected} {disabled} onchange={event => onselect?.(event.currentTarget.checked)} /></label>{/if}
  <a href={view.href(`/activities/${activity.id}`)} class="card-link" data-activity-id={activity.id} aria-current={current ? 'true' : undefined} onclick={onopen}>
    <RouteThumbnail {activity} compact />
    <div class="card-main">
      <h3>{activity.title || '未命名活动'}</h3>
      {#if achievement || activity.category || activity.tags?.length || incomplete}
        <p class="card-labels">
          {#if achievement}<span class="chip achievement">{achievement}</span>{/if}
          {#if activity.category}<span class="chip category">{activity.category}</span>{/if}
          {#each activity.tags ?? [] as tag}<span class="chip">#{tag}</span>{/each}
          {#if incomplete}<span class="chip warn">{qualityLabel(activity.temporal_quality)}</span>{/if}
        </p>
      {/if}
      <p class="card-figures"><span class="sr-only">距离 </span><b>{formatDistance(activity.distance_m)}</b><span class="sr-only"> 用时 </span><span>{formatDuration(activityDuration(activity))}</span><span class="sr-only"> 配速 </span><span>{formatPace(activity.avg_pace_seconds_per_km)}</span></p>
    </div>
  </a>
  {#if onedit || ondelete}<div class="card-actions">
    {#if onedit}<button type="button" {disabled} onclick={onedit} aria-label={`编辑 ${activity.title}`}>编辑</button>{/if}
    {#if ondelete}<button type="button" {disabled} onclick={ondelete} aria-label={`删除 ${activity.title}`}>删除</button>{/if}
  </div>{/if}
</article>
<style>
  .activity-card { display: flex; align-items: center; gap: var(--space-2); min-width: 0; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); color: var(--foreground); padding-right: var(--space-2); transition: border-color var(--transition-control), box-shadow var(--motion-hover), background-color var(--transition-control); }
  @media (hover: hover) { .activity-card:hover { border-color: var(--primary); } }
  .activity-card.selected, .activity-card.current { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
  .activity-card.current { background: color-mix(in srgb, var(--primary) 7%, var(--surface)); }
  .card-selection { display: grid; place-items: center; flex: none; min-width: 2.75rem; min-height: 2.75rem; padding-left: var(--space-1); cursor: pointer; }
  .card-selection input { width: 1.125rem; height: 1.125rem; accent-color: var(--primary); }
  .card-link { display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; padding: var(--space-3) var(--space-3); color: inherit; }
  .card-link:focus-visible { outline-offset: -3px; }
  .card-link :global(.route-thumbnail) { flex: none; width: 3.5rem; height: 2.75rem; aspect-ratio: auto; }
  /* The thumbnail is too small for its "no route" caption: keep it for screen readers only. */
  .card-link :global(.thumbnail-empty p) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .card-main { min-width: 0; flex: 1; }
  h3 { font-size: var(--text-body); font-weight: var(--weight-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-labels { display: flex; flex-wrap: wrap; gap: .25rem .375rem; margin-top: .25rem; }
  .chip { max-width: 100%; padding: .0625rem .5rem; border-radius: .4rem; background: var(--muted); color: var(--muted-foreground); font-size: var(--text-caption); overflow-wrap: anywhere; }
  .chip.achievement, .chip.category { color: var(--primary); background: var(--route-thumbnail); }
  .chip.achievement { font-weight: var(--weight-bold); }
  .chip.warn { color: var(--warning); background: var(--warning-soft); }
  .card-figures { display: flex; align-items: baseline; flex-wrap: wrap; gap: .125rem var(--space-3); margin-top: .25rem; color: var(--muted-foreground); font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  .card-figures b { color: var(--foreground); font-size: var(--text-body); font-weight: var(--weight-bold); }
  .card-actions { display: flex; flex-wrap: wrap; gap: .375rem; flex: none; }
  .card-actions button { min-height: 2.75rem; padding: .375rem .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--surface); color: var(--foreground); font-size: var(--text-small); }
  @media (hover: hover) { .card-actions button:hover:enabled { border-color: var(--primary); color: var(--primary); } }
  .card-actions button:disabled { opacity: .5; cursor: not-allowed; }
  @media (max-width: 639px) { .card-link { gap: var(--space-2); padding: var(--space-2) var(--space-2); } .card-link :global(.route-thumbnail) { width: 3.25rem; height: 2.5rem; } }
</style>
