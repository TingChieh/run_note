<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import type { Map as MapLibreMap, Marker, LngLatBounds } from 'maplibre-gl';
  import type { Route, Coordinate } from '#lib/api/activities.ts';
  import { BASEMAP_SOURCE, BASEMAP_LAYER, BASEMAP_TIMEOUT_MS, createRouteMapStyle, createBasemapSource, isBasemapError, applyMapTheme } from '#lib/api/map-style.ts';
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
  let basemapTimer: ReturnType<typeof setTimeout> | undefined, routeInitialized = false;
  let observer: ResizeObserver | undefined, resizeFrame = 0, bounds: LngLatBounds | undefined;
  let fittedWidth = 0, fittedHeight = 0;
  let dark = false, stopTheme: (() => void) | undefined;
  function removeBasemap() {
    clearTimeout(basemapTimer); basemapTimer = undefined;
    if (map?.getLayer(BASEMAP_LAYER)) map.removeLayer(BASEMAP_LAYER);
    if (map?.getSource(BASEMAP_SOURCE)) map.removeSource(BASEMAP_SOURCE);
  }
  function failBasemap() {
    if (disposed || !basemapEnabled) return;
    basemapStatus = 'failed'; removeBasemap();
  }
  function loadBasemap() {
    if (!map || disposed || !routeInitialized || !basemapEnabled) return;
    removeBasemap(); basemapStatus = 'loading';
    // Standard browser tile requests retain normal cache and Referer behavior.
    // Only viewport tile coordinates leave the browser; the route stays local.
    map.addSource(BASEMAP_SOURCE, createBasemapSource());
    map.addLayer({ id: BASEMAP_LAYER, type: 'raster', source: BASEMAP_SOURCE }, 'route-lines');
    applyMapTheme(map, dark);
    basemapTimer = setTimeout(failBasemap, BASEMAP_TIMEOUT_MS);
  }
  function toggleBasemap() {
    basemapEnabled = !basemapEnabled;
    if (basemapEnabled) loadBasemap();
    else { removeBasemap(); basemapStatus = 'off'; }
  }
  function scheduleFit(duration = 0) {
    if (resizeFrame || disposed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!map || !bounds || disposed) return;
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height || (width === fittedWidth && height === fittedHeight)) return;
      fittedWidth = width; fittedHeight = height; loaded = false;
      map.resize();
      map.fitBounds(bounds, { padding: Math.min(55, width / 4, height / 4), maxZoom: 15, duration, easing: value => 1 - Math.pow(1 - value, 3) });
    });
  }
  onMount(() => {
    stopTheme = watchSystemTheme(value => { dark = value; if (map && !disposed) applyMapTheme(map, dark); });
    void (async () => {
      try {
        const lib = await import('maplibre-gl'); if (disposed) return;
        map = new lib.Map({ container, style: createRouteMapStyle(dark), center: route.start, zoom: 13, attributionControl: false, renderWorldCopies: true, maxZoom: 19 });
        observer = new ResizeObserver(() => scheduleFit()); observer.observe(container);
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        // Wait for the local GeoJSON source to render, independently of raster tiles.
        map.on('render', () => {
          if (!disposed && !error && map && routeInitialized && fittedWidth > 0 && fittedHeight > 0
            && container.clientWidth === fittedWidth && container.clientHeight === fittedHeight
            && !map.isMoving() && map.isSourceLoaded('route')) { loaded = true; hasRendered = true; }
        });
        map.on('error', (event) => {
          if (disposed) return;
          if (isBasemapError(event)) { failBasemap(); return; }
          error = '地图绘制失败。可刷新重试，活动指标不受影响。';
        });
        map.on('sourcedata', (event) => {
          if (!disposed && event.sourceId === BASEMAP_SOURCE && event.sourceDataType !== 'metadata' && event.isSourceLoaded && basemapStatus === 'loading') {
            clearTimeout(basemapTimer); basemapTimer = undefined; basemapStatus = 'ready';
          }
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
            const animate = embedded && renderedRoute !== undefined && renderedRoute !== value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
          // Add raster tiles after fitting the route to avoid requesting the initial unrelated viewport.
          requestAnimationFrame(() => { if (!disposed) loadBasemap(); });
        });
      } catch { if (!disposed) error = '此浏览器无法初始化地图，请使用支持 WebGL 的浏览器。'; }
    })();
  });
  onDestroy(() => { disposed = true; stopTheme?.(); clearTimeout(basemapTimer); observer?.disconnect(); if (resizeFrame) cancelAnimationFrame(resizeFrame); for (const marker of markers) marker.remove(); map?.remove(); map = undefined; });
</script>
<div class="relative mt-4 overflow-hidden rounded-xl border border-border" class:spacious class:embedded>
  <div bind:this={container} class="route-map w-full" role="img" aria-label="活动路线地图，绿色为路线，起与终标记起终点" data-testid={loaded ? 'route-map-ready' : 'route-map-loading'}></div>
  <div class="absolute left-3 top-3"><button type="button" onclick={toggleBasemap} aria-pressed={basemapEnabled} class="rounded border border-border bg-card px-3 py-2 text-sm">{basemapEnabled ? '关闭底图' : '开启底图'}</button></div>
  {#if basemapEnabled}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" class="absolute bottom-0 right-0 bg-card/95 px-2 py-1 text-xs underline">© OpenStreetMap contributors</a>{/if}
  {#if embedded}
    {#if error}<div class="map-status"><FeedbackState kind="error" title={error} /></div>
    {:else if !loaded && !hasRendered}<div class="map-status"><FeedbackState kind="loading" title="正在绘制路线…" /></div>{/if}
    {#if basemapStatus === 'failed'}<div class="map-status map-basemap"><span>底图暂不可用，轨迹仍可查看。</span><button type="button" onclick={loadBasemap} class="font-medium text-primary underline">重试底图</button></div>
    {:else if basemapStatus === 'loading'}<p role="status" class="map-status map-basemap">正在加载底图…</p>{/if}
  {/if}
</div>
{#if !embedded}
{#if error}<div class="mt-3"><FeedbackState kind="error" title={error} /></div>{:else if !loaded}<div class="mt-3"><FeedbackState kind="loading" title="正在绘制路线…" /></div>{/if}
{#if basemapStatus === 'failed'}<div class="basemap-feedback" role="status"><span>底图暂不可用，轨迹仍可查看。</span><button type="button" onclick={loadBasemap} class="font-medium text-primary underline">重试底图</button></div>
{:else if basemapStatus === 'loading'}<p role="status" class="mt-3 text-sm">正在加载底图…</p>{/if}
{/if}
<details class="mt-3 text-sm text-muted-foreground"><summary class="w-fit font-medium">地图与隐私说明</summary><p class="mt-2 leading-6">底图会向 OpenStreetMap 请求当前地图区域的瓦片；完整 GPX 与轨迹点不会发送给底图服务，路径在本地绘制。关闭底图可停止后续瓦片请求。不同轨迹段不会连线，起终点重合时两个标记分别显示。公共底图为尽力服务，可能暂不可用。</p></details>
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
