<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import DatePicker from './DatePicker.svelte';
  import FeedbackState from './FeedbackState.svelte';
  import WellbeingReportEffects from './WellbeingReportEffects.svelte';
  import WellbeingReportMedicines from './WellbeingReportMedicines.svelte';
  import WellbeingReportPrint from './WellbeingReportPrint.svelte';
  import WellbeingReportTimeline from './WellbeingReportTimeline.svelte';
  import WellbeingTile from './WellbeingTile.svelte';
  import { change, changeText, previousRange, sparkRuns, spanDays } from './wellbeing-report-math.ts';
  import type { ToneKey } from './wellbeing-tones.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { RATING_KEYS, RATING_LABELS, addDays, dateLabel, downloadCsv, hoursText, readReport, type CsvKind, type Report } from '#lib/api/wellbeing.ts';
  // The summary of a range: charts and figures first (compared with the stretch just before); the print report is a separate, paper-only layout. It restates what was logged: no diagnosis, no dosing advice, and symptom/dose order is not a cause.
  let { today, timezone }: { today: string; timezone: string } = $props();
  type Mode = 7 | 14 | 30 | 'custom';
  let mode = $state<Mode>(7), customFrom = $state(untrack(() => addDays(today, -29))), customTo = $state(untrack(() => today));
  let from = $state(untrack(() => addDays(today, -6))), to = $state(untrack(() => today));
  let report = $state<Report | null>(null), before = $state<Report | null>(null), loading = $state(false), message = $state(''), exporting = $state<CsvKind | ''>(''), exportError = $state('');
  let allNotes = $state(false), openNote = $state(''), overflowing = $state<Record<string, boolean>>({});
  /** A note shows "展开" only when its two lines really cut something off (that depends on the width), so a short one never gets a button that does nothing. */
  function measure(node: HTMLElement, date: string) {
    const check = () => { if (node.classList.contains('clamp')) overflowing[date] = node.scrollHeight > node.clientHeight + 1; };
    check();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    watch?.observe(node);
    return { update: check, destroy: () => { watch?.disconnect(); } };
  }
  let disposed = false, token = 0;
  const valid = (a: string, b: string) => !!a && !!b && a <= b && spanDays(a, b) <= 366;
  const customValid = $derived(valid(customFrom, customTo));

  function expired(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) { disposed = true; token++; report = null; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); return true; }
    return false;
  }
  async function generate() {
    if (!valid(from, to)) { message = '请选择有效的日期范围（开始不晚于结束，最长 366 天）'; return; }
    const mine = ++token; loading = true; message = '';
    const prior = previousRange(from, to);
    try {
      const [result, earlier] = await Promise.all([readReport(from, to), readReport(prior.from, prior.to).catch(cause => { if (cause instanceof ActivityError && cause.status === 401) throw cause; return null; })]);
      if (disposed || mine !== token) return;
      report = result; before = earlier; allNotes = false; openNote = '';
    } catch (cause) {
      if (disposed || mine !== token || expired(cause)) return;
      message = cause instanceof Error ? cause.message : '生成失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  function choose(next: Mode) {
    mode = next;
    if (next === 'custom') return;
    to = today; from = addDays(today, -(next - 1)); void generate();
  }
  function applyCustom() { if (!customValid) { message = '请选择有效的日期范围（开始不晚于结束，最长 366 天）'; return; } from = customFrom; to = customTo; void generate(); }
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
  type RatingKey = (typeof RATING_KEYS)[number];
  /** Sleep quality is shown inside the sleep widget, with the hours, so it has no widget of its own. */
  const MEASURE_KEYS = RATING_KEYS.filter(key => key !== 'sleep_quality');
  const stat = (r: Report | null, key: RatingKey) => r?.ratings.find(item => item.key === key) ?? null;
  const shownDelta = (now: number | null, then: number | null) => changeText(change(now, then));
  const deltaWords = (now: number | null, then: number | null, unit = '') => { const d = change(now, then); return d === null ? '' : d === 0 ? '与上一段相同' : `比上一段${d > 0 ? '高' : '低'} ${Math.abs(d)}${unit}`; };
  /** "10月29日 周四": the note's day without the year, short enough for a half-width card. */
  const noteDay = (date: string) => { const label = dateLabel(date); return label.slice(label.indexOf('年') + 1); };
  const noteDates = $derived(report ? [...report.notes].sort((a, b) => b.date.localeCompare(a.date)) : []);
  const visibleNotes = $derived(allNotes ? noteDates : noteDates.slice(0, 4));
  const effectDays = $derived(report ? new Set(report.symptom_events.map(e => e.entry_date)).size : 0);
  const prevEffectDays = $derived(before ? new Set(before.symptom_events.map(e => e.entry_date)).size : null);
  onMount(() => { void generate(); return () => { disposed = true; token++; report = null; }; });
</script>

<div class="report-page" data-testid="wellbeing-report-page">
  <section class="card no-print" aria-labelledby="report-form-title">
    <div class="head">
      <div><p class="eyebrow">一段时间的记录汇总</p><h2 id="report-form-title">总结</h2></div>
      <div class="settings-tabs" role="group" aria-label="总结范围">
        {#each [7, 14, 30] as range (range)}<button type="button" aria-pressed={mode === range} onclick={() => { choose(range as Mode); }}>近 {range} 天</button>{/each}
        <button type="button" aria-pressed={mode === 'custom'} onclick={() => { choose('custom'); }}>自定义</button>
      </div>
    </div>
    {#if mode === 'custom'}
      <form class="range" onsubmit={(event) => { event.preventDefault(); applyCustom(); }}>
        <DatePicker label="开始日期" bind:value={customFrom} max={today} {timezone} required />
        <DatePicker label="结束日期" bind:value={customTo} max={today} {timezone} required />
        <button type="submit" class="button-primary" disabled={loading || !customValid}>{loading ? '生成中…' : '查看'}</button>
      </form>
    {/if}
    {#if report}<p class="summary" data-testid="wellbeing-report-summary">{report.start} 至 {report.end}（{report.series.length} 天，{report.timezone}）：{report.coverage.days_with_entry} 天填写了状态。数字旁的箭头是和前一段同样长的日子相比。</p>
    {:else}<p class="hint">选一段时间，汇总你实际记录的内容。只整理记录，不做诊断，也不建议调整药物。</p>{/if}
    {#if message}<div data-testid="wellbeing-report-error"><FeedbackState kind="error" title={message}><button type="button" class="button-secondary" onclick={() => { void generate(); }} aria-label="重试生成报告">重试</button></FeedbackState></div>{/if}
  </section>

  {#if report}
    {@const r = report}
    <div class="dash no-print" aria-busy={loading} data-testid="wellbeing-report-dashboard">
      <div class="tiles overview">
        <WellbeingTile metric="note" title="记录了几天" testid="report-stat-days">
          <p class="big"><strong>{r.coverage.days_with_entry}</strong><span class="unit">/ {r.series.length} 天</span>{#if before}<span class="delta" aria-label={deltaWords(r.coverage.days_with_entry, before.coverage.days_with_entry, ' 天')}>{shownDelta(r.coverage.days_with_entry, before.coverage.days_with_entry)}</span>{/if}</p>
          <span class="bar" aria-hidden="true"><span style:width={`${(r.coverage.days_with_entry / Math.max(1, r.series.length)) * 100}%`}></span></span>
          <p class="sub">没有状态记录的日子不代表情况好或不好。</p>
        </WellbeingTile>
        <WellbeingTile metric="dose" title="服药" testid="report-stat-doses">
          <p class="big"><strong>{r.doses.length}</strong><span class="unit">次</span>{#if before}<span class="delta" aria-label={deltaWords(r.doses.length, before.doses.length, ' 次')}>{shownDelta(r.doses.length, before.doses.length)}</span>{/if}</p>
          <p class="sub">{r.medications.length ? `${r.medications.length} 种药：${r.medications.map(m => `${m.name} ${m.dose_count} 次`).join('、')}` : '这段时间没有服药记录。'}</p>
        </WellbeingTile>
        <WellbeingTile metric="effects" title="副作用" testid="report-stat-effects">
          <p class="big"><strong>{r.symptom_events.length}</strong><span class="unit">条 · {effectDays} 天</span>{#if prevEffectDays !== null && before}<span class="delta" aria-label={deltaWords(r.symptom_events.length, before.symptom_events.length, ' 条')}>{shownDelta(r.symptom_events.length, before.symptom_events.length)}</span>{/if}</p>
          <p class="sub">{r.symptoms.length ? `最常出现的：${[...r.symptoms].sort((a, b) => b.days - a.days)[0].symptom}` : '这段时间没有记录副作用。'}</p>
        </WellbeingTile>
      </div>

      <div class="tiles measures" data-testid="report-measures">
        {#each MEASURE_KEYS as key (key)}
          {@const now = stat(r, key)}
          {@const prev = stat(before, key)}
          {@const label = RATING_LABELS[key]}
          {@const spark = sparkRuns(r.series.map(d => d[key]), 10)}
          <WellbeingTile metric={key as ToneKey} title={label.name} subtitle={label.direction === 'worse' ? '越高越严重' : '越高越好'} testid={`report-measure-${key}`}>
            {#if now && now.answered_days}
              <p class="big"><strong>{now.mean}</strong><span class="unit">/ 10 平均</span>{#if prev && prev.mean !== null}<span class="delta" aria-label={deltaWords(now.mean, prev.mean)}>{shownDelta(now.mean, prev.mean)}</span>{/if}</p>
              <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">{#each spark.runs as run (run)}<polyline points={run} />{/each}{#each spark.dots as [x, y] (`${x}-${y}`)}<polyline class="dot" points={`${x},${y} ${x},${y}`} />{/each}</svg>
              <span class="range-bar" aria-hidden="true"><span class="span" style:left={`${(now.min ?? 0) * 10}%`} style:width={`${Math.max(2, ((now.max ?? 0) - (now.min ?? 0)) * 10)}%`}></span><span class="mean" style:left={`${(now.mean ?? 0) * 10}%`}></span></span>
              <p class="sub">{now.answered_days} 天有记录 · 最低 {now.min} · 最高 {now.max} · {label.direction === 'worse' ? '越高越严重' : '越高越好'}</p>
            {:else}
              <p class="big"><strong>—</strong></p>
              <p class="sub">这段时间没有{label.name}记录。</p>
            {/if}
          </WellbeingTile>
        {/each}
        {#snippet sleepTile()}
          {@const q = stat(r, 'sleep_quality')}
          {@const fmt = (h: number) => String(+h.toFixed(1))}
          <WellbeingTile metric="sleep" title="睡眠" subtitle="平均睡了多久、睡得好不好" testid="report-measure-sleep">
            {#if r.sleep.mean_hours !== null || r.sleep.mean_quality !== null}
              <!-- Two halves built the same way: a caption, the average, a bar from the lowest to the highest with a tick at the average, and those two numbers. -->
              <div class="pair">
                <div class="fig" data-testid="report-sleep-hours">
                  <p class="cap">平均睡眠时长</p>
                  <p class="big">{#if r.sleep.mean_hours !== null}<strong>{hoursText(r.sleep.mean_hours)}</strong>{#if before && before.sleep.mean_hours !== null}<span class="delta" aria-label={deltaWords(r.sleep.mean_hours, before.sleep.mean_hours, ' 小时')}>{shownDelta(r.sleep.mean_hours, before.sleep.mean_hours)}</span>{/if}{:else}<strong>—</strong>{/if}</p>
                  {#if r.sleep.mean_hours !== null}
                    <span class="range-bar" style:--tone="var(--well-sleep)" aria-hidden="true"><span class="span" style:left={`${((r.sleep.min_hours ?? 0) / 12) * 100}%`} style:width={`${Math.max(2, (((r.sleep.max_hours ?? 0) - (r.sleep.min_hours ?? 0)) / 12) * 100)}%`}></span><span class="mean" style:left={`${(r.sleep.mean_hours / 12) * 100}%`}></span></span>
                    <p class="sub">最短 {fmt(r.sleep.min_hours ?? 0)} · 最长 {fmt(r.sleep.max_hours ?? 0)} 小时</p>
                  {:else}<p class="sub">没有记录</p>{/if}
                </div>
                <div class="fig" data-testid="report-sleep-quality">
                  <p class="cap">平均睡眠质量</p>
                  <p class="big">{#if r.sleep.mean_quality !== null}<strong>{r.sleep.mean_quality}</strong><span class="unit">/ 10</span>{#if before && before.sleep.mean_quality !== null}<span class="delta" aria-label={deltaWords(r.sleep.mean_quality, before.sleep.mean_quality)}>{shownDelta(r.sleep.mean_quality, before.sleep.mean_quality)}</span>{/if}{:else}<strong>—</strong>{/if}</p>
                  {#if q && q.answered_days}
                    <span class="range-bar" style:--tone="var(--well-sleep-quality)" aria-hidden="true"><span class="span" style:left={`${(q.min ?? 0) * 10}%`} style:width={`${Math.max(2, ((q.max ?? 0) - (q.min ?? 0)) * 10)}%`}></span><span class="mean" style:left={`${(q.mean ?? 0) * 10}%`}></span></span>
                    <p class="sub">最低 {q.min} · 最高 {q.max}</p>
                  {:else}<p class="sub">没有记录</p>{/if}
                </div>
              </div>
              <p class="sub">{Math.max(r.sleep.answered_days, r.sleep.quality_answered_days)} 天有记录 · 质量越高越好</p>
            {:else}
              <p class="big"><strong>—</strong></p>
              <p class="sub">这段时间没有睡眠记录。</p>
            {/if}
          </WellbeingTile>
        {/snippet}
        {@render sleepTile()}
      </div>

      <WellbeingReportTimeline series={r.series} doses={r.doses} events={r.symptom_events} medications={r.medications} missing={r.coverage.missing_dates} timezone={r.timezone} />
      <WellbeingReportMedicines series={r.series} doses={r.doses} medications={r.medications} before={before ? before.medications : null} />

      <!-- Side effects and notes share one row when there is room (side effects wider), one under the other when there is not. -->
      <div class="duo">
        <WellbeingReportEffects doses={r.doses} events={r.symptom_events} stats={r.symptoms} />
        <section class="card" aria-labelledby="notes-title" data-testid="report-notes">
          <h3 id="notes-title">备注</h3>
          {#if noteDates.length}
            <ul class="notelist">{#each visibleNotes as note (note.date)}
              <li><span class="date">{noteDay(note.date)}</span>
                <p class:clamp={openNote !== note.date} use:measure={note.date}>{note.note}</p>
                {#if overflowing[note.date] || openNote === note.date}<button type="button" class="link" aria-expanded={openNote === note.date} onclick={() => { openNote = openNote === note.date ? '' : note.date; }}>{openNote === note.date ? '收起' : '展开'}</button>{/if}
              </li>{/each}</ul>
            {#if noteDates.length > 4}<button type="button" class="button-secondary more" onclick={() => { allNotes = !allNotes; }}>{allNotes ? '只看最近 4 条' : `显示全部 ${noteDates.length} 条`}</button>{/if}
          {:else}<p class="muted">这段时间没有备注。</p>{/if}
        </section>
      </div>

    </div>

    <WellbeingReportPrint report={r} />

    <section class="card no-print" aria-labelledby="export-title" data-testid="wellbeing-export">
      <h3 id="export-title">打印或导出</h3>
      <div class="export">
        <div class="item"><button type="button" class="button-primary" onclick={() => window.print()}>打印 / 另存为 PDF</button><p class="sub">一份专门排好的报告：概览、各项状态、服药和剂量变化、副作用、备注。</p></div>
        <div class="item"><button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('entries'); }}>{exporting === 'entries' ? '导出中…' : '状态记录 CSV'}</button><p class="sub">每天一行：各项评分、睡眠时长、备注。</p></div>
        <div class="item"><button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('doses'); }}>{exporting === 'doses' ? '导出中…' : '服药记录 CSV'}</button><p class="sub">每次服药一行：日期、时间、药名、用量、常规或按需。</p></div>
        <div class="item"><button type="button" class="button-secondary" disabled={!!exporting} onclick={() => { void save('symptoms'); }}>{exporting === 'symptoms' ? '导出中…' : '副作用 CSV'}</button><p class="sub">每条副作用一行：日期、名称、此前最近一次服药。</p></div>
      </div>
      <p class="hint">导出的文件包含你的健康记录，请只保存在可信的设备上，分享前确认接收对象。以“=”“+”“-”“@”开头的文字会在 CSV 中加一个“'”，避免被表格软件当作公式执行。</p>
      {#if exportError}<div data-testid="wellbeing-export-error"><FeedbackState kind="error" title={exportError} /></div>{/if}
    </section>
  {/if}
</div>

<style>
  .report-page { display: grid; gap: var(--space-6); min-width: 0; }
  .card { display: grid; gap: var(--space-4); min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .eyebrow { margin-bottom: var(--space-1); color: var(--muted-foreground); font-size: var(--text-caption); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h3 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint, .muted { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-4); }
  .summary { color: var(--foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .card .settings-tabs { background: var(--muted); }
  .card .settings-tabs > button { color: var(--muted-foreground); }
  .card .settings-tabs:not(:global(.rn-liquid-navigation)) > button[aria-pressed='true'] { color: var(--primary-foreground); } /* with the glass lens the chosen label stays dark when the lens moves away (the lens carries the white copy) */
  .range { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); }
  /* The print button and the three files, each with a line on what it holds, in even columns. */
  .export { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--space-4); }
  .export .item { display: grid; align-content: start; justify-items: start; gap: var(--space-2); }
  .dash { container-type: inline-size; display: grid; gap: var(--space-4); min-width: 0; }
  /* The widgets always fill their rows: the six measures are 3 + 3 (as wide as the three above them), or 2 + 2 + 2, or one under the other, never a row with a hole in it. */
  .duo > .card { align-content: start; }
  .duo { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); align-items: stretch; min-width: 0; }
  @container (min-width: 62rem) { .duo { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
  .tiles { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); min-width: 0; }
  @container (min-width: 34rem) { .measures { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (min-width: 44rem) { .overview { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @container (min-width: 52rem) { .measures { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  /* The figure of a tile: a big number, its unit, and how it moved against the stretch before. */
  .big { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); line-height: var(--line-height-heading); }
  .big strong { font-size: var(--text-stat); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  /* The sleep widget: hours and quality side by side with a thin rule between them, then one chart (bars = hours, line = quality). */
  .pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
  .fig { display: grid; align-content: start; gap: var(--space-2); min-width: 0; }
  .fig + .fig { padding-left: var(--space-3); border-left: 1px solid var(--border); }
  .cap { color: var(--muted-foreground); font-size: var(--text-caption); }
  .pair .big strong { font-size: var(--text-section); }
  .pair .delta { margin-left: 0; }
  .unit { color: var(--muted-foreground); font-size: var(--text-small); }
  .delta { margin-left: auto; padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); font-size: var(--text-caption); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
  .sub { color: var(--muted-foreground); font-size: var(--text-caption); line-height: var(--line-height-body); overflow-wrap: anywhere; }
  .bar { display: block; height: .5rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--muted) 70%, transparent); overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: var(--radius-pill); background: var(--tone); }
  .spark { display: block; width: 100%; height: 2.5rem; overflow: visible; }
  .spark polyline { fill: none; stroke: var(--tone); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  /* A day with a value is a round dot: a zero-length line with round ends keeps its shape however the chart is stretched. */
  .spark .dot { stroke-width: 7; }
  /* Lowest to highest of the range as a bar on the 0–10 track, the average as a tick. */
  .range-bar { position: relative; display: block; height: .5rem; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--muted) 70%, transparent); }
  .range-bar .span { position: absolute; top: 0; bottom: 0; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--tone) 45%, transparent); }
  .range-bar .mean { position: absolute; top: -.2rem; bottom: -.2rem; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--tone); }
  .notelist { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
  .notelist li { display: grid; grid-template-columns: 8rem minmax(0, 1fr); align-items: start; gap: var(--space-1) var(--space-3); font-size: var(--text-small); }
  .notelist p { white-space: pre-wrap; overflow-wrap: anywhere; }
  .notelist p.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .notelist .link { grid-column: 2; justify-self: start; padding: 0; border: 0; background: none; color: var(--primary); font-size: var(--text-caption); cursor: pointer; }
  @media (max-width: 639px) { .notelist li { grid-template-columns: minmax(0, 1fr); } .notelist .link { grid-column: 1; } }
  .more { justify-self: start; }
  .date { font-variant-numeric: tabular-nums; font-weight: var(--weight-medium); }
  @media (max-width: 767px) { .card { padding: var(--space-4); } }

  /* Printing: only the print report (its own paper layout), on plain paper; the page's charts and cards are left out. */
  @media print {
    :global(.app-sidebar), :global(.mobile-bar), :global(.skip-link), :global(.app-footer), :global(.page-header), :global(.save-bar-slot), :global(.navigation-progress) { display: none !important; }
    :global(body), :global(.sport-theme) { background: #fff !important; color: #000 !important; }
    :global(.page-content) { max-width: none; padding: 0 !important; margin: 0 !important; }
    :global(.content-column) { margin: 0 !important; }
    .no-print { display: none !important; }
  }
</style>
