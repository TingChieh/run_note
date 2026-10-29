<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import WellbeingTile from './WellbeingTile.svelte';
  import { arcPath, createTween, fractionAt, parseDuration, pointAt, valueAt } from './wellbeing-dial-math.ts';
  import { readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  import { hoursText } from '#lib/api/wellbeing.ts';
  // Sleep duration on one double ring: the big outer ring is the hours, the small inner ring the minutes (exact to the minute).
  // Where a finger lands decides which ring turns; tapping the time in the middle opens a small box to type it (7:25, 7.5, 7h25m, 7时25分).
  // Stored as decimal hours with two decimals, which keeps whole minutes exact.
  let { value = $bindable(null), disabled = false }: { value?: number | null; disabled?: boolean } = $props();
  const MAX_HOURS = 16, OUTER = 41, INNER = 25;
  const total = $derived(value === null ? null : Math.round(value * 60));
  const hours = $derived(total === null ? null : Math.floor(total / 60));
  const minutes = $derived(total === null ? null : total % 60);
  const hourMax = $derived(Math.max(MAX_HOURS, hours ?? 0));
  const hourFraction = $derived(hours === null ? 0 : hours / hourMax);
  const minuteFraction = $derived(minutes === null ? 0 : minutes / 59);
  const compose = (h: number, m: number) => Math.round((h + m / 60) * 100) / 100;
  const setHours = (next: number) => { value = compose(next, minutes ?? 0); };
  const setMinutes = (next: number) => { value = compose(hours ?? 0, next); };
  let box: HTMLDivElement, turning: 'hours' | 'minutes' | null = null;

  // Tapping the time in the middle opens a small box: Enter or leaving it applies the time, Escape drops it. Only what was typed counts.
  let editing = $state(false), draft = $state(''), opened = '', invalid = $state(false), quick = $state<HTMLInputElement | undefined>();
  function startEdit() { if (disabled) return; draft = opened = value === null ? '' : `${hours}:${String(minutes).padStart(2, '0')}`; invalid = false; editing = true; }
  function finishEdit(apply: boolean) {
    if (!editing) return;
    if (apply && draft.trim() !== '' && draft.trim() !== opened) {
      const parsed = parseDuration(draft);
      if (parsed === null) { invalid = true; return; }
      if (parsed !== value) value = parsed;
    }
    editing = false; invalid = false;
  }
  $effect(() => { if (editing && quick) { quick.focus(); quick.select(); } });

  /** Which ring a pointer is on (by its distance from the centre), or null for the middle and the outer edge. */
  function ringAt(event: PointerEvent): { ring: 'hours' | 'minutes'; fraction: number } | null {
    const rect = box.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) / rect.width * 100;
    const ring = turning ?? (distance > 32 ? 'hours' : distance > 19 ? 'minutes' : null);
    if (!ring) return null;
    return { ring, fraction: fractionAt(dx, dy, ring === 'hours' ? hourFraction : minuteFraction) };
  }
  function turn(event: PointerEvent) {
    const hit = ringAt(event);
    if (!hit) return;
    if (hit.ring === 'hours') { const next = valueAt(hit.fraction, 0, hourMax, 1); if (next !== hours) setHours(next); }
    else { const next = valueAt(hit.fraction, 0, 59, 1); if (next !== minutes) setMinutes(next); }
  }
  function down(event: PointerEvent) {
    if (disabled || event.button > 0 || (event.target as HTMLElement).closest('.edit, .quick')) return;
    const hit = ringAt(event);
    if (!hit) return;
    turning = hit.ring; (hit.ring === 'hours' ? glassHours : glassMinutes)?.press(true); box.setPointerCapture(event.pointerId); turn(event);
  }
  function up(event: PointerEvent) { turning = null; glassHours?.press(false); glassMinutes?.press(false); if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId); }
  const key = (middle: number) => (event: KeyboardEvent) => {
    if (value === null && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); if (middle === 7) setHours(7); else setMinutes(30); }
  };

  // Both rings glide to a new value (not while a finger is turning one).
  let shownHours = $state(0), shownMinutes = $state(0);
  const hourTween = createTween(0, (v) => { shownHours = v; }), minuteTween = createTween(0, (v) => { shownMinutes = v; });
  $effect(() => { hourTween.to(hourFraction, turning !== null); });
  $effect(() => { minuteTween.to(minuteFraction, turning !== null); });
  onDestroy(() => { hourTween.stop(); minuteTween.stop(); });
  const hourKnob = $derived(pointAt(OUTER, shownHours)), minuteKnob = $derived(pointAt(INNER, shownMinutes));

  // Both knobs are liquid glass (the project's lens and spring press) unless the visitor asked for less transparency; then they are plain discs.
  type Knob = ReturnType<typeof import('#lib/styles/liquid-glass-knob.ts').attachKnobGlass>;
  let glassOn = $state(false), ring = $state<SVGSVGElement | undefined>(), glassHours: Knob | undefined, glassMinutes: Knob | undefined;
  onMount(() => {
    let disposed = false, stop = () => {}, resize: ResizeObserver | undefined;
    const quiet = matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(forced-colors: active)').matches;
    if (!quiet) void import('#lib/styles/liquid-glass-knob.ts').then(({ attachKnobGlass }) => {
      if (disposed) return;
      // The knobs follow the rings: a big one on the thick hours ring, a small one on the thin minutes ring.
      glassHours = attachKnobGlass(box, () => ring ?? null, readGlassSettings(), 24);
      glassMinutes = attachKnobGlass(box, () => ring ?? null, readGlassSettings(), 16);
      stop = watchGlassSettings(next => { glassHours?.update(next); glassMinutes?.update(next); });
      resize = new ResizeObserver(() => place()); resize.observe(box);
      glassOn = true; place();
    }).catch(() => { /* Plain knobs are drawn instead. */ });
    return () => { disposed = true; stop(); resize?.disconnect(); glassHours?.destroy(); glassMinutes?.destroy(); glassHours = glassMinutes = undefined; };
  });
  /** Moves both glass knobs to where the rings have got to, and refreshes the ring the lenses bend. */
  function place() {
    if (!glassHours || !glassMinutes) return;
    const size = box.clientWidth;
    glassHours.sync(); glassMinutes.sync();
    glassHours.move(hourKnob[0] / 100 * size, hourKnob[1] / 100 * size);
    glassMinutes.move(minuteKnob[0] / 100 * size, minuteKnob[1] / 100 * size);
  }
  $effect(() => { void shownHours; void shownMinutes; void value; void glassOn; place(); });
</script>
<WellbeingTile metric="sleep" title="睡眠时长" subtitle="外圈是小时，内圈是分钟" onclear={value === null ? null : () => { value = null; }} clearLabel="清除睡眠时长" {disabled} testid="wellbeing-sleep">
  <div bind:this={box} class="dial" class:unset={value === null} class:off={disabled} data-hours={hours ?? ''} data-minutes={minutes ?? ''} role="presentation"
    onpointerdown={down} onpointermove={(event) => { if (turning) turn(event); }} onpointerup={up} onpointercancel={up}>
    <svg bind:this={ring} viewBox="0 0 100 100" aria-hidden="true">
      <path class="track outer" d={arcPath(OUTER, 1)} />
      <path class="track inner" d={arcPath(INNER, 1)} />
      {#if value !== null && shownHours > 0.001}<path class="progress outer" d={arcPath(OUTER, shownHours)} data-part="hours" />{/if}
      {#if value !== null && shownMinutes > 0.001}<path class="progress inner" d={arcPath(INNER, shownMinutes)} data-part="minutes" />{/if}
      {#if !glassOn}<circle class="knob" cx={hourKnob[0]} cy={hourKnob[1]} r="7.3" /><circle class="knob inner" cx={minuteKnob[0]} cy={minuteKnob[1]} r="4.9" />{/if}
    </svg>
    <div class="edit center" class:hidden={editing} role="button" tabindex={disabled || editing ? -1 : 0} aria-disabled={disabled} onclick={startEdit} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEdit(); } }} aria-label="直接输入睡眠时长">
      {#if value === null}<strong class="none">—</strong>
      {:else}<strong>{hours}<i>:</i>{String(minutes).padStart(2, '0')}</strong><small>时 : 分</small>{/if}
    </div>
    {#if editing}
      <!-- A small box in the middle: it grows out of the time and shrinks back into it. -->
      <span class="quick-wrap"><input bind:this={quick} bind:value={draft} class="quick" inputmode="text" placeholder="7:25" aria-label="输入睡眠时长，如 7:25 或 7.5" aria-invalid={invalid} transition:scale={{ duration: 170, start: .4, opacity: 0 }} onblur={() => finishEdit(true)} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishEdit(true); } else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); } }} /></span>
    {/if}
    <input class="sr hours" type="range" min="0" max={hourMax} step="1" {disabled} value={hours ?? 7} aria-label="睡眠小时" aria-valuetext={hours === null ? '未填写' : `${hours} 小时`} oninput={(event) => setHours(Number(event.currentTarget.value))} onkeydown={key(7)} />
    <input class="sr minutes" type="range" min="0" max="59" step="1" {disabled} value={minutes ?? 30} aria-label="睡眠分钟" aria-valuetext={minutes === null ? '未填写' : `${minutes} 分钟`} oninput={(event) => setMinutes(Number(event.currentTarget.value))} onkeydown={key(30)} />
  </div>
  <span class="sr-only" role="status">{#if value !== null}<span data-testid="scale-value">{hoursText(value)}</span>{/if}</span>
</WellbeingTile>
<style>
  /* The double ring is the same size as the single dials of the other widgets, so the whole row is even; the time in the middle is set a little smaller to sit inside the inner ring. */
  .dial { position: relative; width: min(100%, var(--dial)); aspect-ratio: 1; margin-inline: auto; border-radius: 50%; touch-action: none; user-select: none; cursor: pointer; }
  .dial.off { cursor: not-allowed; opacity: .55; }
  .dial svg { display: block; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .track, .progress { fill: none; stroke-linecap: round; }
  /* The hours ring is thick and the minutes ring thin, like the knobs on them: the big unit is the big ring. */
  .track.outer, .progress.outer { stroke-width: 10; }
  .track.inner, .progress.inner { stroke-width: 5.5; }
  /* Opaque, never see-through: an untouched ring is solid and waiting to be turned. */
  .track.outer { stroke: color-mix(in srgb, var(--tone) 24%, var(--surface)); }
  .track.inner { stroke: color-mix(in srgb, var(--tone) 16%, var(--surface)); }
  .progress.outer { stroke: var(--tone); }
  /* The inner (minutes) ring is the same hue, lighter, so the two read as one measure with two parts. */
  .progress.inner { stroke: color-mix(in srgb, var(--tone) 55%, var(--surface)); }
  .knob { fill: var(--surface); stroke: var(--tone); stroke-width: 3; filter: drop-shadow(0 1px 2px var(--glass-shadow)); }
  .knob.inner { stroke: color-mix(in srgb, var(--tone) 55%, var(--surface)); }
  /* The time in the middle is plain text; tapping it opens the small box below. */
  .center { position: absolute; inset: 27%; display: grid; place-content: center; justify-items: center; border-radius: 50%; font-variant-numeric: tabular-nums; cursor: text; transition: opacity 140ms ease; }
  .center.hidden { opacity: 0; pointer-events: none; }
  /* The text must not catch pointers itself: its line box can stick out of the middle and would block the ring beneath; the box around it still takes the tap. */
  .center > * { pointer-events: none; }
  .center:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .center strong { font-size: var(--text-section); font-weight: var(--weight-bold); line-height: var(--line-height-solid); color: var(--tone); white-space: nowrap; }
  .center strong i { font-style: normal; opacity: .6; padding-inline: .05em; }
  .center strong.none { color: var(--foreground); font-weight: var(--weight-regular); }
  .center small { margin-top: .125rem; color: var(--muted-foreground); font-size: var(--text-caption); line-height: var(--line-height-solid); }
  .quick-wrap { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  /* Small on purpose: it sits inside the rings and must never cover them. */
  .quick { width: 4rem; min-height: 0; height: 2rem; padding: 0 .25rem; pointer-events: auto; border: 1.5px solid var(--tone); border-radius: var(--radius-pill); background: var(--surface); box-shadow: 0 2px 8px var(--glass-shadow); color: var(--foreground); font-size: var(--text-body); font-weight: var(--weight-bold); text-align: center; font-variant-numeric: tabular-nums; }
  .quick[aria-invalid='true'] { border-color: var(--error); }
  .quick:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .center { transition: none; } }
  .sr { position: absolute; width: 1px; height: 1px; margin: 0; padding: 0; opacity: 0; overflow: hidden; pointer-events: none; }
  .dial:has(.sr:focus-visible) { outline: 2px solid var(--ring); outline-offset: 3px; }
  .dial:has(.sr.hours:focus-visible) .track.outer, .dial:has(.sr.minutes:focus-visible) .track.inner { stroke: color-mix(in srgb, var(--tone) 45%, transparent); }
</style>
