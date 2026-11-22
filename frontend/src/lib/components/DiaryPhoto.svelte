<script lang="ts">
  import { onMount } from 'svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { readDiaryPhoto, type DiaryPhotoView } from '#lib/api/running-diary.ts';

  let {
    activityId,
    photo,
    label,
    onauthrequired,
  }: {
    activityId: string;
    photo: DiaryPhotoView;
    label: string;
    onauthrequired: (cause: ActivityError) => void;
  } = $props();
  let src = $state('');
  let failed = $state(false);
  let active: AbortController | undefined;
  let disposed = false;

  async function load() {
    if (disposed) return;
    active?.abort();
    if (src) URL.revokeObjectURL(src);
    src = '';
    failed = false;
    const abort = new AbortController();
    active = abort;
    try {
      const blob = await readDiaryPhoto(activityId, photo.id, abort.signal);
      if (!disposed && active === abort) src = URL.createObjectURL(blob);
    } catch (cause) {
      if (disposed || active !== abort) return;
      if (cause instanceof ActivityError && cause.status === 401) onauthrequired(cause);
      else failed = true;
    }
  }

  onMount(() => {
    void load();
    return () => {
      disposed = true;
      active?.abort();
      if (src) URL.revokeObjectURL(src);
    };
  });
</script>

<div class="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-surface-muted">
  {#if failed}
    <button type="button" class="button-secondary button-compact" onclick={load}>重试加载{label}</button>
  {:else if src}
    <img
      {src}
      width={photo.width}
      height={photo.height}
      alt={label}
      class="h-full w-full object-contain"
      onerror={() => (failed = true)}
    />
  {:else}
    <span role="status" class="text-muted-foreground">正在读取照片…</span>
  {/if}
</div>
