<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const updateActivity = view.bind(scoped_updateActivity, 2);

  import { onMount } from 'svelte';
  import { ActivityError, updateActivity as scoped_updateActivity, type Activity } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  let { activity, onupdated, oncancel, onbusychange }: {
    activity: Activity; onupdated: (value: Activity) => void; oncancel: () => void; onbusychange?: (busy: boolean) => void;
  } = $props();
  const id = $props.id();
  let title = $state(''), notes = $state(''), category = $state(''), tagText = $state('');
  let saving = $state(false), error = $state(''), titleInput: HTMLInputElement;
  let disposed = false, initialTags: string[] = [], initialTagText = '';
  onMount(() => {
    title = activity.title; notes = activity.notes ?? ''; category = activity.category ?? ''; tagText = (activity.tags ?? []).join(', ');
    initialTags = [...(activity.tags ?? [])]; initialTagText = tagText;
    titleInput.focus();
    return () => { disposed = true; onbusychange?.(false); };
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    error = '';
    if (!title.trim()) { error = '请填写标题'; titleInput.focus(); return; }
    const tags = tagText === initialTagText ? initialTags : [...new Set(tagText.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 10) { error = '标签最多 10 个'; return; }
    if (tags.some(tag => [...tag].length > 30)) { error = '每个标签最多 30 字'; return; }
    if ([...category.trim()].length > 30) { error = '分类最多 30 字'; return; }
    saving = true; onbusychange?.(true);
    try {
      const result = await updateActivity(activity.id, { title: title.trim(), notes, category: category.trim(), tags });
      if (disposed) return;
      saving = false; onbusychange?.(false); onupdated(result);
    } catch (cause) {
      if (!disposed) {
        if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/admin?reason=expired');
        error = cause instanceof Error ? cause.message : '保存失败，请重试';
      }
    } finally { if (!disposed) { saving = false; onbusychange?.(false); } }
  }
</script>
<form onsubmit={save} class="editor" aria-busy={saving}>
  <label>标题<input bind:this={titleInput} bind:value={title} name="title" required maxlength="120" disabled={saving} /></label>
  <label>分类<input bind:value={category} name="category" maxlength="30" list={`${id}-categories`} placeholder="例如：轻松跑" disabled={saving} /></label>
  <datalist id={`${id}-categories`}>{#each ['轻松跑', '节奏跑', '间歇跑', '长距离', '比赛'] as item}<option value={item}></option>{/each}</datalist>
  <label>标签<input bind:value={tagText} name="tags" disabled={saving} aria-describedby={`${id}-tags-hint`} placeholder="例如：清晨, 公园" /></label>
  <p id={`${id}-tags-hint`} class="hint">用逗号分隔，最多 10 个，每个 30 字。标题、分类和标签会公开展示。</p>
  <label>备注<textarea bind:value={notes} name="notes" maxlength="5000" rows="4" disabled={saving} aria-describedby={`${id}-notes-hint`}></textarea></label>
  <p id={`${id}-notes-hint`} class="hint">备注仅自己可见，最多 5000 字。</p>
  {#if error}<FeedbackState kind="error" title={error} />{/if}
  <div class="buttons"><button type="submit" disabled={saving} class="save">{saving ? '保存中…' : '保存修改'}</button><button type="button" onclick={oncancel} disabled={saving} class="button-secondary">取消编辑</button></div>
</form>
<style>
  .editor { display: grid; gap: .875rem; margin-top: 1rem; min-width: 0; }
  label { min-width: 0; font-size: var(--text-small); font-weight: var(--weight-semibold); }
  input, textarea { display: block; box-sizing: border-box; width: 100%; min-width: 0; margin-top: .5rem; padding: .625rem .75rem; border: 1px solid var(--border); border-radius: .625rem; background: var(--background); color: var(--foreground); font-weight: var(--weight-regular); }
  textarea { resize: vertical; }
  .hint { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .buttons { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
  .save { padding: .625rem 1rem; border-radius: .75rem; background: var(--primary); color: var(--primary-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  button:disabled { opacity: .5; cursor: wait; }
</style>
