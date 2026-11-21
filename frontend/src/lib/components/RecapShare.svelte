<script lang="ts">
  import { onMount, tick } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { recapFilename, type Recap } from '#lib/recap.ts';

  let { recap, disabled }: { recap: Recap; disabled: boolean } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let trigger: HTMLButtonElement;
  let probe = $state<HTMLElement>(null!);
  let mounted = $state(false);
  let opened = $state(false);
  let dark = false;
  let appearance = $state<'light' | 'dark'>('light');
  let followsPage = true;
  let url = $state('');
  let file = $state<File | null>(null);
  let shareable = $state(false);
  let busy = $state(false);
  let sharing = $state(false);
  let error = $state('');
  let shareError = $state('');
  let token = 0;

  const summary = $derived(
    [
      `${recap.title}，${recap.range}`,
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
      if (opened && followsPage) {
        appearance = dark ? 'dark' : 'light';
        void generate();
      }
    });
    return () => {
      unwatch();
      release();
    };
  });

  $effect(() => {
    if (disabled && opened) close();
  });

  function release() {
    token++;
    if (url) URL.revokeObjectURL(url);
    url = '';
    file = null;
    shareable = false;
  }

  function show() {
    followsPage = true;
    appearance = dark ? 'dark' : 'light';
    opened = true;
    dialog.showModal();
    void generate();
  }

  function close() {
    opened = false;
    release();
    dialog.close();
  }

  async function generate() {
    const source = recap;
    release();
    const mine = token;
    busy = true;
    sharing = false;
    error = '';
    shareError = '';
    try {
      await tick();
      if (mine !== token) return;
      const { renderRecap } = await import('#lib/share/recap-render.ts');
      if (mine !== token) return;
      const blob = await renderRecap(source, probe);
      if (mine !== token) return;
      file = new File([blob], recapFilename(source), { type: 'image/png' });
      url = URL.createObjectURL(blob);
      shareable = typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
    } catch (cause) {
      if (mine === token) error = cause instanceof Error ? cause.message : '分享图生成失败';
    } finally {
      if (mine === token) busy = false;
    }
  }

  async function share() {
    if (!file || !shareable) return;
    const mine = token;
    sharing = true;
    shareError = '';
    try {
      await navigator.share({ files: [file] });
    } catch (cause) {
      if (mine === token && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        shareError = '系统分享失败，可以保存 PNG。';
      }
    } finally {
      if (mine === token) sharing = false;
    }
  }
</script>

<button type="button" bind:this={trigger} class="button-primary" disabled={disabled || !mounted} onclick={show}>
  生成分享图
</button>
<dialog
  bind:this={dialog}
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-disclosure`}
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
  onclose={() => {
    if (!dialog.open && !trigger.disabled) trigger.focus();
  }}
>
  <div class="dialog-heading">
    <h2 id={`${id}-title`}>分享图预览</h2>
    <button type="button" class="button-secondary" onclick={close}>关闭</button>
  </div>
  <p id={`${id}-disclosure`} class="disclosure">图片使用本人聚合数据，包含私人跑步记录的汇总。</p>
  {#if opened}
    <div hidden data-poster-theme={appearance}><div class="sport-theme" bind:this={probe}></div></div>
    <div class="preview">
      {#if url}<img src={url} width="1080" height="1920" alt={summary} />
      {:else if error}
        <FeedbackState kind="error" title={error}>
          <button type="button" class="button-secondary" onclick={generate}>重试生成</button>
        </FeedbackState>
      {:else if busy}
        <FeedbackState kind="loading" title="正在生成分享图…" />
      {/if}
    </div>
    <div class="actions">
      <label
        >图片外观
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
      {#if url && file}
        <a class="button-primary" href={url} download={file.name}>保存 PNG</a>
        {#if shareable}<button type="button" class="button-secondary" onclick={share} disabled={sharing}
            >系统分享</button
          >{/if}
      {/if}
    </div>
    {#if shareError}<p role="alert">{shareError}</p>{/if}
  {/if}
</dialog>

<style>
  .button-primary,
  .button-secondary,
  .text-field {
    min-height: 2.75rem;
  }
  dialog {
    width: min(100% - var(--space-6), 39rem);
    max-height: calc(100dvh - var(--space-6));
    margin: auto;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
  }
  dialog::backdrop {
    background: var(--surface-backdrop);
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .dialog-heading,
  .actions,
  label {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .dialog-heading {
    justify-content: space-between;
  }
  .disclosure {
    margin-block: var(--space-2) var(--space-4);
    font-size: var(--text-small);
  }
  .preview {
    min-height: min(15rem, 36dvh);
    display: grid;
    place-items: center;
    padding: var(--space-3);
    background: var(--background);
    border-radius: var(--radius-control);
  }
  img {
    width: auto;
    max-height: 56dvh;
    max-width: 100%;
    height: auto;
    border: 1px solid var(--border);
  }
  .actions {
    margin-top: var(--space-3);
  }
  label {
    margin-inline-end: auto;
    font-size: var(--text-small);
  }
  .text-field {
    width: auto;
  }
  [role='alert'] {
    margin-top: var(--space-2);
    color: var(--error);
  }
</style>
