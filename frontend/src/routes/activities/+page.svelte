<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readActivities = view.bind(scoped_readActivities, 0);
  const readActivity = view.bind(scoped_readActivity, 1);
  const uploadGpx = view.bind(scoped_uploadGpx, 1);
  const uploadTcx = view.bind(scoped_uploadTcx, 1);
  const deleteActivities = view.bind(scoped_deleteActivities, 1);

  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import ActivityTimeline from '#lib/components/ActivityTimeline.svelte';
  import ActivityPreview from '#lib/components/ActivityPreview.svelte';
  import ActivityViews from '#lib/components/ActivityViews.svelte';
  import { page } from '$app/state';
  import { onMount, tick, untrack } from 'svelte';
  import { replaceState, snapshot } from '$app/navigation';
  import ActivityEditor from '#lib/components/ActivityEditor.svelte';
  import MifitnessImport from '#lib/components/MifitnessImport.svelte';
  import ImportBatchPanel from '#lib/components/ImportBatchPanel.svelte';
  import { createItems, detectBatchFormat, runImportQueue, type ImportItem } from '#lib/import-queue.ts';
  import { ActivityError, deleteActivities as scoped_deleteActivities, readActivities as scoped_readActivities, readActivity as scoped_readActivity, uploadGpx as scoped_uploadGpx, uploadTcx as scoped_uploadTcx, warningLabel, type Activity, type ActivityList } from '#lib/api/activities.ts';
  let records = $state<ActivityList | null>(null), loading = $state(true), busy = $state(false), mounted = $state(false), disposed = false;
  let message = $state(''), listMessage = $state(''), duplicateId = $state<string | null>(null), successId = $state<string | null>(null), warnings = $state<string[]>([]);
  let importFormat = $state<'gpx' | 'tcx'>('gpx'), timeMode = $state('absolute');
  let fileInput = $state<HTMLInputElement>(null!), picked = $state<File | null>(null), dragging = $state(false), title = $state(''), timezone = $state(''), activityDate = $state('');
  let pickedFiles = $state<File[]>([]), batchItems = $state<ImportItem[]>([]), batchRunning = $state(false);
  let batchController: AbortController | undefined;
  const multi = $derived(pickedFiles.length > 1);
  let selected = $state<string[]>([]), editActivity = $state<Activity | null>(null), deleteIds = $state<string[]>([]);
  let editMode = $state(false);
  // Desktop shows a second pane with the chosen record's map and details; narrower screens keep the timeline alone and open the detail page.
  let wide = $state(false), importOpen = $state(false), currentId = $state<string | null>(null);
  let saving = $state(false), deleting = $state(false), deleteError = $state(''), lastOffset = $state(0);
  let editDialog = $state<HTMLDialogElement>(null!), deleteDialog = $state<HTMLDialogElement>(null!), recordsHeading: HTMLHeadingElement;
  let returnFocus: HTMLElement | null = null;
  let listRequest = 0;
  snapshot({
    capture: () => lastOffset,
    restore: offset => {
      lastOffset = offset;
      if (mounted && !disposed) void load(offset);
    }
  });
  const managing = $derived(saving || deleting);
  let mifitnessBusy = $state(false);
  const controlsBusy = $derived(busy || managing || mifitnessBusy);
  const allSelected = $derived(!!records?.items.length && selected.length === records.items.length);
  const currentActivity = $derived(records?.items.find(item => item.id === currentId) ?? null);
  // The address carries ?id= so a refresh, Back or a shared link returns to the same record; an id that is not on this page falls back to the first record.
  function syncCurrent(list: ActivityList) {
    const wanted = new URL(window.location.href).searchParams.get('id');
    currentId = list.items.find(item => item.id === wanted)?.id ?? list.items[0]?.id ?? null;
  }
  $effect(() => {
    const id = currentId;
    // Not before the list is loaded: an id from the address must survive until syncCurrent has read it.
    if (!mounted || !wide || !records) return;
    untrack(() => {
      const url = new URL(window.location.href);
      if (id) { if (url.searchParams.get('id') === id) return; url.searchParams.set('id', id); }
      else { if (!url.searchParams.has('id')) return; url.searchParams.delete('id'); }
      replaceState(url, page.state);
    });
  });
  function openRecord(activity: Activity, event: MouseEvent) {
    if (!wide || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); currentId = activity.id;
  }
  function moveCurrent(event: KeyboardEvent) {
    if (!wide || !records || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !(event.target instanceof Element) || !event.target.closest('.card-link')) return;
    const index = records.items.findIndex(item => item.id === currentId), next = records.items[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault(); currentId = next.id;
    void tick().then(() => document.querySelector<HTMLElement>(`.card-link[data-activity-id="${next.id}"]`)?.focus());
  }
  // Keep the import area open whenever something is going on or has something to say.
  $effect(() => { if (view.manage && records?.total === 0) importOpen = true; });
  $effect(() => { if (busy || batchRunning || mifitnessBusy || message || successId || warnings.length || batchItems.length) importOpen = true; });
  function toggleEditMode() {
    if (!view.manage || controlsBusy || loading) return;
    selected = []; editMode = !editMode;
  }
  function select(id: string, checked: boolean) {
    if (controlsBusy || !editMode) return;
    selected = checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id);
  }
  function formatSize(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`; }
  function pickChanged() {
    pickedFiles = Array.from(fileInput.files ?? []);
    picked = pickedFiles[0] ?? null;
    batchItems = [];
    if (pickedFiles.length > 1) {
      const detected = detectBatchFormat(pickedFiles);
      if (detected.ok) { importFormat = detected.format; message = ''; } else message = detected.message;
    } else {
      const extension = picked?.name.split('.').at(-1)?.toLowerCase();
      if (extension === 'tcx' || extension === 'gpx') importFormat = extension;
    }
    timeMode = 'absolute';
  }
  function dropFile(event: DragEvent) {
    event.preventDefault(); dragging = false;
    const files = event.dataTransfer?.files;
    if (controlsBusy || !mounted || !files?.length) return;
    fileInput.files = files; pickChanged();
  }
  function rememberFocus() { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; }
  async function restoreFocus() {
    await tick();
    if (returnFocus?.isConnected) returnFocus.focus();
    else recordsHeading?.focus();
  }
  async function edit(activity: Activity) {
    if (controlsBusy) return;
    rememberFocus();
    try { const value = await readActivity(activity.id, fetch, true); if (disposed) return; editActivity = value; }
    catch (cause) { if (!disposed) fail(cause, 'list'); return; }
    await tick(); if (!disposed) editDialog.showModal();
  }
  function cancelEdit() {
    if (saving) return;
    editDialog.close(); editActivity = null; void restoreFocus();
  }
  function updated(value: Activity) {
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
    if (records) records = { ...records, items: records.items.map(item => item.id === value.id ? value : item) };
    saving = false; cancelEdit();
  }
  function confirmDelete(ids: string[]) {
    if (controlsBusy || !ids.length) return;
    rememberFocus(); deleteIds = [...ids]; deleteError = ''; deleteDialog.showModal();
  }
  function cancelDelete() {
    if (deleting) return;
    deleteDialog.close(); deleteIds = []; deleteError = ''; void restoreFocus();
  }
  async function remove() {
    if (controlsBusy || !deleteIds.length) return;
    deleting = true; deleteError = '';
    try {
      await deleteActivities(deleteIds);
      window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
      if (disposed) return;
    } catch (cause) {
      if (!disposed) {
        if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/admin?reason=expired&next=%2Factivities');
        deleteError = cause instanceof Error ? cause.message : '删除失败，请重试'; deleting = false;
      }
      return;
    }
    // The mutation succeeded. A subsequent list failure must only retry the read.
    deleteDialog.close(); deleteIds = []; selected = [];
    await load(lastOffset);
    if (!disposed) { deleting = false; void restoreFocus(); }
  }

  function fail(cause: unknown, target: 'upload' | 'list' = 'upload') {
    if (cause instanceof ActivityError && cause.status === 401) {
      records = null; message = ''; listMessage = ''; duplicateId = null; successId = null; warnings = []; window.location.replace('/admin?reason=expired&next=%2Factivities'); return;
    }
    const text = cause instanceof Error ? cause.message : '请求失败，请重试';
    if (target === 'list') listMessage = text;
    else { message = text; duplicateId = cause instanceof ActivityError ? cause.existingActivityId : null; }
  }
  async function load(offset = 0) {
    const request = ++listRequest;
    lastOffset = offset; selected = []; loading = true; records = null; listMessage = '';
    try {
      let result = await readActivities(fetch, offset);
      if (disposed || request !== listRequest) return;
      if (!result.items.length && offset > 0) {
        const clamped = Math.max(0, Math.floor((result.total - 1) / 20) * 20);
        lastOffset = clamped; result = await readActivities(fetch, clamped);
      }
      if (!disposed && request === listRequest) { records = result; syncCurrent(result); if (!result.items.length) editMode = false; }
    } catch (cause) { if (!disposed && request === listRequest) fail(cause, 'list'); }
    finally { if (!disposed && request === listRequest) loading = false; }
  }
  async function runBatch(retry = false) {
    const detected = detectBatchFormat(retry ? batchItems.map(item => item.file) : pickedFiles);
    if (!detected.ok) { message = detected.message; return; }
    const format = detected.format, mode = timeMode, zone = timezone.trim();
    const upload = format === 'tcx' ? uploadTcx : uploadGpx;
    const items = retry
      ? batchItems.map(item => (item.status === 'failed' ? { ...item, status: 'pending' as const, message: '' } : item))
      : createItems(pickedFiles);
    batchController = new AbortController();
    busy = true; batchRunning = true; batchItems = items;
    let authExpired = false;
    try {
      const outcome = await runImportQueue(items, {
        signal: batchController.signal,
        onupdate: next => { if (!disposed) batchItems = next; },
        importOne: async file => {
          const form = new FormData(); form.append('file', file);
          if (zone) form.append('timezone', zone);
          if (format === 'tcx') form.append('time_mode', mode);
          const result = await upload(form);
          return { warnings: result.warnings };
        }
      });
      authExpired = outcome.authExpired;
    } finally { if (!disposed) { busy = false; batchRunning = false; } }
    if (disposed) return;
    // One refresh for the whole batch instead of one per file.
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
    if (authExpired) { fail(new ActivityError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED')); return; }
    fileInput.value = ''; picked = null; pickedFiles = [];
    await load();
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (controlsBusy || !mounted) return;
    message = ''; duplicateId = null; successId = null; warnings = [];
    if (pickedFiles.length > 1) { await runBatch(); return; }
    const file = fileInput.files?.[0];
    if (!file || fileInput.files?.length !== 1) { message = '请选择一个 GPX 或 TCX 文件'; return; }
    if (file.size > 10 * 1024 * 1024) { message = '轨迹文件不能超过 10 MiB'; return; }
    const form = new FormData(); form.append('file', file);
    if (title.trim()) form.append('title', title.trim()); if (timezone.trim()) form.append('timezone', timezone.trim()); if (activityDate) form.append('activity_date', activityDate);
    if (importFormat === 'tcx') form.append('time_mode', timeMode);
    busy = true;
    try {
      const result = await (importFormat === 'tcx' ? uploadTcx(form) : uploadGpx(form));
      window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
      if (disposed) return;
      successId = result.activity.id; warnings = result.warnings; fileInput.value = ''; picked = null; title = ''; activityDate = ''; timeMode = 'absolute';
      await load();
    } catch (cause) { if (!disposed) fail(cause); }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => {
    mounted = true; void load(lastOffset);
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => { wide = media.matches; };
    update(); media.addEventListener('change', update);
    return () => { disposed = true; ++listRequest; batchController?.abort(); media.removeEventListener('change', update); };
  });
</script>
<svelte:head><title>{pageTitle('跑步记录', page.data.site)}</title></svelte:head>
<PageHeader title="跑步记录" description="每一次跑步，都值得留下。导入 GPX 或 TCX，回顾你的轨迹与运动表现。">{#snippet footer()}<ActivityViews current="list" />{/snippet}</PageHeader>
<section class="mt-8" aria-labelledby="records-title">
  <div class="flex flex-wrap items-baseline justify-between gap-3"><h2 bind:this={recordsHeading} tabindex="-1" id="records-title" class="text-xl font-semibold">我的活动{records ? `（${records.total}）` : ''}</h2><div class="records-heading-actions">{#if view.manage}<button type="button" class="button-secondary import-toggle" aria-expanded={importOpen} aria-controls="import-region" onclick={() => { importOpen = !importOpen; }}>导入轨迹<svg class="import-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button><button class="button-secondary" aria-pressed={editMode} disabled={controlsBusy || loading || !records?.items.length} onclick={toggleEditMode}>{editMode ? '完成' : '编辑'}</button>{/if}</div></div>
  {#if view.manage}<div id="import-region" class="import-fold" class:open={importOpen} inert={!importOpen}><div class="import-fold-inner">
<section class="import-card" aria-labelledby="import-title">
  <div class="import-head"><h2 id="import-title">导入 GPX / TCX</h2><span id="gpx-help" class="import-note">导入后记录与完整轨迹公开展示，私人备注和源文件不公开</span></div>
  <form method="POST" enctype="multipart/form-data" onsubmit={submit} aria-busy={busy}>
    <div class="upload-primary">
      <label class="file-pick" data-filled={picked ? 'true' : 'false'} data-dragging={dragging} ondragover={event => { event.preventDefault(); if (!controlsBusy && mounted) dragging = true; }} ondragleave={() => { dragging = false; }} ondrop={dropFile}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
        <input bind:this={fileInput} class="sr-only" type="file" name="file" multiple onchange={pickChanged} accept=".gpx,.tcx,application/gpx+xml,application/xml,text/xml" required disabled={controlsBusy || !mounted} aria-describedby="gpx-help" />
        <span class="file-pick-text">
          {#if multi}<span class="file-pick-title">已选择 {pickedFiles.length} 个文件</span><span class="file-pick-hint">{formatSize(pickedFiles.reduce((sum, f) => sum + f.size, 0))} · 依次导入，点击或拖入可更换</span>
          {:else if picked}<span class="file-pick-title">{picked.name}</span><span class="file-pick-hint">{formatSize(picked.size)} · 点击或拖入可更换</span>
          {:else}<span class="file-pick-title">选择或拖入轨迹文件</span><span class="file-pick-hint">GPX / TCX · 可多选，单个最大 10 MiB</span>{/if}
        </span>
        {#if picked}<span class="file-pick-tag">{importFormat.toUpperCase()}</span>{/if}
      </label>
      <button disabled={controlsBusy || !mounted} class="rounded bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? (batchRunning ? '正在批量导入…' : '正在解析与保存…') : multi ? `导入 ${pickedFiles.length} 个 ${importFormat.toUpperCase()}` : `导入 ${importFormat.toUpperCase()}`}</button>
    </div>
    <div class="import-meta">
      <label class="import-format text-sm font-medium">文件格式<select aria-label="文件格式" bind:value={importFormat} onchange={() => { timeMode = 'absolute'; }} disabled={controlsBusy || !mounted || multi} class="rounded border border-border bg-background p-2"><option value="gpx">GPX</option><option value="tcx">TCX</option></select></label>
      {#if importFormat === 'tcx'}
        <label class="import-time text-sm font-medium">时间解释<select aria-label="时间解释" bind:value={timeMode} disabled={controlsBusy || !mounted} aria-describedby="tcx-time-help" class="rounded border border-border bg-background p-2"><option value="absolute">遵守文件时区（默认）</option><option value="local">按当地时间解释（修正误标 UTC）</option></select></label>
      {/if}
    </div>
    {#if importFormat === 'tcx'}<p id="tcx-time-help" class="import-help">如果导出时间错误标记为 UTC，可选择按账户时区或下方指定时区解释。例如文件写 16:15Z，但实际是北京时间下午 16:15。选择此项会修正整条轨迹的时间。</p>{/if}
    <details class="import-options">
      <summary>补充导入信息</summary>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-sm">标题（可选）<input bind:value={title} name="title" maxlength="120" disabled={controlsBusy || !mounted || multi} class="mt-1 block w-full rounded border border-border p-2" placeholder="例如：周末晨跑" /></label>
        <label class="text-sm">时区（可选）<input bind:value={timezone} name="timezone" disabled={controlsBusy || !mounted} class="mt-1 block w-full rounded border border-border p-2" placeholder="例如：Asia/Shanghai" /></label>
        <label class="text-sm">补录日期（可选）<input bind:value={activityDate} name="activity_date" type="date" disabled={controlsBusy || !mounted || multi} aria-describedby="import-date-help" class="mt-1 block w-full rounded border border-border p-2" /></label>
        {#if multi}<p class="import-help sm:col-span-2">批量导入时标题和补录日期不可用，沿用文件里的信息；时区仍会应用到每个文件。</p>{/if}
        <p id="import-date-help" class="import-help self-end">未指定时区时使用账户时区。缺失时间的轨迹可补录日期；日期与轨迹时间冲突时会提示。</p>
      </div>
    </details>
  </form>
  {#if busy && !batchRunning}<div class="mt-4"><FeedbackState kind="loading" title="正在上传、解析并保存"><p>较大文件可能需要数十秒，请勿重复提交。</p></FeedbackState></div>{/if}
  {#if batchItems.length}<ImportBatchPanel items={batchItems} running={batchRunning} onstop={() => batchController?.abort()} onretry={() => void runBatch(true)} />{/if}
  {#if message}<div class="mt-4"><FeedbackState kind="error" title={message}>{#if duplicateId}<a href={view.href(`/activities/${duplicateId}`)} class="text-primary underline">查看已有活动</a>{:else}<p>可以重试当前文件；若格式有误，请选择修正后的 GPX 或 TCX。</p>{/if}</FeedbackState></div>{/if}
  {#if successId}<div class="mt-4"><FeedbackState kind="success" title="导入成功。"><a href={view.href(`/activities/${successId}`)} class="text-primary underline">查看活动与路线</a><span aria-hidden="true"> · </span><a href={view.href("/activities/wall")}  class="text-primary underline">足迹卡片已生成，查看足迹墙</a></FeedbackState></div>{/if}
  {#if warnings.length}<div class="import-warnings"><p class="font-medium">导入完成，部分数据需要留意</p><ul class="mt-2 list-inside list-disc text-sm">{#each warnings as warning}<li>{warningLabel(warning)}</li>{/each}</ul></div>{/if}
</section>
<MifitnessImport disabled={busy || managing} onbusy={value => { mifitnessBusy = value; }} onimported={() => { window.dispatchEvent(new CustomEvent('runnote-activities-changed')); void load(); }} onauthrequired={cause => fail(cause)} />
</div></div>{/if}
  {#if loading}<div class="mt-4"><PageSkeleton title="正在读取活动…" /></div>
  {:else if records}
    <div class="content-reveal">
    {#if !records.items.length}<div class="mt-4"><FeedbackState kind="empty" title="暂无跑步记录。"><p>{view.manage ? '选择上方文件并导入，开始积累跑步记录。' : '这里将展示站主的运动记录。'}</p></FeedbackState></div>
    {:else}
      <div class="records-layout" class:two-pane={wide && currentActivity}>
        <div class="records-list" role="presentation" onkeydown={moveCurrent}>
          {#if editMode}<div class="selection-toolbar" aria-label="批量管理记录">
            <label><input type="checkbox" aria-label="全选本页" checked={allSelected} indeterminate={selected.length > 0 && !allSelected} disabled={controlsBusy} onchange={event => selected = event.currentTarget.checked ? records!.items.map(item => item.id) : []} />全选本页</label>
            <span class="selected-count" aria-live="polite">已选 {selected.length} 条</span>
            <button class="button-secondary" disabled={!selected.length || controlsBusy} onclick={() => selected = []}>清除选择</button>
            <button class="delete-button" disabled={!selected.length || controlsBusy} onclick={() => confirmDelete(selected)}>删除所选</button>
          </div>{/if}
          <ActivityTimeline items={records.items} offset={records.offset} total={records.total} {editMode} selectedIds={selected} disabled={controlsBusy} currentId={wide ? currentId : null}
            onselect={select} onedit={activity => void edit(activity)} ondelete={activity => confirmDelete([activity.id])} onopen={openRecord} />
        </div>
        {#if wide && currentActivity}<aside class="records-preview" aria-label="记录预览"><ActivityPreview activity={currentActivity} manage={view.manage} busy={controlsBusy} onedit={() => void edit(currentActivity!)} ondelete={() => confirmDelete([currentActivity!.id])} /></aside>{/if}
      </div>
    {/if}
    {#if records.total > 0}<div class="pagination"><button disabled={records.offset === 0 || controlsBusy} onclick={() => { void load(Math.max(0, records!.offset - 20)); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">上一页</button><span class="text-sm text-muted-foreground">第 {Math.floor(records.offset / 20) + 1} 页 / {Math.ceil(records.total / 20)} 页</span><button disabled={records.offset + records.items.length >= records.total || controlsBusy} onclick={() => { void load(records!.offset + 20); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">下一页</button></div>{/if}
    </div>
  {:else if listMessage}<div class="mt-4"><FeedbackState kind="error" title={listMessage}><button onclick={() => void load(lastOffset)} class="button-secondary">重新读取活动</button></FeedbackState></div>{/if}
</section>
{#if view.manage}
<dialog bind:this={editDialog} aria-labelledby="edit-record-title" oncancel={event => { event.preventDefault(); cancelEdit(); }}>
  <h2 id="edit-record-title" class="text-xl font-semibold">编辑跑步记录</h2>
  {#if editActivity}<ActivityEditor activity={editActivity} onupdated={updated} oncancel={cancelEdit} onbusychange={value => saving = value} />{/if}
</dialog>
<dialog bind:this={deleteDialog} aria-labelledby="delete-records-title" aria-describedby="delete-records-hint" oncancel={event => { event.preventDefault(); cancelDelete(); }}>
  <h2 id="delete-records-title" class="text-xl font-semibold">删除 {deleteIds.length} 条跑步记录？</h2>
  <p id="delete-records-hint" class="dialog-hint">所选记录、关联轨迹和导入文件将永久删除，分享链接随之失效。此操作无法撤销。</p>
  {#if deleteError}<FeedbackState kind="error" title={deleteError} />{/if}
  <div class="dialog-buttons"><button class="button-secondary" disabled={deleting} onclick={cancelDelete}>取消</button><button class="delete-confirm" disabled={deleting} onclick={() => void remove()}>{deleting ? '删除中…' : '确认删除'}</button></div>
</dialog>
{/if}
<style>
  .records-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
  .selection-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; padding: 1rem; margin-top: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .selection-toolbar label { display: flex; align-items: center; gap: .5rem; min-height: 2.75rem; font-size: var(--text-small); }
  .selection-toolbar input { width: 1.125rem; height: 1.125rem; accent-color: var(--primary); }
  .selected-count { flex: 1; color: var(--muted-foreground); white-space: nowrap; font-size: var(--text-small); }
  .delete-button, .delete-confirm { padding: .625rem .875rem; border-radius: .75rem; font-size: var(--text-small); font-weight: var(--weight-semibold); color: var(--error); border: 1px solid var(--border); }
  .delete-confirm { background: var(--error); color: white; border-color: var(--error); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  dialog { margin: auto; width: min(34rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--foreground); }
  dialog::backdrop { background: rgb(0 0 0 / .5); }
  .dialog-hint { margin-top: 1rem; color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .dialog-buttons { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: flex-end; margin-top: 1.5rem; }
  .import-card { margin-top: var(--space-6); padding: var(--space-4) var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .import-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-4); margin-bottom: var(--space-3); }
  .import-head h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); }
  .import-note, .import-help { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .import-help { margin-top: var(--space-2); }
  .upload-primary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: var(--space-3); }
  .import-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-6); margin-top: var(--space-3); }
  .import-format, .import-time { display: flex; width: fit-content; max-width: 100%; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .import-options { margin-top: var(--space-3); }
  summary { width: fit-content; color: var(--primary); font-size: var(--text-small); font-weight: var(--weight-semibold); cursor: pointer; }
  .import-warnings { margin-top: var(--space-4); padding: var(--space-4); background: var(--warning-soft); color: var(--warning); border: 1px solid var(--warning-border); border-radius: var(--radius-control); }
  .import-toggle { gap: var(--space-2); }
  .import-chevron { flex: none; transition: transform 320ms var(--ease-out, cubic-bezier(.2,.8,.2,1)); }
  .import-toggle[aria-expanded="true"] .import-chevron { transform: rotate(180deg); }
  /* The import area opens and closes by height: the grid row goes 0fr <-> 1fr, so the list below slides with it. Closed it is also invisible and inert, so nothing in it can be focused. */
  .import-fold { display: grid; grid-template-rows: 0fr; visibility: hidden; opacity: 0; transition: grid-template-rows 420ms cubic-bezier(.4, 0, .2, 1), opacity 260ms ease-in, visibility 0s linear 420ms; }
  .import-fold.open { grid-template-rows: 1fr; visibility: visible; opacity: 1; transition: grid-template-rows 420ms cubic-bezier(.2, .8, .2, 1), opacity 320ms ease-out 60ms, visibility 0s; }
  .import-fold-inner { min-height: 0; overflow: hidden; margin: -.25rem; padding: .25rem; }
  @media (prefers-reduced-motion: reduce) { .import-fold, .import-fold.open, .import-chevron { transition: none; } }
  .records-layout { margin-top: var(--space-4); min-width: 0; }
  .records-layout.two-pane { display: grid; grid-template-columns: minmax(0, 26rem) minmax(0, 1fr); align-items: start; gap: var(--space-6); }
  .records-list { min-width: 0; }
  .two-pane .records-list { padding-top: calc(var(--space-4) + 1px); }
  .records-preview { position: sticky; top: calc(var(--top-navigation-offset) + var(--top-navigation-height) + var(--space-4)); min-width: 0; }
  .pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-3); margin-top: var(--space-6); }
  @media (max-width: 639px) { .import-card { padding: var(--space-3) var(--space-4); } .upload-primary { grid-template-columns: 1fr; } .upload-primary button { width: 100%; } }
</style>
