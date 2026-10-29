<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import DatePicker from './DatePicker.svelte';
  import FeedbackState from './FeedbackState.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { RATING_LABELS, addDays, dateLabel, dateTimeLabel, doseText, downloadCsv, hoursText, pillsText, durationLabel, gapLabel, readReport, timeLabel, type CsvKind, type Report } from '#lib/api/wellbeing.ts';
  // Clinic-visit summary. It restates what was logged: no diagnosis, no dosing advice, and symptom/dose order is not a cause.
  let { today, timezone }: { today: string; timezone: string } = $props();
  let from = $state(untrack(() => addDays(today, -29))), to = $state(untrack(() => today));
  let report = $state<Report | null>(null), loading = $state(false), message = $state(''), exporting = $state<CsvKind | ''>(''), exportError = $state('');
  let disposed = false, token = 0;
  const FIELD_NAMES: Record<string, string> = { ...Object.fromEntries(Object.entries(RATING_LABELS).map(([k, v]) => [k, v.name])), sleep_hours: '睡眠时长' };
  const rangeValid = $derived(!!from && !!to && from <= to && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) < 366 * 86400000);

  function expired(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; report = null; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return true; }
    return false;
  }
  async function generate() {
    if (!rangeValid || loading) { message = '请选择有效的日期范围（开始不晚于结束，最长 366 天）'; return; }
    const mine = ++token; loading = true; message = '';
    try {
      const result = await readReport(from, to);
      if (disposed || mine !== token) return;
      report = result;
    } catch (cause) {
      if (disposed || mine !== token || expired(cause)) return;
      message = cause instanceof Error ? cause.message : '生成失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  function preset(span: number) { to = today; from = addDays(today, -(span - 1)); void generate(); }
  async function save(kind: CsvKind) {
    if (!report || exporting) return;
    exporting = kind; exportError = '';
    try {
      const blob = await downloadCsv(kind, report.start, report.end);
      if (disposed) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `wellbeing-${kind}-${report.start}_${report.end}.csv`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (disposed || expired(cause)) return;
      exportError = cause instanceof Error ? cause.message : '导出失败，请稍后重试';
    } finally { if (!disposed) exporting = ''; }
  }
  const mean = (v: number | null) => v === null ? '—' : String(v);
  onMount(() => { void generate(); return () => { disposed = true; token++; report = null; }; });
</script>

<div class="report-page" data-testid="wellbeing-report-page">
  <section class="card no-print" aria-labelledby="report-form-title">
    <div><p class="eyebrow">一段时间的记录汇总</p><h2 id="report-form-title">总结</h2></div>
    <p class="hint">选择日期范围，汇总这段时间你实际记录的内容。报告只整理记录，不做诊断，也不建议调整药物。</p>
    <form class="range" onsubmit={(event) => { event.preventDefault(); void generate(); }}>
      <DatePicker label="开始日期" bind:value={from} max={today} {timezone} required />
      <DatePicker label="结束日期" bind:value={to} max={today} {timezone} required />
      <button type="submit" class="button-primary" disabled={loading || !rangeValid}>{loading ? '生成中…' : '生成报告'}</button>
    </form>
    <div class="presets" role="group" aria-label="快捷范围"><button type="button" class="button-secondary" onclick={() => preset(30)}>最近 30 天</button><button type="button" class="button-secondary" onclick={() => preset(90)}>最近 90 天</button></div>
    {#if message}<div data-testid="wellbeing-report-error"><FeedbackState kind="error" title={message}><button type="button" class="button-secondary" onclick={() => { void generate(); }} aria-label="重试生成报告">重试</button></FeedbackState></div>{/if}
  </section>

  {#if report}
    {@const r = report}
    <article class="sheet" aria-labelledby="sheet-title" data-testid="wellbeing-report">
      <header>
        <h2 id="sheet-title">身心健康记录摘要</h2>
        <p>{r.start} 至 {r.end}（共 {r.coverage.days_in_range} 天，{r.timezone}）· 生成于 {r.generated_on}</p>
        <p class="disclaimer">本摘要由用户自己的记录整理而成，只反映已填写的内容，不构成诊断，也不包含用药调整建议。</p>
      </header>

      <section aria-labelledby="r-coverage">
        <h3 id="r-coverage">数据完整度</h3>
        <p data-testid="report-coverage">{r.coverage.days_in_range} 天中有 {r.coverage.days_with_entry} 天填写了状态记录，{r.coverage.days_without_entry} 天没有。没有记录的日子不代表情况良好或不佳。</p>
        {#if r.coverage.missing_dates.length}
          <details><summary>查看没有状态记录的日期（{r.coverage.missing_dates.length} 天）</summary><p class="dates">{r.coverage.missing_dates.join('、')}</p></details>
        {/if}
        {#if r.coverage.days_with_entry}
          <details><summary>各项未填写天数</summary>
            <ul>{#each Object.entries(r.coverage.unanswered) as [key, n] (key)}<li>{FIELD_NAMES[key] ?? key}：{n} 天未填写</li>{/each}</ul>
          </details>
        {/if}
      </section>

      <section aria-labelledby="r-meds">
        <h3 id="r-meds">服药明细与变动时间线</h3>
        {#if r.medications.length}
          {#each r.medications as med (med.name)}
            <div class="block" data-testid="report-medication">
              <h4>{med.name}</h4>
              <p>共 {med.dose_count} 次{#if med.total_pills > 0}、{pillsText(med.total_pills)}{/if}（常规 {med.scheduled_count}，按需 {med.as_needed_count}）；范围内首次 {dateTimeLabel(med.first_taken_at, r.timezone)}，最近一次 {dateTimeLabel(med.last_taken_at, r.timezone)}。</p>
              <ol class="timeline">{#each med.timeline as change (change.taken_at)}<li><span class="date">{change.date}</span> {doseText(change)}<span class="tag">{change.kind === 'first_in_range' ? '范围内首次记录' : '与上次记录不同'}</span></li>{/each}</ol>
            </div>
          {/each}
          <details><summary>全部服药明细（{r.doses.length} 条）</summary>
            <div class="table-scroll"><table><caption class="sr-only">范围内每一次服药</caption>
              <thead><tr><th scope="col">日期</th><th scope="col">时间</th><th scope="col">药物</th><th scope="col">用量</th><th scope="col">类型</th><th scope="col">备注</th></tr></thead>
              <tbody>{#each r.doses as dose (dose.id)}<tr><th scope="row">{dose.entry_date}</th><td>{timeLabel(dose.taken_at, r.timezone)}</td><td>{dose.medication_name}</td><td>{doseText(dose)}</td><td>{dose.regimen === 'scheduled' ? '常规' : '按需'}</td><td>{dose.note ?? '—'}</td></tr>{/each}</tbody></table></div>
          </details>
        {:else}<p class="muted">这段时间没有服药记录。</p>{/if}
      </section>

      <section aria-labelledby="r-ratings">
        <h3 id="r-ratings">开心程度、焦虑与日常状态</h3>
        <div class="table-scroll"><table data-testid="report-ratings"><caption class="sr-only">各项评分的已填写天数、平均、最低、最高、首次与最近一次</caption>
          <thead><tr><th scope="col">项目</th><th scope="col">方向</th><th scope="col">已填写天数</th><th scope="col">平均</th><th scope="col">最低</th><th scope="col">最高</th><th scope="col">范围内首次</th><th scope="col">最近一次</th></tr></thead>
          <tbody>{#each r.ratings as stat (stat.key)}<tr><th scope="row">{RATING_LABELS[stat.key].name}</th><td>{RATING_LABELS[stat.key].direction === 'worse' ? '越高越严重' : '越高越好'}</td><td>{stat.answered_days}</td><td>{mean(stat.mean)}</td><td>{mean(stat.min)}</td><td>{mean(stat.max)}</td><td>{mean(stat.first)}</td><td>{mean(stat.last)}</td></tr>{/each}</tbody></table></div>
        {#if r.weekly.length}
          <details><summary>按周平均（开心程度越高越好，焦虑越高越严重）</summary>
            <div class="table-scroll"><table><caption class="sr-only">每周的开心程度与焦虑平均分</caption>
              <thead><tr><th scope="col">周起始（周一）</th><th scope="col">有记录天数</th><th scope="col">开心程度平均</th><th scope="col">焦虑平均</th></tr></thead>
              <tbody>{#each r.weekly as week (week.week_start)}<tr><th scope="row">{week.week_start}</th><td>{week.entries}</td><td>{mean(week.mood_mean)}</td><td>{mean(week.anxiety_mean)}</td></tr>{/each}</tbody></table></div>
          </details>
        {/if}
      </section>

      <section aria-labelledby="r-sleep">
        <h3 id="r-sleep">睡眠</h3>
        {#if r.sleep.answered_days || r.sleep.quality_answered_days}
          <p data-testid="report-sleep">睡眠时长：{r.sleep.answered_days} 天有记录{#if r.sleep.mean_hours !== null}，平均 {hoursText(r.sleep.mean_hours)}（最短 {hoursText(r.sleep.min_hours ?? 0)}，最长 {hoursText(r.sleep.max_hours ?? 0)}）{/if}。睡眠质量：{r.sleep.quality_answered_days} 天有记录{#if r.sleep.mean_quality !== null}，平均 {r.sleep.mean_quality}/10（越高越好）{/if}。</p>
        {:else}<p class="muted">这段时间没有睡眠记录。</p>{/if}
      </section>

      <section aria-labelledby="r-symptoms">
        <h3 id="r-symptoms">副作用</h3>
        {#if r.symptoms.length}
          <div class="table-scroll"><table data-testid="report-symptoms"><caption class="sr-only">各症状的发生次数</caption>
            <thead><tr><th scope="col">症状</th><th scope="col">次数</th><th scope="col">天数</th><th scope="col">影响正常生活</th></tr></thead>
            <tbody>{#each r.symptoms as stat (stat.symptom)}<tr><th scope="row">{stat.symptom}</th><td>{stat.count}</td><td>{stat.days}</td><td>{stat.affects_daily_life_count} 次</td></tr>{/each}</tbody></table></div>
          <details><summary>逐条记录（{r.symptom_events.length} 条，含与此前服药的先后顺序）</summary>
            <ul class="events">{#each r.symptom_events as event (event.id)}<li><span class="date">{event.entry_date}</span> {event.symptom}{#if event.onset_at}，{timeLabel(event.onset_at, r.timezone)} 出现{/if}{#if event.duration_minutes !== null}，持续 {durationLabel(event.duration_minutes)}{/if}{#if event.affects_daily_life !== null}，{event.affects_daily_life ? '影响' : '不影响'}正常生活{/if}{#if event.preceding_dose}；此前最近一次服药：{event.preceding_dose.medication_name}，{gapLabel(event.preceding_dose.minutes_before)}{/if}</li>{/each}</ul>
            <p class="muted">“此前最近一次服药”只表示记录里的时间先后，不代表原因。</p>
          </details>
        {:else}<p class="muted">这段时间没有记录副作用。没有记录不等于没有症状。</p>{/if}
      </section>

      <section aria-labelledby="r-notes">
        <h3 id="r-notes">用户备注</h3>
        {#if r.notes.length}<ul class="notes">{#each r.notes as note (note.date)}<li><span class="date">{dateLabel(note.date)}</span><p>{note.note}</p></li>{/each}</ul>{:else}<p class="muted">这段时间没有备注。</p>{/if}
      </section>
    </article>

    <section class="card no-print" aria-labelledby="export-title" data-testid="wellbeing-export">
      <h3 id="export-title">打印或导出</h3>
      <div class="presets">
        <button type="button" class="button-primary" onclick={() => window.print()}>打印 / 另存为 PDF</button>
        <button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('entries'); }}>{exporting === 'entries' ? '导出中…' : '状态记录 CSV'}</button>
        <button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('doses'); }}>{exporting === 'doses' ? '导出中…' : '服药记录 CSV'}</button>
        <button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('symptoms'); }}>{exporting === 'symptoms' ? '导出中…' : '副作用 CSV'}</button>
      </div>
      <p class="hint">导出的文件包含你的健康记录，请只保存在可信的设备上，分享前确认接收对象。以“=”“+”“-”“@”开头的文字会在 CSV 中加一个“'”，避免被表格软件当作公式执行。</p>
      {#if exportError}<div data-testid="wellbeing-export-error"><FeedbackState kind="error" title={exportError} /></div>{/if}
    </section>
  {/if}
</div>

<style>
  .report-page { display: grid; gap: var(--space-6); min-width: 0; }
  .card, .sheet { display: grid; gap: var(--space-4); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .eyebrow { margin-bottom: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h3 { font-size: var(--text-card); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h4 { font-size: var(--text-body); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint, .muted { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .range { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); }
  .presets { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .sheet section { display: grid; gap: var(--space-3); min-width: 0; padding-top: var(--space-4); border-top: 1px solid var(--border); }
  .sheet header { display: grid; gap: var(--space-2); }
  .disclaimer { padding: var(--space-3) var(--space-4); border-radius: var(--radius-control); background: var(--muted); color: var(--muted-foreground); font-size: var(--text-small); }
  .block { display: grid; gap: var(--space-2); }
  .timeline, .events, .notes { display: grid; gap: var(--space-2); padding-left: var(--space-4); list-style: decimal; font-size: var(--text-small); }
  .events, .notes { list-style: none; padding-left: 0; }
  .notes p { white-space: pre-wrap; overflow-wrap: anywhere; }
  .date { font-variant-numeric: tabular-nums; font-weight: var(--weight-medium); }
  .tag { margin-left: var(--space-2); padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--muted-foreground); font-size: var(--text-caption); }
  .dates { overflow-wrap: anywhere; font-size: var(--text-small); color: var(--muted-foreground); }
  details { font-size: var(--text-small); }
  summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .table-scroll { position: relative; margin-top: var(--space-2); overflow: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  :is(th, td) { padding: var(--space-1) var(--space-3) var(--space-1) 0; border-top: 1px solid var(--border); white-space: nowrap; }
  thead th { border-top: 0; color: var(--muted-foreground); font-weight: var(--weight-medium); }
  @media (max-width: 767px) { .card, .sheet { padding: var(--space-4); } }

  /* Printing: only the summary sheet, on plain paper, with every folded section opened by the user's choice of browser. */
  @media print {
    :global(.app-sidebar), :global(.mobile-bar), :global(.skip-link), :global(.app-footer), :global(.page-header), :global(.save-bar-slot), :global(.navigation-progress) { display: none !important; }
    :global(body), :global(.sport-theme) { background: #fff !important; color: #000 !important; }
    :global(.page-content) { max-width: none; padding: 0 !important; margin: 0 !important; }
    :global(.content-column) { margin: 0 !important; }
    .no-print { display: none !important; }
    .sheet { padding: 0; border: 0; background: #fff; color: #000; }
    .sheet section { break-inside: avoid; }
    .disclaimer, .muted, .hint, .tag, thead th { color: #000; }
  }
</style>
