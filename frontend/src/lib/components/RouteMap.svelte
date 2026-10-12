<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Map as MapLibreMap, Marker, LngLatBounds } from 'maplibre-gl';
  import type { Route, Coordinate } from '#lib/api/activities.ts';
  import { BASEMAP_SOURCE, BASEMAP_LAYER, BASEMAP_TIMEOUT_MS, createRouteMapStyle, createBasemapSource, isBasemapError } from '#lib/api/map-style.ts';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { route }: { route: Route } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined, markers: Marker[] = [], disposed = false;
  let loaded = $state(false), error = $state('');
  let basemapEnabled = $state(true), basemapStatus = $state<'loading' | 'ready' | 'failed' | 'off'>('loading');
  let basemapTimer: ReturnType<typeof setTimeout> | undefined, routeInitialized = false;
  let observer: ResizeObserver | undefined, resizeFrame = 0, bounds: LngLatBounds | undefined;
  let fittedWidth = 0, fittedHeight = 0;
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
    basemapTimer = setTimeout(failBasemap, BASEMAP_TIMEOUT_MS);
  }
  function toggleBasemap() {
    basemapEnabled = !basemapEnabled;
    if (basemapEnabled) loadBasemap();
    else { removeBasemap(); basemapStatus = 'off'; }
  }
  function scheduleFit() {
    if (resizeFrame || disposed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!map || !bounds || disposed) return;
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height || (width === fittedWidth && height === fittedHeight)) return;
      fittedWidth = width; fittedHeight = height; loaded = false;
      map.resize();
      map.fitBounds(bounds, { padding: Math.min(55, width / 4, height / 4), maxZoom: 15, duration: 0 });
    });
  }
  onMount(() => {
    void (async () => {
      try {
        const lib = await import('maplibre-gl'); if (disposed) return;
        map = new lib.Map({ container, style: createRouteMapStyle(), center: route.start, zoom: 13, attributionControl: false, renderWorldCopies: true, maxZoom: 19 });
        observer = new ResizeObserver(scheduleFit); observer.observe(container);
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        // Wait for the local GeoJSON source to render, independently of raster tiles.
        map.on('render', () => {
          if (!disposed && !error && map && routeInitialized && fittedWidth > 0 && fittedHeight > 0
            && container.clientWidth === fittedWidth && container.clientHeight === fittedHeight
            && map.isSourceLoaded('route')) loaded = true;
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
          for (const [coordinate, label, color] of [[route.start, '起', '#14785b'], [route.end, '终', '#bd4d29']] as const) {
            const element = document.createElement('span'); element.textContent = label; element.setAttribute('aria-label', label === '起' ? '路线起点' : '路线终点');
            Object.assign(element.style, { background: color, color: 'white', borderRadius: '50%', width: '28px', height: '28px', lineHeight: '28px', textAlign: 'center', border: '2px solid white', boxShadow: '0 1px 4px #0003' });
            markers.push(new lib.Marker({ element, anchor: label === '起' ? 'bottom-right' : 'top-left' }).setLngLat(coordinate).addTo(map));
          }
          const points: Coordinate[] = route.features.flatMap(f => f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates);
          bounds = new lib.LngLatBounds(points[0], points[0]); for (const point of points) bounds.extend(point);
          routeInitialized = true;
          // Fit after layout, and refit only when the observed container dimensions change.
          scheduleFit();
          // Add raster tiles after fitting the route to avoid requesting the initial unrelated viewport.
          requestAnimationFrame(() => { if (!disposed) loadBasemap(); });
        });
      } catch { if (!disposed) error = '此浏览器无法初始化地图，请使用支持 WebGL 的浏览器。'; }
    })();
  });
  onDestroy(() => { disposed = true; clearTimeout(basemapTimer); observer?.disconnect(); if (resizeFrame) cancelAnimationFrame(resizeFrame); for (const marker of markers) marker.remove(); map?.remove(); map = undefined; });
</script>
<div class="relative mt-4 overflow-hidden rounded-xl border border-border">
  <div bind:this={container} class="h-[420px] w-full" role="img" aria-label="活动路线地图，绿色为路线，起与终标记起终点" data-testid={loaded ? 'route-map-ready' : 'route-map-loading'}></div>
  <div class="absolute left-3 top-3 rounded bg-white/95 p-2 text-sm shadow">
    <button type="button" onclick={toggleBasemap} aria-pressed={basemapEnabled} class="rounded border border-border px-2 py-1">{basemapEnabled ? '关闭底图' : '开启底图'}</button>
    {#if basemapStatus === 'failed'}
      <p role="status" class="mt-1 max-w-64">底图暂不可用，轨迹仍可查看。</p>
      <button type="button" onclick={loadBasemap} class="mt-1 underline">重试底图</button>
    {:else if basemapStatus === 'loading'}<p role="status" class="mt-1">正在加载底图…</p>{/if}
  </div>
  {#if basemapEnabled}
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" class="absolute bottom-0 right-0 bg-white/95 px-2 py-1 text-xs underline">© OpenStreetMap contributors</a>
  {/if}
  {#if error}<p role="alert" class="absolute bottom-10 left-3 right-3 rounded bg-white p-3 text-red-700">{error}</p>{:else if !loaded}<p role="status" class="absolute bottom-10 left-3 rounded bg-white p-2 text-sm">正在绘制路线…</p>{/if}
</div>
<p class="mt-2 text-sm text-muted-foreground">底图会向 OpenStreetMap 请求当前地图区域的瓦片；完整 GPX 与轨迹点不会发送给底图服务，路径在本地绘制。关闭底图可停止后续瓦片请求。不同轨迹段不会连线，起终点重合时两个标记分别显示。公共底图为尽力服务，可能暂不可用。</p>
