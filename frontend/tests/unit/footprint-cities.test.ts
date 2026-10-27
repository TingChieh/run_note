import { expect, it } from 'vitest';
import { locateFootprintCities, type CityRegion } from '../../src/lib/map/footprint-cities.ts';
import type { FootprintCollection } from '../../src/lib/api/footprints.ts';
import atlas from '../../src/lib/data/china-cities.json';

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
  ],atlas as CityRegion[]);
  expect(result.cities.map(city=>city.name)).toEqual(['北京市','上海市','广州市']);
  expect(result.cities.some(city=>city.name==='深圳市')).toBe(false);
  expect(result.unlocatedBounds).toBeNull();
});
