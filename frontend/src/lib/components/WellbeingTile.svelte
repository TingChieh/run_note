<script lang="ts">
  import type { Snippet } from 'svelte';
  import { TONES, type ToneKey } from './wellbeing-tones.ts';
  // The frame of one journal widget, built like the home page's metric cards: a flat surface card with the card radius, a solid round icon badge
  // (the measure's own colour, dark glyph), the name, and the content below. `subtitle` (the direction of the scale) is read aloud only, not shown. The × returns the answer to "未填写".
  let { metric, title, subtitle = '', onclear, clearLabel = '', disabled = false, testid, dashed = false, span = false, actions, children }: { metric: ToneKey; title: string; subtitle?: string; onclear?: (() => void) | null; clearLabel?: string; disabled?: boolean; testid?: string; dashed?: boolean; span?: boolean; actions?: Snippet; children: Snippet } = $props();
  const id = $props.id();
  const tone = $derived(TONES[metric]);
</script>
<section class="tile" class:dashed class:span role="group" aria-labelledby={`${id}-label`} aria-describedby={subtitle ? `${id}-desc` : undefined} style:--tone={`var(${tone.color})`} data-metric={metric} data-testid={testid}>
  <header>
    <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={tone.icon} /></svg></span>
    <span class="text"><span id={`${id}-label`} class="name">{title}</span></span>
    {#if actions}<span class="corner">{@render actions()}</span>{/if}
    {#if onclear}<button type="button" class="clear" {disabled} onclick={onclear} aria-label={clearLabel} title="清除"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>{/if}
  </header>
  {#if subtitle}<span id={`${id}-desc`} class="sr-only">{subtitle}</span>{/if}
  <div class="body">{@render children()}</div>
</section>
<style>
  .tile { position: relative; container-type: inline-size; display: grid; gap: var(--space-3); min-width: 0; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  /* A card stretched to its row's height shares the spare room between its rows; the header stays at the top so every card's name lines up. */
  header { display: flex; align-items: center; align-self: start; gap: var(--space-3); min-width: 0; }
  /* Same recipe as the metric icons on the home page: a solid colour disc with a dark glyph. */
  .badge { display: grid; place-items: center; flex: none; width: 3rem; height: 3rem; border-radius: 50%; background: color-mix(in srgb, var(--tone) 62%, white); color: var(--sport-ink, #20332b); }
  .text { display: grid; flex: 1; min-width: 0; line-height: var(--line-height-heading); }
  .name { font-size: var(--text-body); font-weight: var(--weight-semibold); overflow-wrap: anywhere; }
  /* The × sits on the header's row, after the name and centred with the badge; its touch area is padded out to 44px. */
  .clear { position: relative; display: grid; flex: none; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--muted-foreground); cursor: pointer; }
  .clear::after { content: ''; position: absolute; inset: -.25rem; }
  @media (hover: hover) { .clear:not(:disabled):hover { border-color: var(--control-hover-border); color: var(--foreground); } }
  .clear:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .tile.dashed { border-style: dashed; background: transparent; }
  .tile.span { grid-column: 1 / -1; }
  /* Small round buttons on the header's row, after the name and centred with the badge. */
  .corner { display: flex; flex: none; align-items: center; gap: var(--space-1); }
  .body { --dial: 10.25rem; display: grid; gap: var(--space-2); min-width: 0; }
  @media (max-width: 639px) { .tile { padding: 1.125rem; } }
  @container (max-width: 15rem) { .body { --dial: 8.25rem; } .badge { width: 2.5rem; height: 2.5rem; } }
</style>
