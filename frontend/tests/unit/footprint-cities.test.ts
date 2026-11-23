import { expect, it } from 'vitest';
import {
  COUNTRY_MAX_ZOOM,
  REGION_MAX_ZOOM,
  footprintCitiesToGeoJSON,
  footprintCityPalette,
  footprintCitySummaryText,
  locateFootprintCities,
  locateFootprintCitySummaries,
  placeFootprintLabels,
  shortCityName,
  visitedProvinceCodes,
  zoomTier,
  type CityRegion,
} from '../../src/lib/map/footprint-cities.ts';
import type { FootprintCollection } from '../../src/lib/api/footprints.ts';
import encoded from '../../src/lib/data/china-cities.json';
import { decodeCityAtlas, type EncodedAtlas } from '../../src/lib/map/city-atlas.ts';

const atlas = decodeCityAtlas(encoded as EncodedAtlas);

const regions: CityRegion[] = [
  {code:'a',name:'甲市',bounds:[[0,0],[2,2]],polygons:[[[[0,0],[2,0],[2,2],[0,2],[0,0]]]]},
  {code:'b',name:'乙市',bounds:[[2,0],[4,2]],polygons:[[[[2,0],[4,0],[4,2],[2,2],[2,0]]]]},
  {code:'c',name:'丙市',bounds:[[6,0],[8,2]],polygons:[[[[6,0],[8,0],[8,2],[6,2],[6,0]]]]},
];
function find(geometries:unknown[]){
  return locateFootprintCities(geometries as FootprintCollection['features'][number]['geometry'][],regions);
}
it('returns only regions intersected by records and merges their camera bounds',()=>{
  const result=find([{type:'LineString',coordinates:[[.2,.3],[.8,.9]]},{type:'Point',coordinates:[1.2,1.3]}]);
  expect(result.cities).toEqual([{code:'a',name:'甲市',bounds:[[.2,.3],[1.2,1.3]]}]);
  expect(result.unlocatedBounds).toBeNull();
});
it('finds a crossed city even when a line has no sampled point inside it',()=>{
  expect(find([{type:'LineString',coordinates:[[-1,1],[5,1]]}]).cities.map(c=>c.code)).toEqual(['a','b']);
});
it('does not join disconnected tracks or bridge the dateline through unrelated cities',()=>{
  expect(find([{type:'MultiLineString',coordinates:[[[-2,1],[-1,1]],[[5,1],[5.5,1]]]}]).cities).toEqual([]);
  expect(find([{type:'LineString',coordinates:[[-179,1],[179,1]]}]).cities).toEqual([]);
});
it('matches heat polygons including a city entirely inside a cell, but excludes holes',()=>{
  expect(find([{type:'Polygon',coordinates:[[[-1,-1],[5,-1],[5,3],[-1,3],[-1,-1]]]}]).cities.map(c=>c.code)).toEqual(['a','b']);
  expect(find([{type:'Polygon',coordinates:[[[-1,-1],[5,-1],[5,3],[-1,3],[-1,-1]],[[-.5,-.5],[4.5,-.5],[4.5,2.5],[-.5,2.5],[-.5,-.5]]]}]).cities).toEqual([]);
});
it('keeps unsupported areas accessible and never changes source geometry',()=>{
  const input=[{type:'Point',coordinates:[20,30]}];const original=structuredClone(input);
  expect(find(input)).toEqual({cities:[],unlocatedBounds:[[20,30],[20,30]]});
  expect(input).toEqual(original);expect(find([])).toEqual({cities:[],unlocatedBounds:null});
});
it('uses the bundled atlas to group districts into recorded cities and omit unvisited cities',()=>{
  const result=locateFootprintCities([
    {type:'Point',coordinates:[121.485,31.235]},
    {type:'Point',coordinates:[116.397,39.908]},
    {type:'Point',coordinates:[113.264,23.129]},
  ],atlas);
  expect(result.cities.map(city=>city.name)).toEqual(['北京市','上海市','广州市']);
  expect(result.cities.some(city=>city.name==='深圳市')).toBe(false);
  expect(result.unlocatedBounds).toBeNull();
});
it('decodes delta-encoded rings back to the exact four-decimal coordinates',()=>{
  const [region]=decodeCityAtlas({scale:10000,regions:[{code:'x',name:'某市',bounds:[[116.4436,39.8728],[116.4509,39.89]],polygons:[[[1164436,398728,5,172,68,2,-73,-174]]]}]});
  expect(region.polygons).toEqual([[[[116.4436,39.8728],[116.4441,39.89],[116.4509,39.8902],[116.4436,39.8728]]]]);
  expect(atlas).toHaveLength(369);
  expect(atlas.every(city=>city.polygons.every(polygon=>polygon.every(ring=>ring.length>=4 && ring[0].join()===ring[ring.length-1].join())))).toBe(true);
});

it('produces concise short city names across all bundled atlas regions', () => {
  expect(shortCityName('北京市')).toBe('北京');
  expect(shortCityName('上海市')).toBe('上海');
  expect(shortCityName('延边朝鲜族自治州')).toBe('延边');
  expect(shortCityName('恩施土家族苗族自治州')).toBe('恩施');
  expect(shortCityName('大兴安岭地区')).toBe('大兴安岭');
  expect(shortCityName('锡林郭勒盟')).toBe('锡林郭勒');
  expect(shortCityName('香港')).toBe('香港');
  for (const region of atlas) {
    const label = shortCityName(region.name);
    expect(label.length).toBeGreaterThanOrEqual(2);
    expect(label.length).toBeLessThanOrEqual(region.name.length);
  }
});

it('builds consistent city summaries and GeoJSON for tracks and heatmap modes', () => {
  const trackSummaries = locateFootprintCitySummaries(
    [
      { geometry: { type: 'Point', coordinates: [121.485, 31.235] }, activityId: 'a1' },
      // Second segment of the same activity must not double-count in tracks mode.
      { geometry: { type: 'Point', coordinates: [121.49, 31.24] }, activityId: 'a1' },
      { geometry: { type: 'Point', coordinates: [121.495, 31.245] }, activityId: 'a2' },
      { geometry: { type: 'Point', coordinates: [116.397, 39.908] }, activityId: 'a3' },
    ],
    atlas,
    'tracks',
  );
  const heatSummaries = locateFootprintCitySummaries(
    [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [[[121.484, 31.234], [121.485, 31.234], [121.485, 31.235], [121.484, 31.235], [121.484, 31.234]]],
        },
        count: 5,
      },
      {
        geometry: {
          type: 'Polygon',
          coordinates: [[[121.486, 31.236], [121.487, 31.236], [121.487, 31.237], [121.486, 31.237], [121.486, 31.236]]],
        },
        count: 2,
      },
      {
        geometry: {
          type: 'Polygon',
          coordinates: [[[116.397, 39.908], [116.398, 39.908], [116.398, 39.909], [116.397, 39.909], [116.397, 39.908]]],
        },
        count: 3,
      },
    ],
    atlas,
    'heatmap',
  );

  // Identical city set across both modes.
  expect(trackSummaries.cities.map((c) => c.code)).toEqual(heatSummaries.cities.map((c) => c.code));
  expect(trackSummaries.cities.map((c) => c.shortName)).toEqual(['北京', '上海']);

  const shanghaiTracks = trackSummaries.cities.find((c) => c.code === '310000')!;
  const shanghaiHeat = heatSummaries.cities.find((c) => c.code === '310000')!;
  expect(shanghaiTracks.count).toBe(2);
  expect(shanghaiTracks.cellCount).toBe(0);
  expect(shanghaiHeat.count).toBe(5);
  expect(shanghaiHeat.cellCount).toBe(2);
  expect(footprintCitySummaryText(shanghaiTracks, 'tracks')).toBe('2 条记录');
  expect(footprintCitySummaryText(shanghaiHeat, 'heatmap')).toBe('2 格 · 最高 5 次');

  // Both modes emit non-empty Point features with aligned properties.
  const tracksGeo = footprintCitiesToGeoJSON(trackSummaries.cities, 'tracks');
  const heatGeo = footprintCitiesToGeoJSON(heatSummaries.cities, 'heatmap');
  expect(tracksGeo.type === 'FeatureCollection' ? tracksGeo.features : []).toHaveLength(2);
  expect(heatGeo.type === 'FeatureCollection' ? heatGeo.features : []).toHaveLength(2);
  expect(visitedProvinceCodes(trackSummaries.cities)).toEqual(['CN-110000', 'CN-310000']);
});

it('places cluster and city labels under REGION_MAX_ZOOM and clears them at city detail zoom', () => {
  const { cities } = locateFootprintCitySummaries(
    [
      { geometry: { type: 'Point', coordinates: [121.485, 31.235] }, activityId: 'a1' },
      { geometry: { type: 'Point', coordinates: [121.49, 31.24] }, activityId: 'a2' },
      { geometry: { type: 'Point', coordinates: [116.397, 39.908] }, activityId: 'a3' },
      { geometry: { type: 'Point', coordinates: [104.066, 30.572] }, activityId: 'a4' },
    ],
    atlas,
    'tracks',
  );
  const project = ([lon, lat]: [number, number]) => ({ x: 400 + (lon - 112) * 20, y: 300 - (lat - 32) * 20 });

  expect(zoomTier(4.2)).toBe('country');
  expect(zoomTier(COUNTRY_MAX_ZOOM)).toBe('region');
  expect(zoomTier(REGION_MAX_ZOOM)).toBe('city');

  const countryLabels = placeFootprintLabels(
    cities,
    [{ id: 1, lon: 121.2, lat: 31.25, count: 2, hasNew: false }],
    project,
    900,
    600,
    4.5,
  );
  expect(countryLabels.some((item) => item.kind === 'cluster' && item.text === '2城')).toBe(true);
  expect(countryLabels.some((item) => item.kind === 'city' && item.text === '北京')).toBe(true);

  const regionLabels = placeFootprintLabels(cities, [], project, 900, 600, 8.0);
  expect(regionLabels.every((item) => item.kind === 'city')).toBe(true);
  expect(regionLabels.map((item) => item.text)).toContain('上海');

  expect(placeFootprintLabels(cities, [], project, 900, 600, REGION_MAX_ZOOM)).toEqual([]);
});

it('keeps tracks and heatmap palettes distinct while sharing base tokens', () => {
  for (const dark of [false, true]) {
    const tracksPal = footprintCityPalette(dark, 'tracks');
    const heatPal = footprintCityPalette(dark, 'heatmap');
    expect(tracksPal.ocean).toBe(heatPal.ocean);
    expect(tracksPal.land).toBe(heatPal.land);
    expect(tracksPal.clusterFill).not.toBe(heatPal.clusterFill);
    expect(tracksPal.bubbleFill).not.toEqual(heatPal.bubbleFill);
  }
});
