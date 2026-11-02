import { describe, expect, it } from 'vitest';
import { parseTogether } from '../../src/lib/api/together.ts';
const participant = { username:'runner', display_name:'跑者', distance_m:2000, count:1, week_m:2000, month_m:2000 };
const sample = { distance_m:2000, count:1, participants:[participant], recent:[], tracks:[{ username:'runner', activity_id:'00000000-0000-4000-8000-000000000001',title:'晨跑',activity_date:'2026-10-01',segment_index:0, geometry:{type:'LineString',coordinates:[[1,2],[2,3]]}}] };
describe('一起跑步公开契约',()=>{
  it('rebuilds a validated map collection with participant identity',()=>{
    const result=parseTogether(sample);
    expect(result.footprints.features[0].properties?.username).toBe('runner');
    expect(result.participants[0].week_m).toBe(2000);
  });
  it('rejects invalid geometry and unlisted participants',()=>{
    expect(()=>parseTogether({...sample, tracks:[{...sample.tracks[0],username:'other'}]})).toThrow();
    expect(()=>parseTogether({...sample, tracks:[{...sample.tracks[0],geometry:{type:'LineString',coordinates:[[200,0],[1,2]]}}]})).toThrow();
  });
});
