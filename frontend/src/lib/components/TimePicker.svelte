<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { preparePopoverMotion, positionPopoverMotion } from '#lib/styles/popover-motion.ts';
  import { bindVisualViewport, popoverSupported, visualViewportBox } from '#lib/styles/browser-support.ts';

  // A time of day (HH:mm) in the same family as DatePicker. The field is plain text typed as 24-hour digits (a colon is added as you type), not the browser's own time field:
  // that one looks different in every browser (12-hour in some, its own clock button in Firefox and Chrome) and would sit beside ours. A clock button opens a small popover
  // with two wheels (hours, minutes). `max` (HH:mm) greys out the times after it; `now` fills the "现在" button.
  let { label, value = $bindable(''), max = '', now = '', required = false, disabled = false, onselect }:
    { label: string; value?: string; max?: string; now?: string; required?: boolean; disabled?: boolean; onselect?: (value: string) => void } = $props();
  const id = $props.id();
  let field: HTMLDivElement, trigger: HTMLButtonElement, panel: HTMLDivElement;
  let opened = $state(false), left = $state(0), top = $state(0);
  /** What is in the field while it is being typed: a whole valid time is passed on at once, anything else waits for the field to be left. */
  let draft = $state(untrack(() => value));
  $effect(() => { draft = value; });
  const pad = (n: number) => String(n).padStart(2, '0');
  const HOURS = Array.from({ length: 24 }, (_, i) => pad(i)), MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));
  const hh = $derived(/^\d{2}:\d{2}$/.test(value) ? value.slice(0, 2) : ''), mm = $derived(/^\d{2}:\d{2}$/.test(value) ? value.slice(3) : '');
  const maxH = $derived(/^\d{2}:\d{2}$/.test(max) ? max.slice(0, 2) : '99'), maxM = $derived(/^\d{2}:\d{2}$/.test(max) ? max.slice(3) : '99');
  const hourOk = (h: string) => h <= maxH;
  const minuteOk = (h: string, m: string) => h < maxH || (h === maxH && m <= maxM);

  function typed(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    draft = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    // Typed times are taken as typed; whether one is allowed (not later than now) is for whoever saves it to say.
    if (digits.length === 4 && +digits.slice(0, 2) <= 23 && +digits.slice(2) <= 59) { value = `${digits.slice(0, 2)}:${digits.slice(2)}`; onselect?.(value); }
  }
  /** On leaving the field: "9", "930" and "0930" become 09:00, 09:30 and 09:30; anything else goes back to the last good time. */
  function settleDraft() {
    const digits = draft.replace(/\D/g, '');
    const [h, m] = digits.length <= 2 ? [digits, '00'] : digits.length === 3 ? [digits.slice(0, 1), digits.slice(1)] : [digits.slice(0, 2), digits.slice(2)];
    if (digits && +h <= 23 && +m <= 59 && m.length <= 2) { value = `${pad(+h)}:${pad(+m)}`; draft = value; onselect?.(value); } else draft = value;
  }
  function put(h: string, m: string) {
    const next = `${h}:${minuteOk(h, m) ? m : maxM}`;
    value = next; onselect?.(next);
  }
  const pickHour = (h: string) => { if (!disabled && hourOk(h)) put(h, mm || '00'); };
  const pickMinute = (m: string) => { if (!disabled && minuteOk(hh || '00', m)) put(hh || '00', m); };
  /** A choice that is clicked slides to the middle, which is where the chosen one always sits. */
  const bring = (event: MouseEvent) => { const button = event.currentTarget as HTMLElement, column = button.closest<HTMLElement>('.wheel'); column?.scrollTo({ top: button.offsetTop - (column.clientHeight - button.offsetHeight) / 2, behavior: 'smooth' }); };
  /** The distance between two neighbouring choices in a column (a choice's height plus the gap). */
  const pitch = (column: HTMLElement) => { const first = column.children[0] as HTMLElement | undefined, second = column.children[1] as HTMLElement | undefined; return first && second ? second.offsetTop - first.offsetTop : 38; };
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  /** When a column comes to rest it snaps to the choice in its middle (a choice that is not allowed gives way to the nearest one that is). */
  function settle(column: HTMLElement, kind: 'h' | 'm') {
    const list = kind === 'h' ? HOURS : MINUTES, ok = (v: string) => kind === 'h' ? hourOk(v) : minuteOk(hh || '00', v);
    let index = Math.min(list.length - 1, Math.max(0, Math.round(column.scrollTop / pitch(column))));
    while (index > 0 && !ok(list[index])) index--;
    if (!ok(list[index])) return;
    if (kind === 'h') pickHour(list[index]); else pickMinute(list[index]);
    const target = index * pitch(column);
    if (Math.abs(column.scrollTop - target) > 1) column.scrollTo({ top: target, behavior: 'smooth' });
  }
  function onscroll(event: Event, kind: 'h' | 'm') {
    const column = event.currentTarget as HTMLElement;
    // Live: the choice passing the fixed middle band is the value as it passes (one that is not allowed is left alone until the column rests).
    const list = kind === 'h' ? HOURS : MINUTES, index = Math.min(list.length - 1, Math.max(0, Math.round(column.scrollTop / pitch(column))));
    if (kind === 'h' ? hourOk(list[index]) && list[index] !== hh : minuteOk(hh || '00', list[index]) && list[index] !== mm) { if (kind === 'h') pickHour(list[index]); else pickMinute(list[index]); }
    clearTimeout(timers.get(column));
    timers.set(column, setTimeout(() => { if (opened) settle(column, kind); }, 110));
  }
  function centre(column: HTMLElement | null) {
    const chosen = column?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (column && chosen) column.scrollTop = chosen.offsetTop - (column.clientHeight - chosen.offsetHeight) / 2;
  }
  function position() {
    if (!opened) return;
    const rect = field.getBoundingClientRect(), size = { width: panel.offsetWidth, height: panel.offsetHeight };
    const view = visualViewportBox();
    left = view.left + Math.max(12, Math.min(rect.left - view.left, view.width - size.width - 12));
    const below = rect.bottom + 8;
    const belowSpace = view.top + view.height - below - 12, aboveSpace = rect.top - view.top - 20;
    const desired = belowSpace >= size.height || belowSpace >= aboveSpace ? below : rect.top - size.height - 8;
    top = Math.max(view.top + 12, Math.min(desired, view.top + view.height - size.height - 12));
    positionPopoverMotion(panel, trigger.getBoundingClientRect(), { left, top });
  }
  async function open() {
    if (disabled) return;
    if (!popoverSupported() || typeof panel.showPopover !== 'function') return; // the field can still be typed in
    if (opened) { close(); return; }
    if (!hh) put(now && now <= (max || '99:99') ? now.slice(0, 2) : '08', now && now <= (max || '99:99') ? now.slice(3) : '00');
    opened = true;
    await tick(); if (disabled) { opened = false; return; }
    preparePopoverMotion(panel); panel.showPopover(); position();
    for (const column of panel.querySelectorAll<HTMLElement>('.wheel')) centre(column);
    panel.querySelector<HTMLElement>('.wheel [aria-selected="true"]')?.focus({ preventScroll: true });
  }
  function close() { panel.hidePopover(); opened = false; trigger.focus(); }
  function step(event: KeyboardEvent, kind: 'h' | 'm', current: string) {
    const column = (event.currentTarget as HTMLElement).closest<HTMLElement>('.wheel'); // read now: the event's target is gone after the first await
    const list = kind === 'h' ? HOURS : MINUTES, ok = (v: string) => kind === 'h' ? hourOk(v) : minuteOk(hh || '00', v);
    const at = list.indexOf(current), jump = event.key === 'PageUp' ? -5 : event.key === 'PageDown' ? 5 : 0;
    let to = -1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || jump) {
      const dir = (event.key === 'ArrowUp' || jump < 0) ? -1 : 1, size = jump ? Math.abs(jump) : 1;
      for (let i = at + dir * size; i >= 0 && i < list.length; i += dir) if (ok(list[i])) { to = i; break; }
    } else if (event.key === 'Home') to = list.findIndex(ok);
    else if (event.key === 'End') to = list.length - 1 - [...list].reverse().findIndex(ok);
    else return;
    event.preventDefault();
    if (to < 0) return;
    if (kind === 'h') pickHour(list[to]); else pickMinute(list[to]);
    void tick().then(() => { column?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }); centre(column); });
  }
  function useNow() { if (now && /^\d{2}:\d{2}$/.test(now)) { put(now.slice(0, 2), now.slice(3)); void tick().then(() => { for (const column of panel.querySelectorAll<HTMLElement>('.wheel')) centre(column); }); } }
  onMount(() => bindVisualViewport(position));
</script>

<svelte:window onresize={position} onscrollcapture={position} onkeydown={event => { if (opened && event.key === 'Escape') { event.preventDefault(); close(); } }} />
<div class="time-field">
  <label for={id}>{label}</label>
  <div class="time-control" bind:this={field}>
    <input {id} aria-label={label} type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="时:分" value={draft} {required} {disabled}
      oninput={event => typed(event.currentTarget.value)} onblur={settleDraft}
      onkeydown={event => { if (event.key === 'Enter') { settleDraft(); } else if (event.key === ' ' || (event.altKey && event.key === 'ArrowDown')) { event.preventDefault(); void open(); } }} />
    <button class="clock-trigger" type="button" data-date="clock" {disabled} bind:this={trigger} aria-label={`选择${label}`} aria-haspopup="dialog" aria-expanded={opened} aria-controls={`${id}-clock`} onclick={() => void open()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
  </div>
  <!-- A plain solid popover, not the glass of the calendar's: nothing in it is glass. It keeps the calendar's pop-in motion (copied below), and data-date on its buttons keeps liquid glass off them (as for calendar days). -->
  <div id={`${id}-clock`} class="time-popover" bind:this={panel} popover="auto" role="dialog" aria-label={`选择${label}`}
    style:left={`${left}px`} style:top={`${top}px`} ontoggle={event => { opened = event.newState === 'open'; }}>
    <p class="preview" aria-live="polite"><span>{hh || '--'}</span><i aria-hidden="true">:</i><span>{mm || '--'}</span></p>
    <div class="columns">
      <div class="column"><span class="caption" id={`${id}-h`}>时</span>
        <div class="box"><span class="band" aria-hidden="true"></span><div class="wheel" role="listbox" aria-labelledby={`${id}-h`} data-testid="time-hours" onscroll={event => onscroll(event, 'h')}>
          {#each HOURS as h (h)}<button type="button" role="option" aria-selected={h === hh} tabindex={h === hh ? 0 : -1} disabled={!hourOk(h)} data-hour={h} data-date={h} onclick={event => { pickHour(h); bring(event); }} onkeydown={event => step(event, 'h', h)}>{h}</button>{/each}
        </div></div>
      </div>
      <div class="column"><span class="caption" id={`${id}-m`}>分</span>
        <div class="box"><span class="band" aria-hidden="true"></span><div class="wheel" role="listbox" aria-labelledby={`${id}-m`} data-testid="time-minutes" onscroll={event => onscroll(event, 'm')}>
          {#each MINUTES as m (m)}<button type="button" role="option" aria-selected={m === mm} tabindex={m === mm ? 0 : -1} disabled={!minuteOk(hh || '00', m)} data-minute={m} data-date={m} onclick={event => { pickMinute(m); bring(event); }} onkeydown={event => step(event, 'm', m)}>{m}</button>{/each}
        </div></div>
      </div>
    </div>
    <div class="footer"><button type="button" data-date="now" disabled={!now} onclick={useNow}>现在</button><button type="button" data-date="done" class="done" onclick={close}>完成</button></div>
  </div>
</div>

<style>
  .time-field { display: grid; gap: .35rem; min-width: 0; font-size: var(--text-small); }
  .time-control { display: flex; align-items: center; width: 100%; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); }
  .time-control:focus-within { border-color: var(--primary); }
  input { width: 100%; min-width: 0; border: 0; background: transparent; padding: .5rem 0 .5rem .75rem; border-radius: var(--radius-control); color: var(--foreground); font-variant-numeric: tabular-nums; }
  input::placeholder { color: var(--muted-foreground); font-weight: var(--weight-regular); }
  .clock-trigger { display: grid; place-items: center; flex-shrink: 0; width: 2.75rem; height: 2.75rem; border-radius: .65rem; color: var(--primary); }
  /* Without popover support there is only the typed field. */
  @supports not selector(:popover-open) { .clock-trigger { display: none; } }
  .clock-trigger[aria-expanded='true'] { background: var(--primary-soft); }
  @media (hover: hover) { .clock-trigger:hover { background: var(--primary-soft); } }
  .time-popover { position: fixed; inset: auto; margin: 0; width: 17rem; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--foreground); box-shadow: var(--shadow-popover); }
  /* The time being set, big, so the two columns below read as the two halves of it. */
  /* The same pop-in as the calendar popover (its glass material is not wanted here). */
  .time-popover { --popover-duration: var(--motion-popover-exit-duration); --popover-ease: var(--motion-popover-exit-ease); opacity: 0; translate: var(--popover-from-x, 0px) var(--popover-from-y, 0px); scale: var(--popover-from-scale-x, .1) var(--popover-from-scale-y, .1); transform-origin: center; pointer-events: none; transition: opacity var(--popover-duration) ease, translate var(--popover-duration) var(--popover-ease), scale var(--popover-duration) var(--popover-ease), display var(--motion-popover-exit-duration) allow-discrete, overlay var(--motion-popover-exit-duration) allow-discrete; }
  .time-popover:popover-open:global([data-popover-positioned]) { --popover-duration: var(--motion-popover-enter-duration); --popover-ease: var(--motion-popover-enter-ease); opacity: 1; translate: 0 0; scale: 1; pointer-events: auto; }
  @media (prefers-reduced-motion: reduce) { .time-popover { transition: none; } }
  /* Flat controls: no plate, no shadow, no sheen. */
  /* data-date keeps liquid glass from enhancing these buttons, but the global stylesheet still puts a glass sheen (a gradient and inset highlights) on every button[data-date]: it is switched off here. */
  .time-popover button[data-date], .clock-trigger[data-date] { background-color: transparent; background-image: none !important; box-shadow: none !important; }
  .preview { display: flex; align-items: baseline; justify-content: center; gap: var(--space-2); margin-bottom: var(--space-3); font-size: var(--text-stat); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; line-height: var(--line-height-solid); }
  .preview i { color: var(--muted-foreground); font-style: normal; }
  .columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .column { display: grid; gap: var(--space-1); min-width: 0; }
  .caption { color: var(--muted-foreground); font-size: var(--text-caption); text-align: center; }
  /* A wheel: the chosen time is fixed in the middle (the band) and the column scrolls under it; scrolling is choosing. The ends fade out. */
  .box { position: relative; min-width: 0; }
  .band { position: absolute; left: 0; right: 0; top: calc((12.5rem - 2.25rem) / 2); height: 2.25rem; border-radius: .65rem; background: var(--primary); pointer-events: none; }
  .wheel { position: relative; display: grid; align-content: start; gap: .125rem; height: 12.5rem; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; overscroll-behavior: contain; padding-block: calc((12.5rem - 2.25rem) / 2); mask-image: linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent); }
  .wheel::-webkit-scrollbar { display: none; }
  .wheel button { scroll-snap-align: center; min-height: 2.25rem; border-radius: .65rem; font-size: var(--text-body); font-variant-numeric: tabular-nums; color: var(--foreground); }
  .wheel button:disabled { color: var(--muted-foreground); opacity: .4; cursor: not-allowed; }
  @media (hover: hover) { .wheel button:hover:not(:disabled):not([aria-selected='true']) { color: var(--primary); } }
  .wheel button[aria-selected='true'] { color: var(--primary-foreground); font-weight: var(--weight-bold); }
  .wheel button:focus-visible { outline-offset: 1px; }
  .footer { display: flex; justify-content: space-between; margin-top: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--border); }
  .footer button { min-height: 2.5rem; padding: .25rem .75rem; border-radius: .65rem; color: var(--primary); font-weight: var(--weight-semibold); }
  @media (hover: hover) { .footer button:hover:not(:disabled) { background: var(--primary-soft); } }
  .footer button:disabled { opacity: .4; cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) { .wheel { scroll-behavior: auto; } }
</style>
