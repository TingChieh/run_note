<script lang="ts">
  import { onMount } from 'svelte';
  import ActivityPreview from './ActivityPreview.svelte';
  import type { Activity, Route } from '#lib/api/activities.ts';
  // Phone-width detail for one shared record; mounted only while open. showModal() gives focus containment, Escape and inertness.
  let { activity, route, runner, href, onclose }: { activity: Activity; route: Route | null; runner: { name: string; color: string }; href: string; onclose: () => void } = $props();
  let dialog = $state<HTMLDialogElement>(null!);
  // close() returns focus to the card that opened the sheet before the parent unmounts it.
  function close() { if (dialog?.open) dialog.close(); onclose(); }
  onMount(() => { if (!dialog.open) dialog.showModal(); });
</script>
<dialog bind:this={dialog} class="record-sheet" aria-label={`${activity.title || '未命名活动'} 的路线与详情`} data-testid="together-record-sheet"
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclick={(event) => { if (event.target === dialog) close(); }}>
  <div class="sheet-bar"><span class="sheet-grip" aria-hidden="true"></span><button type="button" class="button-secondary" onclick={close}>关闭</button></div>
  <ActivityPreview {activity} suppliedRoute={route} {runner} {href} routeColor={runner.color} />
</dialog>

<style>
  .record-sheet { margin: auto 0 0; width: 100%; max-width: 100%; max-height: min(78dvh, 40rem); padding: 0; border: 1px solid var(--border); border-bottom: 0; border-radius: var(--radius-card) var(--radius-card) 0 0; background: var(--surface); color: var(--foreground); overflow-y: auto; overscroll-behavior: contain; padding-bottom: env(safe-area-inset-bottom); }
  .record-sheet::backdrop { background: var(--surface-backdrop); }
  .sheet-bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-4); background: var(--surface); }
  .sheet-grip { width: 2.5rem; height: .25rem; border-radius: 999px; background: var(--border); }
  .record-sheet :global(.preview) { border: 0; border-radius: 0; }
  .record-sheet :global(.preview-map) { --route-map-height: 13rem; }
  .record-sheet { transform: translateY(100%); transition: transform 320ms cubic-bezier(.22, .61, .36, 1), overlay 320ms allow-discrete, display 320ms allow-discrete; }
  .record-sheet[open] { transform: none; }
  .record-sheet::backdrop { opacity: 0; transition: opacity 260ms ease, overlay 320ms allow-discrete, display 320ms allow-discrete; }
  .record-sheet[open]::backdrop { opacity: 1; }
  @starting-style { .record-sheet[open] { transform: translateY(100%); } .record-sheet[open]::backdrop { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .record-sheet, .record-sheet::backdrop { transition: none; } }
</style>
