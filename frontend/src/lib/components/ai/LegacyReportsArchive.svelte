<script lang="ts">
  import { onMount } from 'svelte';
  import { useViewContext } from '#lib/view-context.ts';
  import {
    AIError,
    deleteReport as scoped_deleteReport,
    readReport as scoped_readReport,
    readReports as scoped_readReports,
    type Report,
    type ReportList,
  } from '#lib/api/ai.ts';
  import FeedbackState from '../FeedbackState.svelte';
  import AnalysisFacts from '../AnalysisFacts.svelte';

  const view = useViewContext();
  const readReports = view.bind(scoped_readReports, 2);
  const readReport = view.bind(scoped_readReport, 2);
  const deleteReport = view.bind(scoped_deleteReport, 1);

  let {
    owner = false,
    initialReportId = null,
    onauthrequired,
    ontotal,
    onclose,
  }: {
    owner?: boolean;
    initialReportId?: string | null;
    onauthrequired?: () => void;
    ontotal?: (total: number) => void;
    onclose?: () => void;
  } = $props();

  let history = $state<ReportList | null>(null);
  let selected = $state<Report | null>(null);
  let requestedReport = $state<string | null>(null);
  let historyLoading = $state(false);
  let detailLoading = $state(false);
  let busy = $state(false);
  let historyError = $state('');
  let detailError = $state('');
  let notice = $state('');
  let actionError = $state('');

  let disposed = false;
  let historyToken = 0;
  let detailToken = 0;

  const statusLabel = (report: Report) =>
    report.status === 'succeeded' ? '已完成' : report.status === 'failed' ? '失败' : '生成中';

  function fail(cause: unknown): string {
    if (cause instanceof AIError && cause.status === 401) {
      disposed = true;
      selected = null;
      history = null;
      onauthrequired?.();
      return '';
    }
    return cause instanceof Error ? cause.message : '读取失败，请稍后重试';
  }

  async function refreshHistory(offset = history?.offset ?? 0) {
    const token = ++historyToken;
    historyLoading = true;
    historyError = '';
    try {
      const result = await readReports(offset, owner);
      if (!disposed && token === historyToken) {
        history = result;
        ontotal?.(result.total);
      }
    } catch (cause) {
      if (!disposed && token === historyToken) historyError = fail(cause);
    } finally {
      if (!disposed && token === historyToken) historyLoading = false;
    }
  }

  async function openReport(id: string) {
    requestedReport = id;
    detailError = '';
    actionError = '';
    notice = '';
    const token = ++detailToken;
    selected = null;
    detailLoading = true;
    try {
      const report = await readReport(id, owner);
      if (!disposed && token === detailToken) selected = report;
    } catch (cause) {
      if (!disposed && token === detailToken) detailError = fail(cause);
    } finally {
      if (!disposed && token === detailToken) detailLoading = false;
    }
  }

  async function removeSelected() {
    if (!owner || !selected || busy || selected.status === 'pending') return;
    if (!window.confirm('删除历史报告正文与统计快照？已使用的历史额度不会返还。')) return;
    busy = true;
    actionError = '';
    notice = '';
    try {
      await deleteReport(selected.id);
      if (!disposed) {
        selected = null;
        notice = '历史报告已删除。';
        await refreshHistory(0);
      }
    } catch (cause) {
      if (!disposed) actionError = fail(cause);
    } finally {
      if (!disposed) busy = false;
    }
  }

  onMount(() => {
    void refreshHistory(0);
    if (initialReportId) void openReport(initialReportId);
    return () => {
      disposed = true;
      historyToken++;
      detailToken++;
      selected = null;
      history = null;
    };
  });
</script>

<div class="archive-root" data-testid="legacy-reports-archive">
  {#if actionError}
    <FeedbackState kind="error" title={actionError} />
  {/if}
  {#if notice}
    <FeedbackState kind="success" title={notice} />
  {/if}

  {#if selected}
    <section aria-label="当前报告" class="aux-panel">
      <div class="archive-head">
        <h2>历史分析报告 · {statusLabel(selected)}</h2>
        <div class="archive-head-actions">
          {#if owner}
            <button
              type="button"
              class="delete-link"
              disabled={busy || selected.status === 'pending'}
              onclick={() => void removeSelected()}
            >
              删除报告
            </button>
          {/if}
        </div>
      </div>
      <p class="archive-meta">{selected.date_from} 至 {selected.date_to}（结束日期不含）</p>
      {#if owner}
        <details class="archive-details">
          <summary>报告信息</summary>
          <p>模型：{selected.model || '—'} · 提示词版本：{selected.prompt_version || '—'}</p>
        </details>
      {/if}
      {#if selected.is_stale}
        <p class="archive-warn">运动数据已变化；这是生成时的历史快照，此报告保留生成时的分析结果。</p>
      {/if}
      {#if selected.analysis}
        <h3>近期总结与趋势解释</h3>
        <p class="archive-prose">{selected.analysis.trend_summary}</p>
        <h3>下周辅助训练建议</h3>
        <ul class="archive-list">
          {#each selected.analysis.recommendations as advice}
            <li>{advice}</li>
          {/each}
        </ul>
        <h3>分析限制</h3>
        <p class="archive-prose">{selected.analysis.limitations}</p>
      {:else if selected.status === 'failed'}
        <p class="archive-err">该历史报告未完成（{selected.error_code ?? 'UNKNOWN'}）。旧版报告生成已升级为 AI 助手对话。</p>
      {:else}
        <p role="status" class="archive-meta">报告正在生成。请稍后重新点击“查看报告”更新状态。</p>
      {/if}
    </section>
    <AnalysisFacts facts={selected.stats_snapshot} />
  {/if}

  {#if detailLoading}
    <FeedbackState kind="loading" title="正在读取报告…" />
  {/if}
  {#if detailError}
    <div class="aux-panel">
      <FeedbackState kind="error" title={detailError}>
        <button
          type="button"
          class="button-secondary"
          disabled={busy || detailLoading}
          onclick={() => {
            if (requestedReport) void openReport(requestedReport);
          }}
        >
          重试读取报告
        </button>
      </FeedbackState>
    </div>
  {/if}

  <section class="aux-panel" aria-label="分析历史">
    <div class="archive-head">
      <h2>{owner ? '历史分析归档（只读）' : '历史分析报告'}</h2>
      <div class="archive-head-actions">
        <button type="button" class="button-secondary" disabled={historyLoading || busy} onclick={() => void refreshHistory()}>
          刷新列表
        </button>
        {#if onclose}
          <button type="button" class="button-secondary" onclick={onclose}>返回对话</button>
        {/if}
      </div>
    </div>

    {#if historyLoading}
      <FeedbackState kind="loading" title="正在读取历史…" />
    {/if}
    {#if historyError}
      <FeedbackState kind="error" title={historyError}>
        <button type="button" class="button-secondary" onclick={() => void refreshHistory()}>重试</button>
      </FeedbackState>
    {/if}
    {#if history}
      {#if history.items.length === 0}
        <FeedbackState kind="empty" title="暂无历史分析报告">
          {#if owner}
            <p>旧版单次报告归档为空，可直接使用 AI 助手进行多轮对话分析。</p>
          {:else}
            <p>当前没有可公开查看的历史分析报告。发起 AI 助手新对话需要登录本人账号。</p>
            <div class="empty-links">
              <a class="button-secondary" href={view.href('/dashboard')}>数据汇总</a>
              <a class="button-secondary" href={view.href('/activities')}>跑步记录</a>
              <a class="button-secondary" href={view.href('/footprints')}>个人足迹</a>
            </div>
          {/if}
        </FeedbackState>
      {:else}
        <ul class="report-list">
          {#each history.items as item (item.id)}
            <li class="report-row">
              <div>
                <p class="report-range">{item.date_from} 至 {item.date_to} · {statusLabel(item)}</p>
                <p class="archive-meta">
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                  {item.is_stale ? ' · 数据已变化' : ''}
                </p>
              </div>
              <button
                type="button"
                class="view-link"
                disabled={busy || detailLoading}
                onclick={() => void openReport(item.id)}
              >
                查看报告
              </button>
            </li>
          {/each}
        </ul>
        <div class="pager">
          <button
            type="button"
            class="button-secondary button-compact"
            disabled={history.offset === 0 || historyLoading || busy}
            onclick={() => void refreshHistory(Math.max(0, history!.offset - 10))}
          >
            上一页
          </button>
          <span class="archive-meta">共 {history.total} 份报告</span>
          <button
            type="button"
            class="button-secondary button-compact"
            disabled={history.offset + 10 >= history.total || historyLoading || busy}
            onclick={() => void refreshHistory(history!.offset + 10)}
          >
            下一页
          </button>
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .archive-root {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .archive-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .archive-head h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .archive-head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .archive-meta {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .archive-details {
    margin-top: var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .archive-details p {
    margin-top: var(--space-2);
  }
  .archive-warn {
    margin-top: var(--space-3);
    color: var(--warning);
    font-size: var(--text-small);
  }
  .archive-err {
    margin-top: var(--space-3);
    color: var(--error);
    font-size: var(--text-small);
  }
  .archive-prose {
    margin: 0;
    white-space: pre-wrap;
    line-height: var(--line-height-body);
  }
  .archive-list {
    margin: 0;
    padding-left: var(--space-6);
    list-style: disc;
    display: grid;
    gap: var(--space-2);
    line-height: var(--line-height-body);
  }
  .report-list {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-3);
  }
  .report-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--background);
  }
  .report-range {
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-medium);
  }
  .view-link {
    background: none;
    border: 0;
    padding: var(--space-2);
    color: var(--primary);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    text-decoration: underline;
    cursor: pointer;
  }
  .delete-link {
    background: none;
    border: 0;
    padding: var(--space-2);
    color: var(--error);
    font-size: var(--text-small);
    text-decoration: underline;
    cursor: pointer;
  }
  .delete-link:disabled,
  .view-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .pager {
    margin-top: var(--space-4);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .empty-links {
    margin-top: var(--space-3);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }
</style>
