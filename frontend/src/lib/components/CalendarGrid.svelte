<script lang="ts">
  import { calendarCells, type Calendar, type CalendarMetric } from '#lib/api/statistics.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { tick } from 'svelte';
  import { formatDistance } from '#lib/api/activities.ts';
  let { calendar, metric, selected, onselect, enhanced = false }: { calendar: Calendar; metric: CalendarMetric; selected: string | null; onselect: (date: string) => void; enhanced?: boolean } = $props();
  let focused = $state<string | null>(null);
  let daysElement: HTMLDivElement;
  async function move(event: KeyboardEvent, date: string) {
    if (!enhanced) return;
    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    const index = calendar.days.findIndex(day => day.date === date);
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? calendar.days.length - 1 : event.key in offsets ? index + offsets[event.key] : null;
    if (next === null) return;
    event.preventDefault(); next = Math.max(0, Math.min(calendar.days.length - 1, next)); focused = calendar.days[next].date;
    await tick(); daysElement.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }
  const colors = ['#e7ecea','#c8e6d8','#83c6a5','#399769','#176344'];
  let values = $derived(new Map(calendar.days.map(d => [d.date, d])));
  let tabDate = $derived(focused && values.has(focused) ? focused : selected && values.has(selected) ? selected : `${calendar.year}-01-01`);
  let max = $derived(Math.max(1, ...calendar.days.map(d => metric === 'distance' ? Number(d.distance_m) : d.activity_count)));
  function level(date: string) { const d = values.get(date)!; const n = metric === 'distance' ? Number(d.distance_m) : d.activity_count; return d.activity_count === 0 ? 0 : n === 0 ? 1 : Math.min(4, Math.ceil(n / max * 4)); }
  let months = $derived(Array.from({length: 12}, (_, index) => { const date = `${calendar.year}-${String(index + 1).padStart(2, '0')}-01`; return { label: `${index + 1}月`, column: Math.floor(calendarCells(calendar.year).indexOf(date) / 7) + 1 }; }));
  function label(date: string) { const d = values.get(date)!; return `${date}，${d.activity_count} 次活动，${enhanced ? dashboardDistance(d.distance_m) : formatDistance(d.distance_m)}`; }
</script>
<div class="calendar-scroll overflow-x-auto py-3" class:enhanced aria-label={`${calendar.year} 年运动日历，周一开始`}>
  <div class="months" aria-hidden="true">{#each months as month}<span style:grid-column={month.column}>{month.label}</span>{/each}</div>
  <div class="calendar">
    <div class="weekdays" aria-hidden="true">{#each ['一','二','三','四','五','六','日'] as day}<span>{day}</span>{/each}</div>
    <div class="days" bind:this={daysElement}>
      {#each calendarCells(calendar.year) as date}
        {#if date}<button type="button" data-date={date} tabindex={enhanced ? date === tabDate ? 0 : -1 : 0} onfocus={() => { focused = date; }} onkeydown={(event) => { void move(event, date); }} aria-label={label(date)} aria-pressed={selected === date} title={label(date)} onclick={() => onselect(date)} style:background={colors[level(date)]} class:selected={selected === date}></button>
        {:else}<span aria-hidden="true"></span>{/if}
      {/each}
    </div>
  </div>
</div>
<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{metric === 'distance' ? '每日距离' : '每日活动次数'}：少</span>{#each colors as color}<span class="h-3 w-3 rounded-sm" style:background={color}></span>{/each}<span>多</span>{#if !enhanced}<span>（按本年最大值分为四档；零距离活动用浅绿，灰色为无记录）</span>{/if}</div>
{#if enhanced}<p class="scroll-hint">左右滑动查看全年 · 点击日期查看活动</p>{:else}<p class="mt-3 text-sm text-muted-foreground">点击任意日期查看活动；历史日期按活动保存时的当地日期归属。</p>{/if}
<style>
  .months { display: grid; grid-auto-columns: 17px; grid-auto-flow: column; width: max-content; margin-left: 19px; margin-bottom: 8px; font-size: 10px; }
  .months span { width: 35px; }
  .calendar { display: flex; gap: 9px; width: max-content; }
  .weekdays { display: grid; grid-template-rows: repeat(7, 13px); gap: 4px; font-size: 10px; line-height: 13px; }
  .days { display: grid; grid-template-rows: repeat(7, 13px); grid-auto-flow: column; grid-auto-columns: 13px; gap: 4px; }
  .days button { border-radius: 3px; cursor: pointer; width: 13px; height: 13px; }
  .days button:hover, .days button:focus-visible, .days button.selected { outline: 2px solid #183f30; outline-offset: 1px; }
  .enhanced .months { grid-auto-columns: 22px; margin-left: 24px; font-size: 11px; }
  .enhanced .calendar { gap: 12px; }
  .enhanced .weekdays { grid-template-rows: repeat(7,18px); line-height: 18px; font-size: 11px; }
  .enhanced .days { grid-template-rows: repeat(7,18px); grid-auto-columns: 18px; }
  .enhanced .days button { width: 18px; height: 18px; }
  .calendar-scroll { max-width: 100%; }
  .scroll-hint { font-size: .75rem; color: var(--muted-foreground); margin-top: .75rem; }
</style>
