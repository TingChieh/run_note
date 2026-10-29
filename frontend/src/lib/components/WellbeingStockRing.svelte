<script lang="ts">
  // The stock left, as a ring: the share of a reference amount (one box, or a month at the usual dose) that is still on the shelf. The number sits in the middle.
  let { fraction, value, unit, low = false, label }: { fraction: number | null; value: string; unit: string; low?: boolean; label: string } = $props();
  const R = 42, C = 2 * Math.PI * R;
  const shown = $derived(fraction === null ? 0 : Math.min(1, Math.max(0, fraction)));
</script>
<div class="ring" class:low role="img" aria-label={label} data-testid="wellbeing-stock-ring" data-fraction={fraction === null ? '' : shown.toFixed(3)}>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="track" cx="50" cy="50" r={R} />
    {#if shown > 0}<circle class="arc" cx="50" cy="50" r={R} stroke-dasharray={C} stroke-dashoffset={C * (1 - shown)} />{/if}
  </svg>
  <div class="center" aria-hidden="true"><strong>{value}</strong><span>{unit}</span></div>
</div>
<style>
  /* The page's global rule draws a 1px frame on images; a ring is not framed. */
  .ring { position: relative; width: min(100%, 10rem); aspect-ratio: 1; margin-inline: auto; box-shadow: none; --arc: var(--tone); }
  .ring.low { --arc: var(--warning); }
  svg { display: block; width: 100%; height: 100%; transform: rotate(-90deg); box-shadow: none; }
  circle { fill: none; stroke-width: 9; }
  .track { stroke: color-mix(in srgb, var(--tone) 22%, var(--surface)); }
  .arc { stroke: var(--arc); stroke-linecap: round; transition: stroke-dashoffset 600ms cubic-bezier(.22, .61, .36, 1); }
  .center { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; font-variant-numeric: tabular-nums; }
  .center strong { font-size: var(--text-title); font-weight: var(--weight-bold); line-height: var(--line-height-solid); }
  .center span { color: var(--muted-foreground); font-size: var(--text-small); }
  .ring.low .center strong { color: var(--warning); }
  @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
</style>
