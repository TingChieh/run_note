<script lang="ts">
  import type { Snippet } from 'svelte';
  // The journal's pop-up: a native modal dialog that springs up and retracts. The page keeps the content it shows until the retract is over.
  let { open, labelledby, busy = false, onclose, children }: { open: boolean; labelledby: string; busy?: boolean; onclose: () => void; children: Snippet } = $props();
  let dialog = $state<HTMLDialogElement>();
  $effect(() => { if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); });
</script>
<dialog bind:this={dialog} class="well-dialog" aria-labelledby={labelledby} onclose={() => onclose()} oncancel={event => { if (busy) event.preventDefault(); }}>{@render children()}</dialog>
<style>
  .well-dialog { margin: auto; width: min(32rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-6); color: var(--foreground); background: var(--surface);
    /* Pops up with a springy overshoot and retracts faster, like the other popovers. */
    opacity: 0; transform: translateY(1rem) scale(.94); transition: opacity var(--motion-popover-exit-duration) ease, transform var(--motion-popover-exit-duration) var(--motion-popover-exit-ease), overlay var(--motion-popover-exit-duration) allow-discrete, display var(--motion-popover-exit-duration) allow-discrete; }
  .well-dialog[open] { opacity: 1; transform: none; transition: opacity 200ms ease, transform var(--motion-popover-enter-duration) var(--motion-popover-enter-ease), overlay var(--motion-popover-enter-duration) allow-discrete, display var(--motion-popover-enter-duration) allow-discrete; }
  .well-dialog::backdrop { background: var(--surface-backdrop); opacity: 0; transition: opacity var(--motion-popover-exit-duration) ease, overlay var(--motion-popover-exit-duration) allow-discrete, display var(--motion-popover-exit-duration) allow-discrete; }
  .well-dialog[open]::backdrop { opacity: 1; transition-duration: 260ms; }
  @starting-style { .well-dialog[open] { opacity: 0; transform: translateY(1rem) scale(.94); } .well-dialog[open]::backdrop { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .well-dialog, .well-dialog[open], .well-dialog::backdrop { transition: none; } }
  @media (max-width: 479px) { .well-dialog { padding: var(--space-4); } }
</style>
