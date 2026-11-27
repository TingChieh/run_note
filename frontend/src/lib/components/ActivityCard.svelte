<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import RouteThumbnail from './RouteThumbnail.svelte';
  import { activityAchievement } from '#lib/api/activity-labels.ts';
  import { formatDistance, formatDuration, activityDuration, formatPace, formatStartTime, qualityLabel, type Activity } from '#lib/api/activities.ts';
  let { activity, selectable = false, selected = false, disabled = false, current = false, appearance = 'default', onselect, onedit, ondelete, onopen, runner, route, href }: {
    activity: Activity; selectable?: boolean; selected?: boolean; disabled?: boolean; current?: boolean;
    appearance?: 'default' | 'ledger';
    runner?: { name: string; color: string; avatar: string | null; city?: string }; route?: import('#lib/api/activities.ts').Route | null; href?: string;
    onselect?: (selected: boolean) => void; onedit?: () => void; ondelete?: () => void; onopen?: (event: MouseEvent) => void;
  } = $props();
  const achievement = $derived(activityAchievement(activity.distance_m));
  const incomplete = $derived(activity.temporal_quality !== 'complete');
  const ledger = $derived(appearance === 'ledger');
  const editing = $derived(selectable || !!onedit || !!ondelete);
  const splitFigure = (value: string) => {
    const match = /^(.*\d)\s+(\S+)$/.exec(value);
    return match ? { number: match[1], unit: match[2] } : { number: value, unit: '' };
  };
  const distance = $derived(splitFigure(formatDistance(activity.distance_m)));
  const durationText = $derived(formatDuration(activityDuration(activity)));
  const pace = $derived(splitFigure(formatPace(activity.avg_pace_seconds_per_km)));
  const startClock = $derived(activity.started_at ? formatStartTime(activity.started_at, activity.timezone).slice(0, 5) : '');
</script>
<article class="activity-card" class:ledger class:editing class:selected class:current>
  {#if selectable}<label class="card-selection"><input type="checkbox" aria-label={`选择 ${activity.title}`} checked={selected} {disabled} onchange={event => onselect?.(event.currentTarget.checked)} /></label>{/if}
  <a href={href ?? view.href(`/activities/${activity.id}`)} class="card-link" data-activity-id={activity.id} aria-current={current ? 'true' : undefined} onclick={onopen}>
    {#if ledger}
      <div class="card-link-inner">
        <RouteThumbnail {activity} initialRoute={route} managedRoute={route !== undefined} color={runner?.color} compact />
        <div class="card-main">
          <h3>{activity.title || '未命名活动'}</h3>
          {#if runner}<p class="card-runner" style:color={runner.color}><span class="runner-icon">{#if runner.avatar}<img src={runner.avatar} alt="" />{:else}{Array.from(runner.name)[0]}{/if}</span>{runner.name}{#if runner.city} · {runner.city}{/if}</p>{/if}
          {#if startClock && startClock !== '—' || achievement || activity.category || activity.tags?.length || incomplete}
            <p class="card-meta">
              {#if startClock && startClock !== '—'}<span class="meta-time">{startClock} 开始</span>{/if}
              {#if achievement}<span class="meta-accent">{achievement}</span>{/if}
              {#if activity.category}<span class="meta-accent">{activity.category}</span>{/if}
              {#each activity.tags ?? [] as tag}<span class="meta-item">#{tag}</span>{/each}
              {#if incomplete}<span class="meta-warn">{qualityLabel(activity.temporal_quality)}</span>{/if}
            </p>
          {/if}
        </div>
        <div class="card-figures-row">
          <span class="col-fig col-dist"><span class="sr-only">距离 </span><b>{distance.number}</b>{#if distance.unit}{' '}<span class="figure-unit">{distance.unit}</span>{/if}{#if distance.number === '—'}<span class="sr-only">（缺失）</span>{/if}</span>
          <span class="col-fig col-dur"><span class="sr-only"> 用时 </span><span class:muted={durationText === '—'}>{durationText}</span>{#if durationText === '—'}<span class="sr-only">（缺失）</span>{/if}</span>
          <span class="col-fig col-pace"><span class="sr-only"> 配速 </span><span class:muted={pace.number === '—'}>{pace.number}</span>{#if pace.unit}{' '}<span class="figure-unit">{pace.unit}</span>{/if}{#if pace.number === '—'}<span class="sr-only">（缺失）</span>{/if}</span>
        </div>
      </div>
    {:else}
      <RouteThumbnail {activity} initialRoute={route} managedRoute={route !== undefined} color={runner?.color} compact />
      <div class="card-main">
        <h3>{activity.title || '未命名活动'}</h3>
        {#if runner}<p class="card-runner" style:color={runner.color}><span class="runner-icon">{#if runner.avatar}<img src={runner.avatar} alt="" />{:else}{Array.from(runner.name)[0]}{/if}</span>{runner.name}{#if runner.city} · {runner.city}{/if}</p>{/if}
        {#if achievement || activity.category || activity.tags?.length || incomplete}
          <p class="card-labels">
            {#if achievement}<span class="chip achievement">{achievement}</span>{/if}
            {#if activity.category}<span class="chip category">{activity.category}</span>{/if}
            {#each activity.tags ?? [] as tag}<span class="chip">#{tag}</span>{/each}
            {#if incomplete}<span class="chip warn">{qualityLabel(activity.temporal_quality)}</span>{/if}
          </p>
        {/if}
        <p class="card-figures"><span class="sr-only">距离 </span><b>{formatDistance(activity.distance_m)}</b><span class="sr-only"> 用时 </span><span>{durationText}</span><span class="sr-only"> 配速 </span><span>{formatPace(activity.avg_pace_seconds_per_km)}</span></p>
      </div>
    {/if}
  </a>
  {#if onedit || ondelete}<div class="card-actions">
    {#if onedit}<button type="button" {disabled} onclick={onedit} aria-label={`编辑 ${activity.title}`}>编辑</button>{/if}
    {#if ondelete}<button type="button" class:danger={ledger} {disabled} onclick={ondelete} aria-label={`删除 ${activity.title}`}>删除</button>{/if}
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
  .card-runner { display:flex; align-items:center; gap:var(--space-1); font-size:var(--text-small); font-weight:var(--weight-semibold); }
  .runner-icon { display:inline-grid; place-items:center; width:1.4rem; height:1.4rem; border-radius:50%; background:var(--muted); overflow:hidden; }
  .runner-icon img { width:100%; height:100%; object-fit:cover; }
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

  /* Editorial Receipt ledger row (brand.md §4, §6.7).
     Measure .card-link's remaining width (after checkbox/edit actions) so 1024px and 320px edit mode never squish title/metrics to zero width. */
  .activity-card.ledger {
    container: card / inline-size;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    padding-right: 0;
    transition: none;
  }
  .activity-card.ledger.editing {
    flex-wrap: wrap;
  }
  .activity-card.ledger:hover,
  .activity-card.ledger.selected,
  .activity-card.ledger.current {
    border-color: transparent;
    box-shadow: none;
    background: transparent;
  }
  .activity-card.ledger .card-selection {
    min-width: 2.5rem;
    padding-left: 0;
  }
  .activity-card.ledger .card-link {
    display: block;
    flex: 1 1 0;
    min-width: 0;
    padding: 0;
    container: link / inline-size;
  }
  .card-link-inner {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) 5.5rem 4.25rem 5.5rem;
    align-items: center;
    gap: var(--space-3);
    min-height: 3.75rem;
    padding: var(--space-2) var(--space-2) var(--space-2) 0;
  }
  .card-link-inner :global(.route-thumbnail) {
    width: 3.5rem;
    max-width: 100%;
    height: 2.5rem;
    border-radius: var(--radius-sheet);
    background: var(--recap-well);
  }
  .activity-card.ledger h3 {
    line-height: var(--line-height-heading);
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 .35rem;
    margin-top: .125rem;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-heading);
  }
  .card-meta > span {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .card-meta > span:not(:last-child)::after {
    content: '·';
    margin-left: .35rem;
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .meta-time {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .meta-accent {
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .meta-warn {
    color: var(--warning);
    font-weight: var(--weight-medium);
  }
  .card-figures-row {
    display: contents;
  }
  .col-fig {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .col-dist b {
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    color: var(--foreground);
  }
  .col-dur,
  .col-pace {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-tight);
    color: var(--foreground);
  }
  .col-fig .figure-unit {
    font-size: var(--text-caption);
  }
  .col-fig .muted {
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .activity-card.ledger .card-actions {
    padding-right: var(--space-2);
  }
  .activity-card.ledger .card-actions button {
    border-color: var(--control-border);
    border-radius: var(--radius-control);
    background: transparent;
    font-weight: var(--weight-semibold);
  }
  .activity-card.ledger .card-actions button.danger {
    color: var(--error);
  }
  @media (hover: hover) {
    .activity-card.ledger .card-actions button:hover:enabled {
      background: var(--muted);
      border-color: var(--control-border);
      color: var(--foreground);
    }
    .activity-card.ledger .card-actions button.danger:hover:enabled {
      color: var(--error);
    }
  }
  @container card (max-width: 26rem) {
    .activity-card.ledger.editing .card-selection {
      min-width: 2.25rem;
    }
    .activity-card.ledger.editing .card-actions {
      flex: 0 0 100%;
      justify-content: flex-end;
      padding: 0 var(--space-1) var(--space-2) 2.25rem;
    }
  }
  @container link (max-width: 31rem) {
    .card-link-inner {
      grid-template-columns: 3rem minmax(0, 1fr);
      grid-template-rows: auto auto;
      align-items: center;
      gap: .25rem var(--space-2);
      padding: var(--space-2) var(--space-1) var(--space-2) 0;
    }
    .card-link-inner :global(.route-thumbnail) {
      grid-row: 1 / span 2;
      width: 3rem;
      height: 2.25rem;
    }
    .card-link-inner .card-main {
      grid-column: 2;
      grid-row: 1;
    }
    .card-link-inner .card-figures-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: .125rem var(--space-3);
      grid-column: 2;
      grid-row: 2;
    }
    .card-link-inner .col-fig {
      text-align: left;
    }
    .card-link-inner .col-dist b {
      font-size: var(--text-body);
    }
    .card-link-inner .col-dur,
    .card-link-inner .col-pace {
      font-size: var(--text-small);
      color: var(--muted-foreground);
      font-weight: var(--weight-medium);
    }
  }
  @container link (max-width: 14rem) {
    .card-link-inner {
      grid-template-columns: 2.5rem minmax(0, 1fr);
    }
    .card-link-inner :global(.route-thumbnail) {
      width: 2.5rem;
      height: 2rem;
    }
  }
</style>
