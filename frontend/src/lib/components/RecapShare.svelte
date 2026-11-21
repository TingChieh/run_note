<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
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
    // Re-render the compact Chapter 04 dock preview whenever recap, style, or appearance changes.
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
      // Dock preview is non-blocking; users can still open the full dialog.
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

  function toggleAppearance() {
    followsPage = false;
    appearance = appearance === 'light' ? 'dark' : 'light';
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

<!-- Hidden token probe for the live Chapter 04 mini poster preview. -->
<div hidden data-poster-theme={appearance}>
  <div class="sport-theme" bind:this={dockProbe}></div>
</div>

<!-- Chapter 04: Keepsake Poster Dock -->
<section class="poster-dock" aria-labelledby={`${id}-dock-title`} data-testid="recap-poster-dock">
  <div class="dock-copy">
    <p class="chapter-num">04 · KEEPSAKE POSTER</p>
    <h2 id={`${id}-dock-title`}>封存这一期的 9:16 跑步海报</h2>
    <p class="dock-meta">
      仅绘入周期日期、服务端聚合数字、无坐标里程分布与 RunNote 通用字标。提供特刊、环道与存根三款 1080×1920 版式，本机
      Canvas 2D 实时生成。
    </p>
    <div class="dock-style-row">
      <div class="settings-tabs style-tabs" role="group" aria-label="快捷切换海报版式">
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
    </div>
    <div class="dock-actions">
      <button
        type="button"
        bind:this={dockOpenBtn}
        class="button-primary"
        disabled={disabled || !mounted}
        onclick={() => open(dockOpenBtn)}
      >
        打开高清预览与保存
      </button>
      <button type="button" class="button-secondary" disabled={disabled || !mounted} onclick={toggleAppearance}>
        {appearance === 'light' ? '切换深色海报预览' : '切换浅色海报预览'}
      </button>
    </div>
  </div>

  <button
    type="button"
    data-date={recap.dateFrom}
    bind:this={dockFrameBtn}
    class="dock-frame"
    disabled={disabled || !mounted}
    aria-label="放大预览并保存 1080×1920 分享海报"
    onclick={() => open(dockFrameBtn)}
  >
    {#if dockUrl}
      <img src={dockUrl} width="360" height="640" alt={`${recap.title}${activeStyleMeta.name}版式缩略预览`} />
    {:else}
      <span class="dock-placeholder" aria-hidden="true">9:16</span>
    {/if}
  </button>
</section>

<!-- Native 1080×1920 Share Preview Dialog -->
<dialog
  bind:this={dialog}
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
          <a class="button-primary" href={url} download={file.name}>保存 PNG</a>
          {#if shareable}
            <button type="button" class="button-secondary" onclick={share} disabled={sharing}>系统分享</button>
          {/if}
        {/if}
      </div>
    </div>
    {#if shareError}<p role="alert">{shareError}</p>{/if}
  {/if}
</dialog>

<style>
  .poster-dock {
    margin-top: var(--space-6);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-8);
    padding: clamp(1.25rem, 3vw, 2.25rem);
    border-radius: var(--radius-card);
    background: linear-gradient(120deg, var(--recap-dock-tint) 0%, var(--surface) 68%);
    border: 1px solid var(--border);
  }
  .dock-copy {
    min-width: 0;
  }
  .chapter-num {
    margin: 0 0 var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-caps);
    color: var(--primary);
  }
  .dock-copy h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-heading);
  }
  .dock-meta {
    margin: var(--space-2) 0 var(--space-4);
    max-width: 36rem;
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .dock-style-row {
    margin-bottom: var(--space-4);
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
  .dock-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .dock-frame {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: 0 14px 32px rgb(0 0 0 / 0.14);
    transform: rotate(1.5deg);
    transition:
      transform var(--motion-hover),
      box-shadow var(--motion-hover);
    cursor: pointer;
  }
  .dock-frame:hover:not(:disabled) {
    transform: rotate(0deg) translateY(-4px);
    box-shadow: 0 20px 40px rgb(0 0 0 / 0.2);
  }
  .dock-frame img {
    display: block;
    width: 11rem;
    aspect-ratio: 9 / 16;
    height: auto;
    border-radius: var(--radius-control);
    object-fit: cover;
  }
  .dock-placeholder {
    display: grid;
    place-items: center;
    width: 11rem;
    aspect-ratio: 9 / 16;
    border-radius: var(--radius-control);
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
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
  [role='alert'] {
    margin-top: var(--space-2);
    color: var(--error);
    font-size: var(--text-small);
  }
  @media (prefers-reduced-motion: reduce) {
    .dock-frame {
      transform: none;
      transition: none;
    }
    .dock-frame:hover:not(:disabled) {
      transform: none;
    }
  }
  @media (max-width: 639px) {
    .poster-dock {
      grid-template-columns: 1fr;
      gap: var(--space-4);
    }
    .dock-frame {
      justify-self: center;
      transform: none;
    }
    .dock-actions button {
      flex: 1 1 11rem;
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
    .poster-dock {
      background: Canvas;
      border-color: ButtonText;
    }
  }
</style>
