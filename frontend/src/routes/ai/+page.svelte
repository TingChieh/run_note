<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import { readReports as scoped_readReports } from '#lib/api/ai.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import AssistantWorkbench from '#lib/components/ai/AssistantWorkbench.svelte';
  import LegacyReportsArchive from '#lib/components/ai/LegacyReportsArchive.svelte';

  const view = useViewContext();
  const readReports = view.bind(scoped_readReports, 2);

  let showArchive = $state(false);
  let legacyTotal = $state(0);
  let initialReportId = $state<string | null>(null);

  function handleAuthExpired() {
    const next = encodeURIComponent(window.location.pathname);
    window.location.replace(`/admin?reason=expired&next=${next}`);
  }

  onMount(() => {
    let disposed = false;
    const url = new URL(window.location.href);
    const reportParam = url.searchParams.get('report');
    if (url.search) {
      void goto(url.pathname, { state: page.state, shallow: true, replace: true }).catch(() => {});
    }
    if (reportParam) {
      initialReportId = reportParam;
      if (view.manage) showArchive = true;
    }

    if (view.manage) {
      // Quietly check whether this user has historical ai_reports so the low-friction archive entry appears only when relevant.
      void readReports(0, true)
        .then((res) => {
          if (!disposed) legacyTotal = res.total;
        })
        .catch(() => {
          /* Ignore archive count error; primary assistant remains unaffected. */
        });
    }

    return () => {
      disposed = true;
    };
  });
</script>

<svelte:head>
  <title>{pageTitle('AI 助手', page.data.site)}</title>
</svelte:head>

<PageHeader title="AI 助手">
  {#snippet actions()}
    {#if view.manage && (legacyTotal > 0 || showArchive)}
      <button
        type="button"
        class="button-secondary"
        onclick={() => {
          showArchive = !showArchive;
          if (!showArchive) initialReportId = null;
        }}
      >
        {showArchive ? '返回 AI 助手' : `历史分析归档（${legacyTotal}）`}
      </button>
    {/if}
  {/snippet}
</PageHeader>

{#if view.manage}
  {#if showArchive}
    <div class="mt-4">
      <LegacyReportsArchive
        owner
        {initialReportId}
        onauthrequired={handleAuthExpired}
        ontotal={(total) => { legacyTotal = total; }}
        onclose={() => {
          showArchive = false;
          initialReportId = null;
        }}
      />
    </div>
  {:else}
    <AssistantWorkbench />
  {/if}
{:else}
  <div class="readonly-wrap">
    <p class="readonly-notice" role="note" data-testid="ai-anonymous-notice">
      当前为只读展示模式，仅展示允许公开的历史分析报告；发起新的 AI 助手对话需要登录本人账号。
    </p>
    <LegacyReportsArchive
      owner={false}
      {initialReportId}
      onauthrequired={handleAuthExpired}
    />
  </div>
{/if}

<p class="ai-disclaimer" role="note">
  AI 回答基于你的运动数据汇总，仅供参考，不构成医疗或专业训练处方。疼痛或明显不适时请停止训练并寻求专业意见。
</p>

<style>
  .readonly-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    margin-top: var(--space-4);
    min-width: 0;
  }
  .readonly-notice {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .ai-disclaimer {
    margin: var(--space-4) 0 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-control);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
</style>
