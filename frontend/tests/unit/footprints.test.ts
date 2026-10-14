import { expect, it } from 'vitest';
import { footprintSelection, footprintQuery, footprintRange, parseFootprints } from '../../src/lib/api/footprints';
import { isProtected } from '../../src/lib/api/auth';
it('restores year and heatmap, validates inclusive range and leap dates', () => {
  expect(footprintSelection(new URLSearchParams('year=2024&mode=heatmap'),2026)).toEqual({year:2024,from:'2024-01-01',to:'2024-12-31',mode:'heatmap',filter:'year'});
  expect(footprintRange({year:2024,from:'2024-02-29',to:'2024-02-29',mode:'tracks',filter:'range'})).toEqual({date_from:'2024-02-29',date_to:'2024-03-01'});
  expect(()=>footprintRange({year:2024,from:'2024-02-30',to:'2024-03-01',mode:'tracks',filter:'range'})).toThrow();
  expect(footprintSelection(new URLSearchParams('year=9999&mode=bad'),2026).year).toBe(2026);
  expect(isProtected('/footprints')).toBe(true);
});
it('saves range and restores after refresh without retaining private data', () => {
  const selection={year:2024,from:'2024-01-03',to:'2024-02-29',mode:'heatmap' as const,filter:'range' as const};
  expect(footprintSelection(footprintQuery(selection),2026)).toEqual(selection);
});
it('rejects malformed, unsafe and inconsistent service data', () => {
  const data={type:'FeatureCollection',features:[],mode:'heatmap',date_from:'2024-01-01',date_to:'2025-01-01',activity_count:0,visible_activity_count:0,unsupported_segment_count:0,grid_size_m:100,grid_crs:'EPSG:3857',count_basis:'distinct_activity_per_cell',max_count:0};
  expect(parseFootprints(data).features).toEqual([]);
  expect(()=>parseFootprints({...data,features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{i:0,j:0,count:-1}}]})).toThrow();
  expect(()=>parseFootprints({...data,grid_size_m:0})).toThrow();
});
it('displays dateline pieces near one another without changing source coordinates', async () => {
  const { displayFootprints, coordinates } = await import('../../src/lib/api/footprints');
  const source={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[179.999,1],[180,1]],[[-180,1],[-179.999,1]]]},properties:{activity_id:'id'}}]} as unknown as import('../../src/lib/api/footprints').Footprints;
  const points=displayFootprints(source).features.flatMap(f=>coordinates(f.geometry));
  expect(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))).toBeCloseTo(0.002,6);
  expect(coordinates(source.features[0].geometry)[2][0]).toBe(-180);
});
it('moves each whole line as one world copy without stretching opposite routes', async () => {
  const { displayFootprints, coordinates } = await import('../../src/lib/api/footprints');
  const source={features:[{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[179.999,1],[180,1]],[[-0.002,1],[0,1]]]},properties:{}}]} as unknown as import('../../src/lib/api/footprints').Footprints;
  const points=coordinates(displayFootprints(source).features[0].geometry);
  expect(Math.abs(points[3][0]-points[2][0])).toBeCloseTo(0.002,6);
});

it('visits geometry coordinates in order without expanding a temporary array', async () => {
  const { forEachCoordinate, geometryBounds } = await import('../../src/lib/api/footprints');
  const g={type:'GeometryCollection',geometries:[{type:'LineString',coordinates:[[179,1],[180,2]]},{type:'Point',coordinates:[181,-1]}]} as Parameters<typeof forEachCoordinate>[0];
  const points:number[][]=[];
  forEachCoordinate(g,p=>points.push(p));
  expect(points).toEqual([[179,1],[180,2],[181,-1]]);
  expect(geometryBounds([g])).toEqual([[179,-1],[181,2]]);
  expect(geometryBounds([])).toBeNull();
});

it('reuses unchanged display geometry but never shifts original dateline coordinates', async () => {
  const { displayFootprints } = await import('../../src/lib/api/footprints');
  const g={type:'LineString',coordinates:[[121,31],[122,32]]};
  const source={features:[{type:'Feature',geometry:g,properties:{}}]} as unknown as import('../../src/lib/api/footprints').Footprints;
  expect(displayFootprints(source).features[0].geometry).toBe(g);
  expect(g.coordinates).toEqual([[121,31],[122,32]]);
});

it('keeps frozen mixed geometries intact across world shifting and repeated framing', async () => {
  const { displayFootprints, geometryBounds } = await import('../../src/lib/api/footprints');
  const line={type:'LineString',coordinates:[[179,1],[180,2]]};
  const multi={type:'MultiLineString',coordinates:[[[179,1],[180,2]],[[-180,1],[-179,2]]]};
  const polygon={type:'Polygon',coordinates:[[[-180,0],[-179,0],[-179,1],[-180,0]]]};
  const source={features:[{type:'Feature',geometry:{type:'GeometryCollection',geometries:[line,multi,polygon]},properties:{}}]} as unknown as import('../../src/lib/api/footprints').Footprints;
  const freeze=(value: unknown): void => { if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  const original=JSON.stringify(source);freeze(source);
  for(let i=0;i<2;i++) {
    const displayed=displayFootprints(source);
    expect(geometryBounds(displayed.features.map(f=>f.geometry))).toEqual([[179,0],[181,2]]);
    const g=displayed.features[0].geometry as typeof source.features[0]['geometry'] & {geometries: [typeof line,typeof multi,typeof polygon]};
    expect(g.geometries[0]).toBe(line);
    expect(g.geometries[1].coordinates[0]).toBe(multi.coordinates[0]);
    expect(g.geometries[1].coordinates[1]).not.toBe(multi.coordinates[1]);
    expect(g.geometries[2].coordinates).not.toBe(polygon.coordinates);
  }
  expect(JSON.stringify(source)).toBe(original);
  expect(geometryBounds(source.features.map(f=>f.geometry))).toEqual([[-180,0],[180,2]]);
});
