<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import WellbeingTile from './WellbeingTile.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { readDay, type TrendDay } from '#lib/api/wellbeing.ts';
  // A wide widget: on the left the days of the chosen range (7, 14 or 30) as the history calendar's small rings, on the right what was recorded on the chosen day (names only, no counts).
  let { series }: { series: TrendDay[] } = $props();
  const week = $derived(series);
  /** Empty cells before the first day, so each day sits under its weekday (weeks start on Monday, like the history calendar). */
  const withWeekdays = $derived(week.length > 7); // a single week needs no weekday header; longer ranges line the days up under theirs
  const lead = $derived(withWeekdays && week.length ? (new Date(`${week[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0);
  const WEEKDAY_HEAD = ['一', '二', '三', '四', '五', '六', '日'];
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  let chosen = $state<string | null>(null);
  const selected = $derived(week.some(d => d.date === chosen) ? chosen : week.at(-1)?.date ?? null);
  let names = $state<Record<string, string[]>>({}), loading = $state(false), message = $state('');
  let disposed = false, token = 0;
  async function load(date: string) {
    if (names[date]) return;
    const mine = ++token; loading = true; message = '';
    try {
      const day = await readDay(date);
      if (disposed || mine !== token) return;
      names[date] = [...new Set(day.symptoms.map(item => item.symptom))];
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return; }
      message = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => () => { disposed = true; token++; });
  // A day's names are read once per set of data: new data (another range, a save elsewhere) starts again, and the chosen day is read again.
  $effect(() => { void series; const date = selected; untrack(() => { names = {}; if (date) void load(date); }); });
  const list = $derived(selected ? names[selected] : undefined);
  /** The week as one big circle of slices: the shape of slice `index` of `count` (a ring segment with a small gap on either side), clockwise from the top. */
  const OUTER = 45, INNER = 30, GAP = 1.6;
  const polar = (radius: number, degrees: number) => [50 + radius * Math.cos(degrees * Math.PI / 180), 50 + radius * Math.sin(degrees * Math.PI / 180)];
  function slice(index: number, count: number): string {
    const step = 360 / count, from = -90 + index * step + GAP / 2, to = -90 + (index + 1) * step - GAP / 2;
    const [x0, y0] = polar(OUTER, from), [x1, y1] = polar(OUTER, to), [x2, y2] = polar(INNER, to), [x3, y3] = polar(INNER, from);
    const large = to - from > 180 ? 1 : 0;
    return `M${x0} ${y0}A${OUTER} ${OUTER} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${INNER} ${INNER} 0 ${large} 0 ${x3} ${y3}Z`;
  }
  /** The middle of a slice, in percent of the wheel: where its number goes. */
  const centre = (index: number, count: number) => polar((OUTER + INNER) / 2, -90 + (index + 0.5) * (360 / count));
  // Choosing a later day slides its record in from the right, an earlier one from the left; reduced motion skips it.
  let direction = $state(1);
  const motionMs = (ms: number) => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  const pick = (date: string) => { if (selected && date !== selected) direction = date > selected ? 1 : -1; chosen = date; };
  /** "今天", "昨天" or "N 天前", counted back from the latest day of the range. */
  function ago(date: string): string {
    const today = week.at(-1)?.date;
    if (!today) return '';
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    return days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
  }
</script>

{#snippet dayButton(day: TrendDay, style = '')}
  <!-- data-date keeps the button out of the glass enhancement, as for the history calendar; the ring is the mark: tinted when the day has side effects. -->
  <button type="button" class="day" class:marked={day.symptom_count > 0} class:selected={selected === day.date} aria-pressed={selected === day.date} onclick={() => pick(day.date)} data-testid="wellbeing-effect-day" data-date={day.date} {style}
    aria-label={`${Number(day.date.slice(5, 7))} 月 ${Number(day.date.slice(8))} 日${day.symptom_count > 0 ? '，有副作用记录' : '，没有副作用记录'}`}>
    <span class="disc">
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle class="part" cx="24" cy="24" r="21" /></svg>
      <span class="num">{Number(day.date.slice(8))}</span>
    </span>
  </button>
{/snippet}

<!-- One widget: the days of the range on the left (a week as a circle, longer ranges as the history calendar's rings), what was recorded on the chosen day on the right. -->
<WellbeingTile metric="effects" title="副作用" testid="wellbeing-side-effects">
  <div class="layout">
    {#if withWeekdays}
      <div class="calendar" role="group" aria-label={`近 ${week.length} 天，选一天查看那天的副作用`}>
        {#each WEEKDAY_HEAD as name (name)}<span class="head" aria-hidden="true">{name}</span>{/each}
        {#each Array(lead) as _, index (index)}<span class="blank" aria-hidden="true"></span>{/each}
        {#each week as day (day.date)}{@render dayButton(day)}{/each}
      </div>
    {:else}
      <!-- A week is one big circle cut into seven slices (the oldest day at the top, going clockwise): choose a day by its slice, the chosen day is named in the middle. -->
      <div class="wheel" role="group" aria-label={`近 ${week.length} 天，选一天查看那天的副作用`}>
        <svg class="slices" viewBox="0 0 100 100">
          {#each week as day, index (day.date)}
            <g class="slice" class:marked={day.symptom_count > 0} class:selected={selected === day.date} role="button" tabindex="0" aria-pressed={selected === day.date} data-testid="wellbeing-effect-day" data-date={day.date}
              aria-label={`${Number(day.date.slice(5, 7))} 月 ${Number(day.date.slice(8))} 日${day.symptom_count > 0 ? '，有副作用记录' : '，没有副作用记录'}`}
              onclick={() => pick(day.date)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(day.date); } }}>
              <path d={slice(index, week.length)} />
              {#if day.symptom_count > 0}<circle class="dot" cx={polar(OUTER - 2.2, -90 + (index + 0.5) * (360 / week.length))[0]} cy={polar(OUTER - 2.2, -90 + (index + 0.5) * (360 / week.length))[1]} r="1.3" />{/if}
            </g>
          {/each}
        </svg>
        {#each week as day, index (day.date)}{@const at = centre(index, week.length)}<span class="n" class:selected={selected === day.date} style={`left: ${at[0]}%; top: ${at[1]}%`} aria-hidden="true">{Number(day.date.slice(8))}</span>{/each}
        <!-- The day in the middle rolls like a counter: a later day comes up from below, an earlier one down from above, inside the round window. -->
        <div class="core" aria-hidden="true">
          {#if selected}{#key selected}
            <div class="face" in:fly={{ y: direction * 44, duration: motionMs(380), easing: cubicOut }} out:fly={{ y: -direction * 44, duration: motionMs(220), easing: cubicIn }}><strong>{Number(selected.slice(8))}</strong><span>周{weekday(selected)}</span></div>
          {/key}{/if}
        </div>
      </div>
    {/if}
    <div class="panel" role="status" aria-live="polite" data-testid="wellbeing-effect-list">
      <div class="stage">
        {#key selected}
          <div class="pane" in:fly={{ x: direction * 32, duration: motionMs(320), easing: cubicOut }} out:fly={{ x: -direction * 32, duration: motionMs(160), easing: cubicIn }}>
            {#if selected}
              <div class="when"><strong>{Number(selected.slice(5, 7))} 月 {Number(selected.slice(8))} 日</strong><span>周{weekday(selected)} · {ago(selected)}</span></div>
            {/if}
            {#if message}<p class="none">{message}</p>
            {:else if !list && loading}<p class="none">正在读取…</p>
            {:else if list?.length}<ul class="chips">{#each list as name, index (name)}<li class="chip" in:fly={{ y: 10, delay: motionMs(140 + index * 70), duration: motionMs(300), easing: cubicOut }}>{name}</li>{/each}</ul>
            {:else if list}<p class="none">没有记录副作用</p><p class="hint">没有记录不等于没有症状。</p>{/if}
          </div>
        {/key}
      </div>
    </div>
  </div>
</WellbeingTile>

<style>
  /* The widget is one cell of the grid, as big as the charts beside it: the calendar (the 7, 14 or 30 days of the range) is on the left and what was recorded on the chosen day is written on the right; only a very narrow widget stacks them. */
  .layout { display: grid; gap: var(--space-4) var(--space-6); min-width: 0; align-items: start; }
  @container (min-width: 26rem) { .layout { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); } }
  .calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); justify-items: center; row-gap: var(--space-1); }
  /* The week as one big circle of seven slices. Grey: nothing recorded; tinted: side effects that day; green: the chosen day. */
  .wheel { position: relative; width: min(100%, 15rem); aspect-ratio: 1; margin-inline: auto; }
  .slices { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .slice { --slice: color-mix(in srgb, var(--border) 85%, var(--surface)); cursor: pointer; outline: none; }
  .slice path { fill: var(--slice); stroke: var(--slice); stroke-width: 1.2; stroke-linejoin: round; transition: fill var(--transition-control), stroke var(--transition-control), transform 300ms var(--motion-popover-enter-ease); transform-box: fill-box; transform-origin: 50% 50%; }
  .slice.marked { --slice: color-mix(in srgb, var(--tone) 38%, var(--surface)); }
  .slice.selected { --slice: var(--primary); }
  .slice.selected path { transform: scale(1.06); }
  .slice .dot { fill: var(--tone); pointer-events: none; }
  .slice.selected .dot { fill: var(--primary-foreground); }
  @media (hover: hover) { .slice:not(.selected):hover { --slice: color-mix(in srgb, var(--tone) 22%, var(--border)); } .slice.marked:not(.selected):hover { --slice: color-mix(in srgb, var(--tone) 52%, var(--surface)); } }
  .slice:focus-visible path { stroke: var(--ring); }
  .n { position: absolute; display: grid; place-items: center; width: 2rem; height: 2rem; transform: translate(-50%, -50%); font-size: var(--text-small); font-variant-numeric: tabular-nums; pointer-events: none; }
  .n.selected { color: var(--primary-foreground); font-weight: var(--weight-bold); }
  /* A round window in the middle: the day rolls through it. */
  .core { position: absolute; inset: 28%; display: grid; overflow: hidden; border-radius: 50%; pointer-events: none; }
  .face { grid-area: 1 / 1; display: grid; place-content: center; justify-items: center; line-height: var(--line-height-solid); }
  .face strong { font-size: var(--text-title); font-weight: var(--weight-bold); color: var(--foreground); font-variant-numeric: tabular-nums; }
  .face span { margin-top: var(--space-1); color: var(--muted-foreground); font-size: var(--text-small); }
  .head { padding-block: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  .blank { width: 100%; }
  /* One day: a round button with a ring around its number (the history calendar's design); the ring is tinted when side effects were recorded. */
  .day { display: grid; justify-items: center; width: 100%; min-height: 0; padding: var(--space-1) 0; border: 0; border-radius: var(--radius-control); color: var(--foreground); cursor: pointer; }
  .day.day[data-date] { background: none !important; box-shadow: none !important; }
  .disc { position: relative; display: grid; place-items: center; width: 100%; max-width: 2.25rem; aspect-ratio: 1; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .part { fill: none; stroke: var(--border); stroke-width: 3.5; opacity: .7; transition: stroke var(--transition-control), opacity var(--transition-control); }
  .day.marked .part { stroke: var(--tone); opacity: 1; }
  .num { position: relative; display: grid; place-items: center; width: 62%; aspect-ratio: 1; border-radius: 50%; font-size: var(--text-small); font-variant-numeric: tabular-nums; transition: background-color 200ms ease, color 200ms ease, transform 360ms var(--motion-popover-enter-ease); }
  .day.selected .num { transform: scale(1.12); background: var(--primary); color: var(--primary-foreground); font-weight: var(--weight-bold); }
  @media (hover: hover) { .day:not(.selected):hover .num { background: var(--muted); } }
  .day:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  /* The tile is stretched to the height of its row; its content starts right under the title like the other widgets'. */
  :global([data-testid='wellbeing-side-effects']) { align-content: start; }
  .panel { min-width: 0; }
  .stage { display: grid; min-width: 0; overflow-x: clip; }
  .pane { grid-area: 1 / 1; display: grid; align-content: start; gap: var(--space-3); min-width: 0; }
  @container (min-width: 26rem) { .panel { padding-left: var(--space-6); border-left: 1px solid var(--border); min-height: 6rem; } }
  /* The date: the day in the title's size, the weekday and how long ago beneath it. */
  .when { display: grid; gap: .125rem; line-height: var(--line-height-heading); }
  .when strong { font-size: var(--text-card); font-weight: var(--weight-semibold); }
  .when span { color: var(--muted-foreground); font-size: var(--text-small); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .chip::before { content: ''; width: .5rem; height: .5rem; border-radius: 50%; background: var(--tone); }
  .chip { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border: 1px solid color-mix(in srgb, var(--tone) 45%, var(--border)); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--tone) 14%, var(--surface)); font-size: var(--text-body); }
  .none { font-size: var(--text-body); font-weight: var(--weight-medium); color: var(--muted-foreground); }
  .hint { margin-top: calc(-1 * var(--space-2)); color: var(--muted-foreground); font-size: var(--text-caption); }
  @media (prefers-reduced-motion: reduce) { .num, .part, .slice path { transition: none; } .day.selected .num { transform: none; } .slice.selected path { transform: none; } }
</style>
