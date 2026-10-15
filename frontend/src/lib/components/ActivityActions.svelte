<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ActivityError, deleteActivity, type Activity } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  import ActivityEditor from './ActivityEditor.svelte';

  let { activity, onupdated }: { activity: Activity; onupdated: (value: Activity) => void } = $props();
  let editing = $state(false);
  let saving = $state(false), deleting = $state(false), deleteError = $state('');
  let dialog: HTMLDialogElement;
  let editButton = $state<HTMLButtonElement>();
  let disposed = false;
  const busy = $derived(saving || deleting);
  onMount(() => () => { disposed = true; });

  function fail(cause: unknown): string {
    if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/login?reason=expired');
    return cause instanceof Error ? cause.message : '操作失败，请重试';
  }
  function edit() {
    if (!busy) editing = true;
  }
  async function cancel() {
    if (busy) return;
    editing = false;
    await tick(); editButton?.focus();
  }
  async function updated(value: Activity) {
    onupdated(value); editing = false;
    await tick(); editButton?.focus();
  }
  function confirmDelete() {
    if (busy) return;
    deleteError = ''; dialog.showModal();
  }
  async function remove() {
    if (busy) return;
    deleting = true; deleteError = '';
    try {
      await deleteActivity(activity.id);
      if (!disposed) window.location.assign('/activities');
    } catch (cause) {
      if (!disposed) { deleteError = fail(cause); deleting = false; }
    }
  }
</script>

<section class="activity-actions" aria-label="管理跑步记录" aria-busy={busy}>
  <div class="action-heading"><h2>记录信息</h2><div class="action-buttons">
    {#if !editing}<button bind:this={editButton} onclick={() => void edit()} disabled={busy} class="button-secondary">编辑记录</button>{/if}
    <button onclick={confirmDelete} disabled={busy} class="delete-button">删除记录</button>
  </div></div>
  {#if editing}
    <ActivityEditor {activity} onupdated={value => void updated(value)} oncancel={() => void cancel()} onbusychange={value => saving = value} />
  {:else}
    {#if activity.category || activity.tags?.length}<div class="labels">{#if activity.category}<span>{activity.category}</span>{/if}{#each activity.tags ?? [] as tag}<span>#{tag}</span>{/each}</div>{/if}
    {#if activity.notes}<p class="notes">{activity.notes}</p>{:else}<p class="hint mt-3">添加私人备注，留下本次跑步的感受。</p>{/if}
  {/if}
</section>

<dialog bind:this={dialog} aria-labelledby="delete-activity-title" aria-describedby="delete-activity-description" oncancel={(event) => { if (deleting) event.preventDefault(); }}>
  <h2 id="delete-activity-title">删除这条跑步记录？</h2>
  <p class="delete-title">{activity.title}</p>
  <p id="delete-activity-description" class="hint">记录、关联轨迹和导入文件将永久删除，分享链接随之失效。此操作无法撤销。</p>
  {#if deleteError}<FeedbackState kind="error" title={deleteError} />{/if}
  <div class="action-buttons dialog-buttons"><button onclick={() => dialog.close()} disabled={deleting} class="button-secondary">取消</button><button onclick={() => void remove()} disabled={deleting} class="delete-confirm">{deleting ? '删除中…' : '确认删除'}</button></div>
</dialog>

<style>
  .activity-actions { margin-top: 1.5rem; padding: 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); min-width: 0; }
  .action-heading, .action-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
  .action-heading { justify-content: space-between; }
  h2 { font-size: 1.125rem; font-weight: 700; }
  .delete-button { color: var(--error); padding: .625rem .875rem; border: 1px solid var(--border); border-radius: .75rem; font-size: .875rem; font-weight: 600; }
  button:disabled { opacity: .5; cursor: wait; }
  .hint { color: var(--muted-foreground); font-size: .875rem; line-height: 1.6; }
  .labels { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; color: var(--primary); font-size: .875rem; overflow-wrap: anywhere; }
  .notes { margin-top: 1rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .9375rem; }
  dialog { margin: auto; width: min(28rem, calc(100% - 2rem)); max-height: calc(100svh - 2rem); overflow-y: auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--foreground); }
  dialog::backdrop { background: rgb(0 0 0 / .5); }
  .delete-title { margin: 1rem 0 .5rem; overflow-wrap: anywhere; font-weight: 600; }
  .dialog-buttons { justify-content: flex-end; margin-top: 1.5rem; }
  .delete-confirm { padding: .625rem 1rem; border-radius: .75rem; background: var(--error); color: white; font-size: .875rem; font-weight: 600; }
  dialog :global(.feedback) { margin-top: 1rem; }
  @media (max-width: 639px) { .activity-actions, dialog { padding: 1rem; } }
</style>
