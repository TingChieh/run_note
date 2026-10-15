<script lang="ts">
  import { calendarCells, type Calendar, type CalendarMetric } from '#lib/api/statistics.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { onMount, tick } from 'svelte';
  import { formatDistance } from '#lib/api/activities.ts';
  let { calendar, metric, selected, onselect, enhanced = false }: { calendar: Calendar; metric: CalendarMetric; selected: string | null; onselect: (date: string) => void; enhanced?: boolean } = $props();
  let focused = $state<string | null>(null);
  let daysElement = $state<HTMLDivElement>();
  let monthly = $state(false);
  onMount(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => { monthly = enhanced && media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
  let cells = $derived(calendarCells(calendar.year));
  let monthGroups = $derived(Array.from({length:12}, (_, index) => {
    const days = calendar.days.filter(day => Number(day.date.slice(5,7)) === index + 1);
    const offset = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
    return {month:index + 1, dates:[...Array<string | null>(offset).fill(null), ...days.map(day => day.date)]};
  }));
  async function move(event: KeyboardEvent, date: string) {
    if (!enhanced) return;
    const offsets: Record<string, number> = monthly ? { ArrowUp:-7, ArrowDown:7, ArrowLeft:-1, ArrowRight:1 } : { ArrowUp:-1, ArrowDown:1, ArrowLeft:-7, ArrowRight:7 };
    const index = calendar.days.findIndex(day => day.date === date);
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? calendar.days.length - 1 : event.key in offsets ? index + offsets[event.key] : null;
    if (next === null) return;
    event.preventDefault(); next = Math.max(0, Math.min(calendar.days.length - 1, next)); focused = calendar.days[next].date;
    await tick(); daysElement?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }
  const colors = ['var(--calendar-0)','var(--calendar-1)','var(--calendar-2)','var(--calendar-3)','var(--calendar-4)'];
  let values = $derived(new Map(calendar.days.map(d => [d.date, d])));
  let tabDate = $derived(focused && values.has(focused) ? focused : selected && values.has(selected) ? selected : `${calendar.year}-01-01`);
  let max = $derived(Math.max(1, ...calendar.days.map(d => metric === 'distance' ? Number(d.distance_m) : d.activity_count)));
  function level(date: string) { const d = values.get(date)!; const n = metric === 'distance' ? Number(d.distance_m) : d.activity_count; return d.activity_count === 0 ? 0 : n === 0 ? 1 : Math.min(4, Math.ceil(n / max * 4)); }
  let months = $derived(Array.from({length: 12}, (_, index) => { const date = `${calendar.year}-${String(index + 1).padStart(2, '0')}-01`; return { label: `${index + 1}月`, column: Math.floor(calendarCells(calendar.year).indexOf(date) / 7) + 1 }; }));
  function label(date: string) { const d = values.get(date)!; return `${date}，${d.activity_count} 次活动，${enhanced ? dashboardDistance(d.distance_m) : formatDistance(d.distance_m)}`; }
</script>
{#snippet dayButton(date: string)}
  <button type="button" class={`day-level-${level(date)}`} data-date={date} tabindex={enhanced ? date === tabDate ? 0 : -1 : 0} onfocus={() => { focused = date; }} onkeydown={(event) => { void move(event, date); }} aria-label={label(date)} aria-pressed={selected === date} title={label(date)} onclick={() => onselect(date)} style:background={colors[level(date)]} class:selected={selected === date}>{#if monthly}<span aria-hidden="true">{Number(date.slice(8))}</span>{/if}</button>
{/snippet}
<div class="calendar-scroll py-3" class:enhanced class:monthly aria-label={`${calendar.year} 年运动日历，周一开始`} style:--weeks={cells.length / 7}>
  {#if monthly}
    <div class="month-grid" bind:this={daysElement}>
      {#each monthGroups as group}
        <section class="year-month" aria-label={`${group.month}月`}>
          <h3>{group.month}月</h3>
          <div class="month-days">
            {#each ['一','二','三','四','五','六','日'] as day}<span class="month-weekday" aria-hidden="true">{day}</span>{/each}
            {#each group.dates as date}{#if date}{@render dayButton(date)}{:else}<span aria-hidden="true"></span>{/if}{/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <div class="months" aria-hidden="true">{#each months as month}<span style:grid-column={month.column}>{month.label}</span>{/each}</div>
    <div class="calendar">
      <div class="weekdays" aria-hidden="true">{#each ['一','二','三','四','五','六','日'] as day}<span>{day}</span>{/each}</div>
      <div class="days" bind:this={daysElement}>
        {#each cells as date}{#if date}{@render dayButton(date)}{:else}<span aria-hidden="true"></span>{/if}{/each}
      </div>
    </div>
  {/if}
</div>
<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{metric === 'distance' ? '每日距离' : '每日活动次数'}：少</span>{#each colors as color}<span class="h-3 w-3 rounded-sm" style:background={color}></span>{/each}<span>多</span>{#if !enhanced}<span>（按本年最大值分为四档；零距离活动用浅绿，灰色为无记录）</span>{/if}</div>
{#if enhanced}<p class="scroll-hint">全年日期完整展示 · 点击日期查看活动</p>{:else}<p class="mt-3 text-sm text-muted-foreground">点击任意日期查看活动；历史日期按活动保存时的当地日期归属。</p>{/if}
<style>
  .months { display: grid; grid-auto-columns: 17px; grid-auto-flow: column; width: max-content; margin-left: 19px; margin-bottom: 8px; font-size: 10px; }
  .months span { width: 35px; }
  .calendar { display: flex; gap: 9px; width: max-content; }
  .weekdays { display: grid; grid-template-rows: repeat(7, 13px); gap: 4px; font-size: 10px; line-height: 13px; }
  .days { display: grid; grid-template-rows: repeat(7, 13px); grid-auto-flow: column; grid-auto-columns: 13px; gap: 4px; }
  .days button { border-radius: 3px; cursor: pointer; width: 13px; height: 13px; }
  .days button:hover, .days button:focus-visible, .days button.selected { outline: 2px solid var(--calendar-ring); outline-offset: 1px; }
  .calendar-scroll { max-width: 100%; overflow-x: auto; }
  .enhanced { overflow: visible; }
  .enhanced .months { grid-template-columns: repeat(var(--weeks), minmax(0,1fr)); grid-auto-columns: auto; gap: 3px; width: auto; margin-left: 25px; font-size: 10px; }
  .enhanced .months span { width: auto; white-space: nowrap; }
  .enhanced .calendar { gap: 9px; width: 100%; }
  .enhanced .weekdays { flex: 0 0 16px; grid-template-rows: repeat(7,minmax(0,1fr)); gap: 3px; line-height: 1; font-size: 10px; align-items: center; }
  .enhanced .days { flex: 1; min-width: 0; grid-template-columns: repeat(var(--weeks),minmax(0,1fr)); grid-template-rows: repeat(7,minmax(0,1fr)); gap: 3px; }
  .enhanced .days button { width: 100%; height: auto; aspect-ratio: 1; border-radius: 2px; }
  .month-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(9rem,1fr)); gap: 1.5rem 1rem; }
  .year-month { min-width: 0; }
  .year-month h3 { margin-bottom: .5rem; font-size: .875rem; font-weight: 600; }
  .month-days { display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); gap: 3px; }
  .month-days button { min-width: 0; min-height: 20px; aspect-ratio: 1; width: 100%; border-radius: 3px; font-size: .625rem; color: #10231c; }
  .month-days .day-level-4 { color: white; }
  .month-days button:hover, .month-days button:focus-visible, .month-days button.selected { outline: 2px solid var(--calendar-ring); outline-offset: 1px; }
  .month-weekday { text-align: center; font-size: .625rem; color: var(--muted-foreground); }
  .scroll-hint { font-size: .75rem; color: var(--muted-foreground); margin-top: .75rem; }
  @media(prefers-color-scheme:dark) {
    .month-days button { color: white; }
    .month-days .day-level-2 { color: black; }
    .month-days .day-level-3, .month-days .day-level-4 { color: #10231c; }
  }
</style>
