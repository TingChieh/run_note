<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import FeedbackState from './FeedbackState.svelte';
  import SaveBar from './SaveBar.svelte';
  import WellbeingDialog from './WellbeingDialog.svelte';
  import WellbeingScale from './WellbeingScale.svelte';
  import WellbeingSleep from './WellbeingSleep.svelte';
  import WellbeingTile from './WellbeingTile.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    COMMON_SYMPTOMS, RATING_KEYS, RATING_LABELS, answeredCount, createDose, createSymptom, dateLabel, deleteDose, deleteEntry, deleteSymptom, doseText, draftChanged, draftEmpty, draftOf,
    emptyDraft, instantFromLocal, localInput, normalizeDraft, readDay, readMedications, readSymptomNames, saveEntry, timeLabel, updateDose,
    type DayData, type Dose, type EntryDraft, type Medication, type SymptomName, type Regimen, type Symptom
  } from '#lib/api/wellbeing.ts';
  // One day of the journal: state answers (saved together), plus the day's medication (one widget; each dose and its side effects are saved on their own).
  let { day, onunsaved, onchanged }: { day: string; onunsaved?: (unsaved: boolean) => void; onchanged?: () => void } = $props();
  const id = $props.id();
  let data = $state<DayData | null>(null), loading = $state(true), loadError = $state('');
  let draft = $state<EntryDraft>(emptyDraft()), base = $state<EntryDraft>(emptyDraft()), basedOn = $state<string | null>(null);
  let saving = $state(false), saved = $state(''), saveError = $state(''), conflict = $state(false);
  let doses = $state<Dose[]>([]), symptoms = $state<Symptom[]>([]), medications = $state<Medication[]>([]), symptomNames = $state<SymptomName[]>([]);
  let confirming = $state(''), eventError = $state(''), eventBusy = $state(false), removing = $state(false);
  let disposed = false, token = 0;

  interface DoseForm { id: string | null; medicationId: string | null; name: string; pills: string; custom: boolean; keepAmount: { amount: number; unit: string } | null; time: string; regimen: Regimen; note: string; effects: string[]; other: string }
  let doseForm = $state<DoseForm | null>(null), doseSnapshot = '';
  // The dose editor is a modal dialog: open exactly while there is a form. Its content stays for the retract animation, then goes.
  let dialogForm = $state<DoseForm | null>(null);
  $effect(() => {
    if (doseForm) { dialogForm = doseForm; return; }
    if (dialogForm) { const timer = setTimeout(() => { dialogForm = null; }, 400); return () => clearTimeout(timer); }
  });
  let otherInput = $state<HTMLInputElement>();
  /** "其他药物" widens into a text field in place of the chip. */
  async function openOther(form: DoseForm) {
    form.custom = true; form.medicationId = null; if (medications.some(m => m.name === form.name)) form.name = '';
    await tick(); otherInput?.focus();
  }

  const timezone = $derived(data?.timezone ?? 'Asia/Shanghai');
  const isToday = $derived(!!data && data.date === data.today);
  const dirty = $derived(draftChanged(draft, base));
  const unsaved = $derived(dirty || (!!doseForm && JSON.stringify(doseForm) !== doseSnapshot));
  $effect(() => { onunsaved?.(unsaved); });
  const progress = $derived(answeredCount(data?.entry ?? null));
  const status = $derived(!data ? '' : !data.entry && !doses.length && !symptoms.length ? (isToday ? '今天还没有记录' : '这一天还没有记录') : `已记录 ${progress.answered}/${progress.total} 项状态 · ${doses.length} 次服药 · ${symptoms.length} 条副作用`);
  /** One-tap side effects for the dose being written: the ones noted for that medicine first, then the built-in common ones, then the user's own; each once (any case). */
  function effectChoices(form: { medicationId: string | null; name: string }) {
    const own = (medications.find(m => m.id === form.medicationId) ?? known(form.name))?.side_effects ?? [];
    const seen = new Set<string>();
    return [...own, ...COMMON_SYMPTOMS, ...symptomNames.map(item => item.name)].filter(name => { const key = name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  const refreshLists = () => {
    void readMedications().then(list => { if (!disposed) medications = list; }).catch(() => { /* Shortcuts are optional. */ });
    void readSymptomNames().then(list => { if (!disposed) symptomNames = list; }).catch(() => { /* Shortcuts are optional. */ });
  };

  async function load(date: string) {
    const mine = ++token; loading = true; loadError = ''; saved = ''; saveError = ''; conflict = false; doseForm = null; confirming = '';
    try {
      const result = await readDay(date);
      if (disposed || mine !== token) return;
      data = result; doses = result.doses; symptoms = result.symptoms; draft = draftOf(result.entry); base = draftOf(result.entry); basedOn = result.entry?.updated_at ?? null;
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; }
      data = null; loadError = cause instanceof Error ? cause.message : '读取失败，请稍后重试';
    } finally { if (!disposed && mine === token) loading = false; }
  }
  function fail401() { disposed = true; token++; data = null; window.location.replace('/admin?reason=expired&next=' + encodeURIComponent(window.location.pathname)); }
  onMount(() => {
    refreshLists();
    return () => { disposed = true; token++; data = null; draft = emptyDraft(); doses = []; symptoms = []; onunsaved?.(false); };
  });
  $effect(() => { const date = day; untrack(() => { void load(date); }); });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !data) return;
    const clean = normalizeDraft(draft);
    saveError = ''; saved = ''; conflict = false;
    if (draftEmpty(clean)) { saveError = '请至少填写一项，再保存'; return; }
    if (clean.sleep_hours !== null && (clean.sleep_hours < 0 || clean.sleep_hours > 24)) { saveError = '睡眠时长需在 0 到 24 小时之间'; return; }
    saving = true;
    const mine = token;
    try {
      const entry = await saveEntry(data.date, clean, basedOn);
      if (disposed || mine !== token) return;
      data = { ...data, entry }; draft = draftOf(entry); base = draftOf(entry); basedOn = entry.updated_at; saved = '已保存'; onchanged?.();
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; }
      if (cause instanceof ActivityError && cause.code === 'ENTRY_CHANGED') conflict = true;
      saveError = cause instanceof Error ? cause.message : '保存失败，请重试';
    } finally { if (!disposed && mine === token) saving = false; }
  }
  function discard() { draft = { ...base }; saveError = ''; saved = ''; conflict = false; }
  async function removeEntry() {
    if (!data?.entry || removing) return;
    if (confirming !== 'entry') { confirming = 'entry'; return; }
    removing = true; saveError = '';
    const mine = token;
    try {
      await deleteEntry(data.date);
      if (disposed || mine !== token) return;
      data = { ...data, entry: null }; draft = emptyDraft(); base = emptyDraft(); basedOn = null; confirming = ''; saved = '已删除当天的状态记录'; onchanged?.();
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; }
      saveError = cause instanceof Error ? cause.message : '删除失败，请重试';
    } finally { if (!disposed && mine === token) removing = false; }
  }
  const reload = () => { void load(day); };
  const motionMs = (ms: number) => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

  // ---- doses ----
  const defaultTime = () => data && data.date === data.today ? localInput(new Date(), timezone) : `${data?.date ?? day}T08:00`;
  function openDose(dose?: Dose) {
    const trim = (n: number) => String(+n.toFixed(2));
    doseForm = dose
      // An old dose given only as an amount and unit keeps them; one with a pill count is edited by pills.
      ? { id: dose.id, medicationId: dose.medication_id, name: dose.medication_name, custom: !medications.some(m => m.id === dose.medication_id), pills: dose.pills === null ? '' : trim(dose.pills), keepAmount: dose.pills === null && dose.dose_amount !== null && dose.dose_unit ? { amount: dose.dose_amount, unit: dose.dose_unit } : null, time: localInput(dose.taken_at, timezone), regimen: dose.regimen, note: dose.note ?? '', effects: [], other: '' }
      : { id: null, medicationId: null, name: '', custom: false, pills: '', keepAmount: null, time: defaultTime(), regimen: 'scheduled', note: '', effects: [], other: '' };
    doseSnapshot = JSON.stringify(doseForm); eventError = '';
  }
  /** The listed medicine for the typed name (any case); its usual pills and type fill in when nothing was typed yet. */
  const known = (name: string) => medications.find(m => m.name.toLowerCase() === name.trim().toLowerCase());
  function suggest() {
    if (!doseForm || doseForm.id) return;
    const med = known(doseForm.name);
    doseForm.medicationId = med?.id ?? null;
    if (med && !doseForm.pills && med.default_pills !== null) { doseForm.pills = String(med.default_pills); doseForm.regimen = med.regimen; }
  }
  /** Choosing a listed medicine fills in its name, its usual pills and type (a new dose only). */
  function pickMed(form: DoseForm, med: Medication) {
    form.custom = false; form.medicationId = med.id; form.name = med.name;
    if (!form.id) { form.pills = med.default_pills === null ? '' : String(+med.default_pills.toFixed(2)); form.regimen = med.regimen; }
  }
  const countUnit = (form: { medicationId: string | null; name: string }) => (medications.find(m => m.id === form.medicationId) ?? known(form.name))?.count_unit ?? '颗';
  /** What the typed pill count comes to in milligrams, from the strength of one pill (display only; the server computes the stored amount). */
  function converted(form: { medicationId: string | null; name: string; pills: string }) {
    const med = medications.find(m => m.id === form.medicationId) ?? known(form.name), pills = Number(form.pills);
    return med && med.strength_amount !== null && Number.isFinite(pills) && pills > 0 ? `${+(pills * med.strength_amount).toFixed(3)} ${med.strength_unit}` : '';
  }
  async function submitDose(event: SubmitEvent) {
    event.preventDefault();
    if (!doseForm || eventBusy || !data) return;
    const form = doseForm, pills = Number(form.pills);
    if (!form.name.trim()) { eventError = medications.length && !form.custom ? '请先选择药物' : '请填写药物名称'; return; }
    if (!form.keepAmount && (!form.pills.trim() || !Number.isFinite(pills) || pills <= 0 || pills > 1000 || !/^\d+(\.\d{1,2})?$/.test(form.pills.trim()))) { eventError = `请填写吃了几${countUnit(form)}（大于 0，最多 2 位小数，半${countUnit(form)}填 0.5）`; return; }
    if (!form.time.startsWith(data.date)) { eventError = `服药时间需在 ${data.date} 当天`; return; }
    const other = form.other.trim(), names = [...form.effects, ...(other && !form.effects.some(n => n.toLowerCase() === other.toLowerCase()) ? [other] : [])];
    if (names.some(name => [...name].length > 40)) { eventError = '副作用名称最多 40 字'; return; }
    eventBusy = true; eventError = '';
    const mine = token;
    try {
      const draftDose = { medication_name: form.name.trim(), medication_id: form.medicationId, ...(form.keepAmount ? {} : { pills }), taken_at: instantFromLocal(form.time, timezone), regimen: form.regimen, note: form.note.trim() || null };
      const result = form.id ? await updateDose(form.id, draftDose) : await createDose(draftDose);
      if (disposed || mine !== token) return;
      doses = (form.id ? doses.map(d => d.id === result.id ? result : d) : [...doses, result]).filter(d => d.entry_date === data!.date).sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at));
      doseForm = null; onchanged?.();
      refreshLists();
      // The side effects written with the dose are recorded for the day, each on its own.
      for (const name of names) {
        const symptom = await createSymptom({ entry_date: data.date, symptom: name, onset_at: null, duration_minutes: null, affects_daily_life: null });
        if (disposed || mine !== token) return;
        symptoms = [...symptoms, symptom];
      }
      if (names.length) onchanged?.();
    } catch (cause) {
      if (disposed || mine !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; }
      eventError = cause instanceof Error ? cause.message : '保存失败，请重试';
    } finally { if (!disposed && mine === token) eventBusy = false; }
  }
  async function removeDose(dose: Dose) {
    if (eventBusy) return;
    if (confirming !== dose.id) { confirming = dose.id; return; }
    eventBusy = true; eventError = '';
    const mine = token;
    try { await deleteDose(dose.id); if (disposed || mine !== token) return; doses = doses.filter(d => d.id !== dose.id); confirming = ''; onchanged?.(); }
    catch (cause) { if (!disposed && mine === token) { if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; } eventError = cause instanceof Error ? cause.message : '删除失败，请重试'; } }
    finally { if (!disposed && mine === token) eventBusy = false; }
  }

  // ---- side effects ----
  async function removeSymptom(symptom: Symptom) {
    if (eventBusy) return;
    if (confirming !== symptom.id) { confirming = symptom.id; return; }
    eventBusy = true; eventError = '';
    const mine = token;
    try { await deleteSymptom(symptom.id); if (disposed || mine !== token) return; symptoms = symptoms.filter(s => s.id !== symptom.id); confirming = ''; onchanged?.(); }
    catch (cause) { if (!disposed && mine === token) { if (cause instanceof ActivityError && cause.status === 401) { fail401(); return; } eventError = cause instanceof Error ? cause.message : '删除失败，请重试'; } }
    finally { if (!disposed && mine === token) eventBusy = false; }
  }
</script>

<div class="editor" data-testid="wellbeing-editor" data-day={day} aria-busy={loading}>
  {#if loading && !data}<FeedbackState kind="loading" title="正在读取这一天的记录…" />{/if}
  {#if loadError}<div data-testid="wellbeing-load-error"><FeedbackState kind="error" title={loadError}><button type="button" class="button-secondary" onclick={reload} aria-label="重试读取这一天的记录">重试</button></FeedbackState></div>{/if}
  {#if data}
    <!-- The record fades in once it has been read, instead of popping in. -->
    <div class="day-body" in:fade={{ duration: motionMs(240) }}>
    <!-- The day and how much of it is recorded are read aloud (status role), not drawn: the page shows the widgets themselves. -->
    <h2 class="sr-only">{isToday ? '今天' : '日期'} {dateLabel(data.date)}</h2>
    <p class="sr-only" class:done={!!data.entry} role="status" data-testid="wellbeing-status">{status}</p>

    <!-- The day's answers are saved by the bar's button; the form is only its target, so the dose editor below may sit among the widgets (forms cannot nest). -->
    <form id={`${id}-day`} onsubmit={save} aria-busy={saving} novalidate></form>
    <div class="stack">
      <section class="widgets" aria-labelledby={`${id}-ratings`}>
        <h3 id={`${id}-ratings`}>今天的状态</h3>
        <!-- One widget per measure, each with its own colour and icon; sleep duration is a wide widget with two dials. -->
        <div class="tiles">
          {#each RATING_KEYS.filter(k => k !== 'sleep_quality') as key (key)}
            {@const meta = RATING_LABELS[key]}
            <WellbeingScale metric={key} label={meta.name} hint={meta.hint} low={meta.low} high={meta.high} bind:value={draft[key]} disabled={saving} />
          {/each}
          <WellbeingSleep bind:value={draft.sleep_hours} disabled={saving} />
          <WellbeingScale metric="sleep_quality" label={RATING_LABELS.sleep_quality.name} hint={RATING_LABELS.sleep_quality.hint} low={RATING_LABELS.sleep_quality.low} high={RATING_LABELS.sleep_quality.high} bind:value={draft.sleep_quality} disabled={saving} />
          <WellbeingTile metric="dose" title="今天吃的药" testid="wellbeing-doses">
            {#snippet actions()}
              <button type="button" class="icon add-dose" onclick={() => openDose()} data-testid="wellbeing-add-dose" aria-label="添加服药" title="添加服药"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
            {/snippet}
            <!-- A fixed-height list: more doses scroll inside the widget instead of making it taller than its neighbours. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="scroller" role="region" aria-label="今天的服药与副作用记录" tabindex="0" data-testid="wellbeing-dose-list">
            {#if doses.length}
              <ul class="rows">
                {#each doses as dose (dose.id)}
                  {@const unit = medications.find(m => m.id === dose.medication_id)?.count_unit ?? '颗'}
                  <li class="row-item" data-testid="wellbeing-dose">
                    <!-- Read aloud as one sentence; the columns beside it are for the eyes. -->
                    <span class="sr-only">{dose.medication_name} · {doseText(dose, unit)} · {dose.regimen === 'scheduled' ? '常规' : '按需'} · {timeLabel(dose.taken_at, timezone)}{#if dose.note} · {dose.note}{/if}</span>
                    <div class="dose" aria-hidden="true">
                      <div class="main">
                        <p class="line1"><strong>{dose.medication_name}</strong> <span class="amount">{dose.pills !== null ? `${+dose.pills.toFixed(2)} ${unit}` : `${dose.dose_amount} ${dose.dose_unit}`}</span></p>
                        <p class="line2"><span class="time">{timeLabel(dose.taken_at, timezone)}</span> · {#if dose.pills !== null && dose.dose_amount !== null}{+dose.dose_amount.toFixed(3)} {dose.dose_unit} · {/if}{dose.regimen === 'scheduled' ? '常规' : '按需'}{#if dose.note} · {dose.note}{/if}</p>
                      </div>
                    </div>
                    <div class="row-actions">
                      {#if confirming === dose.id}
                        <button type="button" class="mini danger-fill" disabled={eventBusy} onclick={() => { void removeDose(dose); }} aria-label={`确认删除 ${dose.medication_name} 服药记录`}>确认删除</button>
                        <button type="button" class="mini" onclick={() => { confirming = ''; }} aria-label="取消删除">取消</button>
                      {:else}
                        <button type="button" class="icon" disabled={eventBusy} onclick={() => openDose(dose)} aria-label={`编辑 ${dose.medication_name} 服药记录`} title="编辑"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button>
                        <button type="button" class="icon danger" disabled={eventBusy} onclick={() => { void removeDose(dose); }} aria-label={`删除 ${dose.medication_name} 服药记录`} title="删除"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}<p class="empty">这一天还没有服药记录，点标题右边的 + 添加。</p>{/if}
            {#if symptoms.length}
              <ul class="effects" aria-label="这一天记录的副作用" data-testid="wellbeing-symptoms">
                {#each symptoms as symptom (symptom.id)}
                  <li class="effect" data-testid="wellbeing-symptom"><span>{symptom.symptom}</span>
                    {#if confirming === symptom.id}
                      <button type="button" class="mini danger-fill" disabled={eventBusy} onclick={() => { void removeSymptom(symptom); }} aria-label={`确认删除 ${symptom.symptom} 记录`}>确认删除</button>
                      <button type="button" class="mini" onclick={() => { confirming = ''; }} aria-label="取消删除">取消</button>
                    {:else}
                      <button type="button" class="icon danger" disabled={eventBusy} onclick={() => { void removeSymptom(symptom); }} aria-label={`删除 ${symptom.symptom} 记录`} title="删除"><svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            </div>
          </WellbeingTile>
          <div class="note"><WellbeingTile metric="note" title="当日备注" subtitle="仅自己可见">
            <textarea class="text-field" rows="5" maxlength="2000" name="note" disabled={saving} placeholder="写点什么……" aria-label="当日备注" aria-describedby={`${id}-note-count`}
              value={draft.note ?? ''} oninput={(event) => { draft.note = event.currentTarget.value === '' ? null : event.currentTarget.value; }}></textarea>
            <span id={`${id}-note-count`} class="count">{(draft.note ?? '').length}/2000</span>
          </WellbeingTile></div>
        </div>
      </section>
    </div>

    <!-- Medication: ONE widget (in the grid, just before the note) holds the day's doses and side effects. Editing happens in place, inside the same widget. -->
    {#snippet doseEditor(form: DoseForm)}
      <form class="subform dialog-form" onsubmit={submitDose} aria-label={form.id ? '编辑服药记录' : '添加服药记录'} novalidate data-testid="wellbeing-dose-form">
        {#if medications.length}
          <fieldset class="chips" disabled={eventBusy} data-testid="wellbeing-dose-meds">
            <legend>选择药物</legend>
            {#each medications as med (med.id)}
              <button type="button" class="chip-button" aria-pressed={!form.custom && form.medicationId === med.id} onclick={() => pickMed(form, med)}>{med.name}</button>
            {/each}
            <span class="other" class:open={form.custom}>
              <button type="button" class="chip-button" inert={form.custom} onclick={() => { void openOther(form); }}>其他药物</button>
              <input bind:this={otherInput} class="text-field other-input" name="medication_name" aria-label="药物名称" placeholder="药物名称" maxlength="80" bind:value={form.name} onchange={suggest} onblur={() => { if (!form.name.trim()) form.custom = false; }} disabled={eventBusy} inert={!form.custom} required autocomplete="off" />
            </span>
          </fieldset>
        {/if}
        <div class="grid">
          {#if !medications.length}<p class="hint wide">还没有药物清单？到“药物”标签里添加一次，之后这里点选就行；现在可以直接输入药名。</p><label class="field wide">药物名称<input class="text-field" name="medication_name" maxlength="80" bind:value={form.name} onchange={suggest} disabled={eventBusy} required autocomplete="off" /></label>{/if}
          {#if !form.keepAmount}
            <label class="field"><span>吃了几{countUnit(form)}<span class="dim" data-testid="wellbeing-dose-converted">{#if converted(form)} · 约合 {converted(form)}{/if}</span></span><input class="text-field" name="pills" inputmode="decimal" bind:value={form.pills} disabled={eventBusy} required placeholder="例如 1，半{countUnit(form)}填 0.5" /></label>
          {/if}
          <label class="field">类型<select class="text-field" name="regimen" bind:value={form.regimen} disabled={eventBusy}><option value="scheduled">常规用药</option><option value="as_needed">按需用药</option></select></label>
          <label class="field wide">实际服药时间<input class="text-field" type="datetime-local" name="taken_at" min={`${data?.date}T00:00`} max={`${data?.date}T23:59`} bind:value={form.time} disabled={eventBusy} required /></label>
          <label class="field wide">备注（可选）<input class="text-field" name="note" maxlength="500" bind:value={form.note} disabled={eventBusy} /></label>
        </div>
        {#if form.keepAmount}<p class="hint">这条是早先按“剂量 + 单位”记下的（{doseText({ dose_amount: form.keepAmount.amount, dose_unit: form.keepAmount.unit })}），保持不变；可以改时间、类型或备注。</p>{/if}
        <fieldset class="chips" disabled={eventBusy} data-testid="wellbeing-effect-chips">
          <legend>副作用（可选，点选）</legend>
          {#each effectChoices(form) as name (name)}
            <button type="button" class="chip-button" aria-pressed={form.effects.includes(name)} onclick={() => { form.effects = form.effects.includes(name) ? form.effects.filter(n => n !== name) : [...form.effects, name]; }}>{name}</button>
          {/each}
        </fieldset>
        <div class="grid">
          <label class="field wide">其他副作用（可选）<input class="text-field" name="other_effect" maxlength="40" bind:value={form.other} disabled={eventBusy} autocomplete="off" /></label>
        </div>
        <div class="buttons"><button type="submit" class="button-primary" disabled={eventBusy}>{eventBusy ? '保存中…' : form.id ? '保存修改' : '保存服药'}</button><button type="button" class="button-secondary" disabled={eventBusy} onclick={() => { doseForm = null; eventError = ''; }}>取消</button></div>
      </form>
    {/snippet}
    <WellbeingDialog open={!!doseForm} labelledby={`${id}-dose-title`} busy={eventBusy} onclose={() => { if (doseForm) { doseForm = null; eventError = ''; } }}>
      {#if dialogForm}
        <h2 id={`${id}-dose-title`} class="dialog-title">{dialogForm.id ? '编辑服药记录' : '添加服药记录'}</h2>
        {@render doseEditor(dialogForm)}
        {#if eventError}<div data-testid="wellbeing-event-error"><FeedbackState kind="error" title={eventError} /></div>{/if}
      {/if}
    </WellbeingDialog>
    {#if eventError && !doseForm}<div data-testid="wellbeing-event-error"><FeedbackState kind="error" title={eventError} /></div>{/if}

    {#if conflict}
      <div data-testid="wellbeing-conflict"><FeedbackState kind="error" title="这一天的记录已在其他页面或设备更新，为避免覆盖，没有保存。">
        <p>点击“重新读取”会载入最新内容，你刚才填写的状态会被替换；需要的话请先把内容复制下来。</p>
        <button type="button" class="button-secondary" onclick={reload}>重新读取</button>
      </FeedbackState></div>
    {/if}
    {#if data.entry}
      <p class="remove-row"><button type="button" class="button-secondary danger" disabled={removing || saving} onclick={() => { void removeEntry(); }} data-testid="wellbeing-delete-entry">{confirming === 'entry' ? '确认删除当天状态记录' : '删除当天状态记录'}</button>{#if confirming === 'entry'}<button type="button" class="link" onclick={() => { confirming = ''; }}>取消</button>{/if}<span class="hint">只删除上方的状态评分、睡眠与备注，服药和副作用保留。</span></p>
    {/if}
    <SaveBar glass form={`${id}-day`} {dirty} busy={saving} message={saved} error={conflict ? '' : saveError} label={isToday ? '保存今日状态' : '保存这一天'} ondiscard={discard} />
    </div>
  {/if}
</div>

<style>
  .editor, .stack, .day-body { display: grid; gap: var(--space-3); min-width: 0; }
  /* The save bar is as wide as one widget column (the same breakpoints as the grid below), so it lines up with the last column of widgets. */
  .editor { --save-min: 100%; }
  @media (min-width: 480px) { .editor { --save-min: calc((100% - var(--space-3)) / 2); } }
  @media (min-width: 900px) { .editor { --save-min: calc((100% - 2 * var(--space-4)) / 3); } }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  h3 { font-size: var(--text-body); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .hint { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  /* The widgets stand on the page by themselves, with only a small heading; no box around the group. */
  .widgets { display: grid; gap: var(--space-2); min-width: 0; }
  .widgets h3 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* The note is a widget of the same size as the others; its box fills the card. */
  /* The medication widget: a list of rows (time, medicine, amount, type), edited in place. */
  .rows, .effects { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  /* The medication widget lists its doses from the top down, each one a capsule: a tinted pill with the time, medicine, amount and type, and the edit and delete buttons at its end. */
  .tiles :global([data-metric='dose']) { align-content: start; }
  .scroller { display: grid; align-content: start; gap: var(--space-2); max-height: 10.5rem; overflow-y: auto; overscroll-behavior: contain; padding: 1px; margin: -1px; }
  .scroller:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: var(--radius-control); }
  .row-item { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4); border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border)); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--tone) 14%, var(--surface)); }
  /* Time, then the medicine and amount on one line and the details beneath, each cut with an ellipsis rather than wrapping: the capsule stays slim in a narrow widget. */
  .dose { display: grid; flex: 1; min-width: 0; }
  .dose .time { color: var(--tone); font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }
  .dose .main { display: grid; min-width: 0; line-height: var(--line-height-heading); }
  .dose .main p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dose .line1 strong { font-size: var(--text-body); font-weight: var(--weight-semibold); }
  .dose .line1 .amount { font-size: var(--text-body); font-variant-numeric: tabular-nums; }
  .dose .line2 { color: var(--muted-foreground); font-size: var(--text-caption); }
  .row-item .icon, .row-item .mini { height: 2rem; }
  .row-item .icon { width: 2rem; }
  .row-actions { display: flex; flex: none; align-items: center; gap: var(--space-1); }
  .effects { padding-top: var(--space-2); border-top: 1px solid var(--border); }
  .effect { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-small); }
  /* The small round + beside the widget's name; its hit area is padded out to a finger. */
  .add-dose { color: var(--tone); }
  .icon, .mini { display: grid; place-items: center; position: relative; min-height: 0; height: 2.25rem; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); color: var(--muted-foreground); cursor: pointer; }
  .icon { width: 2.25rem; }
  .icon::after, .mini::after { content: ''; position: absolute; inset: -.25rem; }
  .mini { padding-inline: var(--space-2); font-size: var(--text-caption); }
  .icon.danger:hover, .icon.danger:focus-visible { color: var(--error); }
  .danger-fill { border-color: var(--error); background: var(--error); color: var(--surface); }
  .icon:focus-visible, .mini:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
    .tiles .note { min-width: 0; display: grid; }
  .tiles .note :global(.body) { grid-template-rows: 1fr auto; height: 100%; }
  .tiles .note textarea { min-height: 10rem; height: 100%; resize: none; }
  .tiles .count { justify-self: end; color: var(--muted-foreground); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
  /* Three widgets to a row, always: each is wide enough for its dial, whatever the screen. Narrower screens drop to two, then one. */
  .tiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  @media (min-width: 480px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 900px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); } }
  .field { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--text-small); font-weight: var(--weight-semibold); }
  /* The dose form packs its fields into one grid: name and note are wide, the rest sit beside each other. */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.75rem, 1fr)); gap: var(--space-2) var(--space-3); align-items: end; }
  .grid .wide { grid-column: span 2; }
  @media (max-width: 400px) { .grid { grid-template-columns: minmax(0, 1fr); } .grid .wide { grid-column: 1 / -1; } }
  .link { padding: 0; border: 0; background: none; color: var(--primary); font-size: var(--text-small); text-decoration: underline; cursor: pointer; }
  .empty { color: var(--muted-foreground); font-size: var(--text-small); }
  /* "其他药物" widens to the right into a text field where the chip stood, and shrinks back into the chip. */
  .other { display: inline-grid; width: 5.75rem; max-width: 100%; transition: width var(--motion-popover-exit-duration) var(--motion-popover-exit-ease); }
  .other.open { width: 13rem; transition-duration: var(--motion-popover-enter-duration); transition-timing-function: var(--motion-popover-enter-ease); }
  .other > * { grid-area: 1 / 1; min-width: 0; transition: opacity 160ms ease; }
  .other > .chip-button { width: 100%; padding-inline: 0; }
  .other > .other-input { min-height: 2.5rem; }
  .other:not(.open) > .other-input, .other.open > .chip-button { opacity: 0; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .other, .other > * { transition: none; } }
  .dialog-title { margin-bottom: var(--space-3); font-size: var(--text-section); font-weight: var(--weight-semibold); }
  .subform.dialog-form { padding: 0; border: 0; background: none; }
  .subform { display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; border: 0; }
  .chips legend { width: 100%; margin-bottom: var(--space-2); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .chip-button { min-height: 2.5rem; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); font-size: var(--text-small); cursor: pointer; }
  /* The global glass button material would wash a filled state out, so the chosen chip is marked by an outline and a tint that win over it. */
  .chip-button[aria-pressed='true'] { border-color: var(--primary); background: var(--primary-soft) !important; color: var(--primary) !important; box-shadow: inset 0 0 0 1.5px var(--primary) !important; font-weight: var(--weight-semibold); }
  .chip-button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .buttons { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .dim { color: var(--muted-foreground); font-weight: var(--weight-regular); }
  .danger { color: var(--error); }
  .remove-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
</style>
