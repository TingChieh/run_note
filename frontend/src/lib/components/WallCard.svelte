<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import { formatDistance, formatDuration, activityDuration, formatPace, type Activity, type Route, type ActivityError } from '#lib/api/activities.ts';
  import { cardTilt } from '#lib/styles/card-tilt.ts';
  import RouteThumbnail from './RouteThumbnail.svelte';
  let { activity, route = null, managedRoute = false, routeLoading = false, routeError = '', compact = false, headingLevel = 3, onselect, selected = false, centered, interactive = false, onauthrequired }: { onselect?: () => void; selected?: boolean; centered?: boolean; interactive?: boolean; onauthrequired?: (cause: ActivityError) => void; activity: Activity; compact?: boolean; headingLevel?: 2 | 3; route?: Route | null; managedRoute?: boolean; routeLoading?: boolean; routeError?: string } = $props();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let title = $derived(activity.title || '未命名活动');
  // Imported runs default to "跑步 · <date>"; the deck already shows the date.
  let heading = $derived(interactive && title === `跑步 · ${activity.activity_date}` ? '跑步' : title);
  let dateLabel = $derived.by(() => {
    const day = new Date(`${activity.activity_date}T00:00:00Z`);
    return interactive && !Number.isNaN(day.getTime()) ? `${activity.activity_date.replaceAll('-', '.')} 周${weekdays[day.getUTCDay()]}` : activity.activity_date;
  });
</script>
{#snippet content()}
  <RouteThumbnail {activity} initialRoute={route} {managedRoute} {routeLoading} {routeError} {onauthrequired} />
  <div class="wall-card-copy"><p class="wall-date">{dateLabel} {#if !interactive}<span aria-hidden="true">↗</span>{/if}</p>{#if headingLevel === 2}<h2 class="wall-title" {title}>{heading}</h2>{:else}<h3 class="wall-title" {title}>{heading}</h3>{/if}<strong class="wall-distance">{formatDistance(activity.distance_m)}</strong><p class="wall-facts"><span><span class:sr-only={interactive}>{'用时 '}</span>{formatDuration(activityDuration(activity))}</span><span class="fact-separator" aria-hidden="true">·</span><span><span class:sr-only={interactive}>{'配速 '}</span>{formatPace(activity.avg_pace_seconds_per_km)}</span></p></div>
{/snippet}
{#if onselect}
  <button type="button" class="wall-card" class:compact class:interactive class:centered={interactive && (centered ?? selected)}
    aria-label={`查看跑步记录：${title}，${activity.activity_date}`}
    aria-pressed={selected} onclick={onselect} use:cardTilt={interactive && (centered ?? selected)}>
    {@render content()}
  </button>
{:else}
  <a class="wall-card" class:compact href={view.href(`/activities/${activity.id}`)}>{@render content()}</a>
{/if}
<style>
  .wall-card{display:block;min-width:0;height:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:.7rem;transition:border-color .15s ease;}.wall-card:hover{border-color:var(--primary);}.wall-card-copy{padding:.7rem .4rem .3rem;}.wall-date{display:flex;justify-content:space-between;color:var(--muted-foreground);font-size:.75rem;font-variant-numeric:tabular-nums;}.wall-title{font-size:1rem;font-weight:650;margin-top:.4rem;overflow-wrap:anywhere;}.wall-distance{display:block;font-size:1.8rem;font-weight:750;letter-spacing:-.035em;margin-top:.6rem;color:var(--primary);font-variant-numeric:tabular-nums;}.wall-facts{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.3rem;margin:.4rem 0;color:var(--muted-foreground);font-size:.75rem;font-variant-numeric:tabular-nums;}
  .compact{padding:var(--space-2);}
  .compact :global(.route-thumbnail){aspect-ratio:2/1;border-radius:var(--radius-control);}
  .compact .wall-card-copy{padding:var(--space-2) var(--space-1) var(--space-1);}
  .compact .wall-title{font-size:.875rem;margin-top:var(--space-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .compact .wall-distance{font-size:1.5rem;margin-top:var(--space-2);}
  .compact .wall-facts{margin:var(--space-1) 0;gap:var(--space-1);}
  /* Deck typography follows the card width (each stack slot is a size container). */
  .interactive{position:relative;transform-style:preserve-3d;width:100%;text-align:left;cursor:pointer;padding:clamp(var(--space-2),5cqi,var(--space-3));transform:perspective(700px) rotateX(var(--card-rotate-x,0deg)) rotateY(var(--card-rotate-y,0deg)) scale(calc(1 + var(--card-highlight,0) * .035));transition:border-color var(--motion-reveal),box-shadow var(--motion-reveal);box-shadow:0 var(--space-2) var(--space-6) var(--glass-shadow);}
  .interactive.centered{box-shadow:0 var(--space-4) var(--space-8) var(--glass-shadow),0 var(--space-1) var(--space-2) var(--glass-shadow);}
  .interactive::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(circle at var(--card-light-x,50%) var(--card-light-y,50%),color-mix(in srgb,var(--primary) 16%,transparent),transparent 62%);opacity:var(--card-highlight,0);}
  .interactive :global(.route-thumbnail){transform:translate3d(var(--card-shift-x,0px),var(--card-shift-y,0px),0);}
  .interactive .wall-card-copy{transform:translate3d(calc(var(--card-shift-x,0px) * .3),calc(var(--card-shift-y,0px) * .3),0);}
  .fact-separator{display:none;}
  .interactive :global(.route-thumbnail){aspect-ratio:3/2;}
  .interactive :global(.route-watermark){display:none;}
  .interactive :global(.route-thumbnail svg){padding:var(--space-1);}
  .interactive :global(.route-thumbnail svg path){stroke-width:3.5;}
  .interactive .wall-date{font-size:clamp(.6875rem,6.6cqi,.8125rem);}
  .interactive .wall-title{font-size:clamp(.875rem,8.4cqi,1.0625rem);}
  .interactive .wall-distance{font-size:clamp(1.375rem,14.5cqi,1.875rem);}
  .interactive .wall-facts{flex-wrap:nowrap;justify-content:flex-start;white-space:nowrap;font-size:clamp(.6875rem,6.2cqi,.8125rem);}
  .interactive .fact-separator{display:inline;}
  .interactive :global(.thumbnail-empty>span){font-size:1.5rem;line-height:1;}
  .interactive :global(.thumbnail-empty p){font-size:.6875rem;line-height:1.25;}
  .interactive[aria-pressed="true"]{border-color:var(--primary);}
  .interactive:focus-visible{outline:2px solid var(--primary);outline-offset:var(--space-1);}
  @media (prefers-reduced-motion:reduce),(hover:none),(pointer:coarse){.interactive{transform:none;}}
</style>
