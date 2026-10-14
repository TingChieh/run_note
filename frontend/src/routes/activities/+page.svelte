<script lang="ts">
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ActivityCard from '#lib/components/ActivityCard.svelte';
  import { onMount } from 'svelte';
  import { ActivityError, readActivities, uploadGpx, warningLabel, type ActivityList } from '#lib/api/activities.ts';
  let records = $state<ActivityList | null>(null), loading = $state(true), busy = $state(false), mounted = $state(false), disposed = false;
  let message = $state(''), listMessage = $state(''), duplicateId = $state<string | null>(null), successId = $state<string | null>(null), warnings = $state<string[]>([]);
  let fileInput: HTMLInputElement, title = $state(''), timezone = $state(''), activityDate = $state('');
  function fail(cause: unknown, target: 'upload' | 'list' = 'upload') {
    if (cause instanceof ActivityError && cause.status === 401) {
      records = null; message = ''; listMessage = ''; duplicateId = null; successId = null; warnings = []; window.location.replace('/login?reason=expired&next=%2Factivities'); return;
    }
    const text = cause instanceof Error ? cause.message : '请求失败，请重试';
    if (target === 'list') listMessage = text;
    else { message = text; duplicateId = cause instanceof ActivityError ? cause.existingActivityId : null; }
  }
  async function load(offset = 0) {
    loading = true; records = null; listMessage = '';
    try { const result = await readActivities(fetch, offset); if (!disposed) records = result; }
    catch (cause) { if (!disposed) fail(cause, 'list'); }
    finally { if (!disposed) loading = false; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy || !mounted) return;
    message = ''; duplicateId = null; successId = null; warnings = [];
    const file = fileInput.files?.[0];
    if (!file || fileInput.files?.length !== 1) { message = '请选择一个 GPX 文件'; return; }
    if (file.size > 10 * 1024 * 1024) { message = 'GPX 文件不能超过 10 MiB'; return; }
    const form = new FormData(); form.append('file', file);
    if (title.trim()) form.append('title', title.trim()); if (timezone.trim()) form.append('timezone', timezone.trim()); if (activityDate) form.append('activity_date', activityDate);
    busy = true;
    try {
      const result = await uploadGpx(form); if (disposed) return;
      successId = result.activity.id; warnings = result.warnings; fileInput.value = ''; title = ''; activityDate = '';
      await load();
    } catch (cause) { if (!disposed) fail(cause); }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => { mounted = true; void load(); return () => { disposed = true; }; });
</script>
<svelte:head><title>跑步记录 · Run Note</title></svelte:head>
<PageHeader title="跑步记录" description="每一次跑步，都值得留下。导入 GPX，回顾你的轨迹与运动表现。" />
<section class="import-card" aria-labelledby="import-title">
  <div class="flex flex-wrap items-baseline justify-between gap-2"><h2 id="import-title" class="text-xl font-semibold">导入 GPX</h2><span class="text-sm text-muted-foreground">新记录默认仅自己可见</span></div>
  <form method="POST" enctype="multipart/form-data" onsubmit={submit} class="mt-5" aria-busy={busy}>
    <div class="upload-primary">
      <label class="min-w-0 font-medium">GPX 文件 <span class="text-sm font-normal text-muted-foreground">（单个，最大 10 MiB）</span><input bind:this={fileInput} type="file" name="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" required disabled={busy} aria-describedby="gpx-help" class="mt-2 block w-full rounded border border-border p-2" /></label>
      <button disabled={busy || !mounted} class="rounded bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? '正在解析与保存…' : '导入 GPX'}</button>
    </div>
    <p id="gpx-help" class="mt-3 text-sm text-muted-foreground">保存轨迹、距离和时间。记录的公开与分享设置可以在详情页管理。</p>
    <details class="import-options">
      <summary>补充导入信息</summary>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label>标题（可选）<input bind:value={title} name="title" maxlength="120" disabled={busy} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：周末晨跑" /></label>
        <label>时区（可选）<input bind:value={timezone} name="timezone" disabled={busy} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：Asia/Shanghai" /></label>
        <label>补录日期（可选）<input bind:value={activityDate} name="activity_date" type="date" disabled={busy} aria-describedby="import-date-help" class="mt-2 block w-full rounded border border-border p-2" /></label>
        <p id="import-date-help" class="self-end text-sm leading-6 text-muted-foreground">未指定时区时使用账户时区。缺失时间的轨迹可补录日期；日期与轨迹时间冲突时会提示。</p>
      </div>
    </details>
  </form>
  {#if busy}<div class="mt-4"><FeedbackState kind="loading" title="正在上传、解析并保存"><p>较大文件可能需要数十秒，请勿重复提交。</p></FeedbackState></div>{/if}
  {#if message}<div class="mt-4"><FeedbackState kind="error" title={message}>{#if duplicateId}<a href={`/activities/${duplicateId}`} data-sveltekit-reload class="text-primary underline">查看已有活动</a>{:else}<p>可以重试当前文件；若格式有误，请选择修正后的 GPX。</p>{/if}</FeedbackState></div>{/if}
  {#if successId}<div class="mt-4"><FeedbackState kind="success" title="导入成功。"><a href={`/activities/${successId}`} data-sveltekit-reload class="text-primary underline">查看活动与路线</a></FeedbackState></div>{/if}
  {#if warnings.length}<div class="import-warnings"><p class="font-medium">导入完成，部分数据需要留意</p><ul class="mt-2 list-inside list-disc text-sm">{#each warnings as warning}<li>{warningLabel(warning)}</li>{/each}</ul></div>{/if}
</section>
<section class="mt-8" aria-labelledby="records-title">
  <div class="flex flex-wrap items-baseline justify-between gap-3"><h2 id="records-title" class="text-xl font-semibold">我的活动{records ? `（${records.total}）` : ''}</h2><p class="text-sm text-muted-foreground">距离 · 用时 · 配速</p></div>
  {#if loading}<div class="mt-4"><FeedbackState kind="loading" title="正在读取活动…" /></div>
  {:else if records}
    {#if !records.items.length}<div class="mt-4"><FeedbackState kind="empty" title="还没有活动，先导入一个 GPX 文件吧。"><p>选择上方文件并导入，开始积累你的跑步记录。</p></FeedbackState></div>
    {:else}<ul class="activity-list">{#each records.items as activity (activity.id)}<li class="min-w-0"><ActivityCard {activity} /></li>{/each}</ul>{/if}
    {#if records.total > 0}<div class="pagination"><button disabled={records.offset === 0 || busy} onclick={() => { void load(Math.max(0, records!.offset - 20)); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">上一页</button><span class="text-sm text-muted-foreground">第 {Math.floor(records.offset / 20) + 1} 页 / {Math.ceil(records.total / 20)} 页</span><button disabled={records.offset + records.items.length >= records.total || busy} onclick={() => { void load(records!.offset + 20); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">下一页</button></div>{/if}
  {:else if listMessage}<div class="mt-4"><FeedbackState kind="error" title={listMessage}><button onclick={() => void load()} class="button-secondary">重新读取活动</button></FeedbackState></div>{/if}
</section>
<style>
  .import-card { margin-top: var(--space-8); padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .upload-primary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--space-4); }
  .import-options { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
  summary { width: fit-content; color: var(--primary); font-size: .875rem; font-weight: 550; }
  .import-warnings { margin-top: var(--space-4); padding: var(--space-4); background: #fff8e9; color: #805412; border: 1px solid #ead7b3; border-radius: var(--radius-control); }
  .activity-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); margin-top: var(--space-4); }
  .pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-3); margin-top: var(--space-6); }
  @media (max-width: 639px) { .import-card { padding: var(--space-4); } .upload-primary, .activity-list { grid-template-columns: 1fr; } .upload-primary button { width: 100%; } }
</style>
