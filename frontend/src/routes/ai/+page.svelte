<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readContext = view.bind(scoped_readContext, 2);
  const readReports = view.bind(scoped_readReports, 2);
  const readReport = view.bind(scoped_readReport, 2);
  const generateReport = view.bind(scoped_generateReport, 2);
  const deleteReport = view.bind(scoped_deleteReport, 1);

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { AIError, confirmedRequestOutcome, readContext as scoped_readContext, readReports as scoped_readReports, readReport as scoped_readReport, generateReport as scoped_generateReport, deleteReport as scoped_deleteReport, type Context, type Report, type ReportList, type Create } from '#lib/api/ai.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import AnalysisFacts from '#lib/components/AnalysisFacts.svelte';
  import DatePicker from '#lib/components/DatePicker.svelte';
  let context = $state<Context | null>(null), history = $state<ReportList | null>(null), selected = $state<Report | null>(null);
  let from = $state(''), to = $state(''), consent = $state(false), loading = $state(true), busy = $state(false), historyLoading = $state(false), detailLoading = $state(false);
  let message = $state(''), historyError = $state(''), notice = $state('');
  let requestedReport = $state<string | null>(null);
  let detailError = $state('');
  async function retryContext() { if (busy || loading) return; loading = true; message = ''; try { await loadContext(!from || !to); } catch (cause) { message = fail(cause); } finally { loading = false; } }
  let pending = $state<{ key: string; payload: Create } | null>(null);
  let disposed = false, historyToken = 0, detailToken = 0;
  const storageKey = () => `runnote-ai-pending:${page.data.user?.id}`;
  const label = (r: Report) => r.status === 'succeeded' ? '已完成' : r.status === 'failed' ? '失败' : '生成中';
  function fail(cause: unknown): string {
    if (cause instanceof AIError && cause.status === 401) { disposed = true; selected = null; context = null; history = null; window.location.replace('/admin?reason=expired&next=%2Fai'); return ''; }
    return cause instanceof Error ? cause.message : '读取失败，请稍后重试';
  }
  function remember(value: typeof pending) {
    pending = value;
    try { if (value) sessionStorage.setItem(storageKey(),JSON.stringify(value)); else sessionStorage.removeItem(storageKey()); } catch { /* In-memory key still prevents resubmission in this page. */ }
  }
  function selectURL(id: string | null) { const url = new URL(window.location.href); if (id) url.searchParams.set('report',id); else url.searchParams.delete('report'); replaceState(url,page.state); }
  async function loadContext(defaults = false) {
    const value = await readContext(defaults ? undefined : from, defaults ? undefined : to);
    if (disposed) return;
    context = value;
    if (defaults && !pending) { from = value.date_from; to = value.date_to; }
  }
  async function refreshHistory(offset = history?.offset ?? 0) {
    const token = ++historyToken; historyLoading = true; historyError = '';
    try { const result = await readReports(offset, view.manage); if (!disposed && token === historyToken) history = result; }
    catch (cause) { if (!disposed && token === historyToken) historyError = fail(cause); }
    finally { if (!disposed && token === historyToken) historyLoading = false; }
  }
  async function openReport(id: string) {
    requestedReport = id; detailError = '';
    const token = ++detailToken; selected = null; detailLoading = true; message = ''; notice = '';
    try { const report = await readReport(id, view.manage); if (!disposed && token === detailToken) { selected = report; selectURL(id); } }
    catch (cause) { if (!disposed && token === detailToken) detailError = fail(cause); }
    finally { if (!disposed && token === detailToken) detailLoading = false; }
  }
  async function preview(event: SubmitEvent) {
    event.preventDefault(); if (busy || pending) return;
    loading = true; message = ''; notice = ''; context = null; consent = false;
    selected = null; requestedReport = null; detailError = ''; ++detailToken; detailLoading = false; selectURL(null);
    try { await loadContext(); } catch (cause) { if (!disposed) message = fail(cause); }
    finally { if (!disposed) loading = false; }
  }
  async function generate(replay = false) {
    if (busy || !consent || !context || !context.configured || from !== context.date_from || to !== context.date_to) return;
    busy = true; message = ''; notice = ''; selected = null; requestedReport = null; detailError = ''; ++detailToken; detailLoading = false;
    const attempt = replay && pending ? pending : {key:crypto.randomUUID(),payload:{date_from:context.date_from,date_to:context.date_to,consent_to_send_summary:true as const}};
    remember(attempt);
    try {
      const report = await generateReport(attempt.payload,attempt.key);
      if (disposed) return;
      selected = report; selectURL(report.id); remember(null);
      notice = report.status === 'succeeded' ? '分析已保存，可在历史记录中查看。' : '该请求已经失败，未重复调用AI；可主动发起新分析。';
    } catch (cause) {
      if (disposed) return;
      message = fail(cause);
      if (cause instanceof AIError && cause.reportId) {
        remember(null);
        try { selected = await readReport(cause.reportId, true); if (!disposed) selectURL(cause.reportId); } catch (readError) { if (!disposed) message += '；'+fail(readError); }
      } else if (confirmedRequestOutcome(cause)) remember(null);
    } finally {
      if (!disposed) { busy = false; await Promise.allSettled([loadContext(),refreshHistory(0)]); }
    }
  }
  async function remove() {
    if (!selected || busy || !window.confirm('删除报告正文与统计快照？已使用的调用额度不会返还。')) return;
    busy = true; message = '';
    try { await deleteReport(selected.id); if (!disposed) { selected = null; selectURL(null); notice = '报告已删除，调用额度不返还。'; await refreshHistory(0); } }
    catch (cause) { if (!disposed) message = fail(cause); }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => {
    if (view.manage) { try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null'); if (saved && /^[0-9a-f-]{36}$/.test(saved.key) && typeof saved.payload?.date_from === 'string' && typeof saved.payload?.date_to === 'string' && saved.payload.consent_to_send_summary === true) { pending = saved; from = saved.payload.date_from; to = saved.payload.date_to; } } catch { /* Ignore malformed local state. */ } }
    const initial = async () => { try { await loadContext(!pending); } catch (cause) { if (!disposed) message = fail(cause); } finally { if (!disposed) loading = false; } };
    if (view.manage) void initial(); else loading = false;
    void refreshHistory(0);
    const id = new URL(window.location.href).searchParams.get('report'); if (id) void openReport(id);
    return () => { disposed = true; historyToken++; detailToken++; selected = null; context = null; history = null; };
  });
</script>
<svelte:head><title>{pageTitle('AI 跑步分析', page.data.site)}</title></svelte:head>
<PageHeader title="AI 跑步分析" description="从运动数据出发，了解近期趋势与下周训练建议。AI 仅解释统计摘要。" />
<p class="mt-4 rounded-lg bg-warning-soft p-4 text-sm text-warning">AI训练建议仅供参考，不构成医疗建议。疼痛或明显不适时停止训练并寻求专业意见。</p>
{#if message}<div class="mt-4"><FeedbackState kind="error" title={message} /></div>{/if}
{#if notice}<div class="mt-4"><FeedbackState kind="success" title={notice} /></div>{/if}
{#if view.manage}
<section class="aux-panel my-6" aria-label="分析设置" aria-busy={busy || loading}>
  <h2 class="mb-5 text-xl font-semibold">生成运动分析</h2>
  <form onsubmit={preview} method="POST" class="aux-date-form">
    <DatePicker label="开始日期（周一）" bind:value={from} timezone={page.data.user?.timezone ?? 'UTC'} disabled={busy || !!pending} required />
    <DatePicker label="结束日期（周一，不含）" bind:value={to} timezone={page.data.user?.timezone ?? 'UTC'} disabled={busy || !!pending} required />
    <button type="submit" disabled={loading || busy || !!pending} class="rounded border px-4 py-2 disabled:opacity-50">读取统计依据</button>
  </form>
  <p class="mt-3 text-sm text-muted-foreground">默认最近四个已结束自然周。修改日期后先读取统计依据。刷新页面和查询历史不会生成分析。</p>
  {#if !context && !loading}<button onclick={() => void retryContext()} class="button-secondary mt-4">重试读取统计依据</button>{/if}
  {#if context}
    <div class="content-reveal"><p class="mt-4 text-sm">模型：{context.model ?? '未配置'} · 今日剩余额度：{context.remaining_today}/{context.daily_limit}（UTC日期；失败调用也计入额度）</p>
    {#if !context.configured}<p role="note" class="mt-3 text-warning">AI服务尚未配置，请联系服务端维护者；运动记录和统计仍可使用。</p>{/if}
    {#if context.stats_snapshot.summary.activity_count === 0}<p role="note" class="mt-3 text-warning">该范围没有运动记录，无法分析；不会调用AI或扣减额度。</p><a href={view.href("/activities")}  class="button-secondary mt-3">导入 GPX / TCX</a>{/if}
    <label class="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted p-4 text-sm"><input type="checkbox" bind:checked={consent} disabled={busy} class="mt-1" /><span>我同意向已配置的AI服务发送所选日期范围的最小统计摘要（周跑量、频率、配速、汇总心率、热量、步数、各指标覆盖率和质量数量）；不包含原始GPX / TCX文件、GPS坐标、邮箱、用户名、标题或备注。</span></label>
    {#if pending}<p class="mt-3 text-sm text-warning">上次请求结果尚未确认。先读取历史，或按原标识重试；不会因网络中断自动另发新请求。</p>{/if}
    <button onclick={() => generate(!!pending)} disabled={busy || loading || !consent || !context.configured || from !== context.date_from || to !== context.date_to || context.stats_snapshot.summary.activity_count === 0 || !pending && context.remaining_today === 0} class="mt-4 rounded bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{busy ? '正在生成分析…' : pending ? '按原请求标识重试（防重复）' : '生成近期总结与下周建议'}</button></div>
  {/if}
  {#if loading}<div class="mt-4"><PageSkeleton title="正在读取统计依据…" /></div>{/if}
  {#if busy}<div class="mt-4"><FeedbackState kind="loading" title="正在处理请求，请勿重复提交。生成后会保存报告。" /></div>{/if}
</section>
{/if}
<style>
  .aux-date-form :global(.date-field) { flex: 1 1 12rem; }
  .aux-date-form :global(.date-control) { width: 100%; }
</style>
{#if selected}
  <section aria-label="当前报告" class="aux-panel mb-6">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">分析报告 · {label(selected)}</h2>{#if view.manage}<button onclick={remove} disabled={busy || selected.status === 'pending'} class="text-destructive underline disabled:opacity-50">删除报告</button>{/if}</div>
    <p class="mt-2 text-sm text-muted-foreground">{selected.date_from} 至 {selected.date_to}（结束日期不含）</p>
    {#if view.manage}<details class="mt-3 text-sm text-muted-foreground"><summary>报告信息</summary><p class="mt-2">模型：{selected.model} · 提示词版本：{selected.prompt_version}</p></details>{/if}
    {#if selected.is_stale}<p class="mt-3 text-warning">运动数据已变化；这是生成时的历史快照，此报告保留生成时的分析结果。</p>{/if}
    {#if selected.analysis}
      <h3 class="mt-5 font-semibold">近期总结与趋势解释</h3><p class="mt-2 whitespace-pre-wrap">{selected.analysis.trend_summary}</p>
      <h3 class="mt-5 font-semibold">下周辅助训练建议</h3><ul class="mt-2 list-disc space-y-2 pl-5">{#each selected.analysis.recommendations as advice}<li>{advice}</li>{/each}</ul>
      <h3 class="mt-5 font-semibold">分析限制</h3><p class="mt-2 whitespace-pre-wrap">{selected.analysis.limitations}</p>
    {:else if selected.status === 'failed'}<p class="mt-4 text-destructive">分析未完成（{selected.error_code}）。可核对依据后主动生成新分析，新的调用会计入额度。</p>
    {:else}<p role="status" class="mt-4">报告正在生成。请稍后点击历史中的“查看报告”更新状态。</p>{/if}
  </section>
{/if}
{#if detailLoading}<div class="mb-6"><FeedbackState kind="loading" title="正在读取报告…" /></div>{/if}
{#if detailError}<div class="aux-panel mb-6"><FeedbackState kind="error" title={detailError} /><button class="button-secondary mt-3" disabled={busy || detailLoading} onclick={() => { if (requestedReport) void openReport(requestedReport); }}>重试读取报告</button></div>{/if}
{#if selected}<AnalysisFacts facts={selected.stats_snapshot} />{:else if context}<AnalysisFacts facts={context.stats_snapshot} />{/if}
<section class="aux-panel mt-6" aria-label="分析历史">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">分析历史</h2><button onclick={() => refreshHistory()} disabled={historyLoading || busy} class="button-secondary">读取历史</button></div>
  {#if historyLoading}<div class="mt-3"><FeedbackState kind="loading" title="正在读取历史…" /></div>{/if}
  {#if historyError}<div class="mt-3"><FeedbackState kind="error" title={historyError} /></div>{/if}
  {#if history}
    {#if history.items.length === 0}<div class="mt-4"><FeedbackState kind="empty" title="尚无分析报告。"><p>{view.manage ? '选择日期并明确同意后，可生成分析。' : '站主生成的已完成分析将在这里展示。'}</p></FeedbackState></div>{/if}
    <ul class="mt-4 space-y-3">{#each history.items as report}<li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p>{report.date_from} 至 {report.date_to} · {label(report)}</p><p class="mt-1 text-sm text-muted-foreground">{new Date(report.created_at).toLocaleString()} {report.is_stale ? '· 数据已变化' : ''}</p></div><button onclick={() => openReport(report.id)} disabled={busy || detailLoading} class="text-primary underline">查看报告</button></li>{/each}</ul>
    <div class="mt-4 flex items-center gap-4"><button disabled={history.offset === 0 || historyLoading || busy} onclick={() => refreshHistory(Math.max(0,history!.offset-10))}>上一页</button><span class="text-sm">共 {history.total} 份报告</span><button disabled={history.offset+10 >= history.total || historyLoading || busy} onclick={() => refreshHistory(history!.offset+10)}>下一页</button></div>
  {/if}
</section>
