<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;

  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { onMount, onDestroy, untrack, type Snippet } from 'svelte';
  import type { Map as LibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
  import worldBaseUrl from '#lib/data/world-base.json?url';
  import type { FootprintCollection } from '#lib/api/footprints.ts';
  import { geometryBounds, displayFootprints } from '#lib/api/footprints.ts';
  import {
    COUNTRY_MAX_ZOOM,
    REGION_MAX_ZOOM,
    bucketUnlocatedFootprints,
    footprintCitiesToGeoJSON,
    footprintCityPalette,
    footprintCitySummaryText,
    placeFootprintLabels,
    visitedProvinceCodes,
    zoomTier,
    type ClusterPoint,
    type FootprintCityFeatureInput,
    type FootprintCitySummary,
    type FootprintCitySummaryLocations,
    type ProjectedLabel,
    type ZoomTier,
  } from '#lib/map/footprint-cities.ts';
  import { emptyCollection, type GeoCollection } from '#lib/map/exploration-layers.ts';
  import { colorFootprintFeatures, heatFillColor } from '#lib/map/footprint-colors.ts';
  import { createRouteMapStyle, applyMapTheme, type BasemapPreference, type BasemapStyle } from '#lib/api/map-style.ts';
  import BasemapPicker from './BasemapPicker.svelte';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { loadMapLibre } from '#lib/map/maplibre.ts';
  import { watchSystemTheme } from './system-theme';
  let {
    data,
    onretry,
    participantColors = {},
    mapLabel = '',
    quietCityFailure = false,
    animateDataChanges = false,
    selectedRunner = '',
    selectedActivity = '',
    compact = false,
    appearance = 'default',
    detailHref = undefined,
    children,
    onclearRunner,
  }: {
    data: FootprintCollection;
    onretry: () => void;
    participantColors?: Record<string, string>;
    mapLabel?: string;
    quietCityFailure?: boolean;
    animateDataChanges?: boolean;
    selectedRunner?: string;
    selectedActivity?: string;
    compact?: boolean;
    appearance?: 'default' | 'sheet';
    detailHref?: string;
    children?: Snippet;
    onclearRunner?: () => void;
  } = $props();
  type RecordItem = { id: string; title: string; date: string; username?: string };
  let container: HTMLDivElement,
    frameEl: HTMLDivElement,
    map: LibreMap | undefined,
    disposed = false;
  let framing: 'auto' | 'all' | 'picked' | 'free' = 'auto';
  let ready = $state(false),
    error = $state(''),
    basemap = $state<'loading' | 'ready' | 'failed'>('loading');
  let choices = $state<RecordItem[]>([]),
    heat = $state<number | null>(null);
  let observer: ResizeObserver | undefined;
  let basemapPreference = $state<BasemapPreference>('auto'),
    basemapStyle = $state<BasemapStyle>('positron');
  let basemapController: ReturnType<typeof createBasemapController> | undefined;
  let heatDataOpen = $state(false),
    heatPage = $state(0),
    recordsOpen = $state(false);
  let dark = $state(false),
    stopTheme: (() => void) | undefined;
  const heatPageSize = 50;
  let selectedIds = $state<string[]>([]);
  let cityOpen = $state(false),
    cityName = $state('');
  let cities = $state<FootprintCitySummary[]>([]),
    unlocatedMarkers = $state<FootprintCitySummary[]>([]),
    unlocatedBounds = $state<FootprintCitySummaryLocations['unlocatedBounds']>(null);
  let cityLookup = $state<'loading' | 'ready' | 'failed'>('loading'),
    selectedCity = $state('');
  let cityWorker: Worker | undefined,
    cityRequestId = 0,
    appliedData: FootprintCollection | undefined;
  let worldBaseData: GeoCollection = emptyCollection;
  let currentZoom = $state(4);
  const currentTier = $derived<ZoomTier>(zoomTier(currentZoom));
  let labels = $state<ProjectedLabel[]>([]);
  let hoveredCity = $state<{ city: FootprintCitySummary; x: number; y: number } | null>(null);
  let tappedCity = $state<FootprintCitySummary | null>(null);
  let mapWidth = $state(320);
  let lastPointerType = 'mouse';
  let labelFrame = 0;
  let cachedClusters: ClusterPoint[] = [];
  let cachedVisibleCities: FootprintCitySummary[] = [];
  let lastQueryZoomBucket = -1;
  let queryDirty = true;
  const allLowZoomMarkers = $derived([...cities, ...unlocatedMarkers]);
  const cityByCode = $derived(new Map(allLowZoomMarkers.map((city) => [city.code, city])));
  const effectiveMapDark = $derived(basemap === 'ready' ? basemapStyle === 'dark' : dark);
  const lowZoomPalette = $derived(footprintCityPalette(effectiveMapDark, data.mode));
  const cityCache = new WeakMap<FootprintCollection, FootprintCitySummaryLocations>();
  const displayData = $derived(displayFootprints(data));
  const allBounds = $derived(geometryBounds(displayData.features.map((f) => f.geometry)));
  const records = $derived(
    data.mode === 'tracks'
      ? [
          ...new Map(
            data.features.map((f) => {
              const p = f.properties!;
              return [
                String(p.activity_id),
                {
                  id: String(p.activity_id),
                  title: String(p.title),
                  date: String(p.activity_date),
                  username: typeof p.username === 'string' ? p.username : undefined,
                },
              ];
            }),
          ).values(),
        ].sort((a, b) => b.date.localeCompare(a.date))
      : [],
  );
  const recordHref = (record: RecordItem) =>
    record.username
      ? `/p/${encodeURIComponent(record.username)}/activities/${record.id}`
      : view.href(`/activities/${record.id}`);
  // Equal insets keep a symmetric route's midpoint on the canvas centre.
  // 72px clears the top-right zoom control and the layer button.
  const cameraPadding = 72;
  const fitPadding = () =>
    onclearRunner && frameEl
      ? Math.min(cameraPadding, frameEl.clientWidth / 4, frameEl.clientHeight / 4)
      : cameraPadding;
  function fit(bounds: [[number, number], [number, number]] | null, animate = false) {
    if (!map || !bounds) return;
    const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(bounds, {
      padding: fitPadding(),
      maxZoom: map.getMaxZoom(),
      bearing: 0,
      pitch: 0,
      duration: motion ? 350 : 0,
    });
  }
  function frame(bounds: [[number, number], [number, number]] | null) {
    framing = 'free';
    selectedCity = '';
    fit(bounds);
  }
  // Opens on every footprint; city lookup only adds shortcuts and never moves the initial camera.
  function frameInitial() {
    if (!map || framing === 'free') return;
    if (framing === 'picked' && selectedCity) {
      locateCity(selectedCity, false);
      return;
    }
    fit(allBounds);
  }
  function sizeCanvas() {
    if (!frameEl) return;
    // Compact maps are sized by CSS alone: measuring the frame's offset made the height depend on the scroll position.
    if (compact) {
      frameEl.style.height = '';
      return;
    }
    const available = window.innerHeight - frameEl.getBoundingClientRect().top - 16;
    frameEl.style.height = `${Math.min(720, Math.max(424, Math.floor(available)))}px`;
  }
  function cityMarkerData() {
    return footprintCitiesToGeoJSON(allLowZoomMarkers, data.mode);
  }
  function applyLowZoomTheme() {
    if (!map || disposed) return;
    const hasExtBasemap = basemap === 'ready';
    const mapDark = hasExtBasemap ? basemapStyle === 'dark' : dark;
    const pal = footprintCityPalette(mapDark, data.mode);
    const offlineVisibility = hasExtBasemap ? 'none' : 'visible';
    if (map.getLayer('background') && !hasExtBasemap) {
      map.setPaintProperty(
        'background',
        'background-color',
        map.getZoom() < REGION_MAX_ZOOM ? pal.ocean : mapDark ? '#302e2c' : '#edf3ef',
      );
    }
    const visited = visitedProvinceCodes(cities);
    if (map.getLayer('footprint-base-land')) {
      map.setLayoutProperty('footprint-base-land', 'visibility', offlineVisibility);
      map.setPaintProperty(
        'footprint-base-land',
        'fill-color',
        visited.length ? ['case', ['in', ['get', 'code'], ['literal', visited]], pal.visitedFill, pal.land] : pal.land,
      );
    }
    if (map.getLayer('footprint-base-borders')) {
      map.setLayoutProperty('footprint-base-borders', 'visibility', offlineVisibility);
      map.setPaintProperty('footprint-base-borders', 'line-color', pal.border);
    }
    if (map.getLayer('footprint-city-clusters-halo')) {
      map.setPaintProperty('footprint-city-clusters-halo', 'circle-color', pal.clusterHalo);
    }
    if (map.getLayer('footprint-city-clusters')) {
      map.setPaintProperty('footprint-city-clusters', 'circle-color', pal.clusterFill);
      map.setPaintProperty('footprint-city-clusters', 'circle-stroke-color', pal.stroke);
    }
    if (map.getLayer('footprint-city-markers')) {
      map.setPaintProperty('footprint-city-markers', 'circle-color', pal.bubbleFill);
      map.setPaintProperty('footprint-city-markers', 'circle-stroke-color', [
        'case',
        ['==', ['get', 'code'], selectedCity],
        pal.selectedStroke,
        pal.stroke,
      ]);
      map.setPaintProperty('footprint-city-markers', 'circle-stroke-width', [
        'case',
        ['==', ['get', 'code'], selectedCity],
        3,
        2,
      ]);
    }
  }
  function syncLabels(forceQuery = false) {
    if (!map || !container || disposed) {
      if (labels.length) labels = [];
      return;
    }
    const zoom = map.getZoom();
    currentZoom = zoom;
    if (!ready || !allLowZoomMarkers.length || zoom >= REGION_MAX_ZOOM) {
      if (labels.length) labels = [];
      return;
    }
    // MapLibre Supercluster only changes cluster membership at integer zoom boundaries, so avoid
    // synchronous full-viewport queryRenderedFeatures on every animation frame during smooth pan/zoom.
    const zoomBucket = zoom < COUNTRY_MAX_ZOOM ? Math.floor(zoom) : 99;
    if (forceQuery || queryDirty || zoomBucket !== lastQueryZoomBucket) {
      const clusters: ClusterPoint[] = [];
      const seenClusters = new Set<number>();
      if (zoom < COUNTRY_MAX_ZOOM && map.getLayer('footprint-city-clusters')) {
        for (const f of map.queryRenderedFeatures({ layers: ['footprint-city-clusters'] })) {
          const cid = Number(f.properties?.cluster_id);
          if (!Number.isFinite(cid) || seenClusters.has(cid)) continue;
          seenClusters.add(cid);
          const coords = (f.geometry as { coordinates: [number, number] }).coordinates;
          clusters.push({
            id: cid,
            lon: coords[0],
            lat: coords[1],
            count: Number(f.properties?.point_count) || 2,
            hasNew: false,
          });
        }
      }
      const visibleCities: FootprintCitySummary[] = [];
      const seenCities = new Set<string>();
      if (map.getLayer('footprint-city-markers')) {
        for (const f of map.queryRenderedFeatures({ layers: ['footprint-city-markers'] })) {
          const c = String(f.properties?.code ?? '');
          if (!c || seenCities.has(c)) continue;
          seenCities.add(c);
          const found = cityByCode.get(c);
          if (found) visibleCities.push(found);
        }
      }
      cachedClusters = clusters;
      cachedVisibleCities = visibleCities;
      lastQueryZoomBucket = zoomBucket;
      queryDirty = false;
    }
    labels = placeFootprintLabels(
      cachedVisibleCities.length ? cachedVisibleCities : zoom >= COUNTRY_MAX_ZOOM ? cities : [],
      zoom < COUNTRY_MAX_ZOOM ? cachedClusters : [],
      (lngLat) => map!.project(lngLat),
      container.clientWidth,
      container.clientHeight,
      zoom,
      selectedCity,
    );
  }
  function scheduleLabelSync() {
    if (!map || disposed) return;
    const zoom = map.getZoom();
    currentZoom = zoom;
    if (!ready || !allLowZoomMarkers.length || zoom >= REGION_MAX_ZOOM) {
      if (labels.length) labels = [];
      return;
    }
    if (labelFrame) return;
    labelFrame = requestAnimationFrame(() => {
      labelFrame = 0;
      syncLabels(false);
    });
  }
  function syncCityMarkers() {
    if (!map || disposed) return;
    queryDirty = true;
    (map.getSource('footprint-cities') as GeoJSONSource | undefined)?.setData(cityMarkerData());
    applyLowZoomTheme();
    syncLabels(true);
  }
  function highlight(ids: string[]) {
    selectedIds = ids;
    if (!map?.getLayer('footprint-lines')) return;
    map.setPaintProperty('footprint-lines', 'line-width', [
      'case',
      ['in', ['get', 'activity_id'], ['literal', ids]],
      5,
      3,
    ]);
    map.setPaintProperty('footprint-points', 'circle-radius', [
      'case',
      ['in', ['get', 'activity_id'], ['literal', ids]],
      7,
      5,
    ]);
  }
  function focusRecord(record: RecordItem) {
    heat = null;
    highlight([record.id]);
    frame(
      geometryBounds(
        displayData.features.filter((f) => f.properties?.activity_id === record.id).map((f) => f.geometry),
      ),
    );
  }
  function selectRecord(record: RecordItem) {
    choices = [record];
    focusRecord(record);
  }
  function selectHeat(index: number) {
    const feature = displayData.features[index];
    heat = Number(feature.properties?.count);
    choices = [];
    frame(geometryBounds([feature.geometry]));
  }
  function overview() {
    onclearRunner?.();
    map?.stop();
    choices = [];
    heat = null;
    hoveredCity = null;
    tappedCity = null;
    highlight([]);
    framing = 'all';
    selectedCity = '';
    applyLowZoomTheme();
    fit(allBounds);
    syncLabels(true);
  }
  function locateCity(code = cityName, animate = true) {
    const city =
      code === 'unlocated' && unlocatedBounds
        ? { name: '未识别区域', bounds: unlocatedBounds }
        : (cities.find((entry) => entry.code === code) ?? unlocatedMarkers.find((entry) => entry.code === code));
    if (!map || !ready || error || !city) return;
    map.stop();
    hoveredCity = null;
    tappedCity = null;
    framing = 'picked';
    selectedCity = code.startsWith('unlocated:') ? 'unlocated' : code;
    cityName = selectedCity;
    applyLowZoomTheme();
    fit(city.bounds, animate);
  }
  function applyCityLocations(locations: FootprintCitySummaryLocations) {
    cities = locations.cities;
    unlocatedMarkers = locations.unlocatedMarkers;
    unlocatedBounds = locations.unlocatedBounds;
    cityName = cities[0]?.code ?? (unlocatedBounds ? 'unlocated' : '');
    cityLookup = 'ready';
    syncCityMarkers();
    requestAnimationFrame(() => {
      if (!disposed && framing === 'auto') {
        sizeCanvas();
        map?.resize();
        frameInitial();
      }
      if (!disposed) syncLabels(true);
    });
  }
  function cityFeatureInputs(collection: FootprintCollection): FootprintCityFeatureInput[] {
    return collection.features.map((feature) => ({
      geometry: feature.geometry,
      activityId: typeof feature.properties?.activity_id === 'string' ? feature.properties.activity_id : undefined,
      count: typeof feature.properties?.count === 'number' ? feature.properties.count : undefined,
    }));
  }
  function applyCityLookupFailure(collection: FootprintCollection) {
    cities = [];
    unlocatedMarkers = bucketUnlocatedFootprints(cityFeatureInputs(collection), collection.mode);
    unlocatedBounds = null;
    cityLookup = 'failed';
    syncCityMarkers();
    frameInitial();
  }
  function loadCities() {
    const currentData = data;
    const cached = cityCache.get(currentData);
    if (cached) {
      applyCityLocations(cached);
      return;
    }
    const requestId = ++cityRequestId;
    cityLookup = 'loading';
    try {
      const worker =
        cityWorker ?? new Worker(new URL('../map/footprint-cities.worker.ts', import.meta.url), { type: 'module' });
      cityWorker = worker;
      worker.onmessage = (event: MessageEvent<FootprintCitySummaryLocations>) => {
        if (disposed || cityWorker !== worker || requestId !== cityRequestId) return;
        cityCache.set(currentData, event.data);
        applyCityLocations(event.data);
      };
      worker.onerror = () => {
        if (disposed || cityWorker !== worker) return;
        applyCityLookupFailure(currentData);
        worker.terminate();
        cityWorker = undefined;
      };
      worker.postMessage({
        mode: currentData.mode,
        features: cityFeatureInputs(currentData),
      });
    } catch {
      applyCityLookupFailure(currentData);
      cityWorker?.terminate();
      cityWorker = undefined;
    }
  }
  // The page swaps `data` in place (mode switch, background refresh): update the live source instead of rebuilding the map.
  function applyData() {
    const source = map?.getSource('footprints') as GeoJSONSource | undefined;
    if (!map || !source || appliedData === data) return;
    appliedData = data;
    source.setData({ type: 'FeatureCollection', features: colored(displayData.features) });
    framing = 'auto';
    choices = [];
    heat = null;
    heatPage = 0;
    hoveredCity = null;
    tappedCity = null;
    selectedCity = '';
    highlight([]);
    applyLowZoomTheme();
    loadCities();
    if (onclearRunner && (selectedRunner || selectedActivity)) focusRunner(selectedRunner, selectedActivity);
    else fit(allBounds, animateDataChanges);
  }
  $effect(() => {
    data;
    untrack(applyData);
  });
  function focusRunner(runner: string, activity = '') {
    if (!map?.getLayer('footprint-lines') || !onclearRunner) return;
    const match = ['==', ['get', activity ? 'activity_id' : 'username'], activity || runner] as [
      '==',
      ['get', 'username'],
      string,
    ];
    for (const layer of ['footprint-selected-glow', 'footprint-selected-casing', 'footprint-selected']) {
      if (map.getLayer(layer)) map.setFilter(layer, ['all', ['==', ['geometry-type'], 'LineString'], match]);
    }
    const bounds = activity
      ? geometryBounds(
          displayData.features.filter((f) => f.properties?.activity_id === activity).map((f) => f.geometry),
        )
      : runner
        ? geometryBounds(displayData.features.filter((f) => f.properties?.username === runner).map((f) => f.geometry))
        : allBounds;
    if (!runner && !activity) {
      framing = 'all';
      fit(allBounds, animateDataChanges);
      return;
    }
    if (!bounds) return;
    framing = 'free';
    // Measure the selected record's overlay after it has been laid out.
    requestAnimationFrame(() => {
      if (!map || disposed || selectedRunner !== runner || selectedActivity !== activity) return;
      const card = activity ? frameEl.querySelector<HTMLElement>('.map-info') : null;
      const cardRect = card?.getBoundingClientRect(),
        frameRect = frameEl.getBoundingClientRect();
      const inset = 20;
      const padding = { top: inset, right: inset, bottom: inset, left: inset };
      const a = map.project(bounds[0]),
        b = map.project(bounds[1]);
      const left = Math.min(a.x, b.x),
        right = Math.max(a.x, b.x),
        top = Math.min(a.y, b.y),
        bottom = Math.max(a.y, b.y);
      if (cardRect) {
        const cardRight = cardRect.right - frameRect.left + inset,
          cardTop = cardRect.top - frameRect.top - inset;
        if (
          left < cardRight &&
          right > cardRect.left - frameRect.left - inset &&
          bottom > cardTop &&
          top < cardRect.bottom - frameRect.top + inset
        ) {
          const shiftRight = cardRight - left,
            shiftUp = bottom - cardTop;
          if (shiftRight <= shiftUp && cardRight < frameRect.width - inset) padding.left = Math.ceil(cardRight);
          else padding.bottom = Math.ceil(frameRect.height - cardTop);
        }
      }
      const availableWidth = frameRect.width - padding.left - padding.right,
        availableHeight = frameRect.height - padding.top - padding.bottom;
      const overlapX = Math.max(0, Math.min(right, frameRect.width - padding.right) - Math.max(left, padding.left));
      const overlapY = Math.max(0, Math.min(bottom, frameRect.height - padding.bottom) - Math.max(top, padding.top));
      const visibleX =
        right - left < 1
          ? left >= padding.left && left <= frameRect.width - padding.right
            ? 1
            : 0
          : overlapX / (right - left);
      const visibleY =
        bottom - top < 1
          ? top >= padding.top && top <= frameRect.height - padding.bottom
            ? 1
            : 0
          : overlapY / (bottom - top);
      // A route that is in view but only a few pixels wide cannot be told apart: go to it instead of staying put.
      const tiny = Math.max((right - left) / availableWidth, (bottom - top) / availableHeight) < 0.15;
      if (!tiny && visibleX >= 0.8 && visibleY >= 0.8) return;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
      if (tiny) {
        map.fitBounds(bounds, { padding, maxZoom: 16, duration });
        return;
      }
      if (right - left > availableWidth || bottom - top > availableHeight) {
        map.fitBounds(bounds, { padding, maxZoom: map.getZoom(), duration });
        return;
      }
      const dx =
        left < padding.left
          ? left - padding.left
          : right > frameRect.width - padding.right
            ? right - (frameRect.width - padding.right)
            : 0;
      const dy =
        top < padding.top
          ? top - padding.top
          : bottom > frameRect.height - padding.bottom
            ? bottom - (frameRect.height - padding.bottom)
            : 0;
      const center = map.project(map.getCenter());
      map.easeTo({ center: map.unproject([center.x + dx, center.y + dy]), duration });
    });
  }
  $effect(() => {
    const runner = selectedRunner,
      activity = selectedActivity;
    if (ready) untrack(() => focusRunner(runner, activity));
  });
  function colored(features: typeof displayData.features) {
    return colorFootprintFeatures(features, palette).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        color: participantColors[String(feature.properties?.username)] ?? feature.properties.color,
      },
    }));
  }
  const palette = ['#14785b', '#315caf', '#b4552c', '#854caa', '#397d87', '#ba3970'];
  function loadBasemap() {
    basemapController?.retry();
  }
  const onWindowResize = () => {
    sizeCanvas();
    map?.resize();
    if (framing === 'all') fit(allBounds);
    else if (framing === 'picked') locateCity(selectedCity, false);
    else if (framing === 'auto') frameInitial();
  };
  // Overlays dock above the attribution, whose height changes with its expanded text.
  let attributionObserver: ResizeObserver | undefined;
  function trackAttribution() {
    const attribution = frameEl?.querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
    if (!attribution) return;
    const clearance = () => {
      const rect = attribution.getBoundingClientRect();
      frameEl.style.setProperty(
        '--map-attribution-clearance',
        rect.height ? `${Math.ceil(frameEl.getBoundingClientRect().bottom - rect.top)}px` : '0px',
      );
    };
    attributionObserver = new ResizeObserver(clearance);
    attributionObserver.observe(attribution);
    clearance();
  }
  const onFramePointerDown = (event: PointerEvent) => {
    lastPointerType = event.pointerType;
  };
  const onFrameKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      hoveredCity = null;
      tappedCity = null;
    }
  };
  onMount(() => {
    loadCities();
    sizeCanvas();
    mapWidth = frameEl?.clientWidth || 320;
    frameEl?.addEventListener('pointerdown', onFramePointerDown);
    frameEl?.addEventListener('keydown', onFrameKeyDown);
    window.addEventListener('resize', onWindowResize);
    stopTheme = watchSystemTheme((value) => {
      dark = value;
      if (map && !disposed) {
        if (!basemapController) applyMapTheme(map, dark);
        if (map.getLayer('footprint-casing'))
          map.setPaintProperty('footprint-casing', 'line-color', dark ? '#302e2c' : '#ffffff');
        if (map.getLayer('footprint-selected-casing'))
          map.setPaintProperty('footprint-selected-casing', 'line-color', dark ? '#302e2c' : '#ffffff');
        applyLowZoomTheme();
      }
    });
    void (async () => {
      try {
        const [lib, baseJson] = await Promise.all([
          loadMapLibre(),
          window
            .fetch(worldBaseUrl)
            .then((res) => (res.ok ? (res.json() as Promise<GeoCollection>) : emptyCollection))
            .catch(() => emptyCollection),
        ]);
        if (disposed) return;
        worldBaseData = baseJson;
        // Start on the overview so no high-zoom tiles load before the first fit.
        const camera = allBounds
          ? { bounds: allBounds, fitBoundsOptions: { padding: cameraPadding } }
          : { center: [0, 0] as [number, number], zoom: 4 };
        const instance: LibreMap = new lib.Map({
          container,
          fadeDuration: 0,
          locale: {
            'NavigationControl.ZoomIn': '放大地图',
            'NavigationControl.ZoomOut': '缩小地图',
            'Map.Title': '足迹地图',
          },
          style: createRouteMapStyle(dark),
          ...camera,
          maxZoom: 19,
          attributionControl: false,
        });
        map = instance;
        instance.addControl(new lib.AttributionControl({ compact: true }), 'bottom-right');
        trackAttribution();
        instance.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('dragstart', () => {
          selectedCity = '';
          framing = 'free';
          hoveredCity = null;
          tappedCity = null;
          applyLowZoomTheme();
        });
        instance.on('zoomstart', () => {
          hoveredCity = null;
        });
        observer = new ResizeObserver(() => {
          sizeCanvas();
          mapWidth = frameEl?.clientWidth || 320;
          map?.resize();
          scheduleLabelSync();
        });
        observer.observe(frameEl ?? container);
        instance.on('webglcontextlost', () => {
          basemapController?.destroy();
          ready = false;
          error = '地图绘图上下文已丢失，请重新绘制地图。下方数据入口仍可使用。';
        });
        instance.on('error', (e) => {
          if ('sourceId' in e && e.sourceId === 'footprints') error = '地图绘制失败，请重试。下方记录入口仍可使用。';
        });
        instance.on('load', () => {
          if (!map || disposed) return;
          appliedData = data;
          const features = colored(displayData.features);
          map.addSource('footprint-base', {
            type: 'geojson',
            data: worldBaseData,
            maxzoom: 11,
            tolerance: 0.75,
          });
          map.addLayer({
            id: 'footprint-base-land',
            type: 'fill',
            source: 'footprint-base',
            maxzoom: REGION_MAX_ZOOM + 0.5,
            paint: { 'fill-color': '#fcfdfb', 'fill-opacity': 1 },
          });
          map.addLayer({
            id: 'footprint-base-borders',
            type: 'line',
            source: 'footprint-base',
            maxzoom: REGION_MAX_ZOOM + 0.5,
            paint: { 'line-color': '#d5ded8', 'line-width': 0.9 },
          });
          map.addSource('footprints', { type: 'geojson', data: { type: 'FeatureCollection', features } });
          map.addLayer({
            id: 'footprint-fill',
            type: 'fill',
            source: 'footprints',
            filter: ['==', '$type', 'Polygon'],
            // Keep 100 m heat cells out of national/regional overview where subpixel blocks turn into noise.
            minzoom: 10,
            paint: {
              'fill-color': heatFillColor,
              'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10.0, 0, 10.5, 0.8],
            },
          });
          if (onclearRunner)
            map.addLayer({
              id: 'footprint-casing',
              type: 'line',
              source: 'footprints',
              filter: ['==', '$type', 'LineString'],
              paint: { 'line-color': dark ? '#302e2c' : '#ffffff', 'line-width': 5, 'line-opacity': 0.65 },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            });
          map.addLayer({
            id: 'footprint-lines',
            type: 'line',
            source: 'footprints',
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.8 },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
          map.addLayer({
            id: 'footprint-points',
            type: 'circle',
            source: 'footprints',
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-color': ['get', 'color'], 'circle-radius': 5 },
          });
          if (onclearRunner)
            map.addLayer({
              id: 'footprint-selected-glow',
              type: 'line',
              source: 'footprints',
              filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'username'], '']],
              paint: { 'line-color': ['get', 'color'], 'line-width': 15, 'line-blur': 6, 'line-opacity': 0.5 },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            });
          if (onclearRunner)
            map.addLayer({
              id: 'footprint-selected-casing',
              type: 'line',
              source: 'footprints',
              filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'username'], '']],
              paint: { 'line-color': dark ? '#302e2c' : '#ffffff', 'line-width': 9, 'line-opacity': 0.95 },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            });
          if (onclearRunner)
            map.addLayer({
              id: 'footprint-selected',
              type: 'line',
              source: 'footprints',
              filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'username'], '']],
              paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 1 },
              layout: { 'line-join': 'round', 'line-cap': 'round' },
            });
          map.addSource('footprint-cities', {
            type: 'geojson',
            data: cityMarkerData(),
            cluster: true,
            clusterMaxZoom: 6,
            clusterRadius: 42,
            clusterProperties: {
              sum_count: ['+', ['get', 'count']],
            },
          });
          map.addLayer({
            id: 'footprint-city-clusters-halo',
            type: 'circle',
            source: 'footprint-cities',
            filter: ['has', 'point_count'],
            maxzoom: COUNTRY_MAX_ZOOM + 0.5,
            paint: {
              'circle-radius': ['step', ['get', 'point_count'], 18, 5, 22, 12, 26],
              'circle-color': 'rgba(23, 116, 92, 0.16)',
            },
          });
          map.addLayer({
            id: 'footprint-city-clusters',
            type: 'circle',
            source: 'footprint-cities',
            filter: ['has', 'point_count'],
            maxzoom: COUNTRY_MAX_ZOOM + 0.5,
            paint: {
              'circle-radius': ['step', ['get', 'point_count'], 13, 5, 16, 12, 19],
              'circle-color': '#17745c',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });
          map.addLayer({
            id: 'footprint-city-markers',
            type: 'circle',
            source: 'footprint-cities',
            filter: ['!', ['has', 'point_count']],
            maxzoom: REGION_MAX_ZOOM + 0.7,
            paint: {
              'circle-radius': ['step', ['get', 'count'], 7, 3, 9.5, 8, 12, 16, 14.5],
              'circle-color': '#14785b',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 0.96, 11.0, 0],
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 1, 11.0, 0],
            },
          });
          map.on('click', 'footprint-city-clusters', async (event) => {
            if (!map || map.getZoom() >= COUNTRY_MAX_ZOOM + 0.5) return;
            const feature = event.features?.[0];
            if (!feature) return;
            const clusterId = Number(feature.properties?.cluster_id);
            const coords = (feature.geometry as { coordinates: [number, number] }).coordinates;
            const source = map.getSource<GeoJSONSource>('footprint-cities');
            if (!source || !Number.isFinite(clusterId)) return;
            try {
              const expansionZoom = await source.getClusterExpansionZoom(clusterId);
              if (disposed || !map) return;
              framing = 'free';
              selectedCity = '';
              hoveredCity = null;
              tappedCity = null;
              applyLowZoomTheme();
              const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              map.easeTo({
                center: coords,
                zoom: Math.min(Math.max(expansionZoom + 0.5, COUNTRY_MAX_ZOOM + 0.3, map.getZoom() + 1.5), 10),
                duration: motion ? 320 : 0,
              });
            } catch {
              /* ignore transient cluster state */
            }
          });
          const handleCityClick = (event: MapLayerMouseEvent) => {
            if (!map || map.getZoom() >= REGION_MAX_ZOOM) return;
            const code = String(event.features?.[0]?.properties?.code ?? '');
            const found = cityByCode.get(code);
            if (!found) return;
            const coarse =
              lastPointerType === 'touch' ||
              (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
            if (coarse && tappedCity?.code !== found.code) {
              tappedCity = found;
              hoveredCity = null;
              return;
            }
            locateCity(found.code);
          };
          map.on('click', 'footprint-city-markers', handleCityClick);
          for (const interactiveLayer of ['footprint-city-clusters', 'footprint-city-markers'] as const) {
            map.on('mouseenter', interactiveLayer, (event) => {
              if (!map || map.getZoom() >= REGION_MAX_ZOOM) return;
              map.getCanvas().style.cursor = 'pointer';
              if (interactiveLayer === 'footprint-city-clusters' || lastPointerType === 'touch') return;
              const code = String(event.features?.[0]?.properties?.code ?? '');
              const found = cityByCode.get(code);
              if (found) hoveredCity = { city: found, x: event.point.x, y: event.point.y };
            });
            map.on('mousemove', interactiveLayer, (event) => {
              if (!map || map.getZoom() >= REGION_MAX_ZOOM) {
                hoveredCity = null;
                return;
              }
              if (interactiveLayer === 'footprint-city-clusters' || lastPointerType === 'touch') return;
              const code = String(event.features?.[0]?.properties?.code ?? '');
              const found = cityByCode.get(code);
              if (found) hoveredCity = { city: found, x: event.point.x, y: event.point.y };
            });
            map.on('mouseleave', interactiveLayer, () => {
              if (!map) return;
              map.getCanvas().style.cursor = '';
              hoveredCity = null;
            });
          }
          applyMapTheme(map, dark);
          applyLowZoomTheme();
          map.on('click', (e) => {
            if (!map) return;
            if (map.getZoom() < REGION_MAX_ZOOM) {
              const cityLayers = ['footprint-city-clusters', 'footprint-city-markers'].filter((id) => map?.getLayer(id));
              if (cityLayers.length && map.queryRenderedFeatures(e.point, { layers: cityLayers }).length > 0) return;
            }
            tappedCity = null;
            const hits = map.queryRenderedFeatures(
              [
                [e.point.x - 5, e.point.y - 5],
                [e.point.x + 5, e.point.y + 5],
              ],
              { layers: ['footprint-lines', 'footprint-points', 'footprint-fill'] },
            );
            const unique = new Map<string, RecordItem>();
            heat = null;
            for (const hit of hits) {
              const p = hit.properties;
              if (p?.activity_id)
                unique.set(p.activity_id, {
                  id: p.activity_id,
                  title: p.title,
                  date: p.activity_date,
                  username: typeof p.username === 'string' && p.username ? p.username : undefined,
                });
              else if (p?.count) heat = p.count;
            }
            choices = [...unique.values()];
            highlight(choices.map((record) => record.id));
          });
          map.on('move', scheduleLabelSync);
          map.on('moveend', () => {
            applyLowZoomTheme();
            syncLabels(true);
          });
          map.on('idle', () => syncLabels(true));
          sizeCanvas();
          frameInitial();
          const markReady = () => {
            if (!error && map?.isSourceLoaded('footprints')) {
              ready = true;
              map.off('render', markReady);
              syncLabels(true);
            }
          };
          map.on('render', markReady);
          basemapController = createBasemapController(map, 'footprint-fill', (state) => {
            basemap = state.status;
            basemapPreference = state.preference;
            basemapStyle = state.style;
            applyLowZoomTheme();
          });
        });
      } catch {
        if (!disposed) error = '无法初始化地图，请使用支持 WebGL 的浏览器。';
      }
    })();
  });
  onDestroy(() => {
    disposed = true;
    if (labelFrame) cancelAnimationFrame(labelFrame);
    frameEl?.removeEventListener('pointerdown', onFramePointerDown);
    frameEl?.removeEventListener('keydown', onFrameKeyDown);
    attributionObserver?.disconnect();
    window.removeEventListener('resize', onWindowResize);
    cityWorker?.terminate();
    stopTheme?.();
    basemapController?.destroy();
    observer?.disconnect();
    map?.remove();
    map = undefined;
  });
</script>

<div class="map-section content-reveal" class:sheet={appearance === 'sheet'}>
  <div class="map-toolbar">
    <div class="toolbar-actions">
      <button type="button" onclick={overview} disabled={!ready || !!error} class="button-secondary"
        >回到全部足迹</button
      ><button
        type="button"
        onclick={() => {
          cityOpen = !cityOpen;
        }}
        disabled={!ready || !!error || cityLookup !== 'ready' || !cityName}
        aria-expanded={cityOpen}
        aria-controls="footprint-cities"
        class="button-secondary city-menu-toggle">城市</button
      >
    </div>
    {#if cityLookup === 'ready' && (cities.length || unlocatedBounds)}
      <div class="city-buttons" role="group" aria-label="有记录的城市">
        {#each cities as city}<button
            type="button"
            onclick={() => locateCity(city.code)}
            disabled={!ready || !!error}
            aria-pressed={selectedCity === city.code}
            class="button-secondary">{city.name}</button
          >{/each}{#if unlocatedBounds}<button
            type="button"
            onclick={() => locateCity('unlocated')}
            disabled={!ready || !!error}
            aria-pressed={selectedCity === 'unlocated'}
            class="button-secondary">未识别区域</button
          >{/if}
      </div>
    {/if}
    <p class="sr-only" id="footprint-map-help">拖动或缩放探索 · 方向键移动 · + / − 缩放</p>
    {#if detailHref}<a class="button-secondary map-detail-link" href={detailHref} data-testid="map-detail-link"
        >查看完整详情 →</a
      >{/if}
  </div>
  {#if cityLookup === 'loading'}<p role="status" class="city-hint">正在识别有记录的城市…</p>
  {:else if cityLookup === 'failed' && !quietCityFailure}<div class="city-actions">
      <p role="status" class="city-hint">城市识别暂不可用，全部足迹仍可查看。</p>
      <button type="button" onclick={loadCities} class="button-secondary">重试识别城市</button>
    </div>{/if}
  {#if cityOpen}<div id="footprint-cities" class="city-panel">
      <div class="city-actions">
        <label
          >选择城市<select
            aria-label="选择城市"
            bind:value={cityName}
            disabled={!ready || !!error || cityLookup !== 'ready'}
            >{#each cities as city}<option value={city.code}>{city.name}</option>{/each}{#if unlocatedBounds}<option
                value="unlocated">未识别区域</option
              >{/if}</select
          ></label
        ><button
          type="button"
          onclick={() => locateCity()}
          disabled={!ready || !!error || cityLookup !== 'ready'}
          class="button-secondary">定位城市</button
        >
      </div>
      <p class="city-hint">按当前足迹估算城市，仅移动地图；全部路线和热区仍保留。</p>
    </div>{/if}
  {#if basemap === 'failed' && !error}<div class="basemap-feedback" role="status">
      <span>底图暂不可用，足迹仍可查看。</span><button type="button" onclick={loadBasemap} class="button-secondary"
        >重试底图</button
      >
    </div>{:else if basemap === 'loading' && ready && !error}<p role="status" class="basemap-status">
      正在加载底图，足迹可先查看…
    </p>{/if}
  {#if error}<FeedbackState kind="error" title={error}
      ><button type="button" class="button-secondary" onclick={onretry}>重新绘制地图</button></FeedbackState
    >{:else if !ready}<p role="status" class="basemap-status">正在绘制足迹…</p>{/if}
  <div
    class="map-frame"
    class:compact
    data-glass-overlay={appearance === 'sheet' ? '' : undefined}
    bind:this={frameEl}
  >
    <div
      bind:this={container}
      class="map-canvas"
      role="region"
      aria-label={mapLabel || (data.mode === 'heatmap' ? '个人运动热力图' : '个人多轨迹叠加地图')}
      aria-describedby="footprint-map-help"
      data-testid={ready ? 'footprint-map-ready' : 'footprint-map-loading'}
      data-zoom-tier={currentTier}
      data-city-labels={labels.length}
      data-lowzoom-markers={allLowZoomMarkers.length}
    ></div>
    {#if ready && labels.length}
      <div class="labels-layer" aria-hidden="true">
        {#each labels as item (item.id)}
          <span
            class="map-label"
            class:cluster-label={item.kind === 'cluster'}
            style:transform={`translate3d(${Math.round(item.x)}px, ${Math.round(item.y)}px, 0) translate(-50%, -50%)`}
            style:color={item.kind === 'cluster' ? lowZoomPalette.clusterInk : undefined}>{item.text}</span
          >
        {/each}
      </div>
    {/if}
    {#if hoveredCity}
      <div
        class="hover-card"
        style:left={`${Math.min(Math.max(12, hoveredCity.x + 12), Math.max(12, mapWidth - 220))}px`}
        style:top={`${Math.max(12, hoveredCity.y - 54)}px`}
      >
        <strong>{hoveredCity.city.name}</strong>
        <span>{footprintCitySummaryText(hoveredCity.city, data.mode)}</span>
        <small>点击定位该城</small>
      </div>
    {/if}
    {#if tappedCity}
      <div class="tap-bar" role="status" data-testid="footprint-city-tap-bar">
        <div>
          <strong>{tappedCity.name}</strong>
          <span>{footprintCitySummaryText(tappedCity, data.mode)}</span>
        </div>
        <div class="tap-actions">
          <button
            type="button"
            class="button-primary tap-go"
            onclick={() => {
              const target = tappedCity;
              tappedCity = null;
              if (target) locateCity(target.code);
            }}>定位该城</button
          >
          <button
            type="button"
            class="button-secondary tap-close"
            aria-label="关闭城市提示"
            onclick={() => {
              tappedCity = null;
            }}>×</button
          >
        </div>
      </div>
    {/if}
    {@render children?.()}
    <div class="map-layers"><BasemapPicker preference={basemapPreference} style={basemapStyle} status={basemap} /></div>
  </div>
  {#if choices.length}<div class="route-choices" data-testid="route-choices">
      <p class="font-semibold" role="status">此处经过的记录（{choices.length}）</p>
      <ul>
        {#each choices as record}<li>
            <div>
              <span class="record-date">{record.date}</span><a href={recordHref(record)}
                >{record.title || '未命名活动'} · 查看详情</a
              >
            </div>
            <button
              type="button"
              class="button-secondary"
              onclick={() => focusRecord(record)}
              aria-pressed={selectedIds.length === 1 && selectedIds[0] === record.id}>定位路线</button
            >
          </li>{/each}
      </ul>
    </div>{/if}
  {#if heat !== null}<p role="status" class="heat-selection">所选网格：{heat} 条不同运动记录经过。</p>{/if}
  {#if records.length}<details class="record-list" bind:open={recordsOpen}>
      <summary>全部可显示记录（{records.length}）· 详情入口</summary>{#if recordsOpen}<ul>
          {#each records as record}<li>
              <div>
                <span class="record-date">{record.date}</span><a href={recordHref(record)}
                  >{record.title || '未命名活动'}</a
                >
              </div>
              <button
                type="button"
                disabled={!ready || !!error}
                onclick={() => selectRecord(record)}
                aria-label={`定位 ${record.title || '未命名活动'}`}
                aria-pressed={selectedIds.length === 1 && selectedIds[0] === record.id}
                class="button-secondary">定位</button
              >
            </li>{/each}
        </ul>{/if}
    </details>
  {:else if data.mode === 'heatmap'}<details class="heat-data" bind:open={heatDataOpen}>
      <summary>查看热区数据（{data.features.length} 格）</summary>{#if heatDataOpen}<div class="heat-table">
          <table>
            <caption class="sr-only">不同运动记录经过各网格的次数，可定位到地图</caption><thead
              ><tr><th>区域</th><th>不同记录数</th><th>地图定位</th></tr></thead
            ><tbody
              >{#each data.features.slice(heatPage * heatPageSize, (heatPage + 1) * heatPageSize) as feature, index}<tr
                  ><td>热区 {heatPage * heatPageSize + index + 1}</td><td>{feature.properties?.count} 次</td><td
                    ><button
                      type="button"
                      class="button-secondary"
                      disabled={!ready || !!error}
                      aria-label={`定位热区 ${heatPage * heatPageSize + index + 1}`}
                      onclick={() => selectHeat(heatPage * heatPageSize + index)}>定位</button
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
        {#if data.features.length > heatPageSize}<div class="heat-pagination">
            <button
              type="button"
              class="button-secondary"
              disabled={heatPage === 0}
              onclick={() => {
                heatPage--;
              }}>上一页热区</button
            >
            <p role="status">
              第 {heatPage + 1} / {Math.ceil(data.features.length / heatPageSize)} 页 · 共 {data.features.length} 格
            </p>
            <button
              type="button"
              class="button-secondary"
              disabled={(heatPage + 1) * heatPageSize >= data.features.length}
              onclick={() => {
                heatPage++;
              }}>下一页热区</button
            >
          </div>{/if}{/if}
    </details>{/if}
</div>

<style>
  .map-section {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  .map-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .city-panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .city-actions {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .city-actions label {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-small);
    min-width: 0;
  }
  .city-actions select {
    min-width: 9rem;
    max-width: 100%;
  }
  .city-hint {
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .city-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .city-buttons button[aria-pressed='true'] {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .city-menu-toggle,
  .city-panel {
    display: none;
  }
  .map-detail-link {
    margin-left: auto;
  }
  .basemap-feedback {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .basemap-status {
    font-size: var(--text-small);
    margin: 0;
  }
  .map-layers {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 2;
  }
  .map-frame {
    position: relative;
    overflow: hidden;
    height: min(720px, max(424px, calc(100dvh - 26rem)));
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--muted);
  }
  .map-canvas {
    height: 100%;
    width: 100%;
  }
  .labels-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }
  .map-label {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
    padding: 0.125rem 0.45rem;
    border-radius: var(--radius-field);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    color: var(--foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    white-space: nowrap;
  }
  .map-label.cluster-label {
    border: 0;
    background: transparent;
    padding: 0;
    font-variant-numeric: tabular-nums;
  }
  .hover-card {
    position: absolute;
    z-index: 3;
    pointer-events: none;
    display: grid;
    gap: 0.125rem;
    max-width: 13.5rem;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--foreground);
    box-shadow: var(--shadow-popover);
    font-size: var(--text-caption);
  }
  .hover-card strong {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .hover-card small {
    color: var(--muted-foreground);
  }
  .tap-bar {
    position: absolute;
    left: var(--space-3);
    right: var(--space-3);
    bottom: calc(var(--map-attribution-clearance, 0px) + var(--space-3));
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
  }
  .tap-bar > div:first-child {
    min-width: 0;
    display: grid;
  }
  .tap-bar strong {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .tap-bar span {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }
  .tap-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .tap-go {
    min-height: 2.75rem;
    padding-inline: var(--space-3);
    font-size: var(--text-small);
  }
  .tap-close {
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
  }
  .route-choices {
    border-left: 3px solid var(--primary);
    padding: 0.75rem 1rem;
    background: var(--primary-soft);
    border-radius: var(--radius-control);
  }
  .route-choices ul,
  .record-list ul {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.75rem;
    max-height: 20rem;
    overflow: auto;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    padding: 0.5rem 0;
  }
  li > div {
    min-width: 0;
  }
  li a {
    color: var(--primary);
    text-decoration: underline;
    font-size: var(--text-small);
    overflow-wrap: anywhere;
  }
  li button {
    flex-shrink: 0;
  }
  .record-date {
    display: block;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .heat-selection {
    padding: 0.75rem 1rem;
    color: var(--primary);
    border-radius: var(--radius-control);
    background: var(--primary-soft);
  }
  summary {
    cursor: pointer;
    color: var(--primary);
    font-weight: var(--weight-semibold);
    font-size: var(--text-small);
  }
  .record-list,
  .heat-data {
    padding-top: 0.5rem;
  }
  .heat-pagination {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.75rem;
    font-size: var(--text-small);
  }
  .heat-table {
    max-height: 20rem;
    overflow: auto;
    margin-top: 0.75rem;
  }
  table {
    width: 100%;
    font-size: var(--text-small);
    text-align: left;
  }
  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .map-frame.compact {
    height: clamp(424px, calc(100dvh - 13rem), 720px);
  }
  /* Editorial Receipt sheet appearance (brand.md §5, W-17): 4px fine map frame, flat controls, hairline rows. */
  .sheet .map-toolbar {
    justify-content: flex-start;
    gap: var(--space-2) var(--space-3);
  }
  .sheet .city-buttons {
    padding-left: var(--space-3);
    border-left: 1px solid var(--border);
  }
  .sheet .city-buttons button[aria-pressed='true'] {
    outline: none;
    border-color: var(--rule);
    background: var(--foreground);
    color: var(--background);
  }
  .sheet .city-buttons button[aria-pressed='true']:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .sheet .city-panel {
    padding: var(--space-3) 0;
    border: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
  }
  .sheet .city-actions select {
    border-color: var(--control-border);
  }
  .sheet .basemap-feedback {
    border: 0;
    border-left: 3px solid var(--warning);
    border-radius: 0;
    background: var(--warning-soft);
    color: var(--foreground);
    padding: var(--space-2) var(--space-3);
  }
  .sheet .map-frame {
    border-radius: var(--radius-sheet);
  }
  .sheet .route-choices,
  .sheet .heat-selection {
    border-radius: var(--radius-sheet);
  }
  .sheet .route-choices li + li,
  .sheet .record-list li + li {
    border-top: 1px solid var(--border);
  }
  .sheet .record-date {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .sheet .record-list,
  .sheet .heat-data {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
  .sheet table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 959px) {
    .map-frame.compact {
      height: 45dvh;
    }
  }
  @media (max-width: 767px) {
    .map-frame {
      height: min(600px, max(424px, calc(100dvh - 22rem)));
    }
    .route-choices {
      padding: 0.75rem;
    }
  }
  @media (max-width: 1023px) {
    .city-buttons {
      display: none;
    }
    .city-menu-toggle {
      display: inline-flex;
    }
    .city-panel {
      display: grid;
    }
  }
</style>
