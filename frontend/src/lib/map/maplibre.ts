/** Load MapLibre GL JS with its stylesheet and self-hosted module worker URL (required by MapLibre v6 in bundlers). */
export async function loadMapLibre() {
  const [lib, , worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
  ]);
  lib.setWorkerUrl(worker.default);
  return lib;
}
