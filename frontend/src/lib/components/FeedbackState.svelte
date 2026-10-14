<script lang="ts">
  import type { Snippet } from 'svelte';
  let { kind = 'empty', title, children }: { kind?: 'loading' | 'success' | 'error' | 'empty'; title: string; children?: Snippet } = $props();
</script>
<div class="feedback" class:feedback-error={kind === 'error'} class:feedback-success={kind === 'success'} class:feedback-empty={kind === 'empty'} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
  <span class="feedback-icon" class:feedback-spinner={kind === 'loading'} aria-hidden="true">{kind === 'loading' ? '' : kind === 'success' ? '✓' : kind === 'error' ? '!' : '–'}</span>
  <div class="min-w-0"><p class="font-medium">{title}</p>{#if children}<div class="mt-2 text-sm">{@render children()}</div>{/if}</div>
</div>
