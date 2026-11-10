import { locateFootprintCities } from './footprint-cities.ts';
import { withCityAtlas } from './city-atlas.ts';
import type { FootprintCollection } from '#lib/api/footprints.ts';

type Geometry = FootprintCollection['features'][number]['geometry'];
self.onmessage = (event: MessageEvent<Geometry[]>) => {
  withCityAtlas(regions => self.postMessage(locateFootprintCities(event.data, regions)));
};
