<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import { viewsOwnRecords } from '#lib/api/view-context.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { readReplay, type ReplayData } from '#lib/api/replay.ts';
  import { buildTrack, type ReplayTrack } from '#lib/replay/engine.ts';
  import FeedbackState from './FeedbackState.svelte';
  import ReplayPlayer from './ReplayPlayer.svelte';
  import ReplayVideoExport from './ReplayVideoExport.svelte';

  let {
    activityId,
    facts = [],
    showTrigger = true,
    sharedReplay,
    sharedLoading = false,
    sharedError = '',
    onensure,
    onretry,
    onauthrequired,
  }: {
    activityId: string;
    /** Activity date and totals for the exported video, already formatted. */
    facts?: [string, string][];
    showTrigger?: boolean;
    /** Optional page-owned replay state so the pace chart and replay dialog share one fetch. */
    sharedReplay?: ReplayData | null;
    sharedLoading?: boolean;
    sharedError?: string;
    onensure?: () => void;
    onretry?: () => void;
    onauthrequired?: (cause: unknown) => boolean;
  } = $props();
  const view = useViewContext();
  // Video files leave the site, so only the signed-in owner gets them, as with share images.
  const canExport = $derived(viewsOwnRecords(page.url.pathname, page.data.user));
  const managed = $derived(!!onensure && !!onretry);
  let exporting = $state(false),
    exportPanel = $state<HTMLElement | null>(null);
  // Bring the export panel into view whenever it appears, including after the track finishes loading.
  $effect(() => {
    if (exportPanel) void tick().then(() => exportPanel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  });
  let dialog = $state<HTMLDialogElement>(null!),
    trigger = $state<HTMLButtonElement | null>(null);
  let mounted = $state(false),
    visible = $state(false),
    localLoading = $state(false),
    localError = $state('');
  // Kept for the page's lifetime so reopening the same record does not download the track again.
  let localTrack = $state.raw<ReplayTrack | null>(null),
    trackFor = '',
    token = 0,
    disposed = false;
  const sharedTrack = $derived(sharedReplay ? buildTrack(sharedReplay) : null);
  const track = $derived(managed ? sharedTrack : localTrack);
  const loading = $derived(managed ? sharedLoading : localLoading);
  const error = $derived(managed ? sharedError : localError);

  let returnFocus: HTMLElement | null = null;
  export function open(from: HTMLElement | null = null) {
    if (!mounted) return;
    returnFocus = from ?? trigger;
    visible = true;
    dialog.showModal();
    if (managed) onensure?.();
    else if (trackFor !== activityId) void load();
  }
  /** Opens the replay with the video export panel expanded (from the page's share menu). */
  export function openExport(from: HTMLElement | null = null) {
    if (!canExport || !mounted) return;
    exporting = true;
    if (!dialog.open) open(from);
  }
  async function load() {
    if (managed) {
      onretry?.();
      return;
    }
    const request = ++token,
      id = activityId;
    localLoading = true;
    localError = '';
    localTrack = null;
    trackFor = '';
    try {
      const data = await readReplay(id, view.fetch);
      if (disposed || request !== token) return;
      localTrack = buildTrack(data);
      trackFor = id;
    } catch (cause) {
      if (disposed || request !== token) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        dialog.close();
        onauthrequired?.(cause);
        return;
      }
      localError = cause instanceof Error ? cause.message : '无法读取回放数据';
    } finally {
      if (!disposed && request === token) localLoading = false;
    }
  }
  // Switching to another record in place drops the previous record's track.
  let activeId = '';
  $effect(() => {
    const id = activityId;
    if (activeId && id !== activeId) {
      token++;
      localTrack = null;
      trackFor = '';
      if (dialog?.open) dialog.close();
    }
    activeId = id;
  });
  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
      token++;
    };
  });
</script>

{#if showTrigger}<button bind:this={trigger} type="button" class="button-secondary" disabled={!mounted} onclick={() => open()}
  ><svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    aria-hidden="true"
    ><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none" /></svg
  >动态回放</button
>{/if}
<dialog
  bind:this={dialog}
  class="replay-dialog"
  data-glass-overlay
  aria-labelledby="activity-replay-title"
  oncancel={(event) => {
    event.preventDefault();
    dialog.close();
  }}
  onclose={() => {
    visible = false;
    exporting = false;
    if (!managed && localLoading) {
      token++;
      localLoading = false;
    }
    returnFocus?.focus();
  }}
>
  <div class="replay-heading">
    <h2 id="activity-replay-title">动态回放</h2>
    <button type="button" class="button-secondary" onclick={() => dialog.close()}>关闭</button>
  </div>
  <div class="replay-body">
    {#if visible && track}{#key track}<ReplayPlayer
          {track}
          {exporting}
          onexport={canExport ? () => (exporting = !exporting) : undefined}
        />{#if canExport && exporting}<div id="replay-video-panel" bind:this={exportPanel}>
            <ReplayVideoExport {track} {activityId} {facts} />
          </div>{/if}{/key}
    {:else if loading}<FeedbackState kind="loading" title="正在读取轨迹…" />
    {:else if error}<FeedbackState kind="error" title={error}
        ><button type="button" class="button-secondary" onclick={() => void load()}>重新读取</button></FeedbackState
      >{/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(64rem, calc(100% - 2rem));
    max-height: calc(100vh - 2rem);
    margin: auto;
    padding: var(--space-6);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    /* Also clips children on their own compositing layer (glass controls with backdrop-filter), which
       WebKit otherwise paints past the rounded corners of a scrolling dialog. */
    clip-path: inset(0 round var(--radius-card));
    background: var(--surface);
    color: var(--foreground);
    opacity: 0;
    transform: translateY(1rem) scale(0.97);
    transition:
      opacity 220ms ease,
      transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1),
      overlay 320ms allow-discrete,
      display 320ms allow-discrete;
  }
  @supports (height: 100dvh) {
    dialog {
      max-height: calc(100dvh - 2rem);
    }
  }
  dialog[open] {
    opacity: 1;
    transform: none;
  }
  dialog::backdrop {
    background: var(--surface-backdrop);
    opacity: 0;
    transition:
      opacity 260ms ease,
      overlay 320ms allow-discrete,
      display 320ms allow-discrete;
  }
  dialog[open]::backdrop {
    opacity: 1;
  }
  @starting-style {
    dialog[open] {
      opacity: 0;
      transform: translateY(1rem) scale(0.97);
    }
    dialog[open]::backdrop {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog,
    dialog::backdrop {
      transition: none;
    }
  }
  .replay-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .replay-heading h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .replay-body {
    margin-top: var(--space-4);
  }
  @media (max-width: 719px), (max-height: 500px) {
    dialog {
      padding: var(--space-4);
    }
  }
</style>
