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
  import ActivityCard from '#lib/components/ActivityCard.svelte';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { snapshot } from '$app/navigation';
  import ActivityEditor from '#lib/components/ActivityEditor.svelte';
  import MifitnessImport from '#lib/components/MifitnessImport.svelte';
  import { ActivityError, deleteActivities as scoped_deleteActivities, readActivities as scoped_readActivities, readActivity as scoped_readActivity, uploadGpx as scoped_uploadGpx, uploadTcx as scoped_uploadTcx, warningLabel, type Activity, type ActivityList } from '#lib/api/activities.ts';
  let records = $state<ActivityList | null>(null), loading = $state(true), busy = $state(false), mounted = $state(false), disposed = false;
  let message = $state(''), listMessage = $state(''), duplicateId = $state<string | null>(null), successId = $state<string | null>(null), warnings = $state<string[]>([]);
  let importFormat = $state<'gpx' | 'tcx'>('gpx'), timeMode = $state('absolute');
  let fileInput = $state<HTMLInputElement>(null!), title = $state(''), timezone = $state(''), activityDate = $state('');
  let selected = $state<string[]>([]), editActivity = $state<Activity | null>(null), deleteIds = $state<string[]>([]);
  let editMode = $state(false);
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
  function toggleEditMode() {
    if (!view.manage || controlsBusy || loading) return;
    selected = []; editMode = !editMode;
  }
  function select(id: string, checked: boolean) {
    if (controlsBusy || !editMode) return;
    selected = checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id);
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
      if (!disposed && request === listRequest) { records = result; if (!result.items.length) editMode = false; }
    } catch (cause) { if (!disposed && request === listRequest) fail(cause, 'list'); }
    finally { if (!disposed && request === listRequest) loading = false; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (controlsBusy || !mounted) return;
    message = ''; duplicateId = null; successId = null; warnings = [];
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
      successId = result.activity.id; warnings = result.warnings; fileInput.value = ''; title = ''; activityDate = ''; timeMode = 'absolute';
      await load();
    } catch (cause) { if (!disposed) fail(cause); }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => { mounted = true; void load(lastOffset); return () => { disposed = true; ++listRequest; }; });
</script>
<svelte:head><title>{pageTitle('跑步记录', page.data.site)}</title></svelte:head>
<PageHeader title="跑步记录" description="每一次跑步，都值得留下。导入 GPX 或 TCX，回顾你的轨迹与运动表现。">{#snippet actions()}<a href={view.href("/activities/wall")}  class="button-secondary">查看足迹墙</a>{/snippet}</PageHeader>
{#if view.manage}
<section class="import-card" aria-labelledby="import-title">
  <div class="flex flex-wrap items-baseline justify-between gap-2"><h2 id="import-title" class="text-xl font-semibold">导入 GPX / TCX</h2><span class="text-sm text-muted-foreground">全部记录与完整轨迹公开展示</span></div>
  <form method="POST" enctype="multipart/form-data" onsubmit={submit} class="mt-5" aria-busy={busy}>
    <label class="import-format mb-4 text-sm font-medium">文件格式<select aria-label="文件格式" bind:value={importFormat} onchange={() => { timeMode = 'absolute'; }} disabled={controlsBusy || !mounted} class="rounded border border-border bg-background p-2"><option value="gpx">GPX</option><option value="tcx">TCX</option></select></label>
    <div class="upload-primary">
      <label class="min-w-0 font-medium">轨迹文件 <span class="text-sm font-normal text-muted-foreground">（单个，最大 10 MiB）</span><input bind:this={fileInput} type="file" name="file" onchange={() => { const extension = fileInput.files?.[0]?.name.split('.').at(-1)?.toLowerCase(); if (extension === 'tcx' || extension === 'gpx') importFormat = extension; timeMode = 'absolute'; }} accept=".gpx,.tcx,application/gpx+xml,application/xml,text/xml" required disabled={controlsBusy || !mounted} aria-describedby="gpx-help" class="mt-2 block w-full rounded border border-border p-2" /></label>
      <button disabled={controlsBusy || !mounted} class="rounded bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? '正在解析与保存…' : `导入 ${importFormat.toUpperCase()}`}</button>
    </div>
    {#if importFormat === 'tcx'}
      <label class="mt-4 block text-sm font-medium">时间解释<select aria-label="时间解释" bind:value={timeMode} disabled={controlsBusy || !mounted} aria-describedby="tcx-time-help" class="mt-2 block w-full rounded border border-border bg-background p-2"><option value="absolute">遵守文件时区（默认）</option><option value="local">按当地时间解释（修正误标 UTC）</option></select></label>
      <p id="tcx-time-help" class="mt-2 text-sm text-muted-foreground">如果导出时间错误标记为 UTC，可选择按账户时区或下方指定时区解释。例如文件写 16:15Z，但实际是北京时间下午 16:15。选择此项会修正整条轨迹的时间。</p>
    {/if}
    <p id="gpx-help" class="mt-3 text-sm text-muted-foreground">保存轨迹、距离和时间。导入后的记录与完整轨迹会在个人展示站公开；私人备注和源文件不公开。</p>
    <details class="import-options">
      <summary>补充导入信息</summary>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label>标题（可选）<input bind:value={title} name="title" maxlength="120" disabled={controlsBusy || !mounted} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：周末晨跑" /></label>
        <label>时区（可选）<input bind:value={timezone} name="timezone" disabled={controlsBusy || !mounted} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：Asia/Shanghai" /></label>
        <label>补录日期（可选）<input bind:value={activityDate} name="activity_date" type="date" disabled={controlsBusy || !mounted} aria-describedby="import-date-help" class="mt-2 block w-full rounded border border-border p-2" /></label>
        <p id="import-date-help" class="self-end text-sm leading-6 text-muted-foreground">未指定时区时使用账户时区。缺失时间的轨迹可补录日期；日期与轨迹时间冲突时会提示。</p>
      </div>
    </details>
  </form>
  {#if busy}<div class="mt-4"><FeedbackState kind="loading" title="正在上传、解析并保存"><p>较大文件可能需要数十秒，请勿重复提交。</p></FeedbackState></div>{/if}
  {#if message}<div class="mt-4"><FeedbackState kind="error" title={message}>{#if duplicateId}<a href={view.href(`/activities/${duplicateId}`)} class="text-primary underline">查看已有活动</a>{:else}<p>可以重试当前文件；若格式有误，请选择修正后的 GPX 或 TCX。</p>{/if}</FeedbackState></div>{/if}
  {#if successId}<div class="mt-4"><FeedbackState kind="success" title="导入成功。"><a href={view.href(`/activities/${successId}`)} class="text-primary underline">查看活动与路线</a><span aria-hidden="true"> · </span><a href={view.href("/activities/wall")}  class="text-primary underline">足迹卡片已生成，查看足迹墙</a></FeedbackState></div>{/if}
  {#if warnings.length}<div class="import-warnings"><p class="font-medium">导入完成，部分数据需要留意</p><ul class="mt-2 list-inside list-disc text-sm">{#each warnings as warning}<li>{warningLabel(warning)}</li>{/each}</ul></div>{/if}
</section>
<MifitnessImport disabled={busy || managing} onbusy={value => { mifitnessBusy = value; }} onimported={() => { window.dispatchEvent(new CustomEvent('runnote-activities-changed')); void load(); }} onauthrequired={cause => fail(cause)} />
{/if}
<section class="mt-8" aria-labelledby="records-title">
  <div class="flex flex-wrap items-baseline justify-between gap-3"><h2 bind:this={recordsHeading} tabindex="-1" id="records-title" class="text-xl font-semibold">我的活动{records ? `（${records.total}）` : ''}</h2><div class="records-heading-actions"><p class="text-sm text-muted-foreground">距离 · 用时 · 配速</p>{#if view.manage}<button class="button-secondary" aria-pressed={editMode} disabled={controlsBusy || loading || !records?.items.length} onclick={toggleEditMode}>{editMode ? '完成' : '编辑'}</button>{/if}</div></div>
  {#if loading}<div class="mt-4"><PageSkeleton title="正在读取活动…" /></div>
  {:else if records}
    <div class="content-reveal">
    {#if !records.items.length}<div class="mt-4"><FeedbackState kind="empty" title="暂无跑步记录。"><p>{view.manage ? '选择上方文件并导入，开始积累跑步记录。' : '这里将展示站主的运动记录。'}</p></FeedbackState></div>
    {:else}
      {#if editMode}<div class="selection-toolbar" aria-label="批量管理记录">
        <label><input type="checkbox" aria-label="全选本页" checked={allSelected} indeterminate={selected.length > 0 && !allSelected} disabled={controlsBusy} onchange={event => selected = event.currentTarget.checked ? records!.items.map(item => item.id) : []} />全选本页</label>
        <span class="selected-count" aria-live="polite">已选 {selected.length} 条</span>
        <button class="button-secondary" disabled={!selected.length || controlsBusy} onclick={() => selected = []}>清除选择</button>
        <button class="delete-button" disabled={!selected.length || controlsBusy} onclick={() => confirmDelete(selected)}>删除所选</button>
      </div>{/if}
      <ul class="activity-list">{#each records.items as activity (activity.id)}<li class="min-w-0"><ActivityCard {activity} selectable={editMode} selected={selected.includes(activity.id)} disabled={controlsBusy} onselect={checked => select(activity.id, checked)} onedit={editMode ? () => void edit(activity) : undefined} ondelete={editMode ? () => confirmDelete([activity.id]) : undefined} /></li>{/each}</ul>
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
  .selection-toolbar label { display: flex; align-items: center; gap: .5rem; min-height: 2.75rem; font-size: .875rem; }
  .selection-toolbar input { width: 1.125rem; height: 1.125rem; accent-color: var(--primary); }
  .selected-count { flex: 1; color: var(--muted-foreground); white-space: nowrap; font-size: .875rem; }
  .delete-button, .delete-confirm { padding: .625rem .875rem; border-radius: .75rem; font-size: .875rem; font-weight: 600; color: var(--error); border: 1px solid var(--border); }
  .delete-confirm { background: var(--error); color: white; border-color: var(--error); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  dialog { margin: auto; width: min(34rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--foreground); }
  dialog::backdrop { background: rgb(0 0 0 / .5); }
  .dialog-hint { margin-top: 1rem; color: var(--muted-foreground); font-size: .875rem; line-height: 1.7; }
  .dialog-buttons { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: flex-end; margin-top: 1.5rem; }
  .import-card { margin-top: var(--space-8); padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .upload-primary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); }
  .import-format { display: flex; width: fit-content; max-width: 100%; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  .import-options { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
  summary { width: fit-content; color: var(--primary); font-size: .875rem; font-weight: 550; }
  .import-warnings { margin-top: var(--space-4); padding: var(--space-4); background: var(--warning-soft); color: var(--warning); border: 1px solid var(--warning-border); border-radius: var(--radius-control); }
  .activity-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); margin-top: var(--space-4); }
  .pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-3); margin-top: var(--space-6); }
  @media (max-width: 639px) { .import-card { padding: var(--space-4); } .upload-primary, .activity-list { grid-template-columns: 1fr; } .upload-primary button { width: 100%; } }
</style>
