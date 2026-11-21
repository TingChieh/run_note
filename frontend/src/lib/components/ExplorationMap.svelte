<script lang="ts">
  import { onMount } from 'svelte';
  import type { GeoJSONSource, GeoJSONSourceSpecification, Map as LibreMap } from 'maplibre-gl';
  import {
    applyMapTheme,
    createRouteMapStyle,
    type BasemapPreference,
    type BasemapStatus,
    type BasemapStyle,
  } from '#lib/api/map-style.ts';
  import type { ExplorationCells, Layer, Viewport } from '#lib/api/exploration.ts';
  import { createBasemapController } from '#lib/map/basemap-controller.ts';
  import { loadMapLibre } from '#lib/map/maplibre.ts';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import BasemapPicker from '#lib/components/BasemapPicker.svelte';

  let {
    data,
    layer,
    onviewport,
  }: {
    data: ExplorationCells | null;
    layer: Layer;
    onviewport: (viewport: Viewport) => void;
  } = $props();
  const sourceId = 'exploration-grid';
  const layerId = 'exploration-grid-fill';
  const world = Math.PI * 6378137;
  const maxLatitude = 85.0511287798;
  type Collection = Exclude<GeoJSONSourceSpecification['data'], string>;
  const empty: Collection = { type: 'FeatureCollection', features: [] };
  let node: HTMLDivElement;
  let map: LibreMap | undefined;
  let ready = $state(false),
    error = $state(false);
  let drawn = $state(false);
  let active = $state<BasemapPreference | null>(null);
  let style = $state<BasemapStyle>('positron'),
    status = $state<BasemapStatus>('ready');
  let basemap: ReturnType<typeof createBasemapController> | undefined;
  let dark = false,
    framed = false;
  let selected = $state<number | null>(null);

  function longitude(x: number) {
    return Math.min(180, Math.max(-180, (x * 180) / world));
  }
  function latitude(y: number) {
    return (Math.atan(Math.sinh((y * Math.PI) / world)) * 180) / Math.PI;
  }
  function collection(value: ExplorationCells | null): Collection {
    if (!value) return empty;
    const step = value.block_size * 100;
    return {
      type: 'FeatureCollection',
      features: value.cells.map(([i, j, count]) => {
        const [west, south, east, north] = [
          longitude(i * step),
          latitude(j * step),
          longitude((i + 1) * step),
          latitude((j + 1) * step),
        ];
        return {
          type: 'Feature',
          properties: { count },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        };
      }),
    };
  }
  function choose(preference: BasemapPreference | null) {
    if (!ready || !map) return;
    basemap?.destroy();
    basemap = undefined;
    active = preference;
    if (!preference) {
      applyMapTheme(map, dark);
      return;
    }
    const fixed = preference === 'auto' ? undefined : preference;
    basemap = createBasemapController(
      map,
      layerId,
      (next) => {
        style = next.style;
        status = next.status;
      },
      undefined,
      { fixed, localPreference: preference },
    );
  }
  function publishViewport() {
    if (!map || !framed) return;
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
      zoom: Math.max(0, Math.min(22, map.getZoom())),
    });
  }

  $effect(() => {
    const result = data;
    const mode = layer;
    if (!ready || !map) return;
    const current = map;
    let obsolete = false;
    drawn = false;
    const onidle = () => {
      drawn = current.queryRenderedFeatures({ layers: [layerId] }).length > 0;
    };
    current.on('idle', onidle);
    void current
      .getSource<GeoJSONSource>(sourceId)
      ?.setData(collection(result))
      .catch(() => {
        if (!obsolete) error = true;
      });
    current.setPaintProperty(layerId, 'fill-outline-color', mode === 'new' ? '#805412' : 'rgba(255,255,255,0.5)');
    selected = null;
    if (!framed && result?.bounds) {
      framed = true;
      current.fitBounds(result.bounds, { padding: 30, duration: 0, maxZoom: 15 });
    }
    return () => {
      obsolete = true;
      current.off('idle', onidle);
    };
  });

  onMount(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => map?.resize());
    resize.observe(node);
    const stop = watchSystemTheme((value) => {
      dark = value;
      if (map && !basemap) applyMapTheme(map, dark);
    });
    void (async () => {
      try {
        const lib = await loadMapLibre();
        if (disposed) return;
        map = new lib.Map({
          container: node,
          style: createRouteMapStyle(dark),
          center: [0, 0],
          zoom: 0,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          scrollZoom: false,
          maxZoom: 19,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }));
        map.once('load', () => {
          if (disposed || !map) return;
          map.addSource(sourceId, { type: 'geojson', data: empty });
          map.addLayer({
            id: layerId,
            type: 'fill',
            source: sourceId,
            paint: {
              'fill-color': ['step', ['get', 'count'], '#8dcc9c', 2, '#4ca76a', 5, '#227b49', 10, '#105332'],
              'fill-opacity': 0.9,
            },
          });
          map.on('click', layerId, (event) => {
            selected = Number(event.features?.[0]?.properties.count) || null;
          });
          ready = true;
        });
        map.on('moveend', () => {
          clearTimeout(timer);
          timer = setTimeout(publishViewport, 180);
        });
      } catch {
        if (!disposed) error = true;
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      resize.disconnect();
      stop();
      basemap?.destroy();
      map?.remove();
    };
  });
</script>

<div
  class="map"
  role="region"
  aria-label="足迹覆盖地图"
  data-testid="exploration-map"
  data-ready={ready}
  data-drawn={drawn}
>
  <div class="canvas" bind:this={node}></div>
  {#if error}
    <p class="map-error" role="status">地图暂不可用</p>
  {/if}
</div>
<div class="map-footer">
  <p class="legend" aria-live="polite">
    {#if data?.block_size && data.block_size > 1}
      聚合网格 · 每块 {data.block_size * 100} m
      {#if selected !== null}
        · {selected} 格{/if}
    {:else if layer === 'new'}
      首次跑过 · 100 m 投影网格
      {#if selected !== null}
        · 1 格{/if}
    {:else}
      热度低 <span class="swatch" aria-hidden="true"></span> 高 · 100 m 投影网格
      {#if selected !== null}
        · {selected} 条活动{/if}
    {/if}
  </p>
  {#if ready}
    <div class="basemap">
      <BasemapPicker preference={active ?? 'auto'} {style} {status} onselect={choose} />
      {#if active}
        <button class="button-secondary" type="button" onclick={() => choose(null)}>关闭外部底图</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .map {
    position: relative;
    min-height: 20rem;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--muted);
  }
  .map > .canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    color: var(--muted-foreground);
    font-size: var(--text-small);
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
      min-height: 16rem;
    }
  }
</style>
