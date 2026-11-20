<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import FeedbackState from './FeedbackState.svelte';
  import BasemapPicker from './BasemapPicker.svelte';
  import { watchSystemTheme } from './system-theme';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  import {
    applyMapTheme,
    createRouteMapStyle,
    type BasemapPreference,
    type BasemapStatus,
    type BasemapStyle,
  } from '#lib/api/map-style.ts';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { loadMapLibre, startAttributionCollapsed } from '#lib/map/maplibre.ts';
  import { REPLAY_SPEEDS, sampleAt, type ReplayPoint, type ReplayState, type ReplayTrack } from '#lib/replay/engine.ts';
  import { createPlayback } from '#lib/replay/playback.ts';
  import { installReplayLayers, type CameraMode, type ReplayLayers } from '#lib/replay/replay-map.ts';

  let {
    track: source,
    exporting = false,
    onexport,
  }: {
    track: ReplayTrack;
    /** Whether the video export panel is open; the button only appears when `onexport` is given. */
    exporting?: boolean;
    onexport?: () => void;
  } = $props();
  // A player belongs to one track; the dialog remounts it ({#key}) for another.
  const track = untrack(() => source);

  // Digits changing 60 times a second are unreadable; the map and slider still move every frame.
  const READOUT_INTERVAL_MS = 125;
  const first = sampleAt(track, 0);
  let container: HTMLDivElement;
  let playState = $state<ReplayState>({ status: 'idle', time: 0, speed: 1 });
  let readout = $state.raw<ReplayPoint>(first);
  // 'free' after the viewer pans or rotates by hand: neither camera button is pressed then.
  let camera = $state<CameraMode>('overview');
  let ready = $state(false),
    error = $state('');
  let basemapStatus = $state<BasemapStatus>('loading'),
    basemapPreference = $state<BasemapPreference>('auto'),
    basemapStyle = $state<BasemapStyle>('positron');
  let map: MapLibreMap | undefined,
    layers: ReplayLayers | undefined,
    basemap: ReturnType<typeof createBasemapController> | undefined;
  let current = first,
    hint = 0,
    readoutAt = -Infinity,
    siteDark = false,
    disposed = false;
  const real = track.mode === 'real';
  const playback = createPlayback(track.duration, track.rate, (next) => {
    playState = next;
    draw(next.time, next.status !== 'playing');
  });
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The replay layers follow the basemap's own lightness, as the route map does.
  const mapDark = () => (!basemap || basemapStatus === 'failed' ? siteDark : basemapStyle === 'dark');

  function draw(time: number, settle = false) {
    current = sampleAt(track, time, hint);
    hint = current.index;
    const now = performance.now();
    layers?.update(current);
    if (settle || now - readoutAt >= READOUT_INTERVAL_MS) {
      readout = current;
      readoutAt = now;
    }
  }
  function toggle() {
    if (playState.status === 'playing') playback.pause();
    else playback.play();
  }
  function setCamera(mode: 'overview' | 'follow') {
    if (mode === 'overview') layers?.overview(!reduceMotion());
    else layers?.follow(!reduceMotion());
  }

  onMount(() => {
    const stopTheme = watchSystemTheme((value) => {
      siteDark = value;
      if (map && !basemap) applyMapTheme(map, value);
      layers?.theme(mapDark());
    });
    let stopAttribution: (() => void) | undefined;
    let observer: ResizeObserver | undefined,
      resizeFrame = 0;
    void (async () => {
      try {
        const lib = await loadMapLibre();
        if (disposed) return;
        const instance = new lib.Map({
          container,
          style: createRouteMapStyle(siteDark),
          center: [first.lon, first.lat],
          zoom: 14,
          attributionControl: false,
          maxZoom: 19,
        });
        map = instance;
        instance.addControl(new lib.AttributionControl({ compact: true }), 'bottom-right');
        stopAttribution = startAttributionCollapsed(container);
        instance.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('webglcontextlost', () => {
          basemap?.destroy();
          error = '地图绘图上下文已丢失，请关闭后重新打开回放。';
        });
        instance.on('error', (event) => {
          if (!disposed && 'sourceId' in event && String(event.sourceId).startsWith('replay-'))
            error = '回放绘制失败，请关闭后重试。';
        });
        instance.on('load', () => {
          if (disposed) return;
          const runner = document.createElement('span');
          runner.className = 'replay-runner';
          runner.setAttribute('aria-hidden', 'true');
          layers = installReplayLayers(instance, lib, track, siteDark, {
            runner,
            onmode: (mode) => {
              camera = mode;
            },
          });
          layers.overview(false);
          draw(playState.time, true);
          instance.once('idle', () => {
            if (!disposed) ready = true;
          });
          // Frame the local track before the basemap starts requesting viewport tiles.
          requestAnimationFrame(() => {
            if (disposed) return;
            basemap = createBasemapController(instance, 'replay-base', (value) => {
              basemapStatus = value.status;
              basemapPreference = value.preference;
              basemapStyle = value.style;
              layers?.theme(mapDark());
            });
          });
        });
        observer = new ResizeObserver(() => {
          if (resizeFrame) return;
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            if (disposed || !layers) return;
            instance.resize();
            layers.resized();
          });
        });
        observer.observe(container);
      } catch {
        if (!disposed) error = '此浏览器无法初始化地图，请使用支持 WebGL 的浏览器。';
      }
    })();
    return () => {
      disposed = true;
      playback.destroy();
      stopTheme();
      stopAttribution?.();
      basemap?.destroy();
      observer?.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      layers?.destroy();
      map?.remove();
      map = undefined;
    };
  });
</script>

<div class="replay-player">
  <div class="replay-stage">
    <div
      bind:this={container}
      class="replay-map"
      role="region"
      aria-label="轨迹动态回放地图，彩色线为已完成路段，圆点为当前位置"
      data-testid={ready ? 'replay-map-ready' : 'replay-map-loading'}
    ></div>
    <div class="replay-basemap">
      <BasemapPicker preference={basemapPreference} style={basemapStyle} status={basemapStatus} />
    </div>
    {#if error}<div class="replay-status"><FeedbackState kind="error" title={error} /></div>
    {:else if !ready}<div class="replay-status"><FeedbackState kind="loading" title="正在绘制回放…" /></div>{/if}
  </div>

  <dl class="replay-readout">
    <div>
      <dt>距离</dt>
      <dd data-testid="replay-distance">{formatDistance(readout.distance)}</dd>
    </div>
    <div>
      <dt>{real ? '经过时间' : '模拟用时'}</dt>
      <dd data-testid="replay-elapsed">{formatDuration(readout.elapsed)}</dd>
    </div>
    {#if real}<div>
        <dt>运动时间</dt>
        <dd data-testid="replay-moving">{formatDuration(readout.moving)}</dd>
      </div>{/if}
    <div>
      <dt>当前配速</dt>
      <dd data-testid="replay-pace">
        {#if real && readout.pace !== null}{formatPace(readout.pace)}{:else}—<span class="sr-only"
            >{real ? '（静止或信号中断，暂无配速）' : '（模拟回放不显示配速）'}</span
          >{/if}
      </dd>
    </div>
  </dl>

  <div class="replay-controls">
    <button
      type="button"
      class="replay-play bg-primary text-primary-foreground"
      onclick={toggle}
      disabled={!!error}
      data-testid="replay-toggle"
    >
      {#if playState.status === 'playing'}<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
          ><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg
        >暂停{:else}<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
          ><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg
        >{playState.status === 'ended' ? '重新开始' : '播放'}{/if}
    </button>
    <button type="button" class="button-secondary" onclick={() => playback.restart()} disabled={!!error}
      >重新播放</button
    >
    <label class="replay-scrub">
      <span class="sr-only">回放进度</span>
      <input
        type="range"
        min="0"
        max={track.duration}
        step="any"
        value={playState.time}
        disabled={!!error}
        aria-valuetext={`${real ? '经过时间' : '模拟用时'} ${formatDuration(readout.elapsed)}，距离 ${formatDistance(readout.distance)}`}
        oninput={(event) => playback.seek(Number(event.currentTarget.value))}
      />
    </label>
    <span class="replay-time" data-testid="replay-time"
      >{formatDuration(readout.elapsed)} / {formatDuration(track.totals.elapsed)}</span
    >
  </div>

  <div class="replay-options">
    <div class="mode-switch compact-switch" role="group" aria-label="播放速度">
      {#each REPLAY_SPEEDS as speed (speed)}<button
          type="button"
          aria-pressed={playState.speed === speed}
          onclick={() => playback.setSpeed(speed)}>{speed}x</button
        >{/each}
    </div>
    <div class="mode-switch compact-switch" role="group" aria-label="镜头">
      <button type="button" aria-pressed={camera === 'overview'} onclick={() => setCamera('overview')}>全局视角</button>
      <button type="button" aria-pressed={camera === 'follow'} onclick={() => setCamera('follow')}>镜头跟随</button>
    </div>
    {#if onexport}<button
        type="button"
        class="button-secondary replay-export"
        aria-expanded={exporting}
        aria-controls="replay-video-panel"
        onclick={onexport}
        ><svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg
        >导出视频</button
      >{/if}
  </div>
</div>

<style>
  .replay-player {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .replay-stage {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
  }
  .replay-map {
    height: clamp(16rem, 52dvh, 34rem);
  }
  .replay-basemap {
    position: absolute;
    left: var(--space-3);
    top: var(--space-3);
    z-index: 2;
  }
  .replay-status {
    position: absolute;
    inset: 3.5rem var(--space-4) auto;
    background: var(--surface);
    border-radius: var(--radius-control);
  }
  .replay-map :global(.replay-runner) {
    width: 1.125rem;
    height: 1.125rem;
    border: 3px solid var(--primary-foreground);
    border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 1px 6px var(--glass-shadow);
  }
  .replay-readout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: var(--space-3);
  }
  .replay-readout > div {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .replay-readout dt {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .replay-readout dd {
    margin-top: var(--space-1);
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .replay-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .replay-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: 7.5rem;
    padding: 0.5rem 1rem;
  }
  .replay-scrub {
    flex: 1 1 12rem;
    min-width: 0;
    display: flex;
  }
  .replay-scrub input {
    width: 100%;
    min-height: 2.75rem;
    border: 0;
    background: transparent;
    accent-color: var(--primary);
  }
  .replay-time {
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .replay-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  /* Speed on the left; camera and export grouped on the right. */
  .replay-options > :nth-child(2) {
    margin-left: auto;
  }
  @media (max-width: 639px) {
    .replay-player {
      gap: var(--space-3);
    }
    .replay-map {
      height: clamp(12rem, 32dvh, 18rem);
    }
    .replay-readout dd {
      font-size: var(--text-body);
    }
    .replay-play {
      flex: 1;
    }
  }
</style>
