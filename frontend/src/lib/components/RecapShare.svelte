<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { isCapacitorNative } from '#lib/capacitor-env.ts';
  import { recapFilename, recapPosterStyles, type Recap, type RecapPosterStyle } from '#lib/recap.ts';

  let { recap, disabled }: { recap: Recap; disabled: boolean } = $props();

  const id = $props.id();
  let dialog = $state<HTMLDialogElement>(null!);
  let dockOpenBtn = $state<HTMLButtonElement>(null!);
  let dockFrameBtn = $state<HTMLButtonElement>(null!);
  let closeBtn = $state<HTMLButtonElement>(null!);
  let dialogProbe = $state<HTMLElement>(null!);
  let dockProbe = $state<HTMLElement>(null!);
  let returnFocusTo: HTMLElement | null = null;

  let mounted = $state(false);
  let nativeApp = $state(false);
  let opened = $state(false);
  let dark = false;
  let appearance = $state<'light' | 'dark'>('light');
  let style = $state<RecapPosterStyle>('editorial');
  let followsPage = true;

  // Dialog full-resolution 1080×1920 PNG state (generated on demand, revoked on switch/close).
  let url = $state('');
  let file = $state<File | null>(null);
  let shareable = $state(false);
  let busy = $state(false);
  let sharing = $state(false);
  let error = $state('');
  let shareError = $state('');
  let dialogToken = 0;

  // Dock live mini-poster preview (1/3 scale 360×640, lightweight & fast).
  let dockUrl = $state('');
  let dockToken = 0;
  let disposed = false;

  const activeStyleMeta = $derived(recapPosterStyles.find((item) => item.id === style) ?? recapPosterStyles[0]);

  const summary = $derived(
    [
      `${recap.title}，${recap.range}`,
      `版式 ${activeStyleMeta.code} ${activeStyleMeta.name}`,
      `总里程 ${recap.distance} km`,
      ...recap.metrics.map(
        ({ label, value, unit }) => `${label} ${value === '—' ? '数据缺失' : [value, unit].filter(Boolean).join(' ')}`,
      ),
    ].join('。'),
  );

  onMount(() => {
    mounted = true;
    nativeApp = isCapacitorNative();
    const unwatch = watchSystemTheme((isDark) => {
      dark = isDark;
      if (followsPage) {
        appearance = dark ? 'dark' : 'light';
        void renderDockPreview();
        if (opened) void generate();
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
    // Re-render the compact share desk preview whenever recap, style, or appearance changes.
    void recap;
    void style;
    void appearance;
    untrack(() => void renderDockPreview());
  });

  function releaseDialog() {
    dialogToken++;
    if (url) URL.revokeObjectURL(url);
    url = '';
    file = null;
    shareable = false;
  }

  function releaseDock() {
    dockToken++;
    if (dockUrl) URL.revokeObjectURL(dockUrl);
    dockUrl = '';
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
    if (target && !('disabled' in target && (target as HTMLButtonElement).disabled)) {
      target.focus();
    }
  }

  async function renderDockPreview() {
    if (!mounted || disposed) return;
    const source = recap;
    const targetStyle = style;
    const mine = ++dockToken;
    try {
      await tick();
      if (disposed || mine !== dockToken || !dockProbe) return;
      const { renderRecap } = await import('#lib/share/recap-render.ts');
      if (disposed || mine !== dockToken || !dockProbe) return;
      const blob = await renderRecap(source, dockProbe, { style: targetStyle, scale: 1 / 3 });
      if (disposed || mine !== dockToken) return;
      const nextUrl = URL.createObjectURL(blob);
      if (dockUrl) URL.revokeObjectURL(dockUrl);
      dockUrl = nextUrl;
    } catch {
      // Desk preview is non-blocking; users can still open the full dialog.
    }
  }

  async function generate() {
    const source = recap;
    const targetStyle = style;
    releaseDialog();
    const mine = dialogToken;
    busy = true;
    sharing = false;
    error = '';
    shareError = '';
    try {
      await tick();
      if (disposed || mine !== dialogToken || !dialogProbe) return;
      const { renderRecap } = await import('#lib/share/recap-render.ts');
      if (disposed || mine !== dialogToken || !dialogProbe) return;
      const blob = await renderRecap(source, dialogProbe, { style: targetStyle });
      if (disposed || mine !== dialogToken) return;
      file = new File([blob], recapFilename(source), { type: 'image/png' });
      url = URL.createObjectURL(blob);
      shareable = typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
    } catch (cause) {
      if (!disposed && mine === dialogToken) error = cause instanceof Error ? cause.message : '分享图生成失败';
    } finally {
      if (!disposed && mine === dialogToken) busy = false;
    }
  }

  function selectStyle(next: RecapPosterStyle) {
    if (style === next || sharing) return;
    style = next;
    if (opened) void generate();
  }

  function setAppearance(next: 'light' | 'dark') {
    if (appearance === next) return;
    followsPage = false;
    appearance = next;
    if (opened) void generate();
  }

  async function share() {
    if (!file || !shareable) return;
    const mine = dialogToken;
    sharing = true;
    shareError = '';
    try {
      await navigator.share({ files: [file] });
    } catch (cause) {
      if (!disposed && mine === dialogToken && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        shareError = '系统分享失败，可以保存 PNG。';
      }
    } finally {
      if (!disposed && mine === dialogToken) sharing = false;
    }
  }
</script>

<!-- Hidden token probe for the live share desk mini poster preview. -->
<div hidden data-poster-theme={appearance}>
  <div class="sport-theme" bind:this={dockProbe}></div>
</div>

<!-- Sticky Editorial Share Desk (brand.md §4, web-audit W-12) -->
<section class="share-desk" aria-labelledby={`${id}-dock-title`} data-testid="recap-poster-dock">
  <button
    type="button"
    data-date={recap.dateFrom}
    bind:this={dockFrameBtn}
    class="desk-frame"
    disabled={disabled || !mounted}
    aria-label="放大预览并保存 1080×1920 分享海报"
    onclick={() => open(dockFrameBtn)}
  >
    {#if dockUrl}
      <img src={dockUrl} width="360" height="640" alt={`${recap.title}${activeStyleMeta.name}版式缩略预览`} />
    {:else}
      <span class="desk-placeholder" aria-hidden="true">9:16</span>
    {/if}
  </button>

  <div class="desk-controls">
    <h2 id={`${id}-dock-title`}>分享图</h2>

    <div class="appearance-row" role="group" aria-label="海报外观">
      <button
        type="button"
        class="appearance-btn"
        aria-pressed={appearance === 'light'}
        disabled={disabled || !mounted}
        onclick={() => setAppearance('light')}
      >
        浅色纸面
      </button>
      <button
        type="button"
        class="appearance-btn"
        aria-pressed={appearance === 'dark'}
        disabled={disabled || !mounted}
        onclick={() => setAppearance('dark')}
      >
        深色暖炭
      </button>
    </div>

    <div class="underline-tabs desk-style-tabs" role="group" aria-label="快捷切换海报版式">
      {#each recapPosterStyles as preset (preset.id)}
        <button
          type="button"
          aria-pressed={style === preset.id}
          disabled={disabled || !mounted}
          onclick={() => selectStyle(preset.id)}
        >
          {preset.code}
          {preset.name}
        </button>
      {/each}
    </div>

    <button
      type="button"
      bind:this={dockOpenBtn}
      class="button-primary desk-launch"
      disabled={disabled || !mounted}
      onclick={() => open(dockOpenBtn)}
    >
      打开高清预览与保存
    </button>

    <p class="desk-caption">
      分享图仅含周期日期、汇总数字与无坐标节律，不含姓名、账号、坐标、地点、备注或身心健康数据。
    </p>
  </div>
</section>

<!-- Native 1080×1920 Share Preview Dialog (preserves Liquid Glass boundary on modal controls) -->
<dialog
  bind:this={dialog}
  data-glass-overlay
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-disclosure`}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onclose={handleDialogClose}
>
  <div class="dialog-heading">
    <h2 id={`${id}-title`}>分享图预览</h2>
    <button type="button" bind:this={closeBtn} class="button-secondary" onclick={close}>关闭</button>
  </div>
  <p id={`${id}-disclosure`} class="disclosure">
    图片使用本人聚合数据，包含私人跑步记录的汇总。不含姓名、账号、路线坐标或地点，仅在本机生成。
  </p>
  {#if opened}
    <div hidden data-poster-theme={appearance}>
      <div class="sport-theme" bind:this={dialogProbe}></div>
    </div>

    <div class="style-bar">
      <span class="control-label">海报版式</span>
      <div class="settings-tabs style-tabs" role="group" aria-label="分享图版式" data-testid="recap-poster-styles">
        {#each recapPosterStyles as preset (preset.id)}
          <button
            type="button"
            aria-pressed={style === preset.id}
            disabled={sharing}
            onclick={() => selectStyle(preset.id)}
          >
            {preset.code}
            {preset.name}
          </button>
        {/each}
      </div>
      <span class="style-desc">{activeStyleMeta.description}</span>
    </div>

    <div class="preview">
      {#if url}
        <img src={url} width="1080" height="1920" alt={summary} />
      {:else if error}
        <FeedbackState kind="error" title={error}>
          <button type="button" class="button-secondary" onclick={generate}>重试生成</button>
        </FeedbackState>
      {:else if busy}
        <FeedbackState kind="loading" title="正在生成分享图…" />
      {/if}
    </div>

    <div class="actions">
      <label class="appearance-field">
        图片外观
        <select
          class="text-field"
          bind:value={appearance}
          disabled={sharing}
          onchange={() => {
            followsPage = false;
            void generate();
          }}
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <div class="action-buttons">
        {#if url && file}
          {#if !nativeApp}<a class="button-primary" href={url} download={file.name}>保存 PNG</a>{/if}
          {#if shareable}
            <button type="button" class="button-secondary" onclick={share} disabled={sharing}>系统分享</button>
          {/if}
        {/if}
      </div>
    </div>
    {#if nativeApp && !shareable}<p class="hint" role="status">
        当前客户端暂不支持直接保存图片文件，请在浏览器中打开保存 PNG。
      </p>{/if}
    {#if shareError}<p role="alert">{shareError}</p>{/if}
  {/if}
</dialog>

<style>
  .share-desk {
    display: grid;
    gap: var(--space-4);
    align-content: start;
    min-width: 0;
  }
  .desk-frame {
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--desk);
    box-shadow: var(--shadow-popover);
    overflow: hidden;
    cursor: pointer;
    transition: transform var(--motion-hover);
  }
  .desk-frame:hover:not(:disabled) {
    transform: translateY(-2px);
  }
  .desk-frame:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  .desk-frame img {
    display: block;
    width: 100%;
    aspect-ratio: 9 / 16;
    height: auto;
    object-fit: cover;
  }
  .desk-placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 9 / 16;
    background: var(--desk);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }

  .desk-controls {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .desk-controls h2 {
    margin: 0;
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .appearance-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--control-border);
    border-radius: var(--radius-control);
    overflow: hidden;
  }
  .appearance-btn {
    min-height: 2.75rem;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition:
      background-color var(--transition-control),
      color var(--transition-control);
  }
  .appearance-btn + .appearance-btn {
    border-left: 1px solid var(--control-border);
  }
  .appearance-btn[aria-pressed='true'] {
    background: var(--foreground);
    color: var(--background);
    font-weight: var(--weight-semibold);
  }
  .appearance-btn:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  .desk-style-tabs {
    border-bottom: 1px solid var(--border);
  }
  .desk-launch {
    width: 100%;
  }
  .desk-caption {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
  }

  /* Native Share Preview Dialog */
  .button-primary,
  .button-secondary,
  .text-field {
    min-height: 2.75rem;
  }
  dialog {
    width: min(100% - var(--space-6), 42rem);
    max-height: calc(100dvh - var(--space-6));
    margin: auto;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
    overflow-y: auto;
  }
  dialog::backdrop {
    background: var(--surface-backdrop);
  }
  dialog h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .dialog-heading,
  .style-bar,
  .actions,
  .action-buttons,
  .appearance-field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .dialog-heading {
    justify-content: space-between;
  }
  .disclosure {
    margin-block: var(--space-2) var(--space-3);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .style-bar {
    margin-bottom: var(--space-3);
  }
  .style-tabs {
    margin: 0;
    width: max-content;
    max-width: 100%;
  }
  .style-tabs button {
    min-height: 2.5rem;
    white-space: nowrap;
  }
  .control-label,
  .style-desc {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .control-label {
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .preview {
    min-height: min(16rem, 36dvh);
    display: grid;
    place-items: center;
    padding: var(--space-3);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .preview img {
    width: auto;
    max-height: 52dvh;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-field);
    border: 1px solid var(--border);
  }
  .actions {
    margin-top: var(--space-3);
    justify-content: space-between;
  }
  .appearance-field {
    font-size: var(--text-small);
  }
  .text-field {
    width: auto;
  }
  .hint {
    margin-top: var(--space-2);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  [role='alert'] {
    margin-top: var(--space-2);
    color: var(--error);
    font-size: var(--text-small);
  }

  @media (prefers-reduced-motion: reduce) {
    .desk-frame {
      transition: none;
    }
    .desk-frame:hover:not(:disabled) {
      transform: none;
    }
  }
  @media (min-width: 1080px) {
    /* Fit the sticky share desk (poster + controls through the primary save CTA) within both
       above-the-fold scrollY=0 (below the page masthead) and mid/bottom sticky scroll on 1440×768+,
       while preserving the two-column 20rem desk and tall 9:16 preview at 1440×900+. */
    .share-desk {
      gap: var(--space-3);
    }
    .desk-controls {
      gap: var(--space-2);
    }
    .desk-frame {
      width: fit-content;
      max-width: 100%;
      justify-self: center;
    }
    .desk-frame img,
    .desk-placeholder {
      width: auto;
      height: clamp(14rem, calc(100dvh - 27.5rem), 33rem);
      max-width: 100%;
      aspect-ratio: 9 / 16;
    }
  }
  @media (min-width: 640px) and (max-width: 1079px) {
    .share-desk {
      padding-top: var(--space-6);
      border-top: 2px solid var(--rule);
      grid-template-columns: 13.5rem minmax(0, 1fr);
      gap: var(--space-6);
      align-items: start;
    }
  }
  @media (max-width: 639px) {
    .share-desk {
      padding-top: var(--space-6);
      border-top: 2px solid var(--rule);
    }
    .desk-frame {
      max-width: 15rem;
      justify-self: center;
    }
    dialog {
      padding: var(--space-4);
    }
    .style-tabs {
      width: 100%;
    }
    .style-tabs button {
      flex: 1;
    }
  }
  @media (forced-colors: active) {
    .desk-frame,
    .appearance-row {
      border-color: ButtonText;
    }
    .appearance-btn[aria-pressed='true'] {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
