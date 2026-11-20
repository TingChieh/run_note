import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, MapLibreEvent, Marker } from 'maplibre-gl';
import { applyReplayTheme } from '#lib/api/map-style.ts';
import {
  displayEdges,
  displayLines,
  edgesThrough,
  tipCoordinates,
  type ReplayPoint,
  type ReplayTrack,
} from './engine.ts';

type MapLibre = typeof import('maplibre-gl');
export type CameraMode = 'overview' | 'follow' | 'free';
// Follow eases toward the runner instead of snapping to every fix, which made GPS wobble shake the whole map.
const CENTER_LAG_MS = 350;
const ZOOM_LAG_MS = 500;
const FOLLOW_ZOOM_STEP = 1.5;
const FOLLOW_ZOOM_RANGE = [13, 16.5] as const;
const empty = { type: 'FeatureCollection' as const, features: [] };
const travelled = ['case', ['boolean', ['feature-state', 'done'], false], 1, 0] as const;

interface Options {
  /** DOM marker for the runner; omitted when the caller draws the runner itself (video frames). */
  runner?: HTMLElement;
  /** Camera mode changes, including the switch to 'free' when the viewer pans or rotates by hand. */
  onmode?: (mode: CameraMode) => void;
}

/**
 * Adds the replay sources, layers, runner and camera control to a loaded map once. Per update only
 * feature-state, a few tip coordinates and the marker change: no geometry is rebuilt, nothing torn down.
 */
export function installReplayLayers(
  map: MapLibreMap,
  lib: MapLibre,
  track: ReplayTrack,
  dark: boolean,
  options: Options = {},
) {
  const lines = displayLines(track);
  const edges = displayEdges(lines);
  map.addSource('replay-track', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: lines.map((l) => ({
        type: 'Feature' as const,
        properties: {},
        geometry:
          l.coordinates.length > 1
            ? { type: 'LineString' as const, coordinates: l.coordinates }
            : { type: 'Point' as const, coordinates: l.coordinates[0] },
      })),
    },
  });
  map.addSource('replay-edges', { type: 'geojson', data: { type: 'FeatureCollection', features: edges.features } });
  map.addSource('replay-tip', { type: 'geojson', data: empty, tolerance: 0 });
  const lineLayout = { 'line-join': 'round', 'line-cap': 'round' } as const;
  map.addLayer({
    id: 'replay-base',
    type: 'line',
    source: 'replay-track',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: lineLayout,
    paint: { 'line-width': 4, 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'replay-base-points',
    type: 'circle',
    source: 'replay-track',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 4 },
  });
  // Edges are separate features: round caps overlap at joints, invisible only because travelled edges are opaque.
  map.addLayer({
    id: 'replay-done',
    type: 'line',
    source: 'replay-edges',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: lineLayout,
    paint: { 'line-width': 5, 'line-opacity': travelled as never },
  });
  map.addLayer({
    id: 'replay-done-points',
    type: 'circle',
    source: 'replay-edges',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-opacity': travelled as never },
  });
  map.addLayer({
    id: 'replay-tip',
    type: 'line',
    source: 'replay-tip',
    layout: lineLayout,
    paint: { 'line-width': 5 },
  });
  applyReplayTheme(map, dark);
  const marker: Marker | undefined = options.runner
    ? new lib.Marker({ element: options.runner, subpixelPositioning: true })
        .setLngLat([track.lon[0], track.lat[0]])
        .addTo(map)
    : undefined;
  const tip = map.getSource('replay-tip') as GeoJSONSource;
  const bounds: LngLatBoundsLike = [
    [track.bounds[0], track.bounds[1]],
    [track.bounds[2], track.bounds[3]],
  ];
  let done = 0,
    mode: CameraMode = 'overview',
    target: [number, number] = [track.lon[0], track.lat[0]],
    followZoom = 15,
    frame = 0,
    last = 0,
    destroyed = false;

  const padding = () => {
    const container = map.getContainer();
    return Math.min(56, container.clientWidth / 5, container.clientHeight / 5);
  };
  function setMode(next: CameraMode) {
    if (next !== 'follow' && frame) cancelAnimationFrame(frame);
    if (next !== 'follow') frame = 0;
    if (mode === next) return;
    mode = next;
    options.onmode?.(next);
  }
  function followStep(timestamp: number) {
    frame = 0;
    if (destroyed || mode !== 'follow') return;
    const dt = last ? Math.min(timestamp - last, 100) : 16;
    last = timestamp;
    // Let a wheel or button zoom finish; the camera eases back onto the runner afterwards.
    if (!map.isZooming() && !map.isRotating()) {
      const center = map.getCenter(),
        zoom = map.getZoom();
      // Unwrapped track longitudes may sit a world away from the map's wrapped center.
      const lng = target[0] + Math.round((center.lng - target[0]) / 360) * 360;
      if (
        Math.abs(lng - center.lng) < 1e-7 &&
        Math.abs(target[1] - center.lat) < 1e-7 &&
        Math.abs(followZoom - zoom) < 1e-3
      )
        return;
      const kc = 1 - Math.exp(-dt / CENTER_LAG_MS),
        kz = 1 - Math.exp(-dt / ZOOM_LAG_MS);
      map.jumpTo({
        center: [center.lng + (lng - center.lng) * kc, center.lat + (target[1] - center.lat) * kc],
        zoom: zoom + (followZoom - zoom) * kz,
      });
    }
    frame = requestAnimationFrame(followStep);
  }
  function wake() {
    if (mode === 'follow' && !frame && !destroyed) {
      last = 0;
      frame = requestAnimationFrame(followStep);
    }
  }
  const byHand = (event: MapLibreEvent & { originalEvent?: unknown }) => !!event.originalEvent;
  const onPan = (event: MapLibreEvent) => {
    if (byHand(event)) setMode('free');
  };
  const onZoom = (event: MapLibreEvent) => {
    if (!byHand(event)) return;
    // Zooming while following keeps following at the chosen zoom; elsewhere it leaves the overview.
    if (mode === 'follow') {
      followZoom = map.getZoom();
      wake();
    } else setMode('free');
  };
  map.on('dragstart', onPan);
  map.on('rotatestart', onPan);
  map.on('pitchstart', onPan);
  map.on('zoomend', onZoom);

  return {
    update(point: ReplayPoint) {
      marker?.setLngLat([point.lon, point.lat]);
      const next = edgesThrough(edges.ends, point.index);
      for (let id = done; id < next; id++) map.setFeatureState({ source: 'replay-edges', id }, { done: true });
      for (let id = next; id < done; id++) map.setFeatureState({ source: 'replay-edges', id }, { done: false });
      done = next;
      const from =
        done && edges.segments[done - 1] === point.segment ? edges.ends[done - 1] : track.segmentStarts[point.segment];
      tip.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: tipCoordinates(track, from, point) },
      });
      target = [point.lon, point.lat];
      wake();
    },
    /** `inset` reserves room (CSS px) for overlays drawn over the map, such as video panels. */
    overview(animate: boolean, inset?: { top: number; bottom: number; left: number; right: number }) {
      setMode('overview');
      map.stop();
      map.fitBounds(bounds, {
        padding: inset ?? padding(),
        maxZoom: 17,
        bearing: 0,
        pitch: 0,
        duration: animate ? 600 : 0,
      });
    },
    follow(animate: boolean) {
      map.stop();
      const overview = map.cameraForBounds(bounds, { padding: padding(), maxZoom: 17 })?.zoom ?? 14;
      followZoom = Math.min(FOLLOW_ZOOM_RANGE[1], Math.max(FOLLOW_ZOOM_RANGE[0], overview + FOLLOW_ZOOM_STEP));
      setMode('follow');
      if (!animate) map.jumpTo({ center: target, zoom: followZoom, bearing: 0, pitch: 0 });
      wake();
    },
    /** After a resize: refit the overview; follow corrects itself; a hand-picked view stays put. */
    resized() {
      if (mode === 'overview') map.fitBounds(bounds, { padding: padding(), maxZoom: 17, duration: 0 });
    },
    theme(value: boolean) {
      applyReplayTheme(map, value);
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      map.off('dragstart', onPan);
      map.off('rotatestart', onPan);
      map.off('pitchstart', onPan);
      map.off('zoomend', onZoom);
      marker?.remove();
    },
  };
}
export type ReplayLayers = ReturnType<typeof installReplayLayers>;
