<script lang="ts">
  // A round slider: a 270° ring with the opening at the bottom. Drag or tap on the ring to turn it; a native range inside keeps the keyboard
  // (arrow keys, Home/End) and screen-reader behaviour. `value === null` is "not answered": the ring is empty and the first arrow key starts at `middle`.
  let { label, value, min, max, step = 1, middle = Math.round((min + max) / 2), unit = '', disabled = false, onvalue }: { label: string; value: number | null; min: number; max: number; step?: number; middle?: number; unit?: string; disabled?: boolean; onvalue: (next: number) => void } = $props();
  import { onDestroy, onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import { readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  import { arcPath, createTween, fractionAt, pointAt, valueAt } from './wellbeing-dial-math.ts';
  const R = 38;
  const fraction = $derived(value === null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min || 1))));
  // The ring glides to a new value (not while a finger is turning it, so it stays under the finger).
  let shown = $state(0), dragging = false;
  const tween = createTween(0, (v) => { shown = v; });
  $effect(() => { tween.to(fraction, dragging); });
  onDestroy(() => tween.stop());
  const knob = $derived(pointAt(R, shown));
  // The knob is liquid glass (the project's lens and spring press) unless the visitor asked for less transparency; then it is a plain disc.
  let glassOn = $state(false), ring = $state<SVGSVGElement | undefined>();
  let glassKnob: ReturnType<typeof import('#lib/styles/liquid-glass-knob.ts').attachKnobGlass> | undefined;
  onMount(() => {
    let disposed = false, stop = () => {}, resize: ResizeObserver | undefined;
    const quiet = matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(forced-colors: active)').matches;
    if (!quiet) void import('#lib/styles/liquid-glass-knob.ts').then(({ attachKnobGlass }) => {
      if (disposed) return;
      glassKnob = attachKnobGlass(box, () => ring ?? null, readGlassSettings());
      stop = watchGlassSettings(next => glassKnob?.update(next));
      resize = new ResizeObserver(() => place()); resize.observe(box);
      glassOn = true; place();
    }).catch(() => { /* A plain knob is drawn instead. */ });
    return () => { disposed = true; stop(); resize?.disconnect(); glassKnob?.destroy(); glassKnob = undefined; };
  });
  /** Moves the glass knob to where the ring has got to, and refreshes the ring the lens bends. */
  function place() {
    if (!glassKnob) return;
    const size = box.clientWidth;
    glassKnob.sync();
    glassKnob.move(knob[0] / 100 * size, knob[1] / 100 * size);
  }
  $effect(() => { void shown; void value; void glassOn; place(); });
  let box: HTMLDivElement;
  // Tapping the number in the middle opens a box to type the value: Enter or leaving the box applies it, Escape drops it.
  let editing = $state(false), draft = $state(''), opened = '', quick = $state<HTMLInputElement | undefined>();
  function startEdit() { if (disabled) return; draft = opened = value === null ? '' : String(value); editing = true; }
  function finishEdit(apply: boolean) {
    if (!editing) return;
    editing = false;
    const typed = Number(draft.trim());
    // Only what was typed counts: leaving the box untouched must not put the old number back over a value set meanwhile.
    if (apply && draft.trim() !== '' && draft.trim() !== opened && Number.isFinite(typed)) { const next = Math.min(max, Math.max(min, Math.round(typed / step) * step)); if (next !== value) onvalue(next); }
  }
  $effect(() => { if (editing && quick) { quick.focus(); quick.select(); } });

  /** The value under a pointer: its angle round the ring; the opening at the bottom snaps to the nearer end. */
  function fromPointer(event: PointerEvent): number | null {
    const rect = box.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < rect.width * 0.2) return null; // the number in the middle is not a handle
    return valueAt(fractionAt(dx, dy, ((value ?? middle) - min) / (max - min || 1)), min, max, step);
  }
  function turn(event: PointerEvent) {
    const next = fromPointer(event);
    if (next !== null && next !== value) onvalue(next);
  }
  function down(event: PointerEvent) {
    if (disabled || event.button > 0 || (event.target as HTMLElement).closest('.edit, .quick')) return;
    if (fromPointer(event) === null) return;
    dragging = true; glassKnob?.press(true); box.setPointerCapture(event.pointerId); turn(event);
  }
  function move(event: PointerEvent) { if (dragging) turn(event); }
  function up(event: PointerEvent) { dragging = false; glassKnob?.press(false); if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId); }
  function key(event: KeyboardEvent) {
    if (value === null && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onvalue(middle); }
  }
</script>
<div bind:this={box} class="dial" class:unset={value === null} class:off={disabled} data-fraction={fraction.toFixed(3)} role="presentation"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  <svg bind:this={ring} viewBox="0 0 100 100" aria-hidden="true">
    <path class="track" d={arcPath(R, 1)} />
    {#if value !== null && shown > 0.001}<path class="progress" d={arcPath(R, shown)} data-part="progress" />{/if}
    {#if !glassOn}<circle class="knob" cx={knob[0]} cy={knob[1]} r="7.5" />{/if}
  </svg>
  <div class="edit center" class:hidden={editing} role="button" tabindex={disabled || editing ? -1 : 0} aria-disabled={disabled} onclick={startEdit} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEdit(); } }} aria-label={`直接输入${label}`}><strong>{value ?? '—'}</strong><small>{unit}</small></div>
  {#if editing}
    <!-- A small box in the middle: it grows out of the number and shrinks back into it. -->
    <span class="quick-wrap"><input bind:this={quick} bind:value={draft} class="quick" inputmode="numeric" aria-label={`输入${label}（${min} 到 ${max}）`} transition:scale={{ duration: 170, start: .4, opacity: 0 }} onblur={() => finishEdit(true)} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishEdit(true); } else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); } }} /></span>
  {/if}
  <input class="sr" type="range" {min} {max} {step} {disabled} value={value ?? middle} aria-label={label} aria-valuetext={value === null ? '未填写' : `${value}${unit}`}
    oninput={(event) => onvalue(Number(event.currentTarget.value))} onkeydown={key} />
</div>
<style>
  .dial { position: relative; width: var(--dial, 7.75rem); aspect-ratio: 1; margin-inline: auto; border-radius: 50%; touch-action: none; user-select: none; cursor: pointer; }
  .dial.off { cursor: not-allowed; opacity: .55; }
  svg { display: block; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .track, .progress { fill: none; stroke-width: 9; stroke-linecap: round; }
  /* Opaque, never see-through: an untouched dial is a solid ring waiting to be turned. */
  .track { stroke: color-mix(in srgb, var(--tone) 24%, var(--surface)); }
  .progress { stroke: var(--tone); }
  .knob { fill: var(--surface); stroke: var(--tone); stroke-width: 3.5; filter: drop-shadow(0 1px 2px var(--glass-shadow)); }
  /* The number in the middle is plain text, as before; tapping it opens the box below. */
  .center { position: absolute; inset: 24%; display: grid; place-content: center; justify-items: center; border-radius: 50%; font-variant-numeric: tabular-nums; cursor: text; }
    /* The text must not catch pointers itself: its line box can stick out of the middle and would block the ring beneath; the box around it still takes the tap. */
  .center > * { pointer-events: none; }
  .center:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .center { transition: opacity 140ms ease; }
  .center.hidden { opacity: 0; pointer-events: none; }
  .quick-wrap { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  /* Small on purpose: it sits inside the ring and must never cover it. */
  .quick { width: 3.5rem; min-height: 0; height: 2rem; padding: 0 .25rem; pointer-events: auto; border: 1.5px solid var(--tone); border-radius: var(--radius-pill); background: var(--surface); box-shadow: 0 2px 8px var(--glass-shadow); color: var(--foreground); font-size: var(--text-section); font-weight: var(--weight-bold); text-align: center; font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) { .center { transition: none; } }
  .quick:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .center strong { font-size: var(--text-title); font-weight: var(--weight-bold); line-height: var(--line-height-solid); color: var(--tone); }
  .unset .center strong { color: var(--foreground); font-weight: var(--weight-regular); }
  .center small { margin-top: .125rem; color: var(--muted-foreground); font-size: var(--text-caption); line-height: var(--line-height-solid); }
  /* The real control: out of sight, but focusable and operable by keyboard and assistive technology. */
  .sr { position: absolute; width: 1px; height: 1px; margin: 0; padding: 0; opacity: 0; overflow: hidden; pointer-events: none; }
  .dial:has(.sr:focus-visible) { outline: 2px solid var(--ring); outline-offset: 3px; }
  .dial { transition: opacity var(--transition-control); }
  @media (prefers-reduced-motion: reduce) { .dial { transition: none; } }
</style>
