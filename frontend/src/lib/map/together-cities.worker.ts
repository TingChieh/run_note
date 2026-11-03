import regions from '#lib/data/china-cities.json';
import { locateFootprintCities, type CityRegion } from './footprint-cities.ts';
import type { FootprintCollection } from '#lib/api/footprints.ts';

type Feature = FootprintCollection['features'][number];
self.onmessage = (event: MessageEvent<Feature[]>) => {
  const grouped = new Map<string, Feature['geometry'][]>();
  for (const feature of event.data) {
    const id = String(feature.properties?.activity_id);
    grouped.set(id, [...(grouped.get(id) ?? []), feature.geometry]);
  }
  self.postMessage(Object.fromEntries([...grouped].map(([id, geometries]) => [id, locateFootprintCities(geometries, regions as CityRegion[]).cities.map(city => city.name).join('、')])));
};
