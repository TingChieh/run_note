<script lang="ts">
  let { title = '正在加载页面…' }: { title?: string } = $props();
</script>

<div class="page-skeleton" role="status" aria-live="polite" aria-busy="true" data-testid="page-skeleton">
  <span class="sr-only">{title}</span>
  <div aria-hidden="true" class="skeleton-layout">
    <div class="skeleton-block skeleton-title"></div>
    <div class="skeleton-block skeleton-description"></div>
    <div class="skeleton-cards">{#each [1, 2, 3] as card (card)}<div class="skeleton-block skeleton-card"></div>{/each}</div>
    <div class="skeleton-block skeleton-panel"></div>
  </div>
</div>

<style>
  .skeleton-layout { display: grid; gap: var(--space-4); }
  .skeleton-block { background: var(--muted); border-radius: var(--radius-control); animation: skeleton-breathe 1.5s ease-in-out infinite alternate; }
  .skeleton-title { width: 35%; height: var(--space-8); }
  .skeleton-description { width: 60%; height: var(--space-4); }
  .skeleton-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); margin-top: var(--space-2); }
  .skeleton-card { height: calc(var(--space-12) * 2); }
  .skeleton-panel { height: calc(var(--space-12) * 4); }
  @keyframes skeleton-breathe { to { opacity: .45; } }
  @media (max-width: 479px) { .skeleton-cards { gap: var(--space-2); } }
  @media (prefers-reduced-motion: reduce) { .skeleton-block { animation: none; } }
</style>
