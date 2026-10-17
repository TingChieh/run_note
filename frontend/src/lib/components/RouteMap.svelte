<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import type { Map as MapLibreMap, Marker, LngLatBounds } from 'maplibre-gl';
  import type { Route, Coordinate } from '#lib/api/activities.ts';
  import { createRouteMapStyle, applyMapTheme, type BasemapPreference, type BasemapStyle } from '#lib/api/map-style.ts';
  import BasemapPicker from './BasemapPicker.svelte';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { watchSystemTheme } from './system-theme';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { route, spacious = false, embedded = false }: { route: Route; spacious?: boolean; embedded?: boolean } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined, markers: Marker[] = [], disposed = false;
  let loaded = $state(false), error = $state(''), routeReady = $state(false), hasRendered = $state(false);
  let updateRoute: ((value: Route) => void) | undefined;
  let renderedRoute: Route | undefined;
  $effect(() => { const value = route; if (routeReady) updateRoute?.(value); });
  let basemapEnabled = $state(true), basemapStatus = $state<'loading' | 'ready' | 'failed' | 'off'>('loading');
  let basemapPreference = $state<BasemapPreference>('auto'), basemapStyle = $state<BasemapStyle>('positron');
  let basemapController: ReturnType<typeof createBasemapController> | undefined, routeInitialized = false;
  let observer: ResizeObserver | undefined, resizeFrame = 0, bounds: LngLatBounds | undefined;
  let fittedWidth = 0, fittedHeight = 0;
  let dark = false, stopTheme: (() => void) | undefined;
  function loadBasemap() { basemapController?.retry(); }
  function toggleBasemap() { basemapController?.toggle(); }
  function scheduleFit(duration = 0) {
    if (resizeFrame || disposed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!map || !bounds || disposed) return;
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height || (width === fittedWidth && height === fittedHeight)) return;
      fittedWidth = width; fittedHeight = height; loaded = false;
      map.resize();
      map.fitBounds(bounds, { padding: Math.min(55, width / 4, height / 4), maxZoom: map.getMaxZoom(), duration, easing: value => 1 - Math.pow(1 - value, 3) });
    });
  }
  onMount(() => {
    stopTheme = watchSystemTheme(value => { dark = value; if (map && !disposed && !basemapController) applyMapTheme(map, dark); });
    void (async () => {
      try {
        const lib = await import('maplibre-gl'); if (disposed) return;
        map = new lib.Map({ container, style: createRouteMapStyle(dark), center: route.start, zoom: 13, attributionControl: false, renderWorldCopies: true, maxZoom: 19 });
        observer = new ResizeObserver(() => scheduleFit()); observer.observe(container);
        map.addControl(new lib.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        // Wait for the local GeoJSON source to render, independently of external basemap resources.
        map.on('render', () => {
          if (!disposed && !error && map && routeInitialized && fittedWidth > 0 && fittedHeight > 0
            && container.clientWidth === fittedWidth && container.clientHeight === fittedHeight
            && !map.isMoving() && map.isSourceLoaded('route')) { loaded = true; hasRendered = true; }
        });
        map.on('webglcontextlost', () => { basemapController?.destroy(); error = '地图绘图上下文已丢失，请刷新重试。活动指标不受影响。'; });
        map.on('error', (event) => {
          if (disposed) return;
          if (!('sourceId' in event) || event.sourceId !== 'route') return;
          error = '地图绘制失败。可刷新重试，活动指标不受影响。';
        });
        map.on('load', () => {
          if (!map || disposed) return;
          map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: route.features } });
          map.addLayer({ id: 'route-lines', type: 'line', source: 'route', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#14785b', 'line-width': 4 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
          map.addLayer({ id: 'route-points', type: 'circle', source: 'route', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#14785b' } });
          applyMapTheme(map, dark);
          for (const [coordinate, label, color] of [[route.start, '起', '#14785b'], [route.end, '终', '#bd4d29']] as const) {
            const element = document.createElement('span'); element.textContent = label; element.setAttribute('aria-label', label === '起' ? '路线起点' : '路线终点');
            Object.assign(element.style, { background: color, color: 'white', borderRadius: '50%', width: '28px', height: '28px', lineHeight: '28px', textAlign: 'center', border: '2px solid white', boxShadow: '0 1px 4px #0003' });
            markers.push(new lib.Marker({ element, anchor: label === '起' ? 'bottom-right' : 'top-left' }).setLngLat(coordinate).addTo(map));
          }
          updateRoute = (value: Route) => {
            if (!map || disposed) return;
            // Swapping routes on a live map glides to the new framing instead of jumping.
            const animate = renderedRoute !== undefined && renderedRoute !== value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            renderedRoute = value;
            map.stop();
            (map.getSource('route') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: value.features });
            markers[0].setLngLat(value.start); markers[1].setLngLat(value.end);
            const points: Coordinate[] = value.features.flatMap(f => f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates);
            bounds = new lib.LngLatBounds(points[0], points[0]); for (const point of points) bounds.extend(point);
            loaded = false; fittedWidth = 0; fittedHeight = 0;
            scheduleFit(animate ? 280 : 0);
          };
          routeInitialized = true; updateRoute(route); routeReady = true;
          // Fit locally before scheduling external viewport tile requests.
          requestAnimationFrame(() => { if (!disposed && map) basemapController = createBasemapController(map, 'route-lines', state => {
            basemapStatus = state.status; basemapEnabled = state.status !== 'off'; basemapPreference = state.preference; basemapStyle = state.style;
          }); });
        });
      } catch { if (!disposed) error = '此浏览器无法初始化地图，请使用支持 WebGL 的浏览器。'; }
    })();
  });
  onDestroy(() => { disposed = true; stopTheme?.(); basemapController?.destroy(); observer?.disconnect(); if (resizeFrame) cancelAnimationFrame(resizeFrame); for (const marker of markers) marker.remove(); map?.remove(); map = undefined; });
</script>
<div class="relative mt-4 overflow-hidden rounded-xl border border-border" data-glass-stable class:spacious class:embedded>
  <div bind:this={container} class="route-map w-full" role="img" aria-label="活动路线地图，绿色为路线，起与终标记起终点" data-testid={loaded ? 'route-map-ready' : 'route-map-loading'}></div>
  <div class="absolute left-3 top-3"><button type="button" onclick={toggleBasemap} disabled={!routeReady || !!error} aria-pressed={basemapEnabled} class="button-secondary">{basemapEnabled ? '关闭底图' : '开启底图'}</button></div>
  <BasemapPicker preference={basemapPreference} style={basemapStyle} status={basemapStatus} />
  {#if embedded}
    {#if error}<div class="map-status"><FeedbackState kind="error" title={error} /></div>
    {:else if !loaded && !hasRendered}<div class="map-status"><FeedbackState kind="loading" title="正在绘制路线…" /></div>{/if}
    {#if basemapStatus === 'failed'}<div class="map-status map-basemap"><span>底图暂不可用，轨迹仍可查看。</span><button type="button" onclick={loadBasemap} class="font-medium text-primary underline">重试底图</button></div>
    {:else if basemapStatus === 'loading'}<p role="status" class="map-status map-basemap">正在加载底图…</p>{/if}
  {/if}
</div>
{#if !embedded}
{#if error}<div class="mt-3"><FeedbackState kind="error" title={error} /></div>{:else if !loaded && !hasRendered}<div class="mt-3"><FeedbackState kind="loading" title="正在绘制路线…" /></div>{/if}
{#if basemapStatus === 'failed'}<div class="basemap-feedback" role="status"><span>底图暂不可用，轨迹仍可查看。</span><button type="button" onclick={loadBasemap} class="font-medium text-primary underline">重试底图</button></div>
{:else if basemapStatus === 'loading'}<p role="status" class="mt-3 text-sm">正在加载底图…</p>{/if}
{/if}
<details class="mt-3 text-sm text-muted-foreground"><summary class="w-fit font-medium">地图与隐私说明</summary><p class="mt-2 leading-6">底图由 OpenFreeMap 提供，使用 OpenMapTiles 与 OpenStreetMap 数据；会请求样式、字体、图标和当前视口瓦片；完整 GPX 与轨迹点不会发送给底图服务，路径在本地绘制。关闭底图可停止后续瓦片请求。不同轨迹段不会连线，起终点重合时两个标记分别显示。公共底图为尽力服务，可能暂不可用。</p></details>
<style>
  .embedded { margin-top: 1rem; }
  .map-status { position: absolute; inset: 3.5rem 1rem auto; background: var(--surface); border-radius: .5rem; }
  .map-basemap { inset: auto 1rem 2rem; width: fit-content; padding: .375rem .5rem; font-size: .75rem; }
  .route-map { height: var(--route-map-height, clamp(18rem, 50svh, 32rem)); }
  .basemap-feedback { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-3); margin-top: var(--space-3); color: var(--muted-foreground); font-size: .875rem; }
  .spacious .route-map { height: 32.5rem; }
  @media (max-width: 1199px) { .spacious .route-map { height: clamp(22.5rem, 55svh, 32.5rem); } }
  @media (max-width: 639px) { .route-map { height: var(--route-map-height, clamp(17rem, 40svh, 22rem)); } }
</style>
