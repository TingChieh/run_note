<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { GeoJSONSource, Map as LibreMap, MapLayerMouseEvent } from 'maplibre-gl';
  import worldBaseUrl from '#lib/data/world-base.json?url';
  import {
    applyMapTheme,
    createRouteMapStyle,
    type BasemapPreference,
    type BasemapStatus,
    type BasemapStyle,
  } from '#lib/api/map-style.ts';
  import type { ExplorationCells, ExplorationMarker, Layer, Scope, Viewport } from '#lib/api/exploration.ts';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { loadMapLibre } from '#lib/map/maplibre.ts';
  import {
    CHINA_OVERVIEW_BOUNDS,
    COUNTRY_MAX_ZOOM,
    REGION_MAX_ZOOM,
    cellsToFeatures,
    computeFraming,
    emptyCollection,
    explorationPalette,
    markersToGeoJSON,
    placeLabels,
    visitedRegionCodes,
    zoomTier,
    type BoundsBox,
    type ClusterPoint,
    type GeoCollection,
    type ProjectedLabel,
    type ZoomTier,
  } from '#lib/map/exploration-layers.ts';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import BasemapPicker from '#lib/components/BasemapPicker.svelte';

  export interface FocusTarget {
    bounds?: BoundsBox | null;
    center?: [number, number];
    zoom?: number;
    seq: number;
  }

  let {
    markers = [],
    data,
    layer,
    scope,
    selectedCode = '',
    yearLabel = '全部年份',
    focusTarget = null,
    onviewport,
    onselectcity,
    onresetscope,
  }: {
    markers?: ExplorationMarker[];
    data: ExplorationCells | null;
    layer: Layer;
    scope: Scope;
    selectedCode?: string;
    yearLabel?: string;
    focusTarget?: FocusTarget | null;
    onviewport: (viewport: Viewport | null) => void;
    onselectcity?: (marker: ExplorationMarker) => void;
    onresetscope?: () => void;
  } = $props();

  const baseSourceId = 'exploration-base';
  const baseLandId = 'exploration-base-land';
  const baseBordersId = 'exploration-base-borders';
  const baseVisitedId = 'exploration-base-visited';
  const gridSourceId = 'exploration-grid';
  const gridLayerId = 'exploration-grid-fill';
  const centroidsSourceId = 'exploration-grid-centroids';
  const centroidsLayerId = 'exploration-grid-centroids-circle';
  const markersSourceId = 'exploration-markers';
  const clustersHaloId = 'exploration-clusters-halo';
  const clustersLayerId = 'exploration-clusters';
  const cityNewHaloId = 'exploration-city-new-halo';
  const cityBubblesId = 'exploration-city-bubbles';
  const cityNearbyId = 'exploration-city-nearby';
  const maxLatitude = 85.0511287798;

  const meters = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const kmText = (value: number | null | undefined) => (value == null ? '' : `${meters.format(value / 1000)} km`);

  let node: HTMLDivElement;
  let mapWidth = $state(320);
  let map: LibreMap | undefined;
  let ready = $state(false);
  let error = $state(false);
  let drawn = $state(false);
  let gridDrawn = $state(false);
  let active = $state<BasemapPreference | null>(null);
  let style = $state<BasemapStyle>('positron');
  let status = $state<BasemapStatus>('ready');
  let basemap: ReturnType<typeof createBasemapController> | undefined;
  let dark = $state(false);
  let currentZoom = $state(3.8);
  let currentTier = $derived<ZoomTier>(zoomTier(currentZoom));
  let viewMoved = $state(false);
  let selectedCellCount = $state<number | null>(null);
  let labels = $state<ProjectedLabel[]>([]);
  let hovered = $state<{ marker: ExplorationMarker; x: number; y: number } | null>(null);
  let tapped = $state<ExplorationMarker | null>(null);
  let lastPointerType = 'mouse';

  let worldBaseData: GeoCollection | null = null;
  let framedSignature = '';
  let lastFocusSeq = -1;
  let markerByCode = new Map<string, ExplorationMarker>();
  let framing = $derived(computeFraming(markers));
  let currentMarkers: ExplorationMarker[] = [];

  function reducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function fitBox(bounds: BoundsBox, options: { maxZoom?: number; animate?: boolean; padding?: number } = {}) {
    if (!map) return;
    const duration = options.animate && !reducedMotion() ? 360 : 0;
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: options.padding ?? 56,
        maxZoom: options.maxZoom ?? 12,
        duration,
      },
    );
  }

  function applyOfflineTheme() {
    if (!map) return;
    const pal = explorationPalette(dark);
    const hasExt = active !== null && status !== 'failed';
    if (map.getLayer('background')) {
      map.setPaintProperty('background', 'background-color', hasExt ? (dark ? '#302e2c' : '#edf3ef') : pal.ocean);
    }
    if (map.getLayer(baseLandId)) {
      map.setLayoutProperty(baseLandId, 'visibility', hasExt ? 'none' : 'visible');
      map.setPaintProperty(baseLandId, 'fill-color', pal.land);
    }
    if (map.getLayer(baseBordersId)) {
      map.setLayoutProperty(baseBordersId, 'visibility', hasExt ? 'none' : 'visible');
      map.setPaintProperty(baseBordersId, 'line-color', pal.border);
    }
    if (map.getLayer(baseVisitedId)) {
      map.setPaintProperty(baseVisitedId, 'fill-color', layer === 'new' ? pal.visitedNew : pal.visitedHeat);
      map.setPaintProperty(baseVisitedId, 'fill-opacity', hasExt ? 0.16 : 0.92);
    }
    if (map.getLayer(gridLayerId)) {
      map.setPaintProperty(gridLayerId, 'fill-color', layer === 'new' ? pal.gridNewFill : pal.gridHeat);
      map.setPaintProperty(
        gridLayerId,
        'fill-outline-color',
        layer === 'new' ? pal.gridNewOutline : dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.55)',
      );
    }
    if (map.getLayer(centroidsLayerId)) {
      map.setPaintProperty(centroidsLayerId, 'circle-color', layer === 'new' ? pal.gridNewFill : pal.gridHeat);
    }
    if (map.getLayer(clustersHaloId)) {
      map.setPaintProperty(
        clustersHaloId,
        'circle-color',
        layer === 'new'
          ? ['case', ['boolean', ['get', 'has_new'], false], pal.newHalo, 'rgba(114, 183, 138, 0.2)']
          : dark
            ? 'rgba(119, 212, 172, 0.2)'
            : 'rgba(23, 116, 92, 0.16)',
      );
    }
    if (map.getLayer(clustersLayerId)) {
      map.setPaintProperty(
        clustersLayerId,
        'circle-color',
        layer === 'new'
          ? ['case', ['boolean', ['get', 'has_new'], false], pal.clusterNew, pal.clusterMuted]
          : pal.clusterHeat,
      );
      map.setPaintProperty(clustersLayerId, 'circle-stroke-color', pal.stroke);
    }
    if (map.getLayer(cityNewHaloId)) {
      map.setLayoutProperty(cityNewHaloId, 'visibility', layer === 'new' ? 'visible' : 'none');
      map.setPaintProperty(cityNewHaloId, 'circle-color', pal.newHalo);
    }
    if (map.getLayer(cityBubblesId)) {
      map.setPaintProperty(cityBubblesId, 'circle-color', layer === 'new' ? pal.markerNew : pal.markerHeat);
      map.setPaintProperty(cityBubblesId, 'circle-stroke-color', [
        'case',
        ['==', ['get', 'code'], selectedCode],
        pal.selectedStroke,
        pal.stroke,
      ]);
      map.setPaintProperty(cityBubblesId, 'circle-stroke-width', ['case', ['==', ['get', 'code'], selectedCode], 3, 2]);
    }
    if (map.getLayer(cityNearbyId)) {
      map.setPaintProperty(cityNearbyId, 'circle-stroke-color', layer === 'new' ? pal.markerNew : pal.markerHeat);
      map.setPaintProperty(cityNearbyId, 'circle-color', 'rgba(0, 0, 0, 0)');
    }
  }

  function syncLabels() {
    if (!map || !ready || !node) {
      labels = [];
      return;
    }
    const zoom = map.getZoom();
    currentZoom = zoom;
    if (zoom >= REGION_MAX_ZOOM) {
      labels = [];
      return;
    }
    const clusters: ClusterPoint[] = [];
    const seenClusters = new Set<number>();
    if (zoom < COUNTRY_MAX_ZOOM && map.getLayer(clustersLayerId)) {
      for (const f of map.queryRenderedFeatures({ layers: [clustersLayerId] })) {
        const cid = Number(f.properties?.cluster_id);
        if (!Number.isFinite(cid) || seenClusters.has(cid)) continue;
        seenClusters.add(cid);
        const coords = (f.geometry as { coordinates: [number, number] }).coordinates;
        clusters.push({
          id: cid,
          lon: coords[0],
          lat: coords[1],
          count: Number(f.properties?.point_count) || 2,
          hasNew: Boolean(f.properties?.has_new),
        });
      }
    }
    const visibleMarkers: ExplorationMarker[] = [];
    const seenCities = new Set<string>();
    const cityLayers = [cityBubblesId, cityNearbyId].filter((id) => map?.getLayer(id));
    if (cityLayers.length) {
      for (const f of map.queryRenderedFeatures({ layers: cityLayers })) {
        const c = String(f.properties?.code ?? '');
        if (!c || seenCities.has(c)) continue;
        seenCities.add(c);
        const found = markerByCode.get(c);
        if (found) visibleMarkers.push(found);
      }
    }
    labels = placeLabels(
      visibleMarkers.length ? visibleMarkers : zoom >= COUNTRY_MAX_ZOOM ? currentMarkers : [],
      clusters,
      (lngLat) => map!.project(lngLat),
      node.clientWidth,
      node.clientHeight,
      zoom,
      layer,
      selectedCode,
    );
  }

  function updateDrawnFlag() {
    if (!map || !ready) {
      drawn = false;
      gridDrawn = false;
      return;
    }
    const checkLayers = [gridLayerId, centroidsLayerId, cityBubblesId, cityNearbyId, clustersLayerId].filter((id) =>
      map?.getLayer(id),
    );
    const gridLayers = [gridLayerId, centroidsLayerId].filter((id) => map?.getLayer(id));
    drawn = checkLayers.length > 0 && map.queryRenderedFeatures({ layers: checkLayers }).length > 0;
    gridDrawn = gridLayers.length > 0 && map.queryRenderedFeatures({ layers: gridLayers }).length > 0;
  }

  function choose(preference: BasemapPreference | null) {
    if (!ready || !map) return;
    basemap?.destroy();
    basemap = undefined;
    active = preference;
    if (!preference) {
      status = 'ready';
      applyMapTheme(map, dark);
      applyOfflineTheme();
      return;
    }
    const fixed = preference === 'auto' ? undefined : preference;
    basemap = createBasemapController(
      map,
      baseVisitedId,
      (next) => {
        style = next.style;
        status = next.status;
        applyOfflineTheme();
      },
      undefined,
      { fixed, localPreference: preference },
    );
  }

  function publishViewport() {
    if (!map || !ready) return;
    const zoom = map.getZoom();
    currentZoom = zoom;
    if (zoom < COUNTRY_MAX_ZOOM && scope === 'global') {
      onviewport(null);
      return;
    }
    const bounds = map.getBounds();
    const clampLatitude = (v: number) => Math.max(-maxLatitude, Math.min(maxLatitude, v));
    const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
    const all = bounds.getEast() - bounds.getWest() >= 360;
    onviewport({
      bounds: [
        all ? -180 : wrap(bounds.getWest()),
        clampLatitude(bounds.getSouth()),
        all ? 180 : wrap(bounds.getEast()),
        clampLatitude(bounds.getNorth()),
      ],
      zoom: Math.max(0, Math.min(22, zoom)),
    });
  }

  export function resetToOverview(target: 'china' | 'all' = 'all') {
    if (!map) return;
    tapped = null;
    hovered = null;
    selectedCellCount = null;
    viewMoved = false;
    if (scope !== 'global') {
      onresetscope?.();
    }
    if (target === 'china') {
      fitBox(CHINA_OVERVIEW_BOUNDS, { maxZoom: 9, animate: true });
    } else if (framing.initialBounds) {
      fitBox(framing.initialBounds, { maxZoom: 11, animate: true });
    } else {
      fitBox(CHINA_OVERVIEW_BOUNDS, { maxZoom: 5, animate: true });
    }
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (!map) return;
    const step = 72;
    const duration = reducedMotion() ? 0 : 180;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      map.panBy([-step, 0], { duration });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      map.panBy([step, 0], { duration });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      map.panBy([0, -step], { duration });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      map.panBy([0, step], { duration });
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      map.zoomIn({ duration });
    } else if (event.key === '-') {
      event.preventDefault();
      map.zoomOut({ duration });
    } else if (event.key === '0') {
      event.preventDefault();
      resetToOverview(framing.hasOverseas ? 'all' : 'china');
    } else if (event.key === 'Escape') {
      hovered = null;
      tapped = null;
      selectedCellCount = null;
    }
  }

  $effect(() => {
    const markerItems = markers;
    const mode = layer;
    const activeScope = scope;
    const pickedCode = selectedCode;
    currentMarkers = markerItems;
    markerByCode = new Map(markerItems.map((item) => [item.code, item]));
    if (!ready || !map) return;
    const current = map;
    const src = current.getSource<GeoJSONSource>(markersSourceId);
    src?.setData(markersToGeoJSON(markerItems));
    const visited = visitedRegionCodes(markerItems, mode);
    if (current.getLayer(baseVisitedId)) {
      current.setFilter(baseVisitedId, ['in', ['get', 'code'], ['literal', visited]]);
    }
    applyOfflineTheme();

    const sig = `${activeScope}:${pickedCode}:${markerItems.length ? '1' : '0'}`;
    if (!framedSignature && (markerItems.length || data?.bounds)) {
      framedSignature = sig;
      if (activeScope === 'global') {
        const box = framing.initialBounds ?? data?.bounds ?? CHINA_OVERVIEW_BOUNDS;
        fitBox(box, { maxZoom: 11, animate: false });
      }
    }
    untrack(() => {
      syncLabels();
      updateDrawnFlag();
    });
  });

  $effect(() => {
    const result = data;
    const mode = layer;
    if (!ready || !map) return;
    const current = map;
    let obsolete = false;
    selectedCellCount = null;
    const { polygons, centroids } = cellsToFeatures(result);
    const gridPromise = current
      .getSource<GeoJSONSource>(gridSourceId)
      ?.setData(polygons)
      .catch(() => {
        if (!obsolete) error = true;
      });
    const centroidsPromise = current
      .getSource<GeoJSONSource>(centroidsSourceId)
      ?.setData(centroids)
      .catch(() => {
        if (!obsolete) error = true;
      });
    applyOfflineTheme();
    if (scope !== 'global' && result?.bounds && framedSignature !== `cells:${scope}:${selectedCode}`) {
      framedSignature = `cells:${scope}:${selectedCode}`;
      fitBox(result.bounds, { maxZoom: 14, animate: !reducedMotion(), padding: 48 });
    }
    const onIdle = () => {
      if (obsolete) return;
      syncLabels();
      updateDrawnFlag();
    };
    void Promise.all([gridPromise, centroidsPromise]).then(() => {
      if (!obsolete) current.once('idle', onIdle);
    });
    return () => {
      obsolete = true;
      current.off('idle', onIdle);
      void mode;
    };
  });

  $effect(() => {
    const target = focusTarget;
    if (!ready || !map || !target || target.seq === lastFocusSeq) return;
    lastFocusSeq = target.seq;
    tapped = null;
    hovered = null;
    if (target.bounds) {
      fitBox(target.bounds, { maxZoom: 12, animate: true });
    } else if (target.center) {
      map.flyTo({
        center: target.center,
        zoom: target.zoom ?? 9.5,
        duration: reducedMotion() ? 0 : 420,
      });
    }
  });

  onMount(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => {
      mapWidth = node?.clientWidth || 320;
      map?.resize();
      syncLabels();
    });
    resize.observe(node);
    mapWidth = node.clientWidth || 320;
    const stopTheme = watchSystemTheme((value) => {
      dark = value;
      if (map) {
        if (!basemap) applyMapTheme(map, dark);
        applyOfflineTheme();
      }
    });

    void (async () => {
      try {
        const [lib, baseJson] = await Promise.all([
          loadMapLibre(),
          fetch(worldBaseUrl)
            .then((res) => (res.ok ? (res.json() as Promise<GeoCollection>) : emptyCollection))
            .catch(() => emptyCollection),
        ]);
        if (disposed) return;
        worldBaseData = baseJson;
        const instance = new lib.Map({
          container: node,
          style: createRouteMapStyle(dark),
          center: [104.5, 35.5],
          zoom: 3.5,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          cooperativeGestures: true,
          locale: {
            'NavigationControl.ZoomIn': '放大地图',
            'NavigationControl.ZoomOut': '缩小地图',
            'Map.Title': '城市探索地图',
            'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 并滚动鼠标滚轮可缩放地图',
            'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 并滚动触控板可缩放地图',
            'CooperativeGesturesHandler.MobileHelpText': '请使用双指移动或缩放地图',
          },
          maxZoom: 19,
        });
        map = instance;
        instance.addControl(new lib.NavigationControl({ showCompass: false }));
        instance.once('load', () => {
          if (disposed || !map) return;
          map.addSource(baseSourceId, { type: 'geojson', data: worldBaseData ?? emptyCollection });
          map.addLayer({
            id: baseLandId,
            type: 'fill',
            source: baseSourceId,
            paint: { 'fill-color': '#fcfdfb', 'fill-opacity': 1 },
          });
          map.addLayer({
            id: baseBordersId,
            type: 'line',
            source: baseSourceId,
            paint: { 'line-color': '#d5ded8', 'line-width': 0.9 },
          });
          map.addLayer({
            id: baseVisitedId,
            type: 'fill',
            source: baseSourceId,
            filter: ['in', ['get', 'code'], ['literal', []]],
            paint: { 'fill-color': '#e3f4e8', 'fill-opacity': 0.92 },
          });

          map.addSource(gridSourceId, { type: 'geojson', data: emptyCollection });
          map.addLayer({
            id: gridLayerId,
            type: 'fill',
            source: gridSourceId,
            minzoom: 5.5,
            paint: {
              'fill-color': ['step', ['get', 'count'], '#8dcc9c', 2, '#4ca76a', 5, '#227b49', 10, '#105332'],
              'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5.5, 0.55, 8.5, 0.9],
            },
          });

          map.addSource(centroidsSourceId, { type: 'geojson', data: emptyCollection });
          map.addLayer({
            id: centroidsLayerId,
            type: 'circle',
            source: centroidsSourceId,
            minzoom: 5.8,
            maxzoom: 10.2,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 6.0, 3.2, 9.0, 2.2, 10.0, 0],
              'circle-color': ['step', ['get', 'count'], '#8dcc9c', 2, '#4ca76a', 5, '#227b49', 10, '#105332'],
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6.0, 0.9, 9.6, 0.7, 10.1, 0],
            },
          });

          map.addSource(markersSourceId, {
            type: 'geojson',
            data: markersToGeoJSON(currentMarkers),
            cluster: true,
            clusterMaxZoom: 6,
            clusterRadius: 42,
            clusterProperties: {
              sum_count: ['+', ['get', 'activity_count']],
              has_new: ['any', ['==', ['get', 'is_new_in_year'], 1]],
            },
          });

          map.addLayer({
            id: clustersHaloId,
            type: 'circle',
            source: markersSourceId,
            filter: ['has', 'point_count'],
            maxzoom: COUNTRY_MAX_ZOOM + 0.5,
            paint: {
              'circle-radius': ['step', ['get', 'point_count'], 18, 5, 22, 12, 26],
              'circle-color': 'rgba(23, 116, 92, 0.16)',
            },
          });

          map.addLayer({
            id: clustersLayerId,
            type: 'circle',
            source: markersSourceId,
            filter: ['has', 'point_count'],
            maxzoom: COUNTRY_MAX_ZOOM + 0.5,
            paint: {
              'circle-radius': ['step', ['get', 'point_count'], 12, 5, 15, 12, 18],
              'circle-color': '#17745c',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            },
          });

          map.addLayer({
            id: cityNewHaloId,
            type: 'circle',
            source: markersSourceId,
            filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'is_new_in_year'], 1]],
            maxzoom: REGION_MAX_ZOOM + 0.7,
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': ['step', ['get', 'activity_count'], 13, 5, 16, 15, 18],
              'circle-color': 'rgba(217, 130, 24, 0.24)',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 1, 11.0, 0],
            },
          });

          map.addLayer({
            id: cityBubblesId,
            type: 'circle',
            source: markersSourceId,
            filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'is_nearby'], 0]],
            maxzoom: REGION_MAX_ZOOM + 0.7,
            paint: {
              'circle-radius': ['step', ['get', 'activity_count'], 7, 5, 9.5, 15, 12, 40, 14.5],
              'circle-color': [
                'step',
                ['get', 'activity_count'],
                '#8dcc9c',
                3,
                '#4ca76a',
                10,
                '#227b49',
                25,
                '#105332',
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 0.96, 11.0, 0],
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 1, 11.0, 0],
            },
          });

          map.addLayer({
            id: cityNearbyId,
            type: 'circle',
            source: markersSourceId,
            filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'is_nearby'], 1]],
            maxzoom: REGION_MAX_ZOOM + 0.7,
            paint: {
              'circle-radius': ['step', ['get', 'activity_count'], 6, 5, 7.5, 15, 9],
              'circle-color': 'rgba(0, 0, 0, 0)',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 1, 11.0, 0],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#17745c',
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9.8, 1, 11.0, 0],
            },
          });

          map.on('click', clustersLayerId, async (event) => {
            const feature = event.features?.[0];
            if (!feature || !map) return;
            const clusterId = Number(feature.properties?.cluster_id);
            const coords = (feature.geometry as { coordinates: [number, number] }).coordinates;
            const source = map.getSource<GeoJSONSource>(markersSourceId);
            if (!source || !Number.isFinite(clusterId)) return;
            try {
              const expansionZoom = await source.getClusterExpansionZoom(clusterId);
              if (disposed || !map) return;
              viewMoved = true;
              map.easeTo({
                center: coords,
                zoom: Math.min(Math.max(expansionZoom + 0.3, map.getZoom() + 1.5), 11),
                duration: reducedMotion() ? 0 : 320,
              });
            } catch {
              /* ignore transient cluster state */
            }
          });

          const handleCityClick = (event: MapLayerMouseEvent) => {
            const featureCode = String(event.features?.[0]?.properties?.code ?? '');
            const found = markerByCode.get(featureCode);
            if (!found) return;
            const coarse =
              lastPointerType === 'touch' ||
              (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
            if (coarse && tapped?.code !== found.code) {
              tapped = found;
              hovered = null;
              return;
            }
            tapped = null;
            onselectcity?.(found);
          };

          map.on('click', cityBubblesId, handleCityClick);
          map.on('click', cityNearbyId, handleCityClick);
          map.on('click', gridLayerId, (event) => {
            selectedCellCount = Number(event.features?.[0]?.properties?.count) || null;
          });

          for (const interactiveLayer of [clustersLayerId, cityBubblesId, cityNearbyId]) {
            map.on('mouseenter', interactiveLayer, (event) => {
              if (!map) return;
              map.getCanvas().style.cursor = 'pointer';
              if (interactiveLayer === clustersLayerId || lastPointerType === 'touch') return;
              const featureCode = String(event.features?.[0]?.properties?.code ?? '');
              const found = markerByCode.get(featureCode);
              if (!found) return;
              hovered = { marker: found, x: event.point.x, y: event.point.y };
            });
            map.on('mousemove', interactiveLayer, (event) => {
              if (interactiveLayer === clustersLayerId || lastPointerType === 'touch') return;
              const featureCode = String(event.features?.[0]?.properties?.code ?? '');
              const found = markerByCode.get(featureCode);
              if (found) hovered = { marker: found, x: event.point.x, y: event.point.y };
            });
            map.on('mouseleave', interactiveLayer, () => {
              if (!map) return;
              map.getCanvas().style.cursor = '';
              hovered = null;
            });
          }

          map.on('dragstart', () => {
            viewMoved = true;
            hovered = null;
          });
          map.on('zoomstart', () => {
            hovered = null;
          });
          map.on('move', () => {
            syncLabels();
          });
          map.on('moveend', () => {
            syncLabels();
            updateDrawnFlag();
            clearTimeout(timer);
            timer = setTimeout(publishViewport, 180);
          });
          map.on('idle', () => {
            syncLabels();
            updateDrawnFlag();
          });

          ready = true;
          applyOfflineTheme();
          if (currentMarkers.length || data?.bounds) {
            const box =
              scope === 'global'
                ? (framing.initialBounds ?? data?.bounds ?? CHINA_OVERVIEW_BOUNDS)
                : (data?.bounds ?? framing.initialBounds ?? CHINA_OVERVIEW_BOUNDS);
            fitBox(box, { maxZoom: scope === 'global' ? 11 : 14, animate: false });
          }
          syncLabels();
          updateDrawnFlag();
        });
      } catch {
        if (!disposed) error = true;
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      resize.disconnect();
      stopTheme();
      basemap?.destroy();
      map?.remove();
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions : keyboard shortcuts bubble from focusable MapLibre canvas -->
<div
  class="map"
  role="region"
  aria-label="城市探索足迹地图"
  aria-describedby="exploration-map-help"
  data-testid="exploration-map"
  data-ready={ready}
  data-drawn={drawn}
  data-grid-drawn={gridDrawn}
  data-zoom-tier={currentTier}
  onpointerdown={(event) => {
    lastPointerType = event.pointerType;
  }}
  onkeydown={handleCanvasKeydown}
>
  <div class="canvas" bind:this={node}></div>
  <p class="sr-only" id="exploration-map-help">
    拖动或按住 Ctrl / ⌘ 滚动缩放，方向键平移，加减键缩放，按 0 回到全国或全域视野。
  </p>

  {#if ready}
    <div class="map-overlay-top">
      <div class="framing-actions">
        {#if framing.hasChina && framing.hasOverseas}
          <button type="button" class="button-secondary map-chip-btn" onclick={() => resetToOverview('china')}
            >聚焦中国</button
          >
          <button type="button" class="button-secondary map-chip-btn" onclick={() => resetToOverview('all')}
            >回到全球</button
          >
        {:else if viewMoved || scope !== 'global'}
          <button
            type="button"
            class="button-secondary map-chip-btn"
            onclick={() => resetToOverview(framing.hasOverseas ? 'all' : 'china')}
          >
            {framing.hasOverseas ? '回到全域' : '回到全国'}
          </button>
        {/if}
      </div>
    </div>

    <div class="labels-layer" aria-hidden="true">
      {#each labels as item (item.id)}
        <span
          class="map-label"
          class:cluster-label={item.kind === 'cluster'}
          class:accent={item.accent}
          style:left={`${item.x}px`}
          style:top={`${item.y}px`}>{item.text}</span
        >
      {/each}
    </div>

    {#if hovered}
      <div
        class="hover-card"
        style:left={`${Math.min(Math.max(12, hovered.x + 12), Math.max(12, mapWidth - 220))}px`}
        style:top={`${Math.max(12, hovered.y - 54)}px`}
      >
        <strong>{hovered.marker.name}</strong>
        <span>
          {hovered.marker.activity_count} 条活动{#if hovered.marker.distance_m !== null}
            · {kmText(hovered.marker.distance_m)}{/if}
        </span>
        <small>
          {hovered.marker.kind === 'nearby' ? '附近匹配' : '首次跑步'}
          {hovered.marker.first_date} · 点击查看
        </small>
      </div>
    {/if}

    {#if tapped}
      <div class="tap-bar" role="status">
        <div>
          <strong>{tapped.name}</strong>
          <span>
            {tapped.activity_count} 条{#if tapped.distance_m !== null}
              · {kmText(tapped.distance_m)}{/if}
            · {tapped.kind === 'nearby' ? '附近' : '边界内'}
          </span>
        </div>
        <div class="tap-actions">
          <button
            type="button"
            class="button-primary tap-go"
            onclick={() => {
              const target = tapped;
              tapped = null;
              if (target) onselectcity?.(target);
            }}>查看详情</button
          >
          <button
            type="button"
            class="button-secondary tap-close"
            aria-label="关闭城市提示"
            onclick={() => {
              tapped = null;
            }}>×</button
          >
        </div>
      </div>
    {/if}

    <div class="scale-pill" aria-hidden="true">
      {#if currentTier === 'country'}
        全国概览 · 城市聚合
      {:else if currentTier === 'region'}
        区域过渡 · {data?.block_size ? `${data.block_size * 100} m 格网` : '城市标记'}
      {:else}
        城市详图 · 100 m 格网
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="map-error" role="status">地图暂不可用</p>
  {/if}
</div>

<div class="map-footer">
  <div class="legend" aria-live="polite">
    {#if currentTier === 'country'}
      <span class="legend-item"><i class="dot dot-boundary" aria-hidden="true"></i>边界内跑过</span>
      <span class="legend-item"><i class="dot dot-nearby" aria-hidden="true"></i>附近有记录</span>
      {#if layer === 'new'}
        <span class="legend-item"><i class="dot dot-new" aria-hidden="true"></i>{yearLabel}首跑城市</span>
      {:else}
        <span class="legend-item"><i class="dot dot-cluster" aria-hidden="true"></i>聚落（点击展开）</span>
      {/if}
    {:else if data?.block_size && data.block_size > 1}
      <span>聚合网格 · 每块 {data.block_size * 100} m（{yearLabel}）</span>
      {#if selectedCellCount !== null}<span>· {selectedCellCount} 格</span>{/if}
    {:else if layer === 'new'}
      <span><i class="dot dot-new" aria-hidden="true"></i> {yearLabel}首次跑过 · 100 m 投影网格</span>
      {#if selectedCellCount !== null}<span>· 1 格</span>{/if}
    {:else}
      <span>热度低 <span class="swatch" aria-hidden="true"></span> 高 · 100 m 投影网格（{yearLabel}）</span>
      {#if selectedCellCount !== null}<span>· {selectedCellCount} 条活动</span>{/if}
    {/if}
  </div>

  {#if ready}
    <div class="basemap">
      <BasemapPicker
        preference={active ?? 'off'}
        allowOff
        {style}
        {status}
        onselect={choose}
        onoff={() => choose(null)}
      />
      {#if active}
        <button class="button-secondary" type="button" onclick={() => choose(null)}>关闭外部底图</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .map {
    position: relative;
    min-height: clamp(22rem, 52vh, 34rem);
    overflow: hidden;
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
    background: var(--muted);
  }
  .map:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  .map > .canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .map-overlay-top {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    right: 3.25rem;
    pointer-events: none;
    display: flex;
    justify-content: flex-start;
  }
  .framing-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    pointer-events: auto;
  }
  .map-chip-btn {
    min-height: 2.35rem;
    padding-inline: var(--space-3);
    font-size: var(--text-small);
    background: var(--surface);
  }
  .labels-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .map-label {
    position: absolute;
    transform: translate(-50%, -50%);
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
  .map-label.accent {
    background: var(--warning-soft);
    border-color: var(--warning-border);
    color: var(--warning);
  }
  .map-label.cluster-label {
    border: 0;
    background: transparent;
    color: var(--primary-foreground);
    padding: 0;
    font-variant-numeric: tabular-nums;
  }
  .map-label.cluster-label.accent {
    background: transparent;
    color: var(--foreground);
  }
  .hover-card {
    position: absolute;
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
    bottom: var(--space-3);
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
  .scale-pill {
    position: absolute;
    left: var(--space-3);
    bottom: var(--space-3);
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    pointer-events: none;
  }
  .tap-bar ~ .scale-pill {
    display: none;
  }
  .map-error {
    position: relative;
    padding: var(--space-4);
  }
  .map-footer,
  .basemap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .map-footer {
    justify-content: space-between;
    margin-top: var(--space-2);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .dot {
    display: inline-block;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: var(--radius-pill);
    vertical-align: middle;
  }
  .dot-boundary {
    background: var(--calendar-2);
  }
  .dot-nearby {
    border: 2px solid var(--primary);
    background: var(--surface);
  }
  .dot-new {
    background: var(--warning);
  }
  .dot-cluster {
    width: 0.8rem;
    height: 0.8rem;
    background: var(--primary);
  }
  .swatch {
    display: inline-block;
    width: 2rem;
    height: 0.65rem;
    border-radius: var(--radius-field);
    background: linear-gradient(to right, var(--calendar-1), var(--calendar-4));
  }
  @media (max-width: 480px) {
    .map {
      min-height: 20rem;
    }
  }
</style>
