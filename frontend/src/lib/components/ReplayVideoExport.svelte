<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { watchSystemTheme } from './system-theme';
  import { isCapacitorNative } from '#lib/capacitor-env.ts';
  import { posterPalette } from '#lib/share/route-poster-render.ts';
  import type { ReplayTrack } from '#lib/replay/engine.ts';
  import {
    VIDEO_ASPECTS,
    VIDEO_LENGTHS,
    VIDEO_QUALITIES,
    exportReplayVideo,
    videoEncoderConfig,
    videoSize,
    type VideoAspect,
    type VideoLength,
    type VideoQuality,
    type VideoStage,
  } from '#lib/replay/video-export.ts';

  let {
    track,
    activityId,
    facts = [],
  }: {
    track: ReplayTrack;
    activityId: string;
    /** Activity date and totals for the video's summary row, already formatted. */
    facts?: [string, string][];
  } = $props();

  const aspectNames: Record<VideoAspect, string> = { '9:16': '9:16 竖屏', '16:9': '16:9 横屏', '1:1': '1:1 方形' };
  let aspect = $state<VideoAspect>('9:16'),
    quality = $state<VideoQuality>('1080p'),
    seconds = $state<VideoLength>(15),
    theme = $state<'light' | 'dark'>('light');
  let status = $state<'checking' | 'ready' | 'unsupported' | 'rendering' | 'done' | 'error'>('checking');
  let stage = $state<VideoStage>('preparing'),
    frame = $state(0),
    frames = $state(0),
    remaining = $state<number | null>(null),
    summary = $state(''),
    error = $state(''),
    url = $state(''),
    plainBackground = $state(false),
    canShare = $state(false),
    sharing = $state(false),
    nativeApp = $state(false);
  // Resolves the chosen appearance's tokens without switching the page theme (as the share images do).
  let probe = $state<HTMLElement>(null!);
  let preview = $state<HTMLCanvasElement>(),
    saveButton = $state<HTMLButtonElement>(),
    resultPanel = $state<HTMLElement>(),
    progressPanel = $state<HTMLElement>();
  let blob: Blob | null = null,
    controller: AbortController | null = null,
    disposed = false,
    renderStart = 0,
    previewAt = 0;
  const stageLabels: Record<VideoStage, string> = {
    preparing: '正在准备地图…',
    basemap: '正在加载底图（网络慢时最多约 8 秒）…',
    rendering: '正在逐帧绘制视频…',
    finishing: '正在生成 MP4 文件…',
  };
  const percent = $derived(stage === 'finishing' ? 100 : frames ? Math.floor((frame / frames) * 100) : 0);
  // Preparing and basemap loading have no measurable amount of work: show an indeterminate bar.
  const determinate = $derived(stage === 'rendering' || stage === 'finishing');
  const previewSize = $derived.by(() => {
    const { width, height } = videoSize(aspect, quality);
    const scale = Math.min(320 / width, 240 / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  });
  const seconds$ = (value: number) =>
    value < 60 ? `${Math.max(1, Math.ceil(value))} 秒` : `${Math.floor(value / 60)} 分 ${Math.ceil(value % 60)} 秒`;
  const busy = $derived(status === 'rendering');
  const filename = () => `runnote-${activityId.slice(0, 8)}-${aspect.replace(':', 'x')}-${quality}.mp4`;

  function release() {
    if (url) URL.revokeObjectURL(url);
    url = '';
    blob = null;
    canShare = false;
    plainBackground = false;
  }
  function choose(apply: () => void) {
    apply();
    if (status === 'done' || status === 'error') {
      release();
      status = 'ready';
      error = '';
    }
  }
  async function start() {
    release();
    error = '';
    stage = 'preparing';
    frame = frames = 0;
    remaining = null;
    renderStart = previewAt = 0;
    const startedAt = performance.now();
    status = 'rendering';
    controller = new AbortController();
    const signal = controller.signal;
    try {
      await tick();
      // The progress card replaces the start button below the options: bring it on screen right away.
      progressPanel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const result = await exportReplayVideo({
        track,
        aspect,
        quality,
        seconds,
        dark: theme === 'dark',
        facts,
        palette: posterPalette(probe),
        signal,
        onprogress: (value) => {
          if (disposed) return;
          stage = value.stage;
          frame = value.frame;
          frames = value.frames;
          if (value.stage !== 'rendering') return;
          const now = performance.now();
          if (value.frame === 1) renderStart = now;
          // Estimate from the measured frame rate once a few frames have settled.
          else if (value.frame >= 10)
            remaining = (((now - renderStart) / (value.frame - 1)) * (value.frames - value.frame)) / 1000;
        },
        onframe: (canvas) => {
          const now = performance.now();
          if (disposed || !preview || now - previewAt < 120) return;
          previewAt = now;
          preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height);
        },
      });
      if (disposed || signal.aborted) return;
      blob = result.blob;
      url = URL.createObjectURL(result.blob);
      plainBackground = !result.basemap;
      summary = `${result.width}×${result.height} · ${seconds} 秒 · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB · 导出用时 ${seconds$((performance.now() - startedAt) / 1000)}`;
      try {
        canShare =
          typeof navigator.share === 'function' &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [new File([result.blob], filename(), { type: 'video/mp4' })] });
      } catch {
        canShare = false;
      }
      status = 'done';
      await tick();
      resultPanel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      saveButton?.focus({ preventScroll: true });
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        status = 'ready';
        return;
      }
      error = cause instanceof Error && cause.message ? cause.message : '视频导出失败，请重试';
      status = 'error';
    } finally {
      controller = null;
    }
  }
  function cancel() {
    controller?.abort();
  }
  function download() {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename();
    document.body.append(link);
    link.click();
    link.remove();
  }
  async function share() {
    if (!blob || !canShare || sharing) return;
    sharing = true;
    try {
      await navigator.share({ files: [new File([blob], filename(), { type: 'video/mp4' })] });
    } catch (cause) {
      if (!disposed && !(cause instanceof DOMException && cause.name === 'AbortError'))
        error = '系统分享未完成，可以保存 MP4 后分享';
    } finally {
      if (!disposed) sharing = false;
    }
  }
  onMount(() => {
    nativeApp = isCapacitorNative();
    let initial = true;
    const stopTheme = watchSystemTheme((dark) => {
      // Start from the site's look; later site theme changes do not override the viewer's choice.
      if (initial) theme = dark ? 'dark' : 'light';
      initial = false;
    });
    void videoEncoderConfig('9:16', '720p').then((config) => {
      if (!disposed && status === 'checking') status = config ? 'ready' : 'unsupported';
    });
    return () => {
      disposed = true;
      controller?.abort();
      stopTheme();
      release();
    };
  });
</script>

<div hidden data-poster-theme={theme}><div class="sport-theme" bind:this={probe}></div></div>
<section class="video-export" aria-labelledby="replay-video-title" aria-busy={busy}>
  <h3 id="replay-video-title">导出视频</h3>
  {#if nativeApp}
    <p class="video-help" role="status">视频导出与 MP4 保存仅支持在浏览器中使用，请在浏览器中打开此页面。</p>
  {:else if status === 'unsupported'}
    <p class="video-help" role="status">
      此浏览器无法导出视频（需要 WebCodecs H.264 编码），请使用最新版 Chrome、Edge 或 Safari。
    </p>
  {:else}
    <div class="video-options">
      <div class="mode-switch compact-switch" role="group" aria-label="画幅">
        {#each VIDEO_ASPECTS as value (value)}<button
            type="button"
            disabled={busy}
            aria-pressed={aspect === value}
            onclick={() => choose(() => (aspect = value))}>{aspectNames[value]}</button
          >{/each}
      </div>
      <div class="mode-switch compact-switch" role="group" aria-label="清晰度">
        {#each VIDEO_QUALITIES as value (value)}<button
            type="button"
            disabled={busy}
            aria-pressed={quality === value}
            onclick={() => choose(() => (quality = value))}>{value}</button
          >{/each}
      </div>
      <div class="mode-switch compact-switch" role="group" aria-label="时长">
        {#each VIDEO_LENGTHS as value (value)}<button
            type="button"
            disabled={busy}
            aria-pressed={seconds === value}
            onclick={() => choose(() => (seconds = value))}>{value} 秒</button
          >{/each}
      </div>
      <div class="mode-switch compact-switch" role="group" aria-label="地图">
        <button
          type="button"
          disabled={busy}
          aria-pressed={theme === 'light'}
          onclick={() => choose(() => (theme = 'light'))}>浅色地图</button
        >
        <button
          type="button"
          disabled={busy}
          aria-pressed={theme === 'dark'}
          onclick={() => choose(() => (theme = 'dark'))}>深色地图</button
        >
      </div>
    </div>
    <p class="video-help">
      MP4（H.264），30 fps，无水印；地图来自
      OpenStreetMap，数据许可要求注明来源，会在数据面板下方单独一行以小字显示。视频包含完整路线和起终点，在本机生成，不会自动上传。导出期间请保持此页面在前台。
    </p>
    <div class="video-actions">
      {#if !busy && status !== 'done'}
        <button
          type="button"
          class="video-start bg-primary text-primary-foreground"
          disabled={status === 'checking'}
          onclick={() => void start()}>开始导出</button
        >
      {/if}
    </div>
    {#if busy}
      <div class="video-progress" data-testid="video-progress" bind:this={progressPanel}>
        <canvas
          bind:this={preview}
          width={previewSize.width}
          height={previewSize.height}
          class="video-preview"
          aria-hidden="true"
        ></canvas>
        <div class="video-progress-body">
          <p class="video-stage" role="status">{stageLabels[stage]}</p>
          <div
            class="video-bar"
            class:indeterminate={!determinate}
            role="progressbar"
            aria-label="视频导出进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? percent : undefined}
            aria-valuetext={determinate ? `${percent}%，第 ${frame} / ${frames} 帧` : stageLabels[stage]}
          >
            <span style:width={determinate ? `${percent}%` : undefined}></span>
          </div>
          <p class="video-count">
            {#if determinate}{percent}% · {frame} / {frames} 帧{#if remaining !== null && stage === 'rendering'}
                · 约剩 {seconds$(remaining)}{/if}{:else}请稍候{/if}
          </p>
          <p class="video-help">关闭回放对话框会取消导出。</p>
          <button type="button" class="button-secondary" onclick={cancel}>取消导出</button>
        </div>
      </div>
    {/if}
    {#if error}<p role="alert" class="video-error">{error}</p>{/if}
    {#if status === 'done' && url}
      <div class="video-result" data-testid="video-result" bind:this={resultPanel}>
        <!-- svelte-ignore a11y_media_has_caption (the export has no audio or spoken content to caption) -->
        <video src={url} controls muted playsinline aria-label="导出视频预览"></video>
        <div class="video-result-body">
          <div role="status">
            <p class="video-result-title">视频已生成</p>
            <p class="video-summary">{summary}</p>
          </div>
          {#if plainBackground}<p class="video-help">底图暂不可用，视频使用了纯色背景。</p>{/if}
          <div class="video-actions">
            <button
              type="button"
              class="video-start bg-primary text-primary-foreground"
              bind:this={saveButton}
              onclick={download}>保存 MP4</button
            >
            {#if canShare}<button type="button" class="button-secondary" disabled={sharing} onclick={() => void share()}
                >{sharing ? '正在分享…' : '分享视频'}</button
              >{/if}
            <button type="button" class="button-secondary" disabled={sharing} onclick={() => void start()}
              >重新导出</button
            >
          </div>
          <p class="video-help">修改上面的选项后点“重新导出”，会按新设置重新生成。</p>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .video-export {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  h3 {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
  }
  .video-options,
  .video-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .video-help {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .video-error {
    color: var(--error);
    font-size: var(--text-small);
  }
  .video-start {
    padding: 0.5rem 1rem;
  }
  /* A brief tint when the panel opens, so choosing 导出视频 visibly lands somewhere. */
  .video-export {
    animation: video-export-arrive 1.2s ease-out;
    border-radius: var(--radius-control);
  }
  @keyframes video-export-arrive {
    from {
      background: var(--primary-soft);
    }
  }
  .video-progress {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .video-preview {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-control);
    background: var(--muted);
  }
  .video-progress-body {
    flex: 1 1 14rem;
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .video-stage {
    font-weight: var(--weight-semibold);
  }
  .video-bar {
    position: relative;
    width: 100%;
    height: 0.625rem;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--segment-track);
  }
  .video-bar span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--primary);
    transition: width 200ms linear;
  }
  .video-bar.indeterminate span {
    width: 35%;
    animation: video-bar-slide 1.2s ease-in-out infinite;
  }
  @keyframes video-bar-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  .video-count,
  .video-summary {
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .video-export,
    .video-bar.indeterminate span {
      animation: none;
    }
    .video-bar span {
      transition: none;
    }
  }
  /* One card: the preview beside its details and actions, stacked on narrow screens. */
  .video-result {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .video-result-body {
    flex: 1 1 16rem;
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  .video-result-title {
    font-weight: var(--weight-semibold);
  }
  video {
    display: block;
    max-width: 100%;
    max-height: min(24rem, 50dvh);
    border-radius: var(--radius-control);
    background: var(--muted);
  }
</style>
