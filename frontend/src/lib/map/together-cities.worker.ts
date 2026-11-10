import { locateFootprintCities } from './footprint-cities.ts';
import { withCityAtlas } from './city-atlas.ts';
import type { FootprintCollection } from '#lib/api/footprints.ts';

type Feature = FootprintCollection['features'][number];
self.onmessage = (event: MessageEvent<Feature[]>) => {
  const grouped = new Map<string, Feature['geometry'][]>();
  for (const feature of event.data) {
    const id = String(feature.properties?.activity_id);
    grouped.set(id, [...(grouped.get(id) ?? []), feature.geometry]);
  }
  withCityAtlas(regions => self.postMessage(Object.fromEntries([...grouped].map(([id, geometries]) => [id, locateFootprintCities(geometries, regions).cities.map(city => city.name).join('、')]))));
};
