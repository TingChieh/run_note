<script lang="ts">
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import { routeDrawing } from '#lib/api/route-drawing.ts';
  import { shapeRoute, type RouteGroupItem } from '#lib/api/route-groups.ts';
  let { group, href }: { group: RouteGroupItem; href: string } = $props();
  const drawing = $derived(routeDrawing(shapeRoute(group.shape)));
  const name = $derived(`约 ${formatDistance(group.median_distance_m)} 路线`);
</script>
<article class="route-card" data-testid="route-card">
  <svg viewBox="0 0 360 220" role="img" aria-label={`${name}的路线轮廓`}>{#each drawing.paths as path}<path d={path} />{/each}</svg>
  <div class="body">
    <h2><a {href}>{name}</a></h2>
    <p class="count"><strong>{group.run_count} 次</strong><span>{group.first_date} – {group.last_date}</span></p>
    <dl>
      <div><dt>最佳用时</dt><dd>{formatDuration(group.best_duration_seconds)}</dd></div>
      <div><dt>平均用时</dt><dd>{formatDuration(group.avg_duration_seconds)}</dd></div>
      <div><dt>最佳配速</dt><dd>{formatPace(group.best_pace_seconds_per_km)}</dd></div>
    </dl>
  </div>
</article>
<style>
  .route-card { display: grid; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; min-width: 0; }
  svg { display: block; width: 100%; aspect-ratio: 360/220; padding: .65rem; background: var(--route-thumbnail); }
  svg path { fill: none; stroke: var(--primary); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .body { display: grid; gap: .5rem; padding: 1rem; }
  h2 { font-size: 1rem; font-weight: 650; }
  h2 a { color: var(--foreground); }
  h2 a::after { content: ''; position: absolute; inset: 0; }
  .route-card { position: relative; transition: border-color .15s, box-shadow .15s; }
  .route-card:hover { border-color: var(--primary); }
  .route-card:has(a:focus-visible) { outline: 2px solid var(--ring); outline-offset: 3px; }
  h2 a:focus-visible { outline: none; }
  .count { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .25rem; font-size: .875rem; }
  .count span, dt { color: var(--muted-foreground); font-size: .8125rem; }
  dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  dd { font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
