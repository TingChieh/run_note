<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  import { formatDate, formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { CATEGORY_NAMES, CATEGORY_RANGES, type CategoryBest } from '#lib/api/records.ts';
  let { bests }: { bests: CategoryBest[] } = $props();
  const view = useViewContext();
</script>
<div class="personal-bests">
  {#each bests as item (item.category)}
    {@const name = CATEGORY_NAMES[item.category]}
    <article class="pb-card" data-testid={`pb-${item.category}`}>
      <p class="pb-eyebrow">{name} 最佳</p>
      {#if item.best}
        <p class="pb-pace">{formatPace(item.best.avg_pace_seconds_per_km)}</p>
        <dl class="pb-facts">
          <div><dt>用时</dt><dd>{formatDuration(item.best.duration_seconds)}</dd></div>
          <div><dt>距离</dt><dd>{formatDistance(item.best.distance_m)}</dd></div>
          <div><dt>日期</dt><dd>{formatDate(item.best.activity_date)}</dd></div>
        </dl>
        <p class="pb-note">共 {item.best.qualifying_count} 次 {name} 级跑步，按配速排名；不含轨迹途中分段。</p>
        <a class="button-secondary" href={view.href(`/activities/${item.best.activity_id}`)}>查看这次跑步</a>
      {:else}
        <p class="pb-empty">还没有符合条件的 {name} 记录</p>
        <p class="pb-note">需要距离在 {CATEGORY_RANGES[item.category]} 且有可靠用时的整次跑步。</p>
      {/if}
    </article>
  {/each}
</div>
<style>
  .personal-bests { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
  .pb-card { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .pb-eyebrow { color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .pb-pace { color: var(--primary); font-size: var(--text-stat); font-weight: var(--weight-semibold); line-height: var(--line-height-tight); }
  .pb-facts { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  .pb-facts dt { color: var(--muted-foreground); font-size: var(--text-small); }
  .pb-facts dd { font-weight: var(--weight-semibold); }
  .pb-note { color: var(--muted-foreground); font-size: var(--text-small); }
  .pb-empty { font-weight: var(--weight-semibold); }
  @media (max-width: 640px) { .personal-bests { grid-template-columns: minmax(0, 1fr); } }
</style>
