import { describe, expect, it } from 'vitest';
import { parseTogether } from '../../src/lib/api/together.ts';
const participant = { user_id:'00000000-0000-4000-8000-000000000001', avatar_version:null, username:'runner', display_name:'跑者', distance_m:2000, count:1, week_m:2000, month_m:2000 };
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

import { participantColors } from '../../src/lib/map/together-colors.ts';
describe('参与者颜色', () => {
  it('按色板循环分配颜色，且不依赖返回顺序', () => {
    const people = Array.from({ length: 40 }, (_, i) => ({ user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, username: `runner_${i}` }));
    const colors = participantColors(people);
    expect(new Set(Object.values(colors)).size).toBe(16);
    expect(new Set(people.slice(16, 32).map(person => colors[person.username])).size).toBe(16);
    expect(participantColors([...people].reverse())).toEqual(colors);
    expect(new Set(Object.values(participantColors(people.slice(0, 8)))).size).toBe(8);
  });
});
