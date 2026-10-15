import regions from '#lib/data/china-cities.json';
import { locateFootprintCities, type CityRegion } from './footprint-cities.ts';
import type { FootprintCollection } from '#lib/api/footprints.ts';

type Geometry = FootprintCollection['features'][number]['geometry'];
self.onmessage = (event: MessageEvent<Geometry[]>) => {
  self.postMessage(locateFootprintCities(event.data, regions as CityRegion[]));
};
