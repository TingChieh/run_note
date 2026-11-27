<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;
  const deleteActivity = view.bind(scoped_deleteActivity, 1);

  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { ActivityError, deleteActivity as scoped_deleteActivity, type Activity } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  import ActivityEditor from './ActivityEditor.svelte';

  let {
    activity,
    onupdated,
    onbusychange,
    oneditingchange,
  }: {
    activity: Activity;
    onupdated: (value: Activity) => void;
    onbusychange?: (busy: boolean) => void;
    oneditingchange?: (editing: boolean) => void;
  } = $props();

  let editing = $state(false);
  let focusField = $state<'title' | 'notes'>('title');
  let saving = $state(false);
  let deleting = $state(false);
  let deleteError = $state('');
  let dialog: HTMLDialogElement;
  let editReturnFocus: HTMLElement | null = null;
  let editFallbackFocus: HTMLElement | null = null;
  let deleteReturnFocus: HTMLElement | null = null;
  let disposed = false;
  let currentActivityId = '';
  const busy = $derived(saving || deleting);

  $effect(() => {
    onbusychange?.(busy);
  });
  $effect(() => {
    oneditingchange?.(editing);
  });
  $effect(() => {
    const id = activity.id;
    if (currentActivityId && id !== currentActivityId) {
      editing = false;
      deleteError = '';
      if (dialog?.open) dialog.close();
    }
    currentActivityId = id;
  });
  onMount(() => () => {
    disposed = true;
    onbusychange?.(false);
    oneditingchange?.(false);
  });

  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/admin?reason=expired');
    return cause instanceof Error ? cause.message : '操作失败，请重试';
  }
  export function openEdit(
    field: 'title' | 'notes' = 'title',
    from: HTMLElement | null = null,
    fallback: HTMLElement | null = null,
  ) {
    if (busy) return;
    focusField = field;
    editReturnFocus = from;
    editFallbackFocus = fallback;
    editing = true;
  }
  export function openDelete(from: HTMLElement | null = null) {
    if (busy) return;
    deleteReturnFocus = from;
    deleteError = '';
    dialog.showModal();
  }
  function restoreEditFocus() {
    if (editReturnFocus?.isConnected) editReturnFocus.focus();
    else if (editFallbackFocus?.isConnected) editFallbackFocus.focus();
  }
  async function cancel() {
    if (busy) return;
    editing = false;
    await tick();
    restoreEditFocus();
  }
  async function updated(value: Activity) {
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
    onupdated(value);
    editing = false;
    await tick();
    restoreEditFocus();
  }
  async function remove() {
    if (busy) return;
    deleting = true;
    deleteError = '';
    try {
      await deleteActivity(activity.id);
      window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
      if (!disposed) await goto(view.href('/activities'));
    } catch (cause) {
      if (!disposed) {
        deleteError = fail(cause);
        deleting = false;
      }
    }
  }
</script>

{#if editing}
  <section class="section-rule edit-panel" aria-label="管理跑步记录" aria-busy={busy}>
    <div class="section-head">
      <h2>编辑跑步记录</h2>
    </div>
    <ActivityEditor
      {activity}
      initialFocus={focusField}
      onupdated={(value) => void updated(value)}
      oncancel={() => void cancel()}
      onbusychange={(value) => (saving = value)}
    />
  </section>
{/if}

<dialog
  bind:this={dialog}
  data-glass-overlay
  aria-labelledby="delete-activity-title"
  aria-describedby="delete-activity-description"
  oncancel={(event) => {
    if (deleting) event.preventDefault();
  }}
  onclose={() => {
    if (!deleting) deleteReturnFocus?.focus();
  }}
>
  <h2 id="delete-activity-title">删除这条跑步记录？</h2>
  <p class="delete-title">{activity.title}</p>
  <p id="delete-activity-description" class="hint">
    记录、关联轨迹和导入文件将永久删除，分享链接随之失效。此操作无法撤销。
  </p>
  {#if deleteError}<FeedbackState kind="error" title={deleteError} />{/if}
  <div class="dialog-buttons">
    <button type="button" onclick={() => dialog.close()} disabled={deleting} class="button-secondary">取消</button>
    <button type="button" onclick={() => void remove()} disabled={deleting} class="delete-confirm">
      {deleting ? '删除中…' : '确认删除'}
    </button>
  </div>
</dialog>

<style>
  .edit-panel {
    margin-bottom: var(--space-6);
    padding-bottom: var(--space-6);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .hint {
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  dialog {
    margin: auto;
    width: min(28rem, calc(100% - 2rem));
    max-height: calc(100svh - 2rem);
    overflow-y: auto;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
  }
  dialog::backdrop {
    background: var(--surface-backdrop);
  }
  .delete-title {
    margin: var(--space-4) 0 var(--space-2);
    overflow-wrap: anywhere;
    font-weight: var(--weight-semibold);
  }
  .dialog-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }
  .delete-confirm {
    min-height: 2.75rem;
    padding: 0.625rem 1rem;
    border-radius: var(--radius-control);
    background: var(--error);
    color: white;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  dialog :global(.feedback) {
    margin-top: var(--space-4);
  }
  @media (max-width: 639px) {
    dialog {
      padding: var(--space-4);
    }
  }
</style>
