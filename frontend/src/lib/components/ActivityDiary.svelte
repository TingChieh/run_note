<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    deleteDiary,
    maxPhotos,
    moods,
    readDiary,
    saveDiary,
    uploadDiaryPhoto,
    weatherTypes,
    type DiaryView,
  } from '#lib/api/running-diary.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import DiaryPhoto from '#lib/components/DiaryPhoto.svelte';

  let { id, onauthrequired }: { id: string; onauthrequired: (cause: ActivityError) => void } = $props();
  const heading = $props.id();
  let diary = $state<DiaryView | null>(null);
  let loaded = $state(false);
  let busy = $state(false);
  let fault = $state('');
  let editing = $state(false);
  let confirming = $state(false);
  let mood = $state<DiaryView['mood']>(null);
  let rpe = $state<number | undefined>(undefined);
  let weather = $state<DiaryView['weather']>(null);
  let notes = $state('');
  let moodInput = $state<HTMLSelectElement>();
  let editButton = $state<HTMLButtonElement>();
  let deleteButton = $state<HTMLButtonElement>();
  let confirmButton = $state<HTMLButtonElement>();
  let disposed = false;
  let request = 0;
  const photos = $derived(diary?.photos ?? []);
  const hasDetails = $derived(!!diary && (diary.mood || diary.rpe || diary.weather || diary.notes));

  function expire(cause: ActivityError) {
    request++;
    diary = null;
    mood = null;
    rpe = undefined;
    weather = null;
    notes = '';
    fault = '';
    busy = false;
    loaded = false;
    editing = false;
    confirming = false;
    onauthrequired(cause);
  }

  async function run<T>(task: () => Promise<T>, apply: (result: T) => void, fallback: string) {
    if (busy || disposed) return;
    const token = ++request;
    busy = true;
    fault = '';
    try {
      const result = await task();
      if (!disposed && token === request) apply(result);
    } catch (cause) {
      if (disposed || token !== request) return;
      if (cause instanceof ActivityError && cause.status === 401) expire(cause);
      else fault = cause instanceof Error ? cause.message : fallback;
    } finally {
      if (!disposed && token === request) busy = false;
    }
  }

  function load() {
    return run(
      () => readDiary(id),
      (result) => {
        diary = result;
        loaded = true;
      },
      '无法读取日记',
    );
  }

  async function openEditor() {
    mood = diary?.mood ?? null;
    rpe = diary?.rpe ?? undefined;
    weather = diary?.weather ?? null;
    notes = diary?.notes ?? '';
    fault = '';
    editing = true;
    await tick();
    moodInput?.scrollIntoView({ block: 'center' });
    moodInput?.focus({ preventScroll: true });
  }

  async function closeEditor() {
    editing = false;
    await tick();
    editButton?.focus();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void run(
      () => saveDiary(id, { mood, rpe: rpe ?? null, weather, notes: notes.trim() || null }),
      (result) => {
        diary = result;
        void closeEditor();
      },
      '无法保存日记',
    );
  }

  async function confirmDelete() {
    confirming = true;
    fault = '';
    await tick();
    confirmButton?.focus();
  }

  async function cancelDelete() {
    confirming = false;
    await tick();
    deleteButton?.focus();
  }

  function remove() {
    void run(
      () => deleteDiary(id),
      () => {
        diary = null;
        confirming = false;
        void tick().then(() => editButton?.focus());
      },
      '无法删除日记',
    );
  }

  function selectPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run(
      () => uploadDiaryPhoto(id, file),
      (photo) => {
        diary = { mood: null, rpe: null, weather: null, notes: null, ...diary, photos: [...photos, photo] };
      },
      '无法添加照片',
    );
  }

  function removePhoto(photoId: string) {
    void run(
      () => deleteDiary(id, photoId),
      () => {
        if (diary) diary = { ...diary, photos: photos.filter((photo) => photo.id !== photoId) };
      },
      '无法删除照片',
    );
  }

  onMount(() => {
    void load();
    return () => {
      disposed = true;
      request++;
    };
  });
</script>

<section class="diary section-hairline mt-8" aria-labelledby={heading} aria-busy={busy}>
  <header class="flex flex-wrap items-center justify-between gap-3">
    <h2 id={heading}>跑步日记</h2>
    {#if loaded && !editing && !confirming}
      <button
        bind:this={editButton}
        type="button"
        class="button-secondary button-compact"
        disabled={busy}
        onclick={openEditor}
      >
        {diary ? '编辑日记' : '记录日记'}
      </button>
    {/if}
  </header>
  {#if fault}
    <FeedbackState kind="error" title={fault}>
      {#if !loaded}
        <button type="button" class="button-secondary button-compact" onclick={load} disabled={busy}
          >重新读取日记</button
        >
      {/if}
    </FeedbackState>
  {:else if !loaded}
    <FeedbackState kind="loading" title="正在读取日记…" />
  {/if}

  {#if loaded}
    {#if editing}
      <form class="mt-4 grid gap-4" onsubmit={submit}>
        <fieldset class="grid gap-4 sm:grid-cols-3" disabled={busy}>
          <label>
            心情
            <select bind:this={moodInput} bind:value={mood}>
              <option value={null}>未记录</option>
              {#each Object.entries(moods) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
          </label>
          <label>
            疲劳（RPE 1–10）
            <input type="number" inputmode="numeric" min="1" max="10" step="1" bind:value={rpe} />
          </label>
          <label>
            天气
            <select bind:value={weather}>
              <option value={null}>未记录</option>
              {#each Object.entries(weatherTypes) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
          </label>
          <label class="sm:col-span-3">备注<textarea rows="4" maxlength="5000" bind:value={notes}></textarea></label>
        </fieldset>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="button-primary" disabled={busy}>{busy ? '正在保存…' : '保存日记'}</button>
          <button type="button" class="button-secondary" onclick={closeEditor} disabled={busy}>取消</button>
        </div>
      </form>
    {:else if hasDetails && diary}
      <dl class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt>心情</dt>
          <dd>{diary.mood ? moods[diary.mood] : '—'}</dd>
        </div>
        <div>
          <dt>疲劳（RPE）</dt>
          <dd>{diary.rpe === null ? '—' : `${diary.rpe} / 10`}</dd>
        </div>
        <div>
          <dt>天气</dt>
          <dd>{diary.weather ? weatherTypes[diary.weather] : '—'}</dd>
        </div>
        {#if diary.notes}
          <div class="col-span-full min-w-0">
            <dt>备注</dt>
            <dd class="whitespace-pre-wrap wrap-anywhere">{diary.notes}</dd>
          </div>
        {/if}
      </dl>
    {:else if !photos.length}
      <p class="mt-3 text-muted-foreground">还没有日记</p>
    {/if}

    {#if !editing}
      {#if photos.length}
        <ul class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="日记照片">
          {#each photos as photo, index (photo.id)}
            <li class="min-w-0">
              <DiaryPhoto activityId={id} {photo} label={`跑步照片 ${index + 1}`} onauthrequired={expire} />
              {#if !confirming}
                <button
                  type="button"
                  class="button-secondary button-compact mt-2"
                  disabled={busy}
                  aria-label={`删除照片 ${index + 1}`}
                  onclick={() => removePhoto(photo.id)}>删除照片</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if confirming}
        <div class="mt-4">
          <p>删除日记将同时删除所有照片。</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              bind:this={confirmButton}
              type="button"
              class="button-secondary text-destructive"
              disabled={busy}
              onclick={remove}>确认删除日记</button
            >
            <button type="button" class="button-secondary" disabled={busy} onclick={cancelDelete}>取消</button>
          </div>
        </div>
      {:else}
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <label class="photo-upload button-secondary button-compact relative">
            <span>添加照片</span>
            <input
              type="file"
              class="sr-only"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || photos.length >= maxPhotos}
              onchange={selectPhoto}
            />
          </label>
          <span class="text-muted-foreground photo-count" aria-live="polite"
            >{photos.length}/{maxPhotos} 张 · 单张 ≤ 5 MiB</span
          >
          {#if diary}
            <button
              bind:this={deleteButton}
              type="button"
              class="button-secondary button-compact"
              disabled={busy}
              onclick={confirmDelete}
            >
              删除日记
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  dt,
  .photo-count {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  dd {
    margin-top: var(--space-1);
  }
  fieldset label {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  fieldset :is(input, textarea, select) {
    width: 100%;
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--control-border, var(--border));
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .photo-upload:has(input:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .photo-upload:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }
</style>
