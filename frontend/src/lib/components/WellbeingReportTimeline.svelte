<script lang="ts">
  import { untrack } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { OUTER, centre, polar, slice } from './wellbeing-wheel.ts';
  import { RATING_LABELS, dateLabel, doseText, hoursText, monthLabel, timeLabel, type Dose, type MedicationStat, type SymptomEvent, type TrendDay } from '#lib/api/wellbeing.ts';
  // The days of the range as a calendar, the way the history page draws them: a round day with a ring in three parts (state, medication, side effect), each lit when that kind of record exists.
  // A week or a fortnight is one big circle of slices instead (the oldest day at the top, going clockwise); a longer range is a calendar per month, one month at a time: swipe (or use the arrows) to go to the next.
  // Choosing a day shows its record beside it. Presentation only: the figures are the server's.
  let { series, doses, events, medications, missing, timezone }: { series: TrendDay[]; doses: Dose[]; events: SymptomEvent[]; medications: MedicationStat[]; missing: string[]; timezone: string } = $props();
  const RADIUS = 16.5;
  const SEGMENTS = [
    { key: 'entry', name: '状态', color: 'var(--well-mood)' },
    { key: 'dose', name: '服药', color: 'var(--well-dose)' },
    { key: 'symptom', name: '副作用', color: 'var(--well-effect)' }
  ] as const;
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const wheel = $derived(series.length <= 14);
  /** Months are side-by-side pages of one scrolling row: swipe or scroll to turn, the arrows do the same. It starts on the newest month. */
  let pager = $state<HTMLElement | undefined>(), page = $state(0);
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const turn = (to: number) => { if (!pager) return; const next = Math.min(Math.max(to, 0), months.length - 1); pager.scrollTo({ left: next * pager.clientWidth, behavior: reduced() ? 'auto' : 'smooth' }); };
  const onscroll = () => { if (pager && pager.clientWidth) page = Math.round(pager.scrollLeft / pager.clientWidth); };
  $effect(() => {
    const el = pager, count = months.length;
    if (!el) return;
    untrack(() => { requestAnimationFrame(() => { el.scrollLeft = (count - 1) * el.clientWidth; page = count - 1; }); });
  });
  /** The three marks of a slice sit side by side near its outer edge, each at its own spot. */
  const dotAt = (index: number, kind: number) => polar(OUTER - 2.8, -90 + (index + 0.5) * (360 / series.length) + (kind - 1) * Math.min(8, 360 / series.length / 3.4));
  // Choosing a later day slides its record in from the right, an earlier one from the left; reduced motion skips it.
  let direction = $state(1);
  const motionMs = (ms: number) => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  const pick = (date: string) => { if (selected && date !== selected) direction = date > selected ? 1 : -1; selected = date; };
  /** "今天", "昨天" or "N 天前", counted back from the last day of the range. */
  function ago(date: string): string {
    const end = series[series.length - 1]?.date;
    if (!end) return '';
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    return days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
  }
  const lack = $derived(new Set(missing));
  const lit = (day: TrendDay) => ({ entry: !lack.has(day.date), dose: day.dose_count > 0, symptom: day.symptom_count > 0 });
  /** The range cut into calendar months, each one a Monday-first grid padded in front of its first day. */
  const months = $derived.by(() => {
    const groups: { month: string; pad: number; days: TrendDay[] }[] = [];
    for (const day of series) {
      const key = day.date.slice(0, 7);
      let group = groups[groups.length - 1];
      if (!group || group.month !== key) { group = { month: key, pad: (new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7, days: [] }; groups.push(group); }
      group.days.push(day);
    }
    return groups;
  });
  const last = () => [...series].reverse().find(d => !lack.has(d.date) || d.dose_count || d.symptom_count)?.date ?? series[series.length - 1]?.date ?? '';
  let selected = $state('');
  // A new range starts on its newest recorded day again.
  let range = '';
  $effect(() => { const key = `${series[0]?.date}|${series.length}`; if (key !== range || !series.some(d => d.date === selected)) { range = key; selected = last(); } });
  const day = $derived(series.find(d => d.date === selected) ?? null);
  const dayDoses = $derived(doses.filter(d => d.entry_date === selected));
  const dayEvents = $derived(events.filter(e => e.entry_date === selected));
  const doseName = (id: string | null) => doses.find(d => d.id === id)?.medication_name ?? '';
  /** The doses whose amount differs from the one before it (by medicine and the moment it was taken), not every dose of that medicine on that day. */
  const changed = $derived(new Set(medications.flatMap(m => m.timeline.filter(t => t.kind === 'changed').map(t => `${m.name}|${Date.parse(t.taken_at)}`))));
  const isChanged = (dose: Dose) => changed.has(`${dose.medication_name}|${Date.parse(dose.taken_at)}`);
  const RATINGS = ['mood', 'anxiety', 'energy', 'focus', 'functioning', 'sleep_quality'] as const;
  const COLORS: Record<string, string> = { mood: '--well-mood', anxiety: '--well-anxiety', energy: '--well-energy', focus: '--well-focus', functioning: '--well-function', sleep_quality: '--well-sleep-quality', sleep_hours: '--well-sleep' };
  /** The answers of the day as rows with a bar: a rating out of 10, sleep out of 12 hours. */
  const values = $derived(!day ? [] : [
    ...RATINGS.slice(0, 2).map(key => ({ key, label: RATING_LABELS[key].name, value: day[key], text: day[key] === null ? '' : String(day[key]), ratio: (day[key] ?? 0) / 10 })),
    { key: 'sleep_hours', label: '睡眠时长', value: day.sleep_hours, text: day.sleep_hours === null ? '' : hoursText(day.sleep_hours), ratio: Math.min(1, (day.sleep_hours ?? 0) / 12) },
    ...RATINGS.slice(2).map(key => ({ key, label: RATING_LABELS[key].name, value: day[key], text: day[key] === null ? '' : String(day[key]), ratio: (day[key] ?? 0) / 10 }))
  ].filter(item => item.value !== null));
  const label = (d: TrendDay) => `${dateLabel(d.date)}：${[!lack.has(d.date) ? '有状态记录' : '', d.dose_count ? `${d.dose_count} 次服药` : '', d.symptom_count ? `${d.symptom_count} 条副作用` : ''].filter(Boolean).join('，') || '没有记录'}`;
  const summary = $derived(`每天的记录：${series[0]?.date ?? ''} 至 ${series[series.length - 1]?.date ?? ''} 共 ${series.length} 天，${series.length - missing.length} 天有状态记录，${series.filter(d => d.dose_count).length} 天有服药，${series.filter(d => d.symptom_count).length} 天有副作用。`);
</script>

<section class="timeline" aria-labelledby="timeline-title" data-testid="wellbeing-report-timeline" style:--size={series.length > 62 ? '2.25rem' : '2.75rem'}>
  <h3 id="timeline-title">每天的状态、服药与副作用</h3>
  <div class="body">
    {#if wheel}
      <div class="side">
      <div class="wheel" role="group" aria-label={summary}>
        <svg class="slices" viewBox="0 0 100 100">
          {#each series as d, index (d.date)}
            {@const on = lit(d)}
            <g class="slice" class:selected={selected === d.date} role="button" tabindex="0" aria-pressed={selected === d.date} aria-label={label(d)} data-testid="wellbeing-report-day" data-date={d.date}
              onclick={() => pick(d.date)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(d.date); } }}>
              <path d={slice(index, series.length)} />
              {#each SEGMENTS as segment, kind (segment.key)}{@const at = dotAt(index, kind)}<circle class="part" class:lit={on[segment.key]} data-part={segment.key} cx={at[0]} cy={at[1]} r="1.5" style:--part={segment.color} />{/each}
            </g>
          {/each}
        </svg>
        {#each series as d, index (d.date)}{@const at = centre(index, series.length)}<span class="n" class:selected={selected === d.date} style={`left: ${at[0]}%; top: ${at[1]}%`} aria-hidden="true">{+d.date.slice(8)}</span>{/each}
        <!-- The chosen day rolls like a counter in the middle: a later day comes up from below, an earlier one down from above. -->
        <div class="core" aria-hidden="true">
          {#if selected}{#key selected}
            <div class="face" in:fly={{ y: direction * 44, duration: motionMs(380), easing: cubicOut }} out:fly={{ y: -direction * 44, duration: motionMs(220), easing: cubicIn }}><strong>{+selected.slice(8)}</strong><span>周{weekday(selected)}</span></div>
          {/key}{/if}
        </div>
      </div>
      <p class="legend wheel-legend">{#each SEGMENTS as segment (segment.key)}<span><i style:--part={segment.color}></i>{segment.name}</span>{/each}</p>
      </div>
    {:else}
      <div class="calendar" role="group" aria-label={summary}>
        {#if months.length > 1}
          <div class="month-bar">
            <button type="button" class="step" onclick={() => turn(page - 1)} disabled={page <= 0} aria-label="上一个月" data-testid="wellbeing-report-prev">‹</button>
            <h4 data-testid="wellbeing-report-month">{monthLabel(months[Math.min(page, months.length - 1)].month)}</h4>
            <button type="button" class="step" onclick={() => turn(page + 1)} disabled={page >= months.length - 1} aria-label="下一个月" data-testid="wellbeing-report-next">›</button>
          </div>
        {/if}
        <div class="pager" class:paged={months.length > 1} bind:this={pager} {onscroll}>
          {#each months as group (group.month)}
            <div class="month">
              {#if months.length === 1}<h4>{monthLabel(group.month)}</h4>{/if}
              <div class="grid">
                {#each weekdays as name (name)}<span class="weekday" aria-hidden="true">{name}</span>{/each}
                {#each Array(group.pad) as _, i (i)}<span class="blank" aria-hidden="true"></span>{/each}
                {#each group.days as d (d.date)}
                  {@const on = lit(d)}
                  <button type="button" class="day" class:selected={selected === d.date} aria-pressed={selected === d.date} aria-label={label(d)} onclick={() => pick(d.date)} data-testid="wellbeing-report-day" data-date={d.date}>
                    <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
                      {#each SEGMENTS as segment, index (segment.key)}
                        <circle class="part" class:lit={on[segment.key]} data-part={segment.key} cx="20" cy="20" r={RADIUS} pathLength="100" stroke-dasharray="27 73" transform={`rotate(${-90 + index * 120 + 11} 20 20)`} style:--part={segment.color} />
                      {/each}
                    </svg>
                    <span class="num">{+d.date.slice(8)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <p class="legend">{#each SEGMENTS as segment (segment.key)}<span><i style:--part={segment.color}></i>{segment.name}</span>{/each}</p>
      </div>
    {/if}

    <div class="detail" aria-live="polite" data-testid="wellbeing-report-day-detail">
      <div class="stage">{#if day}{#key selected}<div class="pane" in:fly={{ x: direction * 32, duration: motionMs(320), easing: cubicOut }} out:fly={{ x: -direction * 32, duration: motionMs(160), easing: cubicIn }}>
        <header class="when">
          <div><h4>{+day.date.slice(5, 7)} 月 {+day.date.slice(8)} 日</h4><p class="ago">{dateLabel(day.date).slice(-2)} · {ago(day.date)}</p></div>
          <!-- What the day holds at a glance, in the ring's three colours. -->
          <ul class="tally" aria-label="这天有什么">
            <li style:--part="var(--well-mood)"><i></i>状态 <strong>{values.length}</strong> 项</li>
            <li style:--part="var(--well-dose)"><i></i>服药 <strong>{dayDoses.length}</strong> 次</li>
            <li style:--part="var(--well-effect)"><i></i>副作用 <strong>{dayEvents.length}</strong> 条</li>
          </ul>
        </header>
        <div class="cols">
          <section class="states" aria-label="状态">
            <h5>状态</h5>
            {#if values.length}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div class="scroller" role="region" aria-label="这天的各项状态" tabindex="0" data-testid="wellbeing-report-state-list"><ul class="rows">{#each values as item (item.key)}<li style:--tone={`var(${COLORS[item.key]})`}><span class="name">{item.label}</span><strong>{item.text}</strong><span class="meter" aria-hidden="true"><span style:width={`${Math.max(4, item.ratio * 100)}%`}></span></span></li>{/each}</ul></div>
            {:else}<p class="none boxed">这天没有{lack.has(day.date) ? '状态' : '评分'}记录。</p>{/if}
          </section>
          <section class="doses" aria-label="服药">
            <h5>服药{#if dayDoses.length}<span class="count"> · {dayDoses.length} 次</span>{/if}</h5>
            {#if dayDoses.length}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div class="scroller" role="region" aria-label="这天的服药时间线" tabindex="0" data-testid="wellbeing-report-dose-timeline">
                <ol class="steps">{#each dayDoses as dose (dose.id)}<li data-testid="wellbeing-report-dose" class:changed={isChanged(dose)}><span class="time">{timeLabel(dose.taken_at, timezone)}</span><span class="node" aria-hidden="true"></span><div class="what"><strong>{dose.medication_name}</strong> {doseText(dose)}<span class="faint"> · {dose.regimen === 'scheduled' ? '常规' : '按需'}</span>{#if isChanged(dose)}<span class="tag" title="和上一次记录的剂量不同">剂量变化</span>{/if}</div></li>{/each}</ol>
              </div>
            {:else}<p class="none boxed">这天没有服药记录。</p>{/if}
          </section>
        </div>
        <section class="effects-box" aria-label="副作用">
          <h5>副作用</h5>
          {#if dayEvents.length}<ul class="chips effects">{#each dayEvents as event (event.id)}<li><i></i>{event.symptom}{#if doseName(event.dose_id)}<span class="faint"> · {doseName(event.dose_id)}</span>{/if}</li>{/each}</ul>
          {:else}<p class="none">这天没有记录副作用。</p>{/if}
        </section>
      </div>{/key}{/if}</div>
    </div>
  </div>
  <details class="data-table">
    <summary>查看这张图的逐日数据表</summary>
    <div class="table-scroll"><table>
      <caption class="sr-only">范围内每一天的状态、服药和副作用条数</caption>
      <thead><tr><th scope="col">日期</th><th scope="col">开心程度</th><th scope="col">焦虑</th><th scope="col">睡眠时长</th><th scope="col">服药</th><th scope="col">副作用</th></tr></thead>
      <tbody>{#each series as d (d.date)}<tr><th scope="row">{d.date}</th><td>{d.mood ?? '—'}</td><td>{d.anxiety ?? '—'}</td><td>{d.sleep_hours === null ? '—' : hoursText(d.sleep_hours)}</td><td>{d.dose_count || '—'}</td><td>{d.symptom_count || '—'}</td></tr>{/each}</tbody>
    </table></div>
  </details>
</section>

<style>
  .timeline { container-type: inline-size; display: grid; gap: var(--space-4); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  h3 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h4 { font-size: var(--text-body); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h5 { margin-bottom: var(--space-2); color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-medium); letter-spacing: 0; }
  /* Wide: the calendar beside the day's record; narrow: one under the other. */
  .body { display: grid; gap: var(--space-6); min-width: 0; }
  @container (min-width: 58rem) { .body { grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); align-items: stretch; } }
  /* One column as wide as the space it is given: an automatic column would grow to the circle's own width and push it over the record beside it. */
  .calendar, .side { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); min-width: 0; }
  @container (min-width: 58rem) { .side { align-content: center; } }
  .month { display: grid; align-content: start; gap: var(--space-2); min-width: 0; }
  /* Several months: one page each, side by side in a row that scrolls and snaps; the bar above names the month and turns the page. */
  .pager.paged { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
  .pager.paged::-webkit-scrollbar { display: none; }
  .pager.paged .month { flex: 0 0 100%; scroll-snap-align: start; scroll-snap-stop: always; }
  .month-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .step { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--foreground); font-size: var(--text-card); cursor: pointer; }
  .step:disabled { opacity: .4; cursor: not-allowed; }
  .step:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); justify-items: center; row-gap: var(--space-1); }
  .weekday { padding-block: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  .blank { width: var(--size); height: var(--size); }
  /* One day: a round button with a three-part ring around its number (the same as the history calendar). */
  .day { position: relative; display: grid; place-items: center; width: var(--size); height: var(--size); min-height: 0; padding: 0; border: 0; border-radius: 50%; color: var(--foreground); cursor: pointer; }
  /* data-date keeps the button out of the glass enhancement, but that styling adds a sheen and shadow plate; a round ring day wants none. */
  .day.day[data-date] { background: none !important; box-shadow: none !important; }
  .day:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .part { fill: none; stroke: var(--border); stroke-width: 3.5; stroke-linecap: round; opacity: .7; transition: stroke var(--transition-control), opacity var(--transition-control); }
  .part.lit { stroke: var(--part); opacity: 1; }
  .num { position: relative; display: grid; place-items: center; width: 62%; aspect-ratio: 1; border-radius: 50%; font-size: var(--text-small); font-variant-numeric: tabular-nums; transition: background-color 200ms ease, color 200ms ease, transform 360ms var(--motion-popover-enter-ease); }
  @media (prefers-reduced-motion: reduce) { .num { transition: none; } .day.selected .num { transform: none; } }
  .day.selected .num { transform: scale(1.12); background: var(--primary); color: var(--primary-foreground); font-weight: var(--weight-bold); }
  @media (hover: hover) { .day:not(.selected):hover .num { background: var(--muted); } }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); color: var(--muted-foreground); font-size: var(--text-caption); }
  .legend span { display: inline-flex; align-items: center; gap: var(--space-1); }
  .legend i { display: inline-block; width: .625rem; height: .625rem; border-radius: 50%; background: var(--part); }
  .detail { container: detail / inline-size; position: relative; min-width: 0; height: 40rem; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-card); background: color-mix(in srgb, var(--muted) 35%, var(--surface)); }
  /* Height by the room the panel has: under a phone's width its content stacks (tall); wide enough for two columns it is shorter; beside the circle it is as tall as the circle or calendar, never less than this. */
  @container (min-width: 35rem) { .detail { height: 32rem; } }
  @container (min-width: 58rem) { .detail { height: auto; min-height: 32rem; } }
  /* The panel never changes size with what a day holds: its content is laid out in a box taken out of the flow (so it adds nothing to the height), and a long list scrolls inside its own section. Wide: as tall as the calendar beside it; narrow: a fixed height. */
  .stage { position: absolute; inset: var(--space-4); display: grid; min-width: 0; overflow-x: clip; }
  .pane { grid-area: 1 / 1; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--space-4); height: 100%; min-width: 0; min-height: 0; }
  /* The day's name and, at a glance, what it holds in the ring's three colours. */
  .when { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-2) var(--space-4); }
  .when h4 { font-size: var(--text-card); }
  .ago { color: var(--muted-foreground); font-size: var(--text-small); }
  .tally { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: 0; padding: 0; list-style: none; color: var(--muted-foreground); font-size: var(--text-caption); }
  .tally li { display: inline-flex; align-items: center; gap: var(--space-1); }
  .tally i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--part); }
  .tally strong { color: var(--foreground); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  /* Two columns that share the height: the answers as bars on the left, the doses as a timeline on the right. */
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: var(--space-4) var(--space-6); min-height: 0; }
  .cols > section { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .cols > section + section { padding-left: var(--space-6); border-left: 1px solid var(--border); }
  .rows { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
  .rows li { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-2); font-size: var(--text-small); }
  .rows .name { white-space: nowrap; }
  .rows strong { white-space: nowrap; }
  .rows strong { font-variant-numeric: tabular-nums; }
  .meter { flex: 0 0 100%; height: .375rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--muted) 80%, transparent); overflow: hidden; }
  .meter > span { display: block; height: 100%; border-radius: var(--radius-pill); background: var(--tone); }
  .boxed { display: grid; place-items: center; flex: 1; min-height: 4rem; padding: var(--space-3); border: 1px dashed var(--border); border-radius: var(--radius-control); text-align: center; }
  /* Narrow panel (a phone, stacked under the circle): the answers in two columns above the timeline. */
  @container detail (max-width: 34rem) {
    .cols { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(9rem, 1fr); gap: var(--space-3); }
    .cols > section + section { padding: var(--space-3) 0 0; border-left: 0; border-top: 1px solid var(--border); }
    .rows { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); }
  }
  .effects-box .chips { max-height: 4.75rem; overflow-y: auto; }
  .doses { display: flex; flex-direction: column; min-height: 0; }
  .doses h5 { flex: none; }
  .count { margin-left: var(--space-1); font-weight: var(--weight-regular); }
  .scroller { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-right: var(--space-1); }
  .scroller:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: var(--radius-control); }
  /* The day's doses in time order down a line: the time, a dot on the line, what was taken. */
  .steps { margin: 0; padding: 0; list-style: none; }
  .steps li { position: relative; display: grid; grid-template-columns: 3rem 1rem minmax(0, 1fr); align-items: start; gap: var(--space-2); padding-bottom: var(--space-3); font-size: var(--text-small); line-height: var(--line-height-heading); }
  .steps li:last-child { padding-bottom: 0; }
  .steps li::before { content: ''; position: absolute; top: 1rem; bottom: -.125rem; left: calc(3rem + var(--space-2) + .5rem - 1px); width: 2px; background: color-mix(in srgb, var(--well-dose) 35%, var(--border)); }
  .steps li:last-child::before { display: none; }
  .steps .time { text-align: right; }
  .node { justify-self: center; width: .75rem; height: .75rem; margin-top: .1875rem; border: 2px solid var(--well-dose); border-radius: 50%; background: var(--well-dose); }
  .steps li.changed .node { background: var(--surface); }
  .what { min-width: 0; overflow-wrap: anywhere; }
  .detail section { min-width: 0; }
  /* A week or a fortnight as one big circle of slices. Grey: not chosen; green: the chosen day. The three dots of a slice are state, medication and side effect, each lit when that record exists. */
  .wheel { position: relative; width: min(100%, 20rem); aspect-ratio: 1; margin-inline: auto; }
  .slices { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; box-shadow: none; }
  .slice { --slice: color-mix(in srgb, var(--border) 85%, var(--surface)); cursor: pointer; outline: none; }
  .slice path { fill: var(--slice); stroke: var(--slice); stroke-width: 1.2; stroke-linejoin: round; transition: fill var(--transition-control), stroke var(--transition-control), transform 300ms var(--motion-popover-enter-ease); transform-box: fill-box; transform-origin: 50% 50%; }
  .slice.selected { --slice: var(--primary); }
  .slice.selected path { transform: scale(1.06); }
  .slice .part { fill: color-mix(in srgb, var(--surface) 70%, var(--border)); stroke: none; opacity: 1; pointer-events: none; }
  .slice .part.lit { fill: var(--part); stroke: var(--surface); stroke-width: .5; }
  @media (hover: hover) { .slice:not(.selected):hover { --slice: color-mix(in srgb, var(--primary) 18%, var(--border)); } }
  .slice:focus-visible path { stroke: var(--ring); }
  .n { position: absolute; display: grid; place-items: center; width: 2rem; height: 2rem; transform: translate(-50%, -50%); font-size: var(--text-small); font-variant-numeric: tabular-nums; pointer-events: none; }
  .n.selected { color: var(--primary-foreground); font-weight: var(--weight-bold); }
  .core { position: absolute; inset: 28%; display: grid; overflow: hidden; border-radius: 50%; pointer-events: none; }
  .face { grid-area: 1 / 1; display: grid; place-content: center; justify-items: center; line-height: var(--line-height-solid); }
  .face strong { font-size: var(--text-title); font-weight: var(--weight-bold); color: var(--foreground); font-variant-numeric: tabular-nums; }
  .face span { margin-top: var(--space-1); color: var(--muted-foreground); font-size: var(--text-small); }
  .wheel-legend { justify-content: center; }
  @media (prefers-reduced-motion: reduce) { .slice path { transition: none; } .slice.selected path { transform: none; } }
  .none { color: var(--muted-foreground); font-size: var(--text-small); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .chips li { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border)); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--tone) 12%, var(--surface)); font-size: var(--text-small); }
  .chips i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--tone); }
  .chips.effects li { --tone: var(--well-effect); }
  .time { color: var(--well-dose); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .faint { color: var(--muted-foreground); }
  /* "剂量变化" is always on a line of its own right under the dose's text, starting at the same place, however long that text is. */
  .tag { display: block; width: fit-content; margin: var(--space-1) 0 0; white-space: nowrap; padding: 0 var(--space-2); border: 1px solid var(--well-dose); border-radius: var(--radius-pill); color: var(--well-dose); font-size: var(--text-caption); }
  .data-table { font-size: var(--text-small); }
  .data-table summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .table-scroll { position: relative; max-height: 20rem; margin-top: var(--space-3); overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
  :is(th, td) { padding: var(--space-1) var(--space-3) var(--space-1) 0; border-top: 1px solid var(--border); white-space: nowrap; }
  thead th { border-top: 0; color: var(--muted-foreground); font-weight: var(--weight-medium); }
  @media (max-width: 767px) { .timeline { padding: var(--space-4); } }
</style>
