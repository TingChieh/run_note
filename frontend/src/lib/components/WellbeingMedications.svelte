<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import PageSkeleton from './PageSkeleton.svelte';
  import WellbeingDialog from './WellbeingDialog.svelte';
  import WellbeingStockRing from './WellbeingStockRing.svelte';
  import WellbeingTile from './WellbeingTile.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    COMMON_SYMPTOMS, COMMON_UNITS, COUNT_UNITS, addDays, batchDoses, countMedication, createDose, createMedication, deleteDose, deleteMedication, doseText, pillsText, readMedications,
    restockMedication, stockText, supplyText, timeLabel, updateMedication, type Medication, type Regimen
  } from '#lib/api/wellbeing.ts';
  // Medicines: set each one up once (box size, strength of a pill, usual pills, its side effects), keep the stock, log "taken N pills" in one tap, or back-fill several days.
  // Stock is the user's own count minus the pills logged since; the page only does the arithmetic and gives no dosing advice.
  let { today, timezone }: { today: string; timezone: string } = $props();
  const id = $props.id();
  interface Form { id: string | null; name: string; countUnit: string; box: string; strength: string; strengthUnit: string; usual: string; regimen: Regimen; boxes: string; loose: string; effects: string[]; effectText: string }
  interface Panel { id: string; kind: 'restock' | 'count' | 'batch'; boxes: string; pills: string; start: string; end: string; times: string[]; perDose: string; note: string }
  let medications = $state<Medication[]>([]), loading = $state(true), loadError = $state('');
  let form = $state<Form | null>(null), panel = $state<Panel | null>(null), busy = $state(false), error = $state(''), notice = $state(''), confirming = $state('');
  let undo = $state<{ doseId: string; text: string } | null>(null);
  // The pop-ups keep their content while they retract, then let it go.
  let shownForm = $state<Form | null>(null), shownPanel = $state<Panel | null>(null);
  $effect(() => {
    if (form) { shownForm = form; return; }
    if (shownForm) { const timer = setTimeout(() => { shownForm = null; }, 400); return () => clearTimeout(timer); }
  });
  $effect(() => {
    if (panel) { shownPanel = panel; return; }
    if (shownPanel) { const timer = setTimeout(() => { shownPanel = null; }, 400); return () => clearTimeout(timer); }
  });
  /** What the ring shows: the stock as a share of one box, or of a month at the usual dose when no box size is set. */
  function ringFraction(med: Medication): number | null {
    const stock = med.stock, reference = med.pills_per_box ?? (med.default_pills ? med.default_pills * 30 : null);
    return stock && reference ? stock.pills / reference : null;
  }
  const ringNumber = (med: Medication) => med.stock ? String(+Math.max(0, med.stock.pills).toFixed(2)) : '—';
  let disposed = false, token = 0;

  function expired() { disposed = true; token++; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); }
  async function load() {
    const mine = ++token; loading = true; loadError = '';
    try {
      const meds = await readMedications();
      if (disposed || mine !== token) return;
      medications = meds;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { expired(); return; }
      loadError = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; token++; medications = []; }; });

  /** Runs one write; a failure keeps what was typed and says why. */
  async function guard(work: () => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try { await work(); }
    catch (cause) {
      if (disposed) return;
      if (cause instanceof ActivityError && cause.status === 401) { expired(); return; }
      error = cause instanceof Error ? cause.message : '保存失败，请重试';
    } finally { if (!disposed) busy = false; }
  }
  const replace = (saved: Medication) => { medications = medications.some(m => m.id === saved.id) ? medications.map(m => m.id === saved.id ? saved : m) : [...medications, saved]; };
  const whole = (text: string) => text.trim() === '' ? 0 : Number(text);
  const validCount = (text: string, max: number, integer = false) => text.trim() === '' || (/^\d+(\.\d{1,2})?$/.test(text.trim()) && Number(text) <= max && (!integer || Number.isInteger(Number(text))));

  // ---- the medicine form ----
  function openForm(med?: Medication) {
    panel = null; confirming = ''; error = ''; notice = '';
    form = med
      ? { id: med.id, name: med.name, countUnit: med.count_unit, box: med.pills_per_box === null ? '' : String(med.pills_per_box), strength: med.strength_amount === null ? '' : String(med.strength_amount), strengthUnit: med.strength_unit ?? 'mg', usual: med.default_pills === null ? '' : String(med.default_pills), regimen: med.regimen, boxes: '', loose: '', effects: [...med.side_effects], effectText: '' }
      : { id: null, name: '', countUnit: '颗', box: '', strength: '', strengthUnit: 'mg', usual: '1', regimen: 'scheduled', boxes: '', loose: '', effects: [], effectText: '' };
  }
  /** Adds the typed (or tapped) side effect once; repeats in any case are ignored. */
  function addEffect(name = form?.effectText ?? '') {
    const f = form, text = name.trim();
    if (!f || !text) return;
    if ([...text].length > 40) { error = '副作用名称最多 40 字'; return; }
    if (f.effects.length >= 20) { error = '每种药最多 20 个副作用'; return; }
    if (!f.effects.some(e => e.toLowerCase() === text.toLowerCase())) f.effects = [...f.effects, text];
    f.effectText = ''; error = '';
  }
  function submitForm(event: SubmitEvent) {
    event.preventDefault();
    const f = form;
    if (!f) return;
    addEffect();
    if (!f.name.trim()) { error = '请填写药物名称'; return; }
    if (f.box.trim() && !validCount(f.box, 10000, true)) { error = '每盒颗数需是 1 到 10000 的整数'; return; }
    if (f.strength.trim() && (!/^\d+(\.\d{1,3})?$/.test(f.strength.trim()) || Number(f.strength) <= 0 || !f.strengthUnit.trim())) { error = '每颗规格需大于 0（最多 3 位小数），并填写单位'; return; }
    if (f.usual.trim() && (!validCount(f.usual, 1000) || Number(f.usual) <= 0)) { error = '每次默认颗数需大于 0，最多 2 位小数'; return; }
    if (!f.id && (!validCount(f.boxes, 10000, true) || !validCount(f.loose, 100000))) { error = '现有库存请填写数字'; return; }
    if (!f.id && whole(f.boxes) > 0 && !f.box.trim()) { error = '按盒数填写库存，需要先填“每盒几颗”'; return; }
    const draft = { name: f.name.trim(), count_unit: f.countUnit.trim() || '颗', pills_per_box: f.box.trim() ? Number(f.box) : null, strength_amount: f.strength.trim() ? Number(f.strength) : null, strength_unit: f.strength.trim() ? f.strengthUnit.trim() : null, default_pills: f.usual.trim() ? Number(f.usual) : null, regimen: f.regimen, side_effects: f.effects };
    void guard(async () => {
      let saved = f.id ? await updateMedication(f.id, draft) : await createMedication(draft);
      // "How many do I have now" at set-up time is a first count.
      if (!f.id && (whole(f.boxes) > 0 || whole(f.loose) > 0)) saved = await countMedication(saved.id, whole(f.boxes), whole(f.loose));
      if (disposed) return;
      replace(saved); form = null; notice = f.id ? '已保存' : `已添加 ${saved.name}`;
    });
  }
  function remove(med: Medication) {
    if (confirming !== med.id) { confirming = med.id; return; }
    void guard(async () => { await deleteMedication(med.id); if (!disposed) { medications = medications.filter(m => m.id !== med.id); confirming = ''; notice = `已移除 ${med.name}（已记录的服药保留）`; } });
  }

  // ---- one tap: "taken" ----
  function took(med: Medication) {
    const pills = med.default_pills ?? 1;
    void guard(async () => {
      const dose = await createDose({ medication_name: med.name, medication_id: med.id, pills, taken_at: new Date().toISOString(), regimen: med.regimen, note: null });
      if (disposed) return;
      medications = await readMedications();
      if (disposed) return;
      undo = { doseId: dose.id, text: `已记录：${med.name} ${doseText(dose, med.count_unit)}（${timeLabel(dose.taken_at, timezone)}）` };
    });
  }
  function undoTook() {
    const current = undo;
    if (!current) return;
    void guard(async () => { await deleteDose(current.doseId); if (disposed) return; medications = await readMedications(); undo = null; notice = '已撤销这条记录，库存已恢复'; });
  }

  // ---- restock, count and back-fill panels ----
  function openPanel(med: Medication, kind: Panel['kind']) {
    form = null; confirming = ''; error = ''; notice = ''; undo = null;
    const stock = med.stock;
    panel = { id: med.id, kind, boxes: kind === 'count' && stock?.boxes !== null && stock?.boxes !== undefined ? String(stock.boxes) : '', pills: kind === 'count' && stock ? String(stock.loose_pills ?? Math.max(0, stock.pills)) : '', start: addDays(today, -6), end: today, times: ['08:00', '20:00'], perDose: med.default_pills === null ? '' : String(med.default_pills), note: '' };
  }
  function submitPanel(event: SubmitEvent, med: Medication) {
    event.preventDefault();
    const p = panel;
    if (!p) return;
    if (p.kind !== 'batch') {
      if (!validCount(p.boxes, 10000, true) || !validCount(p.pills, 100000)) { error = '请填写盒数（整数）和颗数（最多 2 位小数）'; return; }
      if (whole(p.boxes) > 0 && !med.pills_per_box) { error = '按盒数计算需要先在“编辑”里填写每盒几颗'; return; }
      if (p.kind === 'restock' && whole(p.boxes) === 0 && whole(p.pills) === 0) { error = '请填写补了几盒或几颗'; return; }
      void guard(async () => {
        const saved = p.kind === 'restock' ? await restockMedication(med.id, whole(p.boxes), whole(p.pills)) : await countMedication(med.id, whole(p.boxes), whole(p.pills));
        if (disposed) return;
        replace(saved); panel = null; notice = p.kind === 'restock' ? `已补货，现有 ${stockText(saved)}` : `已盘点，现有 ${stockText(saved)}`;
      });
      return;
    }
    if (!p.start || !p.end || p.start > p.end || p.end > today) { error = '请选择有效的日期范围（不晚于今天）'; return; }
    if (!p.times.length || p.times.some(t => !/^\d{2}:\d{2}$/.test(t)) || new Set(p.times).size !== p.times.length) { error = '请至少选一个时间点，且不要重复'; return; }
    if (p.perDose.trim() !== '' && (!validCount(p.perDose, 1000) || Number(p.perDose) <= 0)) { error = '每次颗数需大于 0，最多 2 位小数'; return; }
    if (p.perDose.trim() === '' && med.default_pills === null) { error = '请填写每次几颗'; return; }
    void guard(async () => {
      const result = await batchDoses({ medication_id: med.id, pills: p.perDose.trim() === '' ? null : Number(p.perDose), start_date: p.start, end_date: p.end, times: [...p.times].sort(), note: p.note.trim() || null });
      if (disposed) return;
      medications = await readMedications(); panel = null;
      notice = `已补录 ${result.created} 条${result.skipped_existing ? `，${result.skipped_existing} 条已存在已跳过` : ''}${result.skipped_future ? `，${result.skipped_future} 条还没到时间已跳过` : ''}`;
    });
  }
  const days = (p: Panel) => p.start && p.end && p.start <= p.end ? Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86400000) + 1 : 0;
  const regimenName = (regimen: Regimen) => regimen === 'scheduled' ? '常规' : '按需';
  const spec = (med: Medication) => [med.pills_per_box ? `每盒 ${med.pills_per_box} ${med.count_unit}` : '', med.strength_amount !== null ? `每${med.count_unit} ${med.strength_amount} ${med.strength_unit}` : '', med.default_pills !== null ? `每次 ${pillsText(med.default_pills, med.count_unit)}` : ''].filter(Boolean).join(' · ');
</script>

{#snippet medForm(f: Form)}
    <form class="subform dialog-form" onsubmit={submitForm} novalidate aria-label={f.id ? '编辑药物' : '添加药物'} data-testid="wellbeing-medication-form">
      <div class="grid">
        <label class="field wide">药物名称<input class="text-field" name="name" maxlength="80" bind:value={f.name} disabled={busy} required autocomplete="off" /></label>
        <label class="field">每盒几{f.countUnit || '颗'}<input class="text-field" name="pills_per_box" inputmode="numeric" bind:value={f.box} disabled={busy} placeholder="28" /></label>
        <label class="field">叫什么<select class="text-field" name="count_unit" bind:value={f.countUnit} disabled={busy}>{#each COUNT_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}</select></label>
        <label class="field">每次默认几{f.countUnit || '颗'}<input class="text-field" name="default_pills" inputmode="decimal" bind:value={f.usual} disabled={busy} placeholder="1" /></label>
        <label class="field">每{f.countUnit || '颗'}规格（可选）<input class="text-field" name="strength_amount" inputmode="decimal" bind:value={f.strength} disabled={busy} placeholder="12.5" /></label>
        <label class="field">规格单位<input class="text-field" name="strength_unit" maxlength="16" list={`${id}-units`} bind:value={f.strengthUnit} disabled={busy} /></label>
        <datalist id={`${id}-units`}>{#each COMMON_UNITS as unit (unit)}<option value={unit}></option>{/each}</datalist>
        <label class="field">类型<select class="text-field" name="regimen" bind:value={f.regimen} disabled={busy}><option value="scheduled">常规用药</option><option value="as_needed">按需用药</option></select></label>
        {#if !f.id}
          <label class="field">现有几盒（可选）<input class="text-field" name="boxes" inputmode="numeric" bind:value={f.boxes} disabled={busy} placeholder="0" /></label>
          <label class="field">另外几{f.countUnit || '颗'}（可选）<input class="text-field" name="loose" inputmode="decimal" bind:value={f.loose} disabled={busy} placeholder="0" /></label>
        {/if}
      </div>
      <div class="effects" role="group" aria-label="这种药的常见副作用">
        <span class="label">常见副作用（可选，记录副作用时会优先给你选）</span>
        <div class="chips">
          {#each f.effects as effect (effect)}<span class="chip-tag" data-testid="wellbeing-effect-tag">{effect}<button type="button" class="x" disabled={busy} onclick={() => { f.effects = f.effects.filter(e => e !== effect); }} aria-label={`去掉副作用 ${effect}`}>×</button></span>{/each}
          <input class="text-field effect-input" name="side_effect" maxlength="40" placeholder="输入后回车添加" aria-label="添加副作用" bind:value={f.effectText} disabled={busy} autocomplete="off" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEffect(); } }} />
          <button type="button" class="button-secondary small" disabled={busy || !f.effectText.trim()} onclick={() => addEffect()}>添加</button>
        </div>
        <div class="suggest" aria-label="常见症状，点一下添加">{#each COMMON_SYMPTOMS.filter(name => !f.effects.some(e => e.toLowerCase() === name.toLowerCase())) as name (name)}<button type="button" class="pick" disabled={busy} onclick={() => addEffect(name)}>+ {name}</button>{/each}</div>
      </div>
      <div class="buttons"><button type="submit" class="button-primary small" disabled={busy}>{busy ? '保存中…' : f.id ? '保存修改' : '保存药物'}</button><button type="button" class="button-secondary small" disabled={busy} onclick={() => { form = null; error = ''; }}>取消</button></div>
    </form>
{/snippet}
{#snippet panelForm(p: Panel, med: Medication)}
    <form class="subform dialog-form" onsubmit={(event) => submitPanel(event, med)} novalidate aria-label={p.kind === 'restock' ? '补货' : p.kind === 'count' ? '盘点' : '补录多天'} data-testid={`wellbeing-panel-${p.kind}`}>
      {#if p.kind !== 'batch'}
        <p class="hint">{p.kind === 'restock' ? '这次新买了多少：' : '现在架子上实际还有多少（按这个数校正库存）：'}</p>
        <div class="grid">
          <label class="field">盒数<input class="text-field" name="boxes" inputmode="numeric" bind:value={p.boxes} disabled={busy} placeholder="0" /></label>
          <label class="field">另外几{med.count_unit}<input class="text-field" name="pills" inputmode="decimal" bind:value={p.pills} disabled={busy} placeholder="0" /></label>
        </div>
      {:else}
        <p class="hint">日期范围内每天按所选时间点各记一条；同一时刻已有的不会重复。</p>
        <div class="grid">
          <label class="field">开始日期<input class="text-field" type="date" name="start" max={today} bind:value={p.start} disabled={busy} /></label>
          <label class="field">结束日期<input class="text-field" type="date" name="end" max={today} bind:value={p.end} disabled={busy} /></label>
          <label class="field">每次几{med.count_unit}<input class="text-field" name="per_dose" inputmode="decimal" bind:value={p.perDose} disabled={busy} placeholder={med.default_pills === null ? '必填' : String(med.default_pills)} /></label>
          <label class="field wide">备注（可选）<input class="text-field" name="note" maxlength="500" bind:value={p.note} disabled={busy} /></label>
        </div>
        <div class="times" role="group" aria-label="每天的时间点">
          {#each p.times as _, index (index)}
            <span class="time"><input class="text-field" type="time" aria-label={`第 ${index + 1} 个时间点`} bind:value={p.times[index]} disabled={busy} />{#if p.times.length > 1}<button type="button" class="x" disabled={busy} onclick={() => { p.times = p.times.filter((__, i) => i !== index); }} aria-label={`删除第 ${index + 1} 个时间点`}>×</button>{/if}</span>
          {/each}
          {#if p.times.length < 6}<button type="button" class="button-secondary small" disabled={busy} onclick={() => { p.times = [...p.times, '12:00']; }}>加时间点</button>{/if}
          <span class="hint" data-testid="wellbeing-batch-preview">将生成最多 {days(p) * p.times.length} 条（{days(p)} 天 × {p.times.length} 次）{#if days(p) * p.times.length > 1000}，超过一次 1000 条的上限{/if}。</span>
        </div>
      {/if}
      <div class="buttons"><button type="submit" class="button-primary small" disabled={busy}>{busy ? '保存中…' : p.kind === 'restock' ? '确认补货' : p.kind === 'count' ? '确认盘点' : '生成记录'}</button><button type="button" class="button-secondary small" disabled={busy} onclick={() => { panel = null; error = ''; }}>取消</button></div>
    </form>
{/snippet}

<div class="meds" data-testid="wellbeing-medications">
  <div class="head">
    <h2 id={`${id}-title`}>我的药物</h2>
    <button type="button" class="button-primary small" onclick={() => openForm()} data-testid="wellbeing-add-medication">添加药物</button>
  </div>
  <p class="hint">每种药设置一次（每盒几颗、每次几颗、常见副作用），之后点“吃了”记一条，库存自动扣减。圆环是剩余药量占一盒（没填每盒颗数时占一个月用量）的比例；“约可吃几天”只是按你自己的记录算的，不是用药建议。</p>

  {#if notice}<p class="notice" role="status" data-testid="wellbeing-med-notice">{notice}</p>{/if}
  {#if undo}<p class="notice" role="status" data-testid="wellbeing-med-undo">{undo.text}<button type="button" class="link" disabled={busy} onclick={undoTook}>撤销</button></p>{/if}
  {#if error && !form && !panel}<div data-testid="wellbeing-med-error"><FeedbackState kind="error" title={error} /></div>{/if}

  {#if loading && !medications.length}<PageSkeleton title="正在读取药物…" />{/if}
  {#if loadError}<div data-testid="wellbeing-meds-load-error"><FeedbackState kind="error" title={loadError}><button type="button" class="button-secondary" onclick={() => { void load(); }} aria-label="重试读取药物">重试</button></FeedbackState></div>{/if}
  {#if !loading && !loadError && !medications.length && !form}<FeedbackState kind="empty" title="还没有药物"><p>点“添加药物”，填一次每盒几颗和每次吃几颗，以后记录只需一点。</p></FeedbackState>{/if}

  <!-- One widget per medicine, the same frame as the journal's other widgets; the ring is what is left. -->
  <ul class="tiles">
    {#each medications as med (med.id)}
      {@const stock = med.stock}
      {@const low = !!stock && (stock.pills <= 0 || (stock.days_left !== null && stock.days_left <= 7))}
      <li class="med" data-testid="wellbeing-medication" data-medication={med.name}>
        <WellbeingTile metric="dose" title={med.name}>
          {#snippet actions()}
            {#if confirming === med.id}
              <button type="button" class="mini danger-fill" disabled={busy} onclick={() => remove(med)} aria-label={`确认移除药物 ${med.name}`}>确认移除</button>
              <button type="button" class="mini" onclick={() => { confirming = ''; }} aria-label="取消移除">取消</button>
            {:else}
              <button type="button" class="icon" disabled={busy} onclick={() => openForm(med)} aria-label={`编辑药物 ${med.name}`} title="编辑"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button>
              <button type="button" class="icon danger" disabled={busy} onclick={() => remove(med)} aria-label={`移除药物 ${med.name}`} title="移除"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>
            {/if}
          {/snippet}
          <WellbeingStockRing fraction={ringFraction(med)} value={ringNumber(med)} unit={med.count_unit} {low} label={`${med.name} 剩余：${stockText(med)}`} />
          <p class="line stock" class:low data-testid="wellbeing-stock"><span class="label">库存</span> {stockText(med)}{#if supplyText(med)}<span class="supply"> · {supplyText(med)}</span>{/if}</p>
          <p class="line meta"><span class="chip">{regimenName(med.regimen)}</span>{#if spec(med)} <span class="spec">{spec(med)}</span>{/if}</p>
          {#if med.side_effects.length}<p class="line effects-line" data-testid="wellbeing-med-effects"><span class="label">常见副作用</span> {med.side_effects.join('、')}</p>{/if}
          <button type="button" class="button-primary small took" disabled={busy} onclick={() => took(med)} data-testid="wellbeing-took" aria-label={`记录吃了 ${pillsText(med.default_pills ?? 1, med.count_unit)} ${med.name}`}>吃了 {pillsText(med.default_pills ?? 1, med.count_unit)}</button>
          <div class="actions">
            <button type="button" class="button-secondary small" disabled={busy} onclick={() => openPanel(med, 'restock')} aria-label={`给 ${med.name} 补货`}>补货</button>
            <button type="button" class="button-secondary small" disabled={busy} onclick={() => openPanel(med, 'count')} aria-label={`盘点 ${med.name}`}>盘点</button>
            <button type="button" class="button-secondary small" disabled={busy} onclick={() => openPanel(med, 'batch')} aria-label={`补录 ${med.name} 多天记录`}>补录多天</button>
          </div>
          {#if confirming === med.id}<p class="hint">移除会同时清掉它的库存记录；已记录的服药保留。再点一次“确认移除”。</p>{/if}
        </WellbeingTile>
      </li>
    {/each}
  </ul>

<WellbeingDialog open={!!form} labelledby={`${id}-form-title`} {busy} onclose={() => { if (form) { form = null; error = ''; } }}>
  {#if shownForm}
    <h2 id={`${id}-form-title`} class="dialog-title">{shownForm.id ? '编辑药物' : '添加药物'}</h2>
    {@render medForm(shownForm)}
    {#if error && form}<div data-testid="wellbeing-med-error"><FeedbackState kind="error" title={error} /></div>{/if}
  {/if}
</WellbeingDialog>
<WellbeingDialog open={!!panel} labelledby={`${id}-panel-title`} {busy} onclose={() => { if (panel) { panel = null; error = ''; } }}>
  {#if shownPanel}
    {@const med = medications.find(m => m.id === shownPanel!.id)}
    {#if med}
      <h2 id={`${id}-panel-title`} class="dialog-title">{med.name} · {shownPanel.kind === 'restock' ? '补货' : shownPanel.kind === 'count' ? '盘点' : '补录多天'}</h2>
      {@render panelForm(shownPanel, med)}
      {#if error && panel}<div data-testid="wellbeing-med-error"><FeedbackState kind="error" title={error} /></div>{/if}
    {/if}
  {/if}
</WellbeingDialog>
</div>

<style>
  .meds { display: grid; gap: var(--space-3); min-width: 0; }
  .meds > .hint { margin-top: calc(-1 * var(--space-1)); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h2 { font-size: var(--text-card); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-heading); }
  .notice { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-1) var(--space-3); border: 1px solid var(--success-border); border-radius: var(--radius-control); background: var(--success-soft); color: var(--success); font-size: var(--text-small); }
  .link { padding: 0; border: 0; background: none; color: var(--primary); font-size: var(--text-small); text-decoration: underline; cursor: pointer; }
  /* The widgets, three to a row like the journal's others (two, then one, on narrower screens). */
  .tiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  @media (min-width: 480px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 900px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); } }
  .med { display: grid; min-width: 0; overflow-wrap: anywhere; }
  .med :global(.body) { justify-items: center; text-align: center; gap: var(--space-2); }
  .meta { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: var(--space-1) var(--space-2); }
  .took { width: 100%; }
  .actions { justify-content: center; }
  /* Small round buttons on the widget's header row (edit, remove). */
  .icon, .mini { display: grid; place-items: center; position: relative; min-height: 0; height: 2.25rem; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); color: var(--muted-foreground); cursor: pointer; }
  .icon { width: 2.25rem; }
  .icon::after, .mini::after { content: ''; position: absolute; inset: -.25rem; }
  .mini { padding-inline: var(--space-2); font-size: var(--text-caption); }
  .icon.danger:hover, .icon.danger:focus-visible { color: var(--error); }
  .danger-fill { border-color: var(--error); background: var(--error); color: var(--surface); }
  .icon:focus-visible, .mini:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .dialog-title { margin-bottom: var(--space-3); font-size: var(--text-section); font-weight: var(--weight-semibold); }
  .subform.dialog-form { padding: 0; border: 0; background: none; }
  .chip { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--muted-foreground); font-size: var(--text-caption); }
  .spec { color: var(--muted-foreground); font-size: var(--text-small); }
  .line { font-size: var(--text-small); font-variant-numeric: tabular-nums; line-height: var(--line-height-heading); }
  .label { color: var(--muted-foreground); }
  .stock.low, .stock.low .supply { color: var(--warning); }
  .supply { color: var(--muted-foreground); }
  .took { flex: none; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
  .small { min-height: 2.25rem; padding-inline: var(--space-3); font-size: var(--text-small); }
  .danger { color: var(--error); }
  .field { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--text-small); font-weight: var(--weight-semibold); }
  /* Fields sit side by side: as many columns as fit, name and note take two. */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.25rem, 1fr)); gap: var(--space-2) var(--space-3); align-items: end; }
  .grid .wide { grid-column: span 2; }
  @media (max-width: 479px) { .grid .wide { grid-column: 1 / -1; } }
  .subform { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--muted); }
  .effects { display: grid; gap: var(--space-1); }
  .effects .label { font-size: var(--text-small); font-weight: var(--weight-semibold); color: var(--foreground); }
  .chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  .chip-tag { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-1) 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-small); }
  .effect-input { flex: 1 1 10rem; min-width: 8rem; }
  .suggest { display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .pick { min-height: 2rem; padding: 0 var(--space-2); border: 1px dashed var(--border); border-radius: var(--radius-pill); background: none; color: var(--muted-foreground); font-size: var(--text-caption); cursor: pointer; }
  .pick:hover:not(:disabled) { color: var(--foreground); border-color: var(--control-hover-border); }
  .pick:focus-visible, .x:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .times { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  .time { display: inline-flex; align-items: center; gap: var(--space-1); }
  .time .text-field { width: 7.5rem; }
  .x { min-width: 2rem; min-height: 2rem; border: 0; background: none; color: var(--muted-foreground); cursor: pointer; }
</style>
