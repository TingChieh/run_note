// A page whose main content is a map or a chart starts fetching that library while its data is
// still on the way, instead of after the data has arrived and the component has mounted.
// Call from onMount only. A failure here is ignored on purpose: the component that really needs the
// library imports it again and shows its own error and retry.

export function warmMapLibrary(): void {
  void import('maplibre-gl').catch(() => {});
  void import('maplibre-gl/dist/maplibre-gl.css').catch(() => {});
}

export function warmChartLibrary(): void {
  void import('#lib/components/trend-chart-runtime.ts').catch(() => {});
}
