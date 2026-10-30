<script lang="ts">
  import { RATING_KEYS, RATING_LABELS, dateLabel, dateTimeLabel, doseText, hoursText, pillsText, shortDate, type Report } from '#lib/api/wellbeing.ts';
  import { UNLINKED, changeLines, medicineMatrix } from './wellbeing-report-math.ts';
  // The report that comes out of "print / save as PDF": the same figures as the page, laid out as plain boxes (no charts, no tables) for paper. It is not shown on screen.
  // It restates what was logged: no diagnosis, no dosing advice, and the order of a side effect and a dose is not a cause.
  let { report: r }: { report: Report } = $props();
  const days = $derived(r.series.length);
  const effectDays = $derived(new Set(r.symptom_events.map(e => e.entry_date)).size);
  const matrix = $derived(medicineMatrix(r.doses, r.symptom_events));
  const under = (symptom: string) => { const column = matrix.columns.indexOf(symptom); return column < 0 ? [] : matrix.rows.filter(row => row.cells[column] > 0).map(row => `${row.name === UNLINKED ? '未关联到某种药' : row.name} ×${row.cells[column]}`); };
  const effects = $derived([...r.symptoms].sort((a, b) => b.days - a.days || b.count - a.count));
  const notes = $derived([...r.notes].sort((a, b) => a.date.localeCompare(b.date)));
  const measures = $derived(RATING_KEYS.filter(key => key !== 'sleep_quality').map(key => ({ key, label: RATING_LABELS[key], stat: r.ratings.find(item => item.key === key)! })));
  const quality = $derived(r.ratings.find(item => item.key === 'sleep_quality')!);
</script>

<article class="print" aria-labelledby="print-title" data-testid="wellbeing-report">
  <header>
    <h2 id="print-title">身心健康记录摘要</h2>
    <p>{r.start} 至 {r.end}（共 {days} 天，{r.timezone}）· 生成于 {r.generated_on}</p>
    <p class="disclaimer">本摘要由用户自己的记录整理而成，只反映已填写的内容，不构成诊断，也不包含用药调整建议。</p>
  </header>

  <section aria-labelledby="p-overview">
    <h3 id="p-overview">记录情况</h3>
    <p data-testid="report-coverage">{r.coverage.days_in_range} 天中有 {r.coverage.days_with_entry} 天填写了状态记录，{r.coverage.days_without_entry} 天没有。没有记录的日子不代表情况良好或不佳。</p>
    <ul class="boxes three">
      <li><span>记录了几天</span><strong>{r.coverage.days_with_entry} / {days} 天</strong></li>
      <li><span>服药</span><strong>{r.doses.length} 次</strong></li>
      <li><span>副作用</span><strong>{r.symptom_events.length} 条 · {effectDays} 天</strong></li>
    </ul>
  </section>

  <section aria-labelledby="p-states">
    <h3 id="p-states">状态</h3>
    <ul class="boxes three" data-testid="report-ratings">
      {#each measures as item (item.key)}
        <li><span>{item.label.name}（{item.label.direction === 'worse' ? '越高越严重' : '越高越好'}）</span>
          {#if item.stat.answered_days}<strong>{item.stat.mean} / 10</strong><small>{item.stat.answered_days} 天 · 最低 {item.stat.min} · 最高 {item.stat.max} · 首次 {item.stat.first} · 最近 {item.stat.last}</small>{:else}<strong>—</strong><small>没有记录</small>{/if}</li>
      {/each}
      <li data-testid="report-sleep"><span>睡眠</span>
        {#if r.sleep.answered_days || r.sleep.quality_answered_days}
          <strong>{#if r.sleep.mean_hours !== null}平均 {hoursText(r.sleep.mean_hours)}{:else}—{/if}</strong>
          <small>{#if r.sleep.mean_hours !== null}时长 {r.sleep.answered_days} 天 · 最短 {hoursText(r.sleep.min_hours ?? 0)} · 最长 {hoursText(r.sleep.max_hours ?? 0)}；{/if}质量{#if r.sleep.mean_quality !== null} 平均 {r.sleep.mean_quality} / 10（{quality.answered_days} 天 · 最低 {quality.min} · 最高 {quality.max} · 越高越好）{:else}：没有记录{/if}</small>
        {:else}<strong>—</strong><small>没有记录</small>{/if}</li>
    </ul>
  </section>

  <section aria-labelledby="p-meds">
    <h3 id="p-meds">服药</h3>
    {#if r.medications.length}
      <ul class="boxes two">
        {#each r.medications as med (med.name)}
          {@const lines = changeLines(med.timeline, c => doseText(c))}
          <li data-testid="report-medication"><span>{med.name}</span>
            <strong>{med.dose_count} 次{#if med.total_pills > 0} · {pillsText(med.total_pills)}{/if}</strong>
            <small>常规 {med.scheduled_count} · 按需 {med.as_needed_count}；首次 {dateTimeLabel(med.first_taken_at, r.timezone)}，最近 {dateTimeLabel(med.last_taken_at, r.timezone)}</small>
            <ol>{#each lines as line, index (index)}<li>{shortDate(line.date)}　{#if line.from}{line.from} → {line.to}{:else}起始 {line.to}{/if}</li>{/each}</ol>
          </li>
        {/each}
      </ul>
    {:else}<p>这段时间没有服药记录。</p>{/if}
  </section>

  <section aria-labelledby="p-effects">
    <h3 id="p-effects">副作用</h3>
    {#if effects.length}
      <ul class="boxes three">
        {#each effects as stat (stat.symptom)}<li><span>{stat.symptom}</span><strong>{stat.days} 天 · {stat.count} 次</strong><small>{under(stat.symptom).join('、')}</small></li>{/each}
      </ul>
      <p class="fine">药名只表示记录里这种副作用写在哪次服药下，不代表是这种药引起的。</p>
    {:else}<p>这段时间没有记录副作用。没有记录不等于没有症状。</p>{/if}
  </section>

  {#if notes.length}
    <section aria-labelledby="p-notes">
      <h3 id="p-notes">备注</h3>
      <ul class="notes">{#each notes as note (note.date)}<li><span>{dateLabel(note.date)}</span><p>{note.note}</p></li>{/each}</ul>
    </section>
  {/if}
</article>

<style>
  /* Paper only: on screen the page's own charts and cards are the summary. */
  .print { display: none; }
  @media print {
    .print { display: grid; gap: 14pt; color: #000; font-size: var(--text-small); line-height: var(--line-height-body); }
    h2 { font-size: var(--text-section); }
    h3 { padding-bottom: 3pt; border-bottom: 1px solid #000; font-size: var(--text-body); }
    header, section { display: grid; gap: 6pt; break-inside: avoid; }
    .disclaimer { padding: 6pt 8pt; border: 1px solid #000; }
    .boxes { display: grid; gap: 6pt; margin: 0; padding: 0; list-style: none; }
    .boxes.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .boxes.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .boxes > li { display: grid; align-content: start; gap: 2pt; padding: 6pt 8pt; border: 1px solid #000; border-radius: 4pt; break-inside: avoid; }
    .boxes span { font-size: var(--text-caption); }
    .boxes strong { font-size: var(--text-body); }
    .boxes small, .fine { font-size: var(--text-caption); }
    .boxes ol { display: grid; gap: 1pt; margin: 2pt 0 0; padding: 0; list-style: none; font-size: var(--text-caption); }
    .boxes ol li { border: 0; padding: 0; display: block; }
    .notes { display: grid; gap: 4pt; margin: 0; padding: 0; list-style: none; }
    .notes li { display: grid; grid-template-columns: 9.5rem minmax(0, 1fr); gap: 8pt; break-inside: avoid; }
    .notes p { white-space: pre-wrap; overflow-wrap: anywhere; }
  }
</style>
