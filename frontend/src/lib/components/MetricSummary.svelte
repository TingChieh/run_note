<script lang="ts">
  let { items, compact = false, appearance = 'sport', stacked = false }: { items: { label: string; value: string; testId?: string; icon?: 'distance' | 'duration' | 'pace' | 'count' | 'days' }[]; compact?: boolean; appearance?: 'default' | 'sport'; stacked?: boolean } = $props();
</script>
<dl class="metrics" class:compact class:sport={appearance === 'sport' && !compact} class:stacked>
  {#each items as item}<div>
    <dt>    {#if appearance === 'sport' && !compact}<span class="metric-icon" class:duration={item.icon === 'duration' || item.icon === 'count'} class:pace={item.icon === 'pace' || item.icon === 'days'} aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {#if item.icon === 'count'}<path d="M6 5h12 M6 12h12 M6 19h12 M3 5h.01 M3 12h.01 M3 19h.01" />
      {:else if item.icon === 'days'}<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4 M17 3v4 M3 11h18 M8 16l3 3 5-5" />
      {:else if item.icon === 'duration'}<circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2 M9 2h6" />
      {:else if item.icon === 'pace'}<path d="M4 17a9 9 0 1 1 16 0 M12 13l4-5 M5 13h1 M18 13h1 M9 5l1 2" /><circle cx="12" cy="13" r="1.5" />
      {:else}<circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M5 8v5a4 4 0 0 0 4 4h2a4 4 0 0 0 0-8h-1a3 3 0 0 1 0-6h5" />{/if}
    </svg></span>{/if}{item.label}</dt>
    <dd data-testid={item.testId}>{item.value}{#if item.value === '—'}<span class="sr-only">（缺失或无法可靠计算）</span>{/if}</dd>
  </div>{/each}
</dl>
<style>
  .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
  .metrics > div { min-width: 0; padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  dt { color: var(--muted-foreground); font-size: .875rem; }
  dd { margin-top: var(--space-2); font-size: clamp(1.75rem, 3vw, 2.25rem); line-height: 1.25; font-weight: 700; letter-spacing: -.035em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .compact { gap: var(--space-3); }
  .compact > div { padding: 0; border: 0; border-radius: 0; background: transparent; }
  .compact dt { font-size: .75rem; }
  .compact dd { font-size: clamp(1rem, 2vw, 1.25rem); margin-top: .25rem; letter-spacing: -.02em; }
  .sport { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
  .sport.stacked { grid-template-columns: 1fr; }
  .sport > div { position: relative; padding: 1.4rem 1.5rem; border-radius: var(--radius-card); }
  .sport dt { padding-left: 4.5rem; font-size: .875rem; }
  .sport dd { padding-left: 4.5rem; margin-top: .25rem; font-size: clamp(1.65rem, 2.5vw, 2.8rem); letter-spacing: -.04em; }
  .metric-icon { position: absolute; left: 1.5rem; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 3.5rem; height: 3.5rem; border-radius: 50%; color: var(--sport-ink, #20332b); background: var(--sport-green, #86a912); }
  .metric-icon.duration { background: var(--sport-blue, #4bb6df); }
  .metric-icon.pace { background: var(--sport-coral, #f06373); }
  @media (min-width: 640px) and (max-width: 1199px) { .sport:not(.stacked) dt, .sport:not(.stacked) dd { padding-left: 0; } .sport:not(.stacked) .metric-icon { position: static; transform: none; margin-bottom: .75rem; } }
  @media (max-width: 639px) { .metrics:not(.compact) { grid-template-columns: 1fr; gap: var(--space-3); } .metrics:not(.compact):not(.sport) > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); } .metrics:not(.compact):not(.sport) dd { margin: 0; } .sport > div { padding: 1rem 1.25rem; } .sport dt, .sport dd { padding-left: 4rem; } .sport dd { font-size: 2.25rem; } .metric-icon { left: 1.25rem; width: 3rem; height: 3rem; } }
</style>
