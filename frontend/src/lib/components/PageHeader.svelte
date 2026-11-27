<script lang="ts">
  import type { Snippet } from 'svelte';
  // meta: one mono line under the title (period · as-of date · counts); description stays optional and is omitted by default.
  let {
    title,
    meta,
    metaLive = false,
    description,
    actions,
    footer,
  }: {
    title: string;
    meta?: string;
    metaLive?: boolean;
    description?: string;
    actions?: Snippet;
    footer?: Snippet;
  } = $props();
</script>

<div class="page-header">
  <div class="min-w-0">
    <h1>{title}</h1>
    {#if meta}<p class="page-meta" data-testid="page-meta" aria-live={metaLive ? 'polite' : undefined}>{meta}</p>{/if}
    {#if description}<p class="page-description">{description}</p>{/if}
  </div>
  {#if actions}<div class="page-actions">{@render actions()}</div>{/if}
  {#if footer}<div class="page-header-footer">{@render footer()}</div>{/if}
</div>
