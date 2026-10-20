<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, description, actions, footer }: { title: string; description?: string; actions?: Snippet; footer?: Snippet } = $props();
</script>
<div class="page-header">
  <div class="min-w-0"><h1>{title}</h1>{#if description}<p class="page-description">{description}</p>{/if}</div>
  {#if actions}<div class="page-actions">{@render actions()}</div>{/if}
  {#if footer}<div class="page-header-footer">{@render footer()}</div>{/if}
</div>
