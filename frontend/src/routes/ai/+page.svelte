<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import AssistantWorkbench from '#lib/components/ai/AssistantWorkbench.svelte';

  const view = useViewContext();
</script>

<svelte:head>
  <title>{pageTitle('AI 助手', page.data.site)}</title>
</svelte:head>

<div class="editorial-page ai-page">
  <PageHeader title="AI 助手" />

  {#if view.manage}
    <AssistantWorkbench />
  {:else}
    <section class="section-rule readonly-wrap" aria-label="AI 助手访问说明">
      <p class="status-strip readonly-notice" role="note" data-testid="ai-anonymous-notice">
        AI 助手仅面向已登录用户开放，发起对话需要登录本人账号。
      </p>
      <div class="readonly-links">
        <a class="button-secondary" href={view.href('/dashboard')}>数据汇总</a>
        <a class="button-secondary" href={view.href('/activities')}>跑步记录</a>
        <a class="button-secondary" href={view.href('/footprints')}>个人足迹</a>
      </div>
    </section>
  {/if}

  <p class="status-strip ai-disclaimer" data-tone="warning" role="note">
    AI 回答基于你的运动数据汇总，仅供参考，不构成医疗或专业训练处方。疼痛或明显不适时请停止训练并寻求专业意见。
  </p>
</div>

<style>
  .ai-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    min-width: 0;
  }
  .readonly-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .readonly-notice,
  .ai-disclaimer {
    margin: 0;
  }
  .readonly-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
</style>
