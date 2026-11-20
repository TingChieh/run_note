<script lang="ts">
  import { page } from '$app/state';
  import { viewsOwnRecords } from '#lib/api/view-context.ts';
  import AnchoredPanel from './AnchoredPanel.svelte';

  // Each action receives the element focus should return to when its dialog closes.
  let {
    onposter,
    onvideo,
  }: {
    onposter: (from: HTMLElement | null) => void;
    onvideo?: (from: HTMLElement | null) => void;
  } = $props();
  // Share images and videos leave the site with the full route: only for the signed-in owner of the record.
  const allowed = $derived(viewsOwnRecords(page.url.pathname, page.data.user));
  let menu = $state<ReturnType<typeof AnchoredPanel>>();

  function choose(action: (from: HTMLElement | null) => void) {
    menu?.close();
    // Closing the popover returns focus to its trigger, which is where the dialog should hand it back.
    action(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
</script>

{#if allowed}
  <AnchoredPanel bind:this={menu} label="分享" panelLabel="分享这次跑步" text>
    {#snippet trigger()}<svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg
      >分享{/snippet}
    <div class="share-menu">
      <button type="button" class="rn-menu-option" onclick={() => choose(onposter)}>生成分享图</button>
      {#if onvideo}<button type="button" class="rn-menu-option" onclick={() => choose(onvideo)}>导出视频</button>{/if}
    </div>
  </AnchoredPanel>
{/if}

<style>
  .share-menu {
    display: grid;
    gap: var(--space-1);
  }
</style>
