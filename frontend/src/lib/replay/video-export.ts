import type { Map as MapLibreMap } from 'maplibre-gl';
import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
import { applyMapTheme, createRouteMapStyle, type BasemapStatus } from '#lib/api/map-style.ts';
import { createBasemapController } from '#lib/map/basemap-controller.ts';
import { loadMapLibre } from '#lib/map/maplibre.ts';
import type { PosterPalette } from '#lib/share/route-poster-render.ts';
import { sampleAt, type ReplayPoint, type ReplayTrack } from './engine.ts';
import { muxMp4, type Mp4Sample } from './mp4.ts';
import { installReplayLayers } from './replay-map.ts';

export type VideoAspect = '9:16' | '16:9' | '1:1';
export type VideoQuality = '720p' | '1080p';
export type VideoLength = 15 | 30 | 60;
export const VIDEO_ASPECTS: VideoAspect[] = ['9:16', '16:9', '1:1'];
export const VIDEO_QUALITIES: VideoQuality[] = ['720p', '1080p'];
export const VIDEO_LENGTHS: VideoLength[] = [15, 30, 60];
export const VIDEO_FPS = 30;
// The finished route stays on screen briefly so the last frame is not a cut.
const HOLD_SECONDS = 1.5;
const KEYFRAME_SECONDS = 2;
const FRAME_SETTLE_TIMEOUT_MS = 4000;
// Overlay geometry in units of 1/1080 of the short side, shared by drawing and framing.
const MARGIN = 48;
const STATS_HEIGHT = 172;
// The activity summary under the live numbers: a grid that wraps onto a second row in narrow frames.
const FACTS_PADDING = 20;
const FACTS_ROW_HEIGHT = 96;
// The attribution sits in its own row under the stats panel, never over the numbers.
const ATTRIBUTION_HEIGHT = 30;
const ATTRIBUTION_GAP = 10;
const MAX_FACTS = 8;
const BITRATE: Record<VideoQuality, number> = { '720p': 4_000_000, '1080p': 8_000_000 };
// High, Main, then Baseline profile; level 3.1 covers 720p, level 4.0 covers 1080p (incl. 1080×1920).
const CODECS: Record<VideoQuality, string[]> = {
  '720p': ['avc1.64001f', 'avc1.4d001f', 'avc1.42001f'],
  '1080p': ['avc1.640028', 'avc1.4d0028', 'avc1.420028'],
};
// OpenStreetMap (ODbL) and OpenMapTiles require visible attribution; it is not a watermark.
const ATTRIBUTION = '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap';

export type VideoStage = 'preparing' | 'basemap' | 'rendering' | 'finishing';
export interface VideoProgress {
  stage: VideoStage;
  /** Frames drawn so far and in total; both 0 before rendering starts. */
  frame: number;
  frames: number;
}
export interface VideoRequest {
  track: ReplayTrack;
  aspect: VideoAspect;
  quality: VideoQuality;
  seconds: VideoLength;
  dark: boolean;
  palette: PosterPalette;
  /** Activity date and totals shown under the live numbers, as already formatted label/value pairs. */
  facts?: [string, string][];
  signal: AbortSignal;
  onprogress?: (progress: VideoProgress) => void;
  /** Called with the composed frame canvas after each frame, for a live preview. */
  onframe?: (canvas: HTMLCanvasElement) => void;
}
export interface VideoResult {
  blob: Blob;
  width: number;
  height: number;
  /** False when the basemap could not load and the video shows the plain local background. */
  basemap: boolean;
}

export function videoSize(aspect: VideoAspect, quality: VideoQuality) {
  const short = quality === '1080p' ? 1080 : 720,
    long = quality === '1080p' ? 1920 : 1280;
  if (aspect === '9:16') return { width: short, height: long };
  if (aspect === '16:9') return { width: long, height: short };
  return { width: short, height: short };
}

/** First H.264 configuration this browser can encode, or null when video export is unavailable. */
export async function videoEncoderConfig(
  aspect: VideoAspect,
  quality: VideoQuality,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') return null;
  const { width, height } = videoSize(aspect, quality);
  for (const codec of CODECS[quality]) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: BITRATE[quality],
      framerate: VIDEO_FPS,
      avc: { format: 'avc' },
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // An unknown codec string throws in some browsers; try the next profile.
    }
  }
  return null;
}

/** Playback time of video frame `frame`: travel across the whole track, then hold the finished route. */
export function frameTime(frame: number, seconds: number, duration: number): number {
  const travel = Math.max(1, Math.round((seconds - HOLD_SECONDS) * VIDEO_FPS) - 1);
  return Math.min(1, frame / travel) * duration;
}

const abortError = () => new DOMException('导出已取消', 'AbortError');
const copy = (source: AllowSharedBufferSource) =>
  ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
    : new Uint8Array(source.slice(0));

function settle(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      map.off('idle', finish);
      signal.removeEventListener('abort', stop);
      resolve();
    };
    const stop = () => {
      clearTimeout(timer);
      map.off('idle', finish);
      reject(abortError());
    };
    // A tile that never arrives must not stall the export; the frame then shows what has loaded.
    const timer = setTimeout(finish, FRAME_SETTLE_TIMEOUT_MS);
    signal.addEventListener('abort', stop, { once: true });
    map.once('idle', finish);
    map.triggerRepaint();
  });
}

/** Summary columns: four in portrait and square frames, all in one row in landscape. */
function factColumns(facts: number, width: number, height: number) {
  return Math.max(1, Math.min(facts, width > height ? MAX_FACTS : 4));
}
function statsHeight(facts: number, columns: number) {
  return STATS_HEIGHT + (facts ? FACTS_PADDING + Math.ceil(facts / columns) * FACTS_ROW_HEIGHT : 0);
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  ratio: number,
  point: ReplayPoint,
  pace: number | null,
  request: VideoRequest,
  basemap: boolean,
) {
  const { width, height } = ctx.canvas;
  const { palette, track } = request;
  const facts = (request.facts ?? []).slice(0, MAX_FACTS);
  const u = Math.min(width, height) / 1080;
  const margin = MARGIN * u;
  ctx.drawImage(map.getCanvas(), 0, 0, width, height);

  const at = map.project([point.lon, point.lat]);
  ctx.beginPath();
  ctx.arc(at.x * ratio, at.y * ratio, 13 * u, 0, Math.PI * 2);
  ctx.fillStyle = palette.route;
  ctx.fill();
  ctx.lineWidth = 5 * u;
  ctx.strokeStyle = palette.surface;
  ctx.stroke();

  const panel = (x: number, y: number, w: number, h: number, radius = 24 * u, alpha = 0.9) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
  };
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    weight = 400,
    align: CanvasTextAlign = 'left',
  ) => {
    ctx.font = `${weight} ${size}px ${palette.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };

  ctx.textBaseline = 'alphabetic';

  // Bottom stack, from the frame edge up: margin, attribution row, gap, stats panel.
  const inner = width - 2 * margin;
  const attributionTop = height - margin - ATTRIBUTION_HEIGHT * u;
  const columns = factColumns(facts.length, width, height);
  const panelHeight = statsHeight(facts.length, columns) * u;
  const top = attributionTop - ATTRIBUTION_GAP * u - panelHeight;
  panel(margin, top, inner, panelHeight);

  // Progress along the route, so the frame shows how much of the run is done.
  const barX = margin + 32 * u,
    barWidth = inner - 64 * u,
    barY = top + 22 * u,
    barHeight = 8 * u;
  const done = track.totals.distance > 0 ? Math.min(1, point.distance / track.totals.distance) : 0;
  ctx.save();
  ctx.fillStyle = palette.line;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fill();
  ctx.fillStyle = palette.route;
  ctx.beginPath();
  ctx.roundRect(barX, barY, Math.max(barHeight, barWidth * done), barHeight, barHeight / 2);
  ctx.fill();
  ctx.restore();

  const real = track.mode === 'real';
  const stats: [string, string][] = [
    ['距离', formatDistance(point.distance)],
    [real ? '用时' : '模拟用时', formatDuration(point.elapsed)],
    ...(real ? [['配速', pace === null ? '—' : formatPace(pace)] as [string, string]] : []),
  ];
  const column = inner / stats.length;
  stats.forEach(([label, value], i) => {
    const x = margin + column * i + 32 * u;
    text(label, x, top + 70 * u, 28 * u, palette.muted);
    text(value, x, top + 138 * u, Math.min(64 * u, column / 4.6), palette.foreground, 700);
  });

  if (facts.length) {
    const divider = top + STATS_HEIGHT * u;
    ctx.save();
    ctx.fillStyle = palette.line;
    ctx.fillRect(margin + 32 * u, divider, inner - 64 * u, Math.max(1, 2 * u));
    ctx.restore();
    const factColumn = (inner - 32 * u) / columns;
    facts.forEach(([label, value], i) => {
      const x = margin + 32 * u + factColumn * (i % columns),
        y = divider + (FACTS_PADDING + Math.floor(i / columns) * FACTS_ROW_HEIGHT) * u;
      text(label, x, y + 22 * u, 22 * u, palette.muted);
      text(value, x, y + 60 * u, Math.min(30 * u, factColumn / 5.5), palette.foreground, 700);
    });
  }

  if (basemap) {
    // Required by the data licences: a quiet line on its own small backing, under the panel.
    const size = 16 * u;
    ctx.font = `400 ${size}px ${palette.font}`;
    const pill = ctx.measureText(ATTRIBUTION).width + 24 * u;
    panel(width - margin - pill, attributionTop, pill, ATTRIBUTION_HEIGHT * u, (ATTRIBUTION_HEIGHT * u) / 2, 0.8);
    text(ATTRIBUTION, width - margin - 12 * u, attributionTop + 21 * u, size, palette.muted, 400, 'right');
  }
}

/**
 * Renders the replay frame by frame in an off-screen map (never a screen recording, so slow tiles
 * cannot drop frames), encodes H.264 with WebCodecs and writes an MP4. Everything stays in the browser:
 * the only network traffic is the basemap's viewport tiles, exactly as when viewing the map.
 */
export async function exportReplayVideo(request: VideoRequest): Promise<VideoResult> {
  const { track, aspect, quality, seconds, dark, signal } = request;
  const config = await videoEncoderConfig(aspect, quality);
  if (!config) throw new Error('此浏览器无法导出视频，请使用最新版 Chrome、Edge 或 Safari');
  const { width, height } = videoSize(aspect, quality);
  // Render map labels and lines at a phone-like density instead of tiny 1:1 desktop pixels.
  const ratio = Math.min(width, height) / 540;
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${width / ratio}px`,
    height: `${height / ratio}px`,
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  let map: MapLibreMap | undefined, cleanup: (() => void) | undefined, encoder: VideoEncoder | undefined;
  try {
    const frames = seconds * VIDEO_FPS;
    const report = (stage: VideoStage, frame = 0) => request.onprogress?.({ stage, frame, frames: frame ? frames : 0 });
    report('preparing');
    await document.fonts.ready;
    const lib = await loadMapLibre();
    if (signal.aborted) throw abortError();
    const instance = new lib.Map({
      container,
      style: createRouteMapStyle(dark),
      center: [track.lon[0], track.lat[0]],
      zoom: 14,
      pixelRatio: ratio,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });
    map = instance;
    await new Promise<void>((resolve, reject) => {
      instance.once('load', () => resolve());
      instance.once('error', (event) => reject(event.error));
    });
    const layers = installReplayLayers(instance, lib, track, dark);
    // Frame the route above the stats panel and attribution (CSS px: canvas units divided by the pixel ratio).
    const unit = Math.min(width, height) / 1080 / ratio,
      gap = 24 * unit;
    const facts = Math.min(MAX_FACTS, request.facts?.length ?? 0);
    layers.overview(false, {
      top: MARGIN * unit + gap,
      bottom:
        (MARGIN + ATTRIBUTION_HEIGHT + ATTRIBUTION_GAP + statsHeight(facts, factColumns(facts, width, height))) * unit +
        gap,
      left: MARGIN * unit,
      right: MARGIN * unit,
    });
    report('basemap');
    const basemapStatus = await new Promise<BasemapStatus>((resolve) => {
      const controller = createBasemapController(
        instance,
        'replay-base',
        (state) => {
          if (state.status !== 'loading') resolve(state.status);
        },
        undefined,
        { fixed: dark ? 'dark' : 'positron' },
      );
      cleanup = () => {
        controller.destroy();
        layers.destroy();
      };
    });
    const basemap = basemapStatus === 'ready';
    if (!basemap) applyMapTheme(instance, dark);
    layers.theme(dark);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建视频画布');
    const samples: Mp4Sample[] = [];
    let avcC: Uint8Array | null = null,
      failure: unknown = null;
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const description = metadata?.decoderConfig?.description;
        if (description && !avcC) avcC = copy(description);
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
      },
      error: (error) => {
        failure = error;
      },
    });
    encoder.configure(config);
    let hint = 0,
      // Through a signal gap or a standstill there is no fresh pace: keep showing the last one.
      pace: number | null = null;
    for (let frame = 0; frame < frames; frame++) {
      if (signal.aborted) throw abortError();
      if (failure) throw failure;
      const point = sampleAt(track, frameTime(frame, seconds, track.duration), hint);
      hint = point.index;
      pace = point.pace ?? pace;
      layers.update(point);
      await settle(instance, signal);
      drawFrame(ctx, instance, ratio, point, pace, request, basemap);
      request.onframe?.(canvas);
      const image = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1e6) / VIDEO_FPS),
        duration: Math.round(1e6 / VIDEO_FPS),
      });
      encoder.encode(image, { keyFrame: frame % (KEYFRAME_SECONDS * VIDEO_FPS) === 0 });
      image.close();
      // Back-pressure: never queue more than a few raw frames in the encoder.
      while (encoder.encodeQueueSize > 4)
        await new Promise((resolve) => encoder!.addEventListener('dequeue', resolve, { once: true }));
      report('rendering', frame + 1);
    }
    report('finishing', frames);
    await encoder.flush();
    if (failure) throw failure;
    if (!avcC) throw new Error('编码器没有给出视频参数，无法生成 MP4');
    return { blob: muxMp4({ width, height, fps: VIDEO_FPS, avcC, samples }), width, height, basemap };
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    cleanup?.();
    map?.remove();
    container.remove();
  }
}
