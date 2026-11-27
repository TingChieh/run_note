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
  .route-card { position: relative; display: grid; background: var(--paper); border: 1px solid var(--border); border-radius: var(--radius-sheet); overflow: hidden; min-width: 0; transition: border-color var(--transition-control); }
  svg { display: block; width: 100%; aspect-ratio: 360/220; padding: .65rem; background: var(--route-thumbnail); border-bottom: 1px solid var(--border); }
  svg path { fill: none; stroke: var(--primary); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .body { display: grid; gap: var(--space-2); padding: var(--space-4); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); }
  h2 a { color: var(--foreground); }
  h2 a::after { content: ''; position: absolute; inset: 0; }
  @media (hover: hover) { .route-card:hover { border-color: var(--rule); } }
  .route-card:has(a:focus-visible) { outline: 2px solid var(--ring); outline-offset: 3px; }
  /* The card draws the ring through :has(); keep the link's own outline where it is unsupported. */
  @supports selector(:has(*)) { h2 a:focus-visible { outline: none; } }
  .count { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1); font-family: var(--font-mono); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
  .count strong { color: var(--primary); font-weight: var(--weight-bold); }
  .count span, dt { color: var(--muted-foreground); font-size: var(--text-caption); }
  dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border); }
  dl > div { min-width: 0; }
  dl > div + div { padding-left: var(--space-2); border-left: 1px solid var(--border); }
  dd { margin-top: var(--space-1); font-size: var(--text-small); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
