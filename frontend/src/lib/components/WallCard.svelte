<script lang="ts">
  import { formatDistance, formatDuration, activityDuration, formatPace, type Activity, type Route } from '#lib/api/activities.ts';
  import RouteThumbnail from './RouteThumbnail.svelte';
  let { activity, route = null, managedRoute = false, routeLoading = false, routeError = '' }: { activity: Activity; route?: Route | null; managedRoute?: boolean; routeLoading?: boolean; routeError?: string } = $props();
</script>
<a class="wall-card" href={`/activities/${activity.id}`}>
  <RouteThumbnail {activity} initialRoute={route} {managedRoute} {routeLoading} {routeError} />
  <div class="wall-card-copy"><p class="wall-date">{activity.activity_date} <span aria-hidden="true">↗</span></p><h3>{activity.title || '未命名活动'}</h3><strong class="wall-distance">{formatDistance(activity.distance_m)}</strong><p class="wall-facts"><span>用时 {formatDuration(activityDuration(activity))}</span><span>配速 {formatPace(activity.avg_pace_seconds_per_km)}</span></p></div>
</a>
<style>
  .wall-card{display:block;min-width:0;height:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:.7rem;transition:border-color .15s ease;}.wall-card:hover{border-color:var(--primary);}.wall-card-copy{padding:.7rem .4rem .3rem;}.wall-date{display:flex;justify-content:space-between;color:var(--muted-foreground);font-size:.75rem;font-variant-numeric:tabular-nums;}h3{font-size:1rem;font-weight:650;margin-top:.4rem;overflow-wrap:anywhere;}.wall-distance{display:block;font-size:1.8rem;font-weight:750;letter-spacing:-.035em;margin-top:.6rem;color:var(--primary);font-variant-numeric:tabular-nums;}.wall-facts{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.3rem;margin:.4rem 0;color:var(--muted-foreground);font-size:.75rem;font-variant-numeric:tabular-nums;}
</style>
