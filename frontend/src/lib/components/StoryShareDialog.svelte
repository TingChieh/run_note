<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { AnnualStory } from '#lib/api/annual-story.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { isCapacitorNative } from '#lib/capacitor-env.ts';
  import { renderStoryPosterBlob } from '#lib/share/story-poster-render.ts';
  import { storyFilename, storyKm, storyRangeText } from '#lib/story.ts';

  let { story, disabled = false }: { story: AnnualStory; disabled?: boolean } = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>(null!);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let dockOpenBtn = $state<HTMLButtonElement | null>(null);
  let probe = $state<HTMLElement | null>(null);
  let returnFocusTo: HTMLElement | null = null;

  let mounted = $state(false);
  let nativeApp = $state(false);
  let opened = $state(false);
  let dark = false;
  let appearance = $state<'light' | 'dark'>('light');
  let followsPage = true;
  let hideCities = $state(false);
  let hideRouteNames = $state(false);

  let url = $state('');
  let file = $state<File | null>(null);
  let shareable = $state(false);
  let busy = $state(false);
  let sharing = $state(false);
  let error = $state('');
  let shareError = $state('');
  let dialogToken = 0;

  let dockUrl = $state('');
  let dockToken = 0;
  let disposed = false;

  const summary = $derived(
    `${story.year} 跑步年度故事，${storyRangeText(story)}，总里程 ${storyKm(story.summary.distance_m)} km，共 ${story.summary.activity_count} 次出发。`,
  );

  onMount(() => {
    mounted = true;
    nativeApp = isCapacitorNative();
    const unwatch = watchSystemTheme((isDark) => {
      dark = isDark;
      if (followsPage) {
        appearance = dark ? 'dark' : 'light';
      }
    });
    return () => {
      disposed = true;
      unwatch();
      releaseDialog();
      releaseDock();
    };
  });

  $effect(() => {
    if (disabled && opened) close();
  });

  $effect(() => {
    if (!mounted) return;
    void story;
    void appearance;
    void hideCities;
    void hideRouteNames;
    untrack(() => {
      void renderDockPreview();
      if (opened) void generate();
    });
  });

  function clearDialogAssets() {
    if (url) URL.revokeObjectURL(url);
    url = '';
    file = null;
    shareable = false;
    shareError = '';
  }

  function releaseDialog() {
    dialogToken++;
    busy = false;
    error = '';
    clearDialogAssets();
  }

  function clearDockAsset() {
    if (dockUrl) URL.revokeObjectURL(dockUrl);
    dockUrl = '';
  }

  function releaseDock() {
    dockToken++;
    clearDockAsset();
  }

  export function open(from?: HTMLElement | null) {
    if (disabled || !mounted) return;
    returnFocusTo = from ?? null;
    if (followsPage) appearance = dark ? 'dark' : 'light';
    opened = true;
    dialog.showModal();
    void tick().then(() => {
      if (dialog?.open) closeBtn?.focus();
    });
    void generate();
  }

  function close() {
    opened = false;
    releaseDialog();
    if (dialog?.open) dialog.close();
  }

  function handleDialogClose() {
    opened = false;
    releaseDialog();
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target?.isConnected) target.focus();
  }

  function setAppearance(next: 'light' | 'dark') {
    if (appearance === next) return;
    followsPage = false;
    if (opened) clearDialogAssets();
    appearance = next;
  }

  function handlePrivacyChange() {
    clearDockAsset();
    if (opened) clearDialogAssets();
  }

  async function renderDockPreview() {
    if (!mounted || disposed) return;
    const mine = ++dockToken;
    clearDockAsset();
    try {
      const blob = await renderStoryPosterBlob(story, probe, {
        theme: appearance,
        hideCities,
        hideRouteNames,
        scale: 1 / 3,
      });
      if (disposed || mine !== dockToken) return;
      dockUrl = URL.createObjectURL(blob);
    } catch {
      if (!disposed && mine === dockToken) clearDockAsset();
      // Dock preview is non-blocking; full preview surfaces errors explicitly.
    }
  }

  async function generate() {
    if (!mounted || disposed || !opened) return;
    const mine = ++dialogToken;
    // Immediately invalidate any previous poster so stale or unredacted output can never be saved/shared.
    clearDialogAssets();
    busy = true;
    error = '';
    try {
      const blob = await renderStoryPosterBlob(story, probe, {
        theme: appearance,
        hideCities,
        hideRouteNames,
        scale: 1,
      });
      if (disposed || mine !== dialogToken || !opened) return;
      const filename = storyFilename(story.year, appearance);
      url = URL.createObjectURL(blob);
      const generated = new File([blob], filename, { type: 'image/png' });
      file = generated;
      shareable =
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [generated] });
    } catch (cause) {
      if (disposed || mine !== dialogToken) return;
      clearDialogAssets();
      error = cause instanceof Error ? cause.message : '无法生成分享海报，请重试';
    } finally {
      if (!disposed && mine === dialogToken) busy = false;
    }
  }

  function save() {
    if (!url || !file || busy || error) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name || storyFilename(story.year, appearance);
    link.click();
  }

  async function share() {
    if (!file || !shareable || busy || sharing || error || typeof navigator?.share !== 'function') return;
    sharing = true;
    shareError = '';
    try {
      await navigator.share({ title: `${story.year} 跑步年度故事`, files: [file] });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      shareError = '系统分享未完成，可直接保存图片';
    } finally {
      if (!disposed) sharing = false;
    }
  }
</script>

<section class="section-rule keepsake-dock" aria-labelledby={`${uid}-dock-title`} data-testid="story-poster-dock">
  <div class="dock-copy" bind:this={probe}>
    <p class="dock-kicker">KEEPSAKE · 9:16 MEMOIR FOLIO</p>
    <h2 id={`${uid}-dock-title`}>封存这一年的长卷海报</h2>
    <p class="dock-note">本地离线生成 1080×1920 竖屏纪实卷轴，可按需隐去城市名与路线名，不含真实坐标或起终点。</p>
    <div class="dock-actions">
      <button type="button" class="button-primary" bind:this={dockOpenBtn} {disabled} onclick={() => open(dockOpenBtn)}>
        预览并保存海报
      </button>
    </div>
  </div>
  <div class="dock-preview">
    {#if dockUrl}
      <button
        type="button"
        class="dock-frame"
        aria-label="打开年度故事海报高清预览"
        {disabled}
        onclick={() => open(dockOpenBtn)}
      >
        <img src={dockUrl} alt={`${story.year} 跑步年度故事 9:16 海报缩略预览`} />
      </button>
    {:else}
      <div class="dock-placeholder" aria-hidden="true"></div>
    {/if}
  </div>
</section>

<dialog
  bind:this={dialog}
  class="story-dialog editorial-page"
  aria-labelledby={`${uid}-dialog-title`}
  data-testid="story-poster-dialog"
  onclose={handleDialogClose}
>
  <div class="dialog-head">
    <h2 id={`${uid}-dialog-title`}>{story.year} 年度故事海报</h2>
    <button type="button" class="button-secondary dialog-close-btn" bind:this={closeBtn} onclick={close}>关闭</button>
  </div>

  <div class="dialog-body">
    <div class="dialog-stage">
      {#if error}
        <FeedbackState kind="error" title={error}>
          <button type="button" class="button-secondary" onclick={() => void generate()}>重试生成</button>
        </FeedbackState>
      {:else if busy && !url}
        <FeedbackState kind="loading" title="正在绘制 1080×1920 分享海报…" />
      {:else if url}
        <img src={url} alt={summary} class="poster-preview-img" data-testid="story-poster-image" />
      {/if}
    </div>

    <div class="dialog-controls">
      <div class="option-group">
        <span class="option-label">海报外观</span>
        <div class="segment-group" role="group" aria-label="海报外观">
          <button type="button" aria-pressed={appearance === 'light'} onclick={() => setAppearance('light')}>
            浅色纸面
          </button>
          <button type="button" aria-pressed={appearance === 'dark'} onclick={() => setAppearance('dark')}>
            深色暖炭
          </button>
        </div>
      </div>

      <div class="option-group">
        <span class="option-label">隐私脱敏控制</span>
        <div class="toggle-list">
          <label class="toggle-row">
            <span>隐藏具体城市名</span>
            <input type="checkbox" bind:checked={hideCities} onchange={handlePrivacyChange} />
          </label>
          <label class="toggle-row">
            <span>隐藏具体路线名</span>
            <input type="checkbox" bind:checked={hideRouteNames} onchange={handlePrivacyChange} />
          </label>
        </div>
      </div>

      <p class="status-strip privacy-notice" data-testid="story-poster-privacy-note">
        本分享图包含本人私人跑步记录的汇总，仅在浏览器本机绘制无坐标系的抽象足迹轮廓，不含真实经纬度、街道地图、起终点、邮箱、备注或身心健康数据。
      </p>

      {#if shareError}
        <p class="status-strip share-error" data-tone="error" role="alert">{shareError}</p>
      {/if}

      <div class="dialog-footer">
        <div class="dialog-actions" class:two-col={!nativeApp && shareable}>
          {#if !nativeApp}
            <button type="button" class="button-primary" disabled={!url || !file || busy || Boolean(error)} onclick={save}>
              保存 PNG
            </button>
          {/if}
          {#if shareable}
            <button
              type="button"
              class="button-secondary"
              disabled={!file || !shareable || busy || sharing || Boolean(error)}
              onclick={share}
            >
              {sharing ? '正在调起分享…' : '系统分享'}
            </button>
          {/if}
        </div>
        {#if nativeApp && !shareable}<p class="status-strip privacy-notice" role="status">当前客户端暂不支持直接保存图片文件，请在浏览器中打开保存 PNG。</p>{/if}
      </div>
    </div>
  </div>
</dialog>

<style>
  .keepsake-dock {
    margin-top: var(--space-12);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-6);
  }
  .dock-copy {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .dock-kicker {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    color: var(--primary);
  }
  .dock-copy h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .dock-note {
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
    max-width: 36rem;
  }
  .dock-actions {
    margin-top: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .dock-preview {
    display: flex;
    justify-content: center;
  }
  .dock-frame {
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    overflow: hidden;
    background: var(--paper);
    box-shadow: var(--shadow-popover);
  }
  .dock-frame img {
    display: block;
    width: 8rem;
    aspect-ratio: 9 / 16;
    height: auto;
  }
  .dock-placeholder {
    width: 8rem;
    aspect-ratio: 9 / 16;
    border-radius: var(--radius-sheet);
    border: 1px dashed var(--border);
    background: var(--recap-well);
  }

  .story-dialog {
    width: min(92vw, 56rem);
    max-height: 92dvh;
    margin: auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
    box-shadow: var(--shadow-popover);
    overflow: hidden;
  }
  .story-dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .story-dialog::backdrop {
    background: var(--surface-backdrop);
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .dialog-head h2 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    min-width: 0;
  }
  .dialog-close-btn {
    flex: none;
    min-height: 2.75rem;
    white-space: nowrap;
  }
  .dialog-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
    gap: var(--space-6);
    padding: var(--space-6);
    max-height: calc(92dvh - 4.75rem);
    overflow-y: auto;
  }
  .dialog-stage {
    display: grid;
    place-items: center;
    padding: var(--space-4);
    border-radius: var(--radius-sheet);
    background: var(--desk);
    border: 1px solid var(--border);
    min-height: 20rem;
  }
  .poster-preview-img {
    display: block;
    width: min(100%, 19rem);
    aspect-ratio: 9 / 16;
    height: auto;
    border-radius: var(--radius-sheet);
    box-shadow: var(--shadow-popover);
  }
  .dialog-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  .option-group {
    display: grid;
    gap: var(--space-2);
  }
  .option-label {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
  }
  .segment-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--control-border);
    border-radius: var(--radius-field);
    overflow: hidden;
    background: var(--surface);
  }
  .segment-group button {
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
  .segment-group button + button {
    border-left: 1px solid var(--control-border);
  }
  .segment-group button[aria-pressed='true'] {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .toggle-list {
    border-top: 1px solid var(--border);
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 3rem;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    cursor: pointer;
  }
  .toggle-row input[type='checkbox'] {
    width: 1.25rem;
    height: 1.25rem;
    accent-color: var(--primary);
    flex: none;
  }
  .privacy-notice {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .share-error {
    margin: 0;
    font-size: var(--text-small);
    color: var(--error);
  }
  .dialog-footer {
    margin-top: auto;
    display: grid;
    gap: var(--space-2);
  }
  .dialog-actions {
    display: grid;
    gap: var(--space-2);
  }
  .dialog-actions.two-col {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dialog-actions :is(.button-primary, .button-secondary) {
    min-height: 3rem;
    border-radius: var(--radius-field);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    box-shadow: none;
  }
  .dialog-actions .button-secondary {
    border: 1px solid var(--control-border);
    background: transparent;
  }

  @media (max-width: 767px) {
    .keepsake-dock {
      grid-template-columns: 1fr;
    }
    .story-dialog {
      width: min(100% - var(--space-4), 32rem);
      max-height: calc(100dvh - var(--safe-top) - var(--safe-bottom) - var(--space-4));
      border-radius: var(--radius-header);
    }
    .dialog-head {
      flex: none;
      padding: var(--space-2) var(--space-4);
    }
    .dialog-body {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      max-height: none;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4) 0;
    }
    .dialog-stage {
      flex: none;
      min-height: 0;
      padding: var(--space-2);
    }
    .poster-preview-img {
      height: clamp(8.5rem, 26dvh, 16rem);
      width: auto;
      max-width: 100%;
    }
    .dialog-controls {
      flex: 1 0 auto;
      gap: var(--space-3);
    }
    .dialog-footer {
      position: sticky;
      bottom: 0;
      z-index: 2;
      margin-inline: calc(-1 * var(--space-4));
      padding: var(--space-2) var(--space-4) calc(var(--space-2) + var(--safe-bottom));
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
  }
</style>
