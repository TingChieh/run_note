<script lang="ts">
  import { summarize, type ImportItem } from '#lib/import-queue.ts';
  let { items, running, onstop, onretry }: { items: ImportItem[]; running: boolean; onstop: () => void; onretry: () => void } = $props();
  const summary = $derived(summarize(items));
  const current = $derived(items.find(item => item.status === 'running'));
  const failures = $derived(items.filter(item => item.status === 'failed'));
  const headline = $derived(
    running
      ? `正在导入第 ${Math.min(summary.done + 1, summary.total)} / ${summary.total} 个：${current?.file.name ?? ''}`
      : `导入完成：成功 ${summary.success} · 重复跳过 ${summary.duplicate} · 失败 ${summary.failed}${summary.skipped ? ` · 未处理 ${summary.skipped}` : ''}`
  );
</script>
<div class="batch-panel" data-testid="import-batch">
  <p class="batch-headline" role="status">{headline}</p>
  <div class="batch-progress" role="progressbar" aria-label="批量导入进度" aria-valuemin="0" aria-valuemax={summary.total} aria-valuenow={summary.done}><span style:width={`${summary.total ? (summary.done / summary.total) * 100 : 0}%`}></span></div>
  {#if !running && summary.withWarnings}<p class="batch-note">{summary.withWarnings} 个文件导入时有提示，可在活动详情查看。</p>{/if}
  {#if !running && failures.length}
    <ul class="batch-failures" aria-label="失败的文件">
      {#each failures as item (item.id)}<li><span class="batch-name">{item.file.name}</span><span class="batch-reason">{item.message}</span></li>{/each}
    </ul>
  {/if}
  <div class="batch-actions">
    {#if running}<button type="button" class="button-secondary" onclick={onstop}>停止</button>{/if}
    {#if !running && failures.length}<button type="button" class="button-secondary" onclick={onretry}>重试失败项</button>{/if}
  </div>
</div>
<style>
  .batch-panel { display: grid; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-control); min-width: 0; }
  .batch-headline { font-size: .9375rem; font-weight: 600; overflow-wrap: anywhere; }
  .batch-progress { width: 100%; height: .375rem; overflow: hidden; background: var(--muted); border-radius: 999px; }
  .batch-progress span { display: block; height: 100%; background: var(--primary); border-radius: inherit; transition: width .2s ease; }
  @media (prefers-reduced-motion: reduce) { .batch-progress span { transition: none; } }
  .batch-note { color: var(--muted-foreground); font-size: .8125rem; }
  .batch-failures { display: grid; gap: var(--space-1); max-height: 14rem; overflow: auto; font-size: .8125rem; }
  .batch-failures li { display: grid; gap: .125rem; padding: var(--space-1) 0; border-bottom: 1px solid var(--border); }
  .batch-name { font-weight: 600; overflow-wrap: anywhere; }
  .batch-reason { color: var(--muted-foreground); overflow-wrap: anywhere; }
  .batch-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .batch-actions:empty { display: none; }
</style>
