<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import FeedbackState from './FeedbackState.svelte';
  import WellbeingDayEditor from './WellbeingDayEditor.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { RATING_KEYS, RATING_LABELS, dateLabel, hoursText, monthBounds, monthLabel, readEntries, readMarks, shiftMonth, type DayMark, type Entry } from '#lib/api/wellbeing.ts';
  // History: a month calendar and a paged list. Choosing a day opens the same editor as "today", so past days can be viewed, edited, deleted or back-filled.
  let { today, timezone, onunsaved, onrequestswitch }: { today: string; timezone: string; onunsaved?: (unsaved: boolean) => void; onrequestswitch: () => boolean } = $props();
  const PAGE = 20;
  let month = $state(untrack(() => today.slice(0, 7))), mode = $state<'calendar' | 'list'>('calendar');
  let marks = $state<Record<string, DayMark>>({}), marksLoading = $state(true), marksError = $state('');
  let entries = $state<Entry[]>([]), total = $state(0), offset = $state(0), listLoading = $state(false), listError = $state('');
  let selected = $state<string | null>(null);
  let disposed = false, marksToken = 0, listToken = 0;
  const RADIUS = 16.5;
  /** The three parts of a day's ring, clockwise from the top. Each part has its own colour, none alike: the day's state is purple (`--well-mood`), medication is `--well-dose` (the medication widget) and side effects `--well-effect` (the trends widget). */
  const SEGMENTS = [
    { key: 'entry', name: '状态', color: 'var(--well-mood)', lit: (m: DayMark) => m.has_entry },
    { key: 'dose', name: '服药', color: 'var(--well-dose)', lit: (m: DayMark) => m.dose_count > 0 },
    { key: 'symptom', name: '副作用', color: 'var(--well-effect)', lit: (m: DayMark) => m.symptom_count > 0 }
  ];
  const bounds = $derived(monthBounds(month));
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const cells = $derived([...Array(bounds.first).fill(null), ...Array.from({ length: bounds.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[]);

  function expired(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) { disposed = true; marksToken++; listToken++; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return true; }
    return false;
  }
  async function loadMarks() {
    const mine = ++marksToken; marksLoading = true; marksError = '';
    try {
      const list = await readMarks(bounds.from, bounds.to);
      if (disposed || mine !== marksToken) return;
      marks = Object.fromEntries(list.map(m => [m.date, m]));
    } catch (cause) {
      if (disposed || mine !== marksToken || expired(cause)) return;
      marks = {}; marksError = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === marksToken) marksLoading = false; }
  }
  async function loadList(next = offset) {
    const mine = ++listToken; listLoading = true; listError = '';
    try {
      const page = await readEntries(next, PAGE);
      if (disposed || mine !== listToken) return;
      entries = page.items; total = page.total; offset = next;
    } catch (cause) {
      if (disposed || mine !== listToken || expired(cause)) return;
      listError = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === listToken) listLoading = false; }
  }
  // On a wide screen the calendar card starts level with the widgets beside it, below the day's heading: its top is moved down by that heading's height.
  let column = $state<HTMLDivElement | undefined>(), alignOffset = $state(0);
  $effect(() => {
    void selected;
    if (!column) return;
    const host = column;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Layout positions (offsetTop) rather than on-screen ones: a section that is still sliding in must not skew the measure.
      const all = host.querySelectorAll<HTMLElement>('.stack'), widgets = all[all.length - 1];
      let top = 0;
      for (let node: HTMLElement | null = widgets ?? null; node && node !== host; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
      alignOffset = widgets ? Math.max(0, Math.round(top)) : 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const resize = new ResizeObserver(schedule), changes = new MutationObserver(schedule);
    resize.observe(host); changes.observe(host, { childList: true, subtree: true }); // the editor's heading and widgets arrive after its data does
    return () => { cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect(); };
  });
  onMount(() => { return () => { disposed = true; marksToken++; listToken++; marks = {}; entries = []; }; });
  $effect(() => { void month; untrack(() => { if (!disposed) void loadMarks(); }); });
  $effect(() => { if (mode === 'list') untrack(() => { void loadList(0); }); });

  // Choosing a later day slides the record in from the right, an earlier one from the left.
  let dayDirection = $state(1);
  const motionMs = (ms: number) => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  function open(day: string) { if (day === selected || !onrequestswitch()) return; dayDirection = selected && day < selected ? -1 : 1; selected = day; }
  function move(delta: number) { if (!onrequestswitch()) return; selected = null; month = shiftMonth(month, delta); }
  function changed() { void loadMarks(); if (mode === 'list') void loadList(offset); }
  const label = (day: string, mark?: DayMark) => `${dateLabel(day)}：${mark ? [mark.has_entry ? '有状态记录' : '', mark.dose_count ? `${mark.dose_count} 次服药` : '', mark.symptom_count ? `${mark.symptom_count} 条副作用` : ''].filter(Boolean).join('，') : '没有记录'}`;
  const value = (entry: Entry, key: typeof RATING_KEYS[number]) => entry[key] === null ? '—' : String(entry[key]);
</script>

<div class="history" data-testid="wellbeing-history">
  <section class="card" aria-labelledby="history-title" style:--align-offset={`${alignOffset}px`}>
    <div class="head">
      <h2 id="history-title">历史记录</h2>
      <div class="settings-tabs" role="group" aria-label="历史视图">
        <button type="button" aria-pressed={mode === 'calendar'} onclick={() => { mode = 'calendar'; }}>日历</button>
        <button type="button" aria-pressed={mode === 'list'} onclick={() => { mode = 'list'; }}>列表</button>
      </div>
    </div>

    {#if mode === 'calendar'}
      <div class="month-bar">
        <button type="button" class="step" onclick={() => move(-1)} aria-label="上个月">‹</button>
        <h3 data-testid="wellbeing-month">{monthLabel(month)}</h3>
        <button type="button" class="step" onclick={() => move(1)} disabled={month >= today.slice(0, 7)} aria-label="下个月">›</button>
      </div>
      {#if marksError}<div data-testid="wellbeing-marks-error"><FeedbackState kind="error" title={marksError}><button type="button" class="button-secondary" onclick={() => { void loadMarks(); }} aria-label="重试读取日历">重试</button></FeedbackState></div>{/if}
      <div class="grid" role="group" aria-label={`${monthLabel(month)}日历`} aria-busy={marksLoading}>
        {#each weekdays as name (name)}<span class="weekday" aria-hidden="true">{name}</span>{/each}
        {#each cells as day, i (day ?? `blank-${i}`)}
          {#if day}
            {@const mark = marks[day]}
            <button type="button" class="day" class:selected={selected === day} class:today={day === today} disabled={day > today} aria-pressed={selected === day} aria-label={label(day, mark)} onclick={() => open(day)} data-testid="wellbeing-day" data-date={day}>
              <!-- A ring in three parts: state, medication, side effect. A part is lit when that kind of record exists. -->
              <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
                {#each SEGMENTS as segment, index (segment.key)}
                  <circle class="part" class:lit={!!mark && segment.lit(mark)} data-part={segment.key} cx="20" cy="20" r={RADIUS} pathLength="100" stroke-dasharray="27 73" transform={`rotate(${-90 + index * 120 + 11} 20 20)`} style:--part={segment.color} />
                {/each}
              </svg>
              <span class="num">{+day.slice(8)}</span>
            </button>
          {:else}<span class="blank" aria-hidden="true"></span>{/if}
        {/each}
      </div>
      <p class="legend">{#each SEGMENTS as segment (segment.key)}<span><i style:--part={segment.color}></i>{segment.name}</span>{/each}{#if !marksLoading && !Object.keys(marks).length && !marksError}<span class="none" data-testid="wellbeing-month-empty">这个月还没有记录</span>{/if}</p>
    {:else}
      {#if listError}<FeedbackState kind="error" title={listError}><button type="button" class="button-secondary" onclick={() => { void loadList(offset); }} aria-label="重试读取列表">重试</button></FeedbackState>{/if}
      {#if !listError && !listLoading && !entries.length}<FeedbackState kind="empty" title="还没有状态记录"><p>在“今日记录”里保存第一天，之后会按日期列在这里。</p></FeedbackState>{/if}
      {#if entries.length}
        <ul class="entries" aria-busy={listLoading}>
          {#each entries as entry (entry.entry_date)}
            <li><button type="button" class="entry" class:selected={selected === entry.entry_date} onclick={() => open(entry.entry_date)} data-testid="wellbeing-entry">
              <strong>{dateLabel(entry.entry_date)}</strong>
              <span class="values">{#each RATING_KEYS as key (key)}<span>{RATING_LABELS[key].name} {value(entry, key)}</span>{/each}<span>睡眠 {entry.sleep_hours === null ? '—' : hoursText(entry.sleep_hours)}</span></span>
            </button></li>
          {/each}
        </ul>
        <div class="pager"><button type="button" class="button-secondary" disabled={listLoading || offset === 0} onclick={() => { void loadList(Math.max(0, offset - PAGE)); }}>上一页</button><span>第 {Math.floor(offset / PAGE) + 1} / {Math.max(1, Math.ceil(total / PAGE))} 页 · 共 {total} 天</span><button type="button" class="button-secondary" disabled={listLoading || offset + PAGE >= total} onclick={() => { void loadList(offset + PAGE); }}>下一页</button></div>
      {/if}
    {/if}
  </section>

  <div class="column" bind:this={column}>
    <div class="stage">
      {#key selected}
        <div class="pane" in:fly={{ x: dayDirection * 48, duration: motionMs(320), easing: cubicOut }} out:fly={{ x: -dayDirection * 48, duration: motionMs(180), easing: cubicIn }}>
          {#if selected}
            <WellbeingDayEditor day={selected} {onunsaved} onchanged={changed} />
          {:else}
            <FeedbackState kind="empty" title="选择一个日期查看或补录"><p>点日历里的日期，查看或补录那一天。</p></FeedbackState>
          {/if}
        </div>
      {/key}
    </div>
  </div>
</div>

<style>
  /* Wide: the calendar is a narrow column beside the editor. Narrow: they stack. */
  .history { display: grid; gap: var(--space-4); min-width: 0; align-items: start; }
  @media (min-width: 64rem) { .history { grid-template-columns: minmax(0, 23rem) minmax(0, 1fr); } }
  /* Wide: the calendar stays in view while the page scrolls past the editor. If the screen is short, the card scrolls inside itself. */
  @media (min-width: 64rem) { .card { position: sticky; top: var(--space-4); margin-top: var(--align-offset, 0px); max-height: calc(100dvh - 2 * var(--space-4)); overflow-y: auto; overscroll-behavior: contain; } }
  .card { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .column { position: relative; min-width: 0; }
  .stage { display: grid; min-width: 0; overflow-x: clip; }
  .pane { grid-area: 1 / 1; min-width: 0; }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h2 { font-size: var(--text-card); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .card .settings-tabs { background: var(--muted); }
  .card .settings-tabs > button { color: var(--muted-foreground); }
  .card .settings-tabs > button[aria-pressed='true'] { color: var(--primary-foreground); }
  .month-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .step { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--foreground); font-size: var(--text-card); cursor: pointer; }
  .step:disabled { opacity: .4; cursor: not-allowed; }
  .step:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  h3 { font-size: var(--text-body); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); justify-items: center; row-gap: var(--space-1); }
  .weekday { padding-block: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  .blank { width: 2.5rem; height: 2.5rem; }
  /* One day: a round button with a three-part ring around its number. */
  .day { position: relative; display: grid; place-items: center; width: 2.75rem; height: 2.75rem; min-height: 0; padding: 0; border: 0; border-radius: 50%; color: var(--foreground); cursor: pointer; }
  /* data-date keeps the button out of the glass enhancement (as for the activity calendar), but that styling adds a sheen and shadow plate; a round ring day wants none. */
  .day.day[data-date] { background: none !important; box-shadow: none !important; }
  .day:disabled { opacity: .35; cursor: not-allowed; }
  .day:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .part { fill: none; stroke: var(--border); stroke-width: 3.5; stroke-linecap: round; opacity: .7; transition: stroke var(--transition-control), opacity var(--transition-control); }
  .part.lit { stroke: var(--part); opacity: 1; }
  .num { position: relative; display: grid; place-items: center; width: 1.625rem; height: 1.625rem; border-radius: 50%; font-size: var(--text-small); font-variant-numeric: tabular-nums; transition: background-color 200ms ease, color 200ms ease, transform 360ms var(--motion-popover-enter-ease); }
  @media (prefers-reduced-motion: reduce) { .num { transition: none; } .day.selected .num { transform: none; } }
  .day.today .num { color: var(--primary); font-weight: var(--weight-bold); }
  .day.selected .num { transform: scale(1.12); background: var(--primary); color: var(--primary-foreground); font-weight: var(--weight-bold); }
  @media (hover: hover) { .day:not(:disabled):not(.selected):hover .num { background: var(--muted); } }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); color: var(--muted-foreground); font-size: var(--text-caption); }
  .legend span { display: inline-flex; align-items: center; gap: var(--space-1); }
  .legend i { display: inline-block; width: .625rem; height: .625rem; border-radius: 50%; background: var(--part); }
  .legend .none { margin-left: auto; }
  .entries { display: grid; gap: var(--space-2); }
  .entry { display: grid; gap: var(--space-1); width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); text-align: left; cursor: pointer; }
  .entry.selected { border-color: var(--primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 25%, transparent); }
  .entry:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .values { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); color: var(--muted-foreground); font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  .pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-small); }
</style>
