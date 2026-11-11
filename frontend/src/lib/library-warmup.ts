// A page whose main content is a map or a chart starts fetching that library early, instead of only
// once its component mounts. Where the page's own text comes first (activity and route detail), start
// it with afterNextPaint once that text has rendered: begun any earlier, ~215 KB of map library
// competes with the first paint on a slow phone connection. Where the map is the content (footprints,
// together), start it on mount: waiting there costs about a second before the map appears.
// A failure here is ignored on purpose: the component that really needs the library imports it again
// and shows its own error and retry.

/** Runs after the next frame has been painted. */
export function afterNextPaint(run: () => void): void {
  requestAnimationFrame(() => setTimeout(run, 0));
}

export function warmMapLibrary(): void {
  void import('maplibre-gl').catch(() => {});
  void import('maplibre-gl/dist/maplibre-gl.css').catch(() => {});
}

export function warmChartLibrary(): void {
  void import('#lib/components/trend-chart-runtime.ts').catch(() => {});
}
