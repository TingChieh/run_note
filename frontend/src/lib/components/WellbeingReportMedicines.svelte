<script lang="ts">
  import { doseText, pillsText, shortDate, type Dose, type MedicationStat, type TrendDay } from '#lib/api/wellbeing.ts';
  import { TONES } from './wellbeing-tones.ts';
  import { change, changeLines, changeText } from './wellbeing-report-math.ts';
  // The medicines of the range inside one card (like the side effects below it), one inner card each: a round badge and the name, a big figure with how it moved against the stretch before,
  // how many times, a strip of the days (a round dot per day, lit where it was taken), and how the dose changed. Presentation only: the figures are the server's.
  let { series, doses, medications, before }: { series: TrendDay[]; doses: Dose[]; medications: MedicationStat[]; before: MedicationStat[] | null } = $props();
  const SHOWN = 3;
  const dots = $derived(series.length <= 31); // a round dot per day for a month or less; a thin strip for longer
  const counts = $derived.by(() => {
    const map = new Map<string, Map<string, number>>();
    for (const dose of doses) { const days = map.get(dose.medication_name) ?? new Map<string, number>(); days.set(dose.entry_date, (days.get(dose.entry_date) ?? 0) + 1); map.set(dose.medication_name, days); }
    return map;
  });
  const describe = (c: { pills: number | null; dose_amount: number | null; dose_unit: string | null }) => doseText(c);
  const cards = $derived(medications.map(med => {
    const lines = changeLines(med.timeline, describe), changes = lines.filter(line => line.from !== null);
    const earlier = before === null ? null : before.find(item => item.name === med.name)?.dose_count ?? 0;
    return { med, lines, changes, earlier, changedOn: new Set(changes.map(line => line.date)), per: counts.get(med.name) ?? new Map<string, number>() };
  }));
</script>

<section class="meds" aria-labelledby="meds-title" data-testid="wellbeing-report-medicines">
  <h3 id="meds-title">服药</h3>
  {#if !cards.length}
    <p class="empty">这段时间没有服药记录。</p>
  {:else}
    <ul class="list">
      {#each cards as card (card.med.name)}
        <li class="card" data-testid="wellbeing-report-medicine" data-medicine={card.med.name}>
          <header>
            <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={TONES.dose.icon} /></svg></span>
            <span class="name" title={card.med.name}>{card.med.name}</span>
          </header>
          <p class="big"><strong>{card.med.dose_count}</strong><span class="unit">次{#if card.med.total_pills > 0} · 共 {pillsText(card.med.total_pills)}{/if}</span>{#if card.earlier !== null}<span class="delta" aria-label={change(card.med.dose_count, card.earlier) === null ? '' : `比上一段${card.med.dose_count >= card.earlier ? '多' : '少'} ${Math.abs(card.med.dose_count - card.earlier)} 次`}>{changeText(change(card.med.dose_count, card.earlier))}</span>{/if}</p>
          <!-- The range as one mark per day, lit when the medicine was taken; a day the amount changed is a ring. -->
          <div class="strip" class:dots role="img" aria-label={`${card.med.name}：${card.per.size} 天有服药`} style:--n={series.length}>
            {#each series as day (day.date)}{@const n = card.per.get(day.date) ?? 0}<span class="day" class:lit={n > 0} class:changed={card.changedOn.has(day.date)} data-date={day.date} data-count={n}></span>{/each}
          </div>
          <div class="ends" aria-hidden="true"><span>{shortDate(series[0]?.date ?? '')}</span><span>{shortDate(series[series.length - 1]?.date ?? '')}</span></div>
          <p class="mix"><span class="pill">常规 {card.med.scheduled_count}</span><span class="pill">按需 {card.med.as_needed_count}</span></p>
          <ul class="changes" aria-label={`${card.med.name}的剂量变化`}>
            {#if card.changes.length}
              {#each card.changes.slice(0, SHOWN) as line, index (index)}<li><span class="date">{shortDate(line.date)}</span><span class="move">{line.from} <i aria-hidden="true">→</i> <strong>{line.to}</strong></span></li>{/each}
              {#if card.changes.length > SHOWN}<li class="more">还有 {card.changes.length - SHOWN} 次变化</li>{/if}
            {:else}<li class="same">剂量没有变化{#if card.lines[0]}：每次 {card.lines[0].to}{/if}</li>{/if}
          </ul>
        </li>
      {/each}
    </ul>
    <p class="legend"><span><i class="on"></i>这天服药了</span><span><i class="off"></i>这天没服药</span><span><i class="ring"></i>剂量与上一次不同</span></p>
  {/if}
</section>

<style>
  /* One card holds them all, the same frame as the side-effect card; inside, a card per medicine, three to a row when there is room, two, or one. */
  .meds { container-type: inline-size; display: grid; align-content: start; gap: var(--space-4); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  h3 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .empty { color: var(--muted-foreground); font-size: var(--text-small); }
  .list { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
  @container (min-width: 32rem) { .list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (min-width: 52rem) { .list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .card { --tone: var(--well-dose); display: grid; align-content: start; gap: var(--space-3); min-width: 0; padding: var(--space-4); border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--border)); border-radius: var(--radius-control); background: color-mix(in srgb, var(--tone) 6%, var(--surface)); font-size: var(--text-small); }
  header { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  /* The same recipe as the round badges of the widgets above, a size smaller. */
  .badge { display: grid; place-items: center; flex: none; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: color-mix(in srgb, var(--tone) 62%, white); color: var(--sport-ink, #20332b); }
  .name { overflow: hidden; font-size: var(--text-body); font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
  .big { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); line-height: var(--line-height-heading); }
  .big strong { font-size: var(--text-stat); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .unit, .mix, .ends { color: var(--muted-foreground); }
  .unit { font-size: var(--text-small); }
  .delta { margin-left: auto; padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-caption); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
  /* A strip of the days spread over the card's width. A day it was taken is a big solid dot; a day it was not is a small pale one, so the two read apart at a glance.
     (More than a month: tall solid bars against short pale ones.) A day the amount changed has a ring round its dot. */
  .strip { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); align-items: end; gap: 1px; height: 1.25rem; }
  .strip.dots { gap: 0; align-items: center; justify-items: center; height: 1.375rem; }
  .day { height: 25%; border-radius: 1px; background: color-mix(in srgb, var(--muted-foreground) 32%, var(--surface)); }
  .day.lit { height: 100%; border-radius: 2px; background: var(--tone); }
  .strip.dots .day { width: min(.3125rem, 40%); height: auto; aspect-ratio: 1; border-radius: 50%; }
  .strip.dots .day.lit { width: min(.9375rem, 92%); height: auto; }
  .strip.dots .day.changed { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--tone); }
  .legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); margin: 0; color: var(--muted-foreground); font-size: var(--text-caption); }
  .legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
  .legend i { display: inline-block; border-radius: 50%; }
  .legend .on { width: .75rem; height: .75rem; background: var(--well-dose); }
  .legend .off { width: .3125rem; height: .3125rem; margin: 0 .21875rem; background: color-mix(in srgb, var(--muted-foreground) 32%, var(--surface)); }
  .legend .ring { width: .75rem; height: .75rem; background: var(--well-dose); box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--well-dose); margin: 0 .1875rem; }
  .ends { display: flex; justify-content: space-between; margin-top: calc(-1 * var(--space-2)); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
  .mix { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .pill { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-caption); }
  /* How the dose moved, each change on a line: when, and from-what to-what. */
  .changes { display: grid; gap: var(--space-1); margin: 0; padding: var(--space-3) 0 0; border-top: 1px solid color-mix(in srgb, var(--tone) 25%, var(--border)); list-style: none; font-size: var(--text-small); }
  .changes li { display: grid; grid-template-columns: 3rem minmax(0, 1fr); align-items: baseline; gap: var(--space-2); }
  .changes .date { color: var(--tone); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .changes .move strong { font-weight: var(--weight-semibold); }
  .changes .more, .changes .same { display: block; color: var(--muted-foreground); }
  @media (max-width: 767px) { .meds { padding: var(--space-4); } .card { padding: var(--space-3); } }
</style>
