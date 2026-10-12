<script lang="ts">
  import { calendarCells, type Calendar, type CalendarMetric } from '#lib/api/statistics.ts';
  import { formatDistance } from '#lib/api/activities.ts';
  let { calendar, metric, selected, onselect }: { calendar: Calendar; metric: CalendarMetric; selected: string | null; onselect: (date: string) => void } = $props();
  const colors = ['#e7ecea','#c8e6d8','#83c6a5','#399769','#176344'];
  let values = $derived(new Map(calendar.days.map(d => [d.date, d])));
  let max = $derived(Math.max(1, ...calendar.days.map(d => metric === 'distance' ? Number(d.distance_m) : d.activity_count)));
  function level(date: string) { const d = values.get(date)!; const n = metric === 'distance' ? Number(d.distance_m) : d.activity_count; return d.activity_count === 0 ? 0 : n === 0 ? 1 : Math.min(4, Math.ceil(n / max * 4)); }
  let months = $derived(Array.from({length: 12}, (_, index) => { const date = `${calendar.year}-${String(index + 1).padStart(2, '0')}-01`; return { label: `${index + 1}月`, column: Math.floor(calendarCells(calendar.year).indexOf(date) / 7) + 1 }; }));
  function label(date: string) { const d = values.get(date)!; return `${date}，${d.activity_count} 次活动，${formatDistance(d.distance_m)}`; }
</script>
<div class="overflow-x-auto py-3" aria-label={`${calendar.year} 年运动日历，周一开始`}>
  <div class="months" aria-hidden="true">{#each months as month}<span style:grid-column={month.column}>{month.label}</span>{/each}</div>
  <div class="calendar">
    <div class="weekdays" aria-hidden="true">{#each ['一','二','三','四','五','六','日'] as day}<span>{day}</span>{/each}</div>
    <div class="days">
      {#each calendarCells(calendar.year) as date}
        {#if date}<button type="button" aria-label={label(date)} aria-pressed={selected === date} title={label(date)} onclick={() => onselect(date)} style:background={colors[level(date)]} class:selected={selected === date}></button>
        {:else}<span aria-hidden="true"></span>{/if}
      {/each}
    </div>
  </div>
</div>
<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{metric === 'distance' ? '每日距离' : '每日活动次数'}：少</span>{#each colors as color}<span class="h-3 w-3 rounded-sm" style:background={color}></span>{/each}<span>多</span><span>（按本年最大值分为四档；零距离活动用浅绿，灰色为无记录）</span></div>
<p class="mt-3 text-sm text-muted-foreground">点击任意日期查看活动；历史日期按活动保存时的当地日期归属。</p>
<style>
  .months { display: grid; grid-auto-columns: 17px; grid-auto-flow: column; width: max-content; margin-left: 19px; margin-bottom: 8px; font-size: 10px; }
  .months span { width: 35px; }
  .calendar { display: flex; gap: 9px; width: max-content; }
  .weekdays { display: grid; grid-template-rows: repeat(7, 13px); gap: 4px; font-size: 10px; line-height: 13px; }
  .days { display: grid; grid-template-rows: repeat(7, 13px); grid-auto-flow: column; grid-auto-columns: 13px; gap: 4px; }
  .days button { border-radius: 3px; cursor: pointer; width: 13px; height: 13px; }
  .days button:hover, .days button:focus-visible, .days button.selected { outline: 2px solid #183f30; outline-offset: 1px; }
</style>
