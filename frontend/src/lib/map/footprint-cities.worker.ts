import {
  locateFootprintCitySummaries,
  type FootprintCityFeatureInput,
  type FootprintMode,
} from './footprint-cities.ts';
import { withCityAtlas } from './city-atlas.ts';
import type { FootprintCollection } from '#lib/api/footprints.ts';

type Geometry = FootprintCollection['features'][number]['geometry'];
type WorkerPayload =
  | Geometry[]
  | {
      mode: FootprintMode;
      features: FootprintCityFeatureInput[];
    };

self.onmessage = (event: MessageEvent<WorkerPayload>) => {
  const payload = event.data;
  const mode: FootprintMode = Array.isArray(payload) ? 'tracks' : payload.mode;
  const features: FootprintCityFeatureInput[] = Array.isArray(payload)
    ? payload.map((geometry) => ({ geometry }))
    : payload.features;
  withCityAtlas((regions) => self.postMessage(locateFootprintCitySummaries(features, regions, mode)));
};
