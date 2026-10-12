<script lang="ts">
  import { onMount } from 'svelte';
  import { ActivityError, readActivities, uploadGpx, formatDate, formatDistance, formatDuration, qualityLabel, warningLabel, type ActivityList } from '#lib/api/activities.ts';
  let records = $state<ActivityList | null>(null), loading = $state(true), busy = $state(false), mounted = $state(false), disposed = false;
  let message = $state(''), duplicateId = $state<string | null>(null), successId = $state<string | null>(null), warnings = $state<string[]>([]);
  let fileInput: HTMLInputElement, title = $state(''), timezone = $state(''), activityDate = $state('');
  function fail(cause: unknown) {
    if (cause instanceof ActivityError && cause.status === 401) {
      records = null; message = ''; duplicateId = null; successId = null; warnings = []; window.location.replace('/login?reason=expired&next=%2Factivities'); return;
    }
    message = cause instanceof Error ? cause.message : '请求失败，请重试';
    duplicateId = cause instanceof ActivityError ? cause.existingActivityId : null;
  }
  async function load(offset = 0) {
    loading = true; records = null;
    try { const result = await readActivities(fetch, offset); if (!disposed) records = result; }
    catch (cause) { if (!disposed) fail(cause); }
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
<h1 class="text-3xl font-semibold">跑步记录</h1>
<p class="mt-3 text-muted-foreground">导入 GPX，保存你的跑步轨迹与指标。记录仅本人可见。</p>
<section class="mt-7 rounded-xl border border-border bg-white p-5" aria-labelledby="import-title">
  <h2 id="import-title" class="text-xl font-semibold">导入 GPX</h2>
  <form method="POST" enctype="multipart/form-data" onsubmit={submit} class="mt-4 grid gap-4 sm:grid-cols-2">
    <label class="sm:col-span-2">GPX 文件 <span class="text-sm text-muted-foreground">（单个，最大 10 MiB）</span><input bind:this={fileInput} type="file" name="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" required disabled={busy} class="mt-2 block w-full rounded border border-border p-2" /></label>
    <label>标题（可选）<input bind:value={title} name="title" maxlength="120" disabled={busy} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：周末晨跑" /></label>
    <label>时区（可选）<input bind:value={timezone} name="timezone" disabled={busy} class="mt-2 block w-full rounded border border-border p-2" placeholder="例如：Asia/Shanghai" /></label>
    <label>补录日期（可选）<input bind:value={activityDate} name="activity_date" type="date" disabled={busy} class="mt-2 block w-full rounded border border-border p-2" /></label>
    <p class="self-end text-sm leading-6 text-muted-foreground">未指定时区时使用账户时区。缺失时间的轨迹可补录日期；日期与轨迹时间冲突时会提示。</p>
    <button disabled={busy || !mounted} class="w-fit rounded bg-primary px-5 py-2 text-white disabled:opacity-50">{busy ? '正在解析与保存…' : '导入 GPX'}</button>
  </form>
  {#if busy}<p role="status" class="mt-3 text-sm">较大文件可能需要数十秒，请勿重复提交。</p>{/if}
  {#if message}<p role="alert" class="mt-4 text-red-700">{message}</p>{/if}
  {#if duplicateId}<a href={`/activities/${duplicateId}`} data-sveltekit-reload class="mt-2 block text-primary underline">查看已有活动</a>{/if}
  {#if successId}<p role="status" class="mt-4">导入成功。<a href={`/activities/${successId}`} data-sveltekit-reload class="text-primary underline">查看活动与路线</a></p>{/if}
  {#if warnings.length}<ul class="mt-3 list-inside list-disc text-sm text-amber-800">{#each warnings as warning}<li>{warningLabel(warning)}</li>{/each}</ul>{/if}
</section>
<section class="mt-8" aria-labelledby="records-title">
  <h2 id="records-title" class="text-xl font-semibold">我的活动{records ? `（${records.total}）` : ''}</h2>
  {#if loading}<p role="status" class="mt-4">正在读取活动…</p>
  {:else if records}
    {#if !records.items.length}<p class="mt-4 text-muted-foreground">还没有活动，先导入一个 GPX 文件吧。</p>
    {:else}<ul class="mt-4 space-y-3">{#each records.items as activity (activity.id)}<li><a href={`/activities/${activity.id}`} data-sveltekit-reload class="block rounded-xl border border-border bg-white p-5 hover:border-primary"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">{activity.title || '未命名活动'}</h3><time datetime={activity.activity_date}>{formatDate(activity.activity_date)}</time></div><p class="mt-2 text-sm text-muted-foreground">{formatDistance(activity.distance_m)} · 用时 {formatDuration(activity.elapsed_seconds)} · {qualityLabel(activity.temporal_quality)}</p></a></li>{/each}</ul>{/if}
    <div class="mt-4 flex items-center gap-4"><button disabled={records.offset === 0 || busy} onclick={() => { message = ''; void load(Math.max(0, records!.offset - 20)); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">上一页</button><span class="text-sm">第 {Math.floor(records.offset / 20) + 1} 页</span><button disabled={records.offset + records.items.length >= records.total || busy} onclick={() => { message = ''; void load(records!.offset + 20); }} class="rounded border border-border px-3 py-2 disabled:opacity-40">下一页</button></div>
  {:else}<button onclick={() => { message = ''; void load(); }} class="mt-4 text-primary underline">重新读取活动</button>{/if}
</section>
