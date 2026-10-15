<script lang="ts">
  import { tick } from 'svelte';

  let { label, value = $bindable(''), min = '1900-01-01', max = '2100-12-31', timezone = 'UTC', required = false, disabled = false }:
    { label: string; value?: string; min?: string; max?: string; timezone?: string; required?: boolean; disabled?: boolean } = $props();
  const id = $props.id();
  let field: HTMLDivElement, trigger: HTMLButtonElement, panel: HTMLDivElement;
  let opened = $state(false), month = $state('2026-01'), focused = $state('');
  $effect(() => {
    if (disabled && opened) { panel?.hidePopover(); opened = false; }
  });
  let left = $state(0), top = $state(0);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const year = $derived(Number(month.slice(0, 4)));
  const monthIndex = $derived(Number(month.slice(5)) - 1);
  const years = $derived(Array.from({ length: Number(max.slice(0, 4)) - Number(min.slice(0, 4)) + 1 }, (_, i) => Number(min.slice(0, 4)) + i));
  const days = $derived.by(() => {
    const first = new Date(Date.UTC(year, monthIndex, 1));
    return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(year, monthIndex, 1 - first.getUTCDay() + i)).toISOString().slice(0, 10));
  });
  const tabDate = $derived(focused.slice(0, 7) === month && days.includes(focused) && allowed(focused) ? focused : days.find(date => date.slice(0, 7) === month && allowed(date)));
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function allowed(date: string) { return date >= min && date <= max; }
  function bounded(date: string) { return date < min ? min : date > max ? max : date; }
  function dateLabel(date: string) { const [y, m, d] = date.split('-').map(Number); return `${y}年${m}月${d}日`; }
  function position() {
    if (!opened) return;
    const rect = field.getBoundingClientRect(), size = { width: panel.offsetWidth, height: panel.offsetHeight };
    left = Math.max(12, Math.min(rect.left, window.innerWidth - size.width - 12));
    const below = rect.bottom + 8;
    const belowSpace = window.innerHeight - below - 12, aboveSpace = rect.top - 20;
    top = Math.max(12, Math.min(belowSpace >= size.height || belowSpace >= aboveSpace ? below : rect.top - size.height - 8, window.innerHeight - size.height - 12));
  }
  async function focusDate(date: string) {
    focused = bounded(date); month = focused.slice(0, 7);
    await tick(); panel.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }
  async function open() {
    if (disabled) return;
    if (opened) { close(); return; }
    focused = bounded(value || today()); month = focused.slice(0, 7); opened = true;
    await tick(); if (disabled) { opened = false; return; } panel.showPopover(); position(); await focusDate(focused);
  }
  function close() { panel.hidePopover(); opened = false; trigger.focus(); }
  function choose(date: string) { if (disabled) return; value = date; close(); }
  function shiftMonth(offset: number) {
    const next = new Date(Date.UTC(year, monthIndex + offset, 1)).toISOString().slice(0, 7);
    return next < min.slice(0, 7) ? min.slice(0, 7) : next > max.slice(0, 7) ? max.slice(0, 7) : next;
  }
  function navigate(event: KeyboardEvent, date: string) {
    const current = new Date(`${date}T00:00:00Z`);
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -current.getUTCDay(), End: 6 - current.getUTCDay() };
    if (event.key in offsets) current.setUTCDate(current.getUTCDate() + offsets[event.key]);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const target = current.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1);
      const day = current.getUTCDate(); current.setUTCDate(1); current.setUTCMonth(target);
      current.setUTCDate(Math.min(day, new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate()));
    } else return;
    event.preventDefault(); void focusDate(current.toISOString().slice(0, 10));
  }
</script>

<svelte:window onresize={position} onscroll={position} onkeydown={event => { if (opened && event.key === 'Escape') { event.preventDefault(); close(); } }} />
<div class="date-field">
  <label for={id}>{label}</label>
  <div class="date-control" bind:this={field}>
    <input {id} aria-label={label} type="date" bind:value {min} {max} {required} {disabled}
      onkeydown={event => { if (event.key === ' ' || (event.altKey && event.key === 'ArrowDown')) { event.preventDefault(); void open(); } }} />
    <button class="calendar-trigger" type="button" {disabled} bind:this={trigger} aria-label={`选择${label}`} aria-haspopup="dialog" aria-expanded={opened} aria-controls={`${id}-calendar`} onclick={() => void open()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
    </button>
  </div>
  <div id={`${id}-calendar`} class="date-popover" bind:this={panel} popover="auto" role="dialog" aria-label={`选择${label}`} aria-describedby={`${id}-help`}
    style:left={`${left}px`} style:top={`${top}px`} ontoggle={event => { opened = event.newState === 'open'; }}>
    <div class="calendar-header">
      <div class="month-selectors">
        <select aria-label="年份" value={year} onchange={event => { month = bounded(`${event.currentTarget.value}-${month.slice(5)}-01`).slice(0, 7); }}>
          {#each years as y}<option value={y}>{y}年</option>{/each}
        </select>
        <select aria-label="月份" value={monthIndex} onchange={event => { month = bounded(`${year}-${String(Number(event.currentTarget.value) + 1).padStart(2, '0')}-01`).slice(0, 7); }}>
          {#each Array.from({ length: 12 }, (_, i) => i) as m}<option value={m} disabled={`${year}-${String(m + 1).padStart(2, '0')}` < min.slice(0, 7) || `${year}-${String(m + 1).padStart(2, '0')}` > max.slice(0, 7)}>{m + 1}月</option>{/each}
        </select>
      </div>
      <button class="month-step" type="button" aria-label="上个月" disabled={month <= min.slice(0, 7)} onclick={() => { month = shiftMonth(-1); }}>‹</button>
      <button class="month-step" type="button" aria-label="下个月" disabled={month >= max.slice(0, 7)} onclick={() => { month = shiftMonth(1); }}>›</button>
    </div>
    <div class="month-announcement" aria-live="polite">{year}年{monthIndex + 1}月</div>
    <div class="weekdays" aria-hidden="true">{#each weekdays as day}<span>{day}</span>{/each}</div>
    <div class="calendar-days" role="group" aria-label="日期">
      {#each days as date}
        <button type="button" data-date={date} aria-label={dateLabel(date)} aria-pressed={date === value} aria-current={date === today() ? 'date' : undefined}
          class:outside={date.slice(0, 7) !== month} class:today={date === today()} disabled={!allowed(date)} tabindex={date === tabDate ? 0 : -1}
          onfocus={() => { focused = date; }} onkeydown={event => navigate(event, date)} onclick={() => choose(date)}>{Number(date.slice(8))}</button>
      {/each}
    </div>
    <div class="calendar-footer"><button type="button" onclick={() => choose('')}>清除</button><button type="button" disabled={!allowed(today())} onclick={() => choose(today())}>今天</button></div>
    <p id={`${id}-help`} class="calendar-help">方向键选择日期，Esc 关闭</p>
  </div>
</div>

<style>
  .date-field { display: grid; gap: .35rem; min-width: 0; font-size: .875rem; }
  .date-control { display: flex; align-items: center; width: 13.5rem; max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); }
  .date-control:focus-within { border-color: var(--primary); }
  input { width: 100%; min-width: 0; border: 0; background: transparent; padding: .5rem 0 .5rem .75rem; border-radius: var(--radius-control); color: var(--foreground); }
  input::-webkit-calendar-picker-indicator { display: none; }
  .calendar-trigger { display: grid; place-items: center; flex-shrink: 0; width: 2.75rem; height: 2.75rem; border-radius: .65rem; color: var(--primary); }
  .calendar-trigger:hover, .calendar-trigger[aria-expanded='true'] { background: var(--primary-soft); }
  .date-popover { position: fixed; inset: auto; margin: 0; width: 20rem; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--foreground); box-shadow: 0 12px 40px #1e302b26; }
  .calendar-header { display: flex; align-items: center; gap: .25rem; margin-bottom: .75rem; }
  .month-selectors { display: flex; flex: 1; min-width: 0; gap: var(--space-2); }
  select { min-width: 0; min-height: 2.5rem; border: 0; background: var(--surface); color: var(--foreground); padding: .25rem; font-size: .9375rem; font-weight: 650; }
  .month-step { flex-shrink: 0; width: 2.5rem; height: 2.5rem; border-radius: .65rem; font-size: 1.5rem; color: var(--primary); }
  .month-step:hover:not(:disabled) { background: var(--primary-soft); }
  .weekdays, .calendar-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: .25rem; text-align: center; }
  .weekdays { color: var(--muted-foreground); font-size: .75rem; margin-bottom: .5rem; }
  .calendar-days button { min-height: 2.25rem; border-radius: .65rem; font-size: .875rem; }
  .calendar-days button:hover:not(:disabled) { background: var(--primary-soft); color: var(--primary); }
  .calendar-days .outside { color: var(--muted-foreground); }
  .calendar-days .today { box-shadow: inset 0 0 0 1px var(--primary); }
  .calendar-days button[aria-pressed='true'], .calendar-days button[aria-pressed='true']:hover { background: var(--primary); color: var(--primary-foreground); font-weight: 700; }
  .calendar-days button:focus-visible { outline-offset: 1px; }
  .calendar-footer { display: flex; justify-content: space-between; margin-top: .75rem; padding-top: .5rem; border-top: 1px solid var(--border); }
  .calendar-footer button { min-height: 2.5rem; padding: .25rem .75rem; border-radius: .65rem; color: var(--primary); font-weight: 550; }
  .calendar-footer button:hover:not(:disabled) { background: var(--primary-soft); }
  .calendar-help { text-align: center; color: var(--muted-foreground); font-size: .6875rem; margin-top: .25rem; }
  .month-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @media (max-width: 767px) { .date-control { width: 100%; } }
</style>
