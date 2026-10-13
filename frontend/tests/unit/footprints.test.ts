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
