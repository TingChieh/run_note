import { describe, expect, it } from 'vitest';
import { parseTogether } from '../../src/lib/api/together.ts';
const participant = { user_id:'00000000-0000-4000-8000-000000000001', avatar_version:null, username:'runner', display_name:'跑者', distance_m:2000, count:1, week_m:2000, month_m:2000, year_m:2000 };
const sample = { next_cursor:null, tracks_truncated:false, distance_m:2000, count:1, participants:[participant], recent:[], tracks:[{ username:'runner', activity_id:'00000000-0000-4000-8000-000000000001',title:'晨跑',activity_date:'2026-10-01',segment_index:0, geometry:{type:'LineString',coordinates:[[1,2],[2,3]]}}] };
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
  it('相邻颜色（包括循环边界）的色相至少相差 100 度', () => {
    const people = Array.from({ length: 256 }, (_, i) => ({ user_id: `runner-${String(i).padStart(3, '0')}`, username: `runner-${i}` }));
    const colliding = people.filter(person => {
      let hash = 2166136261;
      for (const char of person.user_id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return (hash >>> 0) % 16 === 0;
    }).slice(0, 16);
    expect(colliding).toHaveLength(16);
    const assigned = participantColors(colliding);
    const hues = colliding.map(person => {
      const color = assigned[person.username];
      const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      expect(delta).toBeGreaterThan(0);
      const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return (hue * 60 + 360) % 360;
    });
    for (let i = 0; i < hues.length; i++) {
      const difference = Math.abs(hues[i] - hues[(i + 1) % hues.length]);
      expect(Math.min(difference, 360 - difference)).toBeGreaterThanOrEqual(100);
    }
  });
  it('按色板循环分配颜色，且不依赖返回顺序', () => {
    const people = Array.from({ length: 40 }, (_, i) => ({ user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, username: `runner_${i}` }));
    const colors = participantColors(people);
    expect(new Set(Object.values(colors)).size).toBe(16);
    expect(new Set(people.slice(16, 32).map(person => colors[person.username])).size).toBe(16);
    expect(participantColors([...people].reverse())).toEqual(colors);
    expect(new Set(Object.values(participantColors(people.slice(0, 8)))).size).toBe(8);
  });
});

import { parsePeriod, periodCopy } from '../../src/lib/api/together.ts';
it('parses periods and provides overview copy', () => {
  expect(['week','month','year','invalid',null].map(parsePeriod)).toEqual(['week','month','year','week','week']);
  expect(['week','month','year'].map(p => periodCopy(parsePeriod(p)))).toEqual(['本周','本月','今年']);
});

import { appendRecent, parseFeed } from '../../src/lib/api/together.ts';
it('validates feed cursors and deduplicates appended records', () => {
  const record = {id:participant.user_id, username:'runner', display_name:'跑者', title:'晨跑', activity_date:'2026-10-01', distance_m:2000, avg_pace_seconds_per_km:null};
  const parsed = parseFeed({items:[record], next_cursor:'opaque'}, new Set(['runner']));
  expect(appendRecent([record], parsed.items)).toEqual([record]);
  expect(parsed.next_cursor).toBe('opaque');
  expect(() => parseFeed({items:[record], next_cursor:42}, new Set(['runner']))).toThrow();
});
