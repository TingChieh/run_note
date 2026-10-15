<script lang="ts">
  import { onMount } from 'svelte';
  import { ActivityError, readRoute, type Activity, type Route } from '#lib/api/activities.ts';
  import { routeDrawing } from '#lib/api/route-drawing.ts';
  let { activity, initialRoute = null, managedRoute = false, routeLoading = false, routeError = '', compact = false, onauthrequired }: { activity: Activity; initialRoute?: Route | null; managedRoute?: boolean; routeLoading?: boolean; routeError?: string; compact?: boolean; onauthrequired?: (cause: ActivityError) => void } = $props();
  let route = $state<Route | null>(null), loading = $state(true), error = $state('');
  let element: HTMLDivElement, active = false;
  let drawing = $derived(route ? routeDrawing(route) : null);
  $effect(()=>{
    if(managedRoute){route=initialRoute;loading=routeLoading;error=routeError;}
    else if(initialRoute){route=initialRoute;loading=false;error='';}
  });
  async function load() {
    loading=true;error='';
    try { const data=await readRoute(activity.id);if(active && !initialRoute)route=data; }
    catch(cause) { if(active){if(cause instanceof ActivityError && cause.status===401){route=null;if(onauthrequired)onauthrequired(cause);else window.location.replace('/login?reason=expired');return;}error='路线暂不可用';} }
    finally {if(active)loading=false;}
  }
  onMount(()=>{
    active=true;
    if(managedRoute)return()=>{active=false;};
    route=initialRoute;loading=activity.has_route&&!initialRoute;
    if(!activity.has_route || initialRoute)return()=>{active=false;};
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();void load();}},{rootMargin:'120px'});
    observer.observe(element);return()=>{active=false;observer.disconnect();};
  });
</script>
<div class="route-thumbnail" class:compact bind:this={element}>
  <span class="route-watermark" aria-hidden="true">RUNNOTE</span>
  {#if drawing}<svg viewBox="0 0 360 220" role="img" aria-label={`${activity.title || '未命名活动'}的路线轮廓`}>{#each drawing.paths as path}<path d={path} />{/each}{#each drawing.points as [x,y]}<circle cx={x} cy={y} r="3" />{/each}</svg>
  {:else}<div class="thumbnail-empty"><span aria-hidden="true">{activity.has_route?'↗':'◷'}</span><p>{loading?'正在描绘足迹…':error||'没有路线'}</p></div>{/if}
</div>
<style>
  .route-thumbnail{position:relative;aspect-ratio:360/220;overflow:hidden;display:grid;place-items:center;background:var(--route-thumbnail);border-radius:1rem;color:var(--primary);}
  .route-watermark{position:absolute;bottom:.6rem;right:.7rem;opacity:.22;letter-spacing:.15em;font-size:.65rem;font-weight:750;}
  svg{display:block;width:100%;height:100%;padding:.65rem;}svg path{fill:none;stroke:var(--primary);stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;}svg circle{fill:var(--primary);}
  .thumbnail-empty{text-align:center;}.thumbnail-empty>span{font-size:2.5rem;opacity:.4;}.thumbnail-empty p{font-size:.8rem;opacity:.8;}
  .compact { width: 104px; aspect-ratio: 4/3; border-radius: .625rem; }
  .compact .route-watermark { display: none; }
  .compact svg { padding: .25rem; }
  .compact .thumbnail-empty { padding: .25rem; }
  .compact .thumbnail-empty>span { font-size: 1.25rem; }
  .compact .thumbnail-empty p { font-size: .625rem; line-height: 1.35; }
  @media (max-width: 639px) { .compact { width: 80px; } }
</style>
