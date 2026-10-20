<script lang="ts">
  import { onMount } from 'svelte';
  let { label, src, fallback, shape = 'square', size = 'md', busy = false, error = '', hint = '', onselect, onremove }: { label: string; src: string | null; fallback: string; shape?: 'circle' | 'square'; size?: 'md' | 'lg'; busy?: boolean; error?: string; hint?: string; onselect: (file: File) => void; onremove: () => void } = $props();
  const id = $props.id(); // SSR-stable: random ids would break label/input pairing after hydration.
  let ready = $state(false), failed = $state(false), focused = $state(false), input: HTMLInputElement;
  onMount(() => { ready = true; }); // The server-rendered input must not accept a file before its handler is attached.
  $effect(() => { void src; failed = false; });
</script>
<div class="image-upload" aria-busy={busy}>
  <div class="preview" class:circle={shape === 'circle'} class:large={size === 'lg'}>{#if src && !failed}<img {src} alt={`当前${label}`} onerror={() => failed = true} />{:else}<span aria-hidden="true">{fallback}</span><span class="sr-only">未设置{label}</span>{/if}</div>
  <div class="controls">
    <label for={id} class="button-secondary" class:disabled={busy} class:focused>{busy ? '上传中…' : `选择${label}`}</label>
    <input bind:this={input} {id} class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label={`上传${label}`} disabled={busy || !ready} onfocus={() => focused = true} onblur={() => focused = false} onchange={() => { const file = input.files?.[0]; input.value = ''; if (file) onselect(file); }} />
    {#if src}<button type="button" class="button-secondary" disabled={busy} onclick={onremove}>{shape === 'circle' ? `移除${label}` : `恢复默认${label}`}</button>{/if}
    {#if hint}<p class="text-sm text-muted-foreground">{hint}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</div>
<style>
  .image-upload { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
  .preview { display: grid; place-items: center; width: 4rem; height: 4rem; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--muted-foreground); font-size: 1.5rem; font-weight: 700; }
  .preview.circle { border-radius: 50%; }
  .preview.large { width: 6rem; height: 6rem; font-size: 2.25rem; }
  .preview img { width: 100%; height: 100%; object-fit: cover; }
  .controls { display: grid; gap: var(--space-2); min-width: 0; justify-items: start; }
  label.disabled { opacity: .5; pointer-events: none; }
  label.focused { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
