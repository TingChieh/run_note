<script lang="ts">
  import type { Dose, SymptomEvent, SymptomStat } from '#lib/api/wellbeing.ts';
  import { UNLINKED, medicineMatrix } from './wellbeing-report-math.ts';
  // The side effects of the range, one card each, most days first: the days it came up as a bar, and under it the medicines it was written under (each with how often).
  // Each side effect is counted under the medicine of the dose it was noted for. That is the order the user wrote them in, not a finding that the medicine caused it.
  let { doses, events, stats }: { doses: Dose[]; events: SymptomEvent[]; stats: SymptomStat[] } = $props();
  const matrix = $derived(medicineMatrix(doses, events));
  const ranking = $derived([...stats].sort((a, b) => b.days - a.days || b.count - a.count || a.symptom.localeCompare(b.symptom, 'zh')));
  const widest = $derived(Math.max(1, ...ranking.map(s => s.days)));
  /** The medicines a side effect was written under, most often first; old records tied to no dose come last. */
  const under = (symptom: string) => {
    const column = matrix.columns.indexOf(symptom);
    return column < 0 ? [] : matrix.rows.filter(row => row.cells[column] > 0).map(row => ({ name: row.name, count: row.cells[column], loose: row.name === UNLINKED }));
  };
</script>

<section class="effects" aria-labelledby="effects-title" data-testid="wellbeing-report-effects">
  <h3 id="effects-title">副作用</h3>
  {#if !ranking.length}
    <p class="empty">这段时间没有记录副作用。没有记录不等于没有症状。</p>
  {:else}
    <ul class="list" data-testid="wellbeing-effect-ranking">
      {#each ranking as stat (stat.symptom)}
        <li class="effect" data-testid="wellbeing-effect-row">
          <span class="name" title={stat.symptom}>{stat.symptom}</span>
          <span class="track" aria-hidden="true"><span class="fill" style:width={`${Math.max(4, (stat.days / widest) * 100)}%`}></span></span>
          <span class="value"><strong>{stat.days} 天</strong><span class="times"> · {stat.count} 次</span></span>
          <ul class="under" aria-label={`${stat.symptom}记在哪些药下面`}>
            {#each under(stat.symptom) as item (item.name)}<li class="chip" class:loose={item.loose}><i></i>{item.name}<strong>×{item.count}</strong></li>{/each}
          </ul>
        </li>
      {/each}
    </ul>
    <p class="note">药名只表示记录里这种副作用写在哪次服药下，不代表是这种药引起的。</p>
  {/if}
</section>

<style>
  .effects { container-type: inline-size; display: grid; align-content: start; gap: var(--space-4); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  h3 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .empty, .note { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  /* Every side effect is a card of the same shape: three to a row when there is room, two, or one. */
  .list { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
  @container (min-width: 32rem) { .list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (min-width: 52rem) { .list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  /* Inside a card: the name and its numbers on the first line, the bar on the second, the medicines on the third. */
  .effect { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: var(--space-2) var(--space-3); min-width: 0; padding: var(--space-3) var(--space-4); border: 1px solid color-mix(in srgb, var(--well-effect) 28%, var(--border)); border-radius: var(--radius-control); background: color-mix(in srgb, var(--well-effect) 6%, var(--surface)); font-size: var(--text-small); }
  .name { grid-row: 1; grid-column: 1; overflow: hidden; font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
  .track { grid-row: 2; grid-column: 1 / -1; height: .5rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--well-effect) 14%, var(--surface)); overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--well-effect) 75%, var(--surface)); }
  .value { grid-row: 1; grid-column: 2; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .value strong { font-weight: var(--weight-bold); }
  .times { color: var(--muted-foreground); }
  /* The medicines it was written under, in the colour of medication, small and all alike. */
  .under { grid-row: 3; grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); margin: 0; padding: 0; list-style: none; }
  .chip { --tone: var(--well-dose); display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border)); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--tone) 12%, var(--surface)); font-size: var(--text-caption); }
  .chip i { width: .4375rem; height: .4375rem; border-radius: 50%; background: var(--tone); }
  .chip strong { font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .chip.loose { --tone: var(--muted-foreground); }
  @media (max-width: 767px) { .effects { padding: var(--space-4); } .effect { padding: var(--space-3); } }
</style>
