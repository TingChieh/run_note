<script lang="ts">
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { unfoldBar } from '#lib/styles/reveal-from-left.ts';
  let { form, dirty, busy, message = '', error = '', label, busyLabel = '正在保存…', ondiscard }: { form: string; dirty: boolean; busy: boolean; message?: string; error?: string; label: string; busyLabel?: string; ondiscard: () => void } = $props();
  const visible = $derived(dirty || busy || !!message || !!error);
</script>
{#if visible}<div transition:unfoldBar class="save-bar-slot"><div class="save-bar" role="region" aria-label="保存设置">
  {#if error}<FeedbackState kind="error" title={error} />{/if}
  <div class="save-bar-row">
    <p class="save-status" role="status">{#if busy}{busyLabel}{:else if dirty}有未保存的更改{:else if message}{message}{/if}</p>
    {#if dirty || busy}<button type="button" class="button-secondary" disabled={busy} onclick={ondiscard}>放弃</button><button type="submit" {form} class="button-primary" disabled={busy}>{busy ? '保存中…' : label}</button>{/if}
  </div>
</div></div>{/if}
