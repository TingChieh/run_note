<script lang="ts">
  import type { Snippet } from 'svelte';
  // meta: one mono line under the title (period · as-of date · counts); description stays optional and is omitted by default.
  let {
    title,
    meta,
    description,
    actions,
    footer,
  }: { title: string; meta?: string; description?: string; actions?: Snippet; footer?: Snippet } = $props();
</script>

<div class="page-header">
  <div class="min-w-0">
    <h1>{title}</h1>
    {#if meta}<p class="page-meta" data-testid="page-meta">{meta}</p>{/if}
    {#if description}<p class="page-description">{description}</p>{/if}
  </div>
  {#if actions}<div class="page-actions">{@render actions()}</div>{/if}
  {#if footer}<div class="page-header-footer">{@render footer()}</div>{/if}
</div>
