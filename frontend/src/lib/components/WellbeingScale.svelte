<script lang="ts">
  import WellbeingDial from './WellbeingDial.svelte';
  import WellbeingTile from './WellbeingTile.svelte';
  import type { ToneKey } from './wellbeing-tones.ts';
  // One 0–10 measure as a widget: icon, name and direction, a round dial in the measure's colour, and what the two ends mean.
  // Until it is turned the answer is "未填写" (saved as empty, never 0).
  let { metric, label, hint, low, high, value = $bindable(null), disabled = false }: { metric: ToneKey; label: string; hint: string; low: string; high: string; value?: number | null; disabled?: boolean } = $props();
</script>
<WellbeingTile {metric} title={label} subtitle={hint} onclear={value === null ? null : () => { value = null; }} clearLabel={`清除${label}`} {disabled}>
  <WellbeingDial {label} {value} min={0} max={10} {disabled} middle={5} unit={value === null ? '' : '/10'} onvalue={(next) => { value = next; }} />
  <p class="ends"><span>{low}</span><span>{high}</span></p>
  <span class="sr-only" data-testid="scale-value">{value ?? ''}</span>
</WellbeingTile>
<style>
  .ends { display: flex; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-heading); }
</style>
