<script lang="ts">
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { unfoldBar } from '#lib/styles/reveal-from-left.ts';
  import { attachMenuGlass } from '#lib/styles/menu-glass.ts';
  import { glassOptics, readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  // `glass` (opt-in): while the bar floats over other content it is liquid glass; once it rests at the end of its form, with nothing underneath, it is a plain card.
  let { form, dirty, busy, message = '', error = '', label, busyLabel = '正在保存…', ondiscard, glass = false }: { form: string; dirty: boolean; busy: boolean; message?: string; error?: string; label: string; busyLabel?: string; ondiscard: () => void; glass?: boolean } = $props();
  const visible = $derived(dirty || busy || !!message || !!error);
  let slot = $state<HTMLDivElement | undefined>(), bar = $state<HTMLDivElement | undefined>(), floating = $state(false);

  // The slot is sticky to the bottom edge of the viewport. It is floating exactly while its container still ends below that edge:
  // then the bar covers content. When the container ends above it, the bar sits at its natural place and covers nothing.
  $effect(() => {
    if (!glass || !slot) return;
    const parent = slot.parentElement;
    if (!parent) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const offset = parseFloat(getComputedStyle(slot!).bottom) || 0;
      floating = parent.getBoundingClientRect().bottom > window.innerHeight - offset + 2;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(parent);
    measure();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); observer.disconnect(); };
  });

  // Only the floating state carries the refracting material; reduced transparency and forced colors keep the solid card.
  $effect(() => {
    if (!glass || !floating || !bar) return;
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(forced-colors: active)').matches) return;
    // The same optics as the glass buttons (full refraction, no extra blur), so it reads like them rather than like frosted glass.
    const optics = (value: ReturnType<typeof readGlassSettings>) => ({ ...glassOptics(value, 1), chroma: 0 });
    const initial = readGlassSettings();
    const handle = attachMenuGlass(bar, initial);
    handle.update(optics(initial));
    const stop = watchGlassSettings(value => handle.update(optics(value)));
    return () => { stop(); handle.destroy(); };
  });
</script>
{#if visible}<div bind:this={slot} transition:unfoldBar class="save-bar-slot" class:save-glass={glass}><div bind:this={bar} class="save-bar" class:docked={glass && !floating} class:floating={glass && floating} data-glass={glass ? (floating ? 'floating' : 'docked') : undefined} role="region" aria-label="保存设置">
  {#if error}<FeedbackState kind="error" title={error} />{/if}
  <div class="save-bar-row">
    <p class="save-status" role="status">{#if busy}{busyLabel}{:else if dirty}有未保存的更改{:else if message}{message}{/if}</p>
    {#if dirty || busy}<button type="button" class="button-secondary" disabled={busy} onclick={ondiscard}>放弃</button><button type="submit" {form} class="button-primary" disabled={busy}>{busy ? '保存中…' : label}</button>{/if}
  </div>
</div></div>{/if}
<style>
  /* The glass bar stays slim and sits at the right end of its form. A page can give it a minimum width (`--save-min`, e.g. one widget column) so that its edges line up with the column above it; with no room for that it just hugs its content. */
  .save-glass { justify-self: end; width: max-content; min-width: min(100%, var(--save-min, 0px)); max-width: 100%; }
  .save-glass .save-bar { padding: var(--space-2) var(--space-3); gap: var(--space-2); }
  .save-glass .save-bar-row { flex-wrap: nowrap; gap: var(--space-3); }
  .save-glass .save-status { flex: 1 1 auto; white-space: nowrap; }
  @media (max-width: 479px) { .save-glass { justify-self: stretch; width: auto; } .save-glass .save-bar-row { flex-wrap: wrap; } .save-glass .save-status { white-space: normal; flex: 1 1 8rem; } }
  .save-bar { transition: background-color var(--transition-control), border-color var(--transition-control), box-shadow var(--transition-control); }
  /* At rest: a plain card, no blur and no float shadow. */
  .save-bar.docked { background: var(--surface); box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  /* Floating over content: the project's glass panel recipe, tinted like the glass buttons (a little above their fill, about 24% at the default transparency; the glass tuner still moves it). */
  .save-bar.floating { border-color: var(--glass-edge); background: color-mix(in srgb, var(--glass-fill-base, var(--surface)) calc((var(--glass-opacity, .14) + .1) * 100%), transparent); box-shadow: inset 0 1px var(--glass-sheen), 0 .75rem 2rem var(--glass-shadow); }
  /* The glass is clear, so the status text gets a soft halo in the surface colour to stay readable over whatever is underneath. */
  .save-bar.floating .save-status { font-weight: var(--weight-medium); text-shadow: 0 0 .5rem var(--surface), 0 0 .25rem var(--surface), 0 0 .125rem var(--surface); }
  /* WebKit gets the static rim instead of a live backdrop (see the cross-browser notes in the design system). */
  .save-bar.floating:global(.rn-static-glass) {
    background: linear-gradient(165deg, var(--glass-sheen), transparent 36%, var(--glass-reflection)), color-mix(in srgb, var(--surface) calc((.88 + var(--glass-opacity, .14) * .08) * 100%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset 0 -1px 0 var(--glass-rim), 0 .75rem 2rem var(--glass-shadow);
  }
</style>
