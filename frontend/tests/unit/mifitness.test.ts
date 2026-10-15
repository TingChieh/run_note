import { describe, expect, it } from 'vitest';
import { matchTrackFiles, parsePreparedRecords, parsePreview, previewMifitness, saveMifitness, mifitnessWarningLabel } from '../../src/lib/api/mifitness';
import { readActivity } from '../../src/lib/api/activities';
const source = { source_time: 1791763200, has_downloaded_track: false, source_metrics: { distance: 3000, duration: 1200, start_time: 1791763200, end_time: 1791764400, max_cadence: 5730, train_effect: 0, account_id: 'private', download_url: 'https://private.invalid' }, device_id: 'private' };
export const preview = { activity_date: '2026-10-12', timezone: 'Asia/Shanghai', started_at: '2026-10-12T00:00:00Z', ended_at: '2026-10-12T00:20:00Z', distance_m: '3000', timer_seconds: '1200', elapsed_seconds: '1200', calories_kcal: null, steps: null, avg_heart_rate_bpm: null, max_heart_rate_bpm: 180, min_heart_rate_bpm: null, avg_cadence_spm: '170.5', max_cadence_spm: null, vo2_max_ml_kg_min: null, training_load: null, aerobic_training_effect: '0', anaerobic_training_effect: null, has_route: false, point_count: 0, segment_count: 0, warnings: ['MIFITNESS_MAX_CADENCE_INVALID'], suspected_activity_ids: [] };
const activity = { id: '11111111-1111-4111-8111-111111111111', title: '跑步', ...preview, avg_pace_seconds_per_km:'400', temporal_quality:'complete',quality_summary:{},metrics_version:'mifitness-v1',created_at:preview.started_at };
describe('Mi Fitness input privacy and matching', () => {
  it('rebuilds the upload whitelist while retaining anomalous optional numbers for server warnings', () => {
    const [item] = parsePreparedRecords({ records: [source] });
    expect(item.record).toEqual({source_time:source.source_time,source_metrics:{distance:3000,duration:1200,start_time:1791763200,end_time:1791764400,max_cadence:5730,train_effect:0}});
    expect(item.record).not.toHaveProperty('has_downloaded_track');
  });
  it('rejects malformed required fields, duplicate summaries and unsafe batch sizes', () => {
    for (const value of [{records:[]}, {records:[source,source]}, {records:[{...source,source_time:'1791763200'}]}, {records:[{...source,source_metrics:{...source.source_metrics,distance:'3000'}}]}, {records:Array.from({length:1001},()=>source)}]) expect(()=>parsePreparedRecords(value)).toThrow();
  });
  it('rejects required metrics beyond the supported numeric range before any upload', () => {
    expect(()=>parsePreparedRecords({records:[{...source,source_metrics:{...source.source_metrics,distance:1e9}}]})).toThrow();
  });
  it('matches only exact unique names and refuses silently missing downloaded tracks', () => {
    const records = parsePreparedRecords({records:[{...source,has_downloaded_track:true}]});
    const file = new File(['<gpx/>'],`running_${source.source_time}.gpx`);
    expect(matchTrackFiles(records,[file])[0].file).toBe(file);
    expect(()=>matchTrackFiles(records,[])).toThrow('缺少');
    expect(()=>matchTrackFiles(records,[file,file])).toThrow('重复');
    expect(()=>matchTrackFiles(records,[new File(['x'],'other.gpx')])).toThrow();
    expect(matchTrackFiles(parsePreparedRecords({records:[source]}),[])[0].file).toBeUndefined();
  });
});
describe('Mi Fitness private API contract', () => {
  it('retains only a valid owner activity link for the backend record fingerprint conflict', async () => {
    const item=matchTrackFiles(parsePreparedRecords({records:[source]}),[])[0];
    const fetcher:typeof fetch=async input=>input==='/api/v1/auth/csrf'?Response.json({data:{csrf_token:'token'}}):Response.json({error:{code:'MIFITNESS_DUPLICATE',message:'已存在',details:[{duplicate_kind:'record',existing_activity_id:activity.id}]}},{status:409});
    await expect(previewMifitness(item,'',fetcher)).rejects.toMatchObject({existingActivityId:activity.id,duplicateKind:'record'});
  });
  it('explains all normalized device warning codes in Chinese', () => {
    for (const field of ['CALORIES','STEPS','AVG_HRM','MAX_HRM','MIN_HRM','AVG_CADENCE','MAX_CADENCE','VO2_MAX','TRAIN_LOAD','TRAIN_EFFECT','ANAEROBIC_TRAIN_EFFECT']) expect(mifitnessWarningLabel(`MIFITNESS_${field}_INVALID`)).not.toContain('MIFITNESS_');
    expect(mifitnessWarningLabel('MIFITNESS_AVG_STRIDE_UNIT_UNVERIFIED')).toContain('步幅');
    expect(mifitnessWarningLabel('MIFITNESS_RECOVER_TIME_UNIT_UNVERIFIED')).toContain('恢复');
  });
  it('validates preview ranges and preserves valid zero and decimal device metrics', () => {
    expect(parsePreview(preview).aerobic_training_effect).toBe('0');
    for (const bad of [{max_heart_rate_bpm:1.5},{max_cadence_spm:5730},{training_load:'1000000000'},{aerobic_training_effect:6},{activity_date:'2026-02-30'},{suspected_activity_ids:['//evil']}]) expect(()=>parsePreview({...preview,...bad})).toThrow('无效响应');
  });
  it('validates optional nullable activity metrics and rejects corrupt device values', async () => {
    expect(await readActivity(activity.id,async()=>Response.json({data:activity}))).toMatchObject({avg_cadence_spm:'170.5'});
    for (const bad of [{max_cadence_spm:5730},{max_heart_rate_bpm:'180'},{aerobic_training_effect:-1}]) await expect(readActivity(activity.id,async()=>Response.json({data:{...activity,...bad}}))).rejects.toThrow('无效响应');
  });
  it('uses fresh CSRF for preview and save; enrichment and similar confirmation are explicit', async () => {
    const item=matchTrackFiles(parsePreparedRecords({records:[source]}),[])[0]; const bodies: FormData[]=[]; let tokens=0;
    const fetcher:typeof fetch=async(input,init)=>{
      if(input==='/api/v1/auth/csrf')return Response.json({data:{csrf_token:`token-${++tokens}`}});
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(`token-${tokens}`);
      const form=init?.body as FormData; bodies.push(form); expect(JSON.parse(String(form.get('record')))).toEqual(item.record);
      return Response.json({data:String(input).includes('?preview=true')?preview:{activity,warnings:[]}});
    };
    await previewMifitness(item,'',fetcher); await saveMifitness(item,'Asia/Shanghai',{},fetcher);
    expect(bodies[0].has('timezone')).toBe(false);expect(bodies[1].get('timezone')).toBe('Asia/Shanghai');expect(bodies[1].has('enrich_activity_id')).toBe(false);expect(bodies[1].has('confirm_similar')).toBe(false);
    await saveMifitness(item,'',{confirmSimilar:true,enrichActivityId:activity.id},fetcher);
    expect(bodies[2].get('confirm_similar')).toBe('true');expect(bodies[2].get('enrich_activity_id')).toBe(activity.id);
    await expect(previewMifitness(item,'',async()=>new Response('expired',{status:401}))).rejects.toMatchObject({status:401});
  });
});
