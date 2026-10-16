import { describe, expect, it } from 'vitest';
import { ActivityError, readActivities, readActivity, uploadGpx, formatDate, formatDistance, formatDuration, formatPace, warningLabel, qualityEntries, unwrapRoute } from '../../src/lib/api/activities';
const activity = { id: '11111111-1111-4111-8111-111111111111', title: '晨跑', activity_date: '2026-10-12', timezone: 'Asia/Shanghai', started_at: null, ended_at: null, distance_m: '1234.567', elapsed_seconds: null, avg_pace_seconds_per_km: null, temporal_quality: 'incomplete', quality_summary: {}, metrics_version: 'gpx-v1', has_route: true, created_at: '2026-10-12T00:00:00Z' };
const envelope = (data: unknown) => Response.json({ data, error: null });
describe('activity display and privacy boundary', () => {
  it('preserves calendar dates and never turns missing metrics into zero', () => {
    expect(formatDate('2026-10-12')).toBe('2026-10-12'); expect(formatDistance('1234.567')).toBe('1.2 km');
    expect(formatDistance(null)).toBe('—'); expect(formatDuration(null)).toBe('—'); expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatPace(null)).toBe('—'); expect(formatPace('359.9')).toBe('6:00 /km');
  });
  it('rejects malformed list/detail responses instead of presenting stale data', async () => {
    await expect(readActivities(async () => envelope({ items: [activity], total: 1, limit: 20, offset: 0 }))).resolves.toMatchObject({ total: 1 });
    await expect(readActivity(activity.id, async () => envelope(activity))).resolves.toMatchObject({ id: activity.id });
    for (const data of [{ ...activity, distance_m: '' }, { ...activity, activity_date: '2026-02-30' }, { ...activity, id: 'other' }]) await expect(readActivity(activity.id, async () => envelope(data))).rejects.toThrow('无效响应');
    await expect(readActivities(async () => envelope({ items: [{ ...activity, has_route: 'yes' }], total: 1 }))).rejects.toThrow('无效响应');
  });
  it('supports wall page sizes while rejecting mismatched pagination responses', async () => {
    const fetcher: typeof fetch = async input => {
      expect(input).toBe('/api/v1/activities?limit=24&offset=24');
      return envelope({ items: [activity], total: 25, limit: 24, offset: 24 });
    };
    await expect(readActivities(fetcher, 24, undefined, undefined, undefined, 24)).resolves.toMatchObject({ limit: 24, offset: 24 });
    await expect(readActivities(async () => envelope({ items: [], total: 50, limit: 20, offset: 24 }), 24, undefined, undefined, undefined, 24)).rejects.toThrow('无效响应');
  });
  it('fetches a fresh CSRF token for every upload with cookies and browser multipart boundary', async () => {
    let tokens = 0, writes = 0; const form = new FormData(); form.append('file', new Blob(['<gpx/>']), 'run.gpx');
    const fetcher: typeof fetch = async (input, init) => {
      expect(init?.credentials).toBe('same-origin'); expect(init?.cache).toBe('no-store');
      if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: `token-${++tokens}` });
      writes++; expect(input).toBe('/api/v1/gpx-imports'); expect(init?.body).toBe(form);
      const headers = new Headers(init?.headers); expect(headers.get('X-CSRF-Token')).toBe(`token-${tokens}`);
      expect(headers.has('Content-Type')).toBe(false); expect(headers.has('Origin')).toBe(false);
      return envelope({ activity, import_id: activity.id, warnings: [], point_count: 2, segment_count: 1, metrics_version: 'gpx-v1' });
    };
    await uploadGpx(form, fetcher); await uploadGpx(form, fetcher); expect(tokens).toBe(2); expect(writes).toBe(2);
  });
  it('retains 401 status even for non-JSON failures and limits duplicate links to UUIDs', async () => {
    await expect(readActivities(async () => new Response('expired', { status: 401 }))).rejects.toMatchObject({ status: 401 });
    const response = (id: string) => Response.json({ error: { code: 'DUPLICATE', message: '重复轨迹', details: [{ existing_activity_id: id, duplicate_kind: 'raw' }] } }, { status: 409 });
    await expect(readActivities(async () => response(activity.id))).rejects.toMatchObject({ existingActivityId: activity.id });
    await expect(readActivities(async () => Response.json({ error: { details: [{ existing_activity_id: activity.id, duplicate_kind: 'canonical' }] } }, { status: 409 }))).rejects.toMatchObject({ existingActivityId: activity.id });
    await expect(readActivities(async () => response('//evil.example'))).rejects.toMatchObject({ existingActivityId: null });
    for (const details of [{ existing_activity_id: activity.id }, [{ existing_activity_id: activity.id, duplicate_kind: 'unknown' }], [{ existing_activity_id: activity.id }], [{ existing_activity_id: activity.id, duplicate_kind: 'raw' }, { existing_activity_id: activity.id, duplicate_kind: 'canonical' }]]) {
      await expect(readActivities(async () => Response.json({ error: { details } }, { status: 409 }))).rejects.toMatchObject({ existingActivityId: null });
    }
  });
  it('explains confirmed quality counters and warnings without exposing internal keys', () => {
    expect(warningLabel('TIME_GAP')).toContain('300');
    expect(qualityEntries({ valid_point_count: 3, speed_jump_count: 1, warnings: ['TIME_GAP'] })).toEqual([['有效轨迹点', '3'], ['异常速度断点', '1'], ['质量提示', warningLabel('TIME_GAP')]]);
  });
  it('unwraps the antimeridian without joining segments and accepts single points', () => {
    const route = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[179, 10], [-179, 11]] }, properties: { segment_index: 0, point_count: 2 } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [-178, 12] }, properties: { segment_index: 1, point_count: 1 } }], start: [179, 10], end: [-178, 12] };
    const result = unwrapRoute(route); expect(result.features).toHaveLength(2); expect(result.features[0].geometry.coordinates).toEqual([[179, 10], [181, 11]]); expect(result.end).toEqual([182, 12]); expect(route.end).toEqual([-178, 12]);
    expect(() => unwrapRoute({ ...route, start: [190, 10] })).toThrow('无效响应');
  });
});

describe('TCX private metrics and upload', () => {
  it('uploads TCX with explicit time interpretation through fresh CSRF', async () => {
    const { uploadTcx } = await import('../../src/lib/api/activities');
    const form = new FormData(); form.append('file', new Blob(['<TrainingCenterDatabase/>']), 'run.tcx'); form.append('time_mode', 'local');
    const fetcher: typeof fetch = async (input, init) => {
      if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: 'tcx-token' });
      expect(input).toBe('/api/v1/tcx-imports');
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tcx-token');
      expect(init?.body).toBe(form);
      return envelope({ activity: { ...activity, timer_seconds:'1166', avg_heart_rate_bpm:156, calories_kcal:144, steps:3262 }, warnings:[] });
    };
    await expect(uploadTcx(form, fetcher)).resolves.toMatchObject({ activity: { avg_heart_rate_bpm:156, timer_seconds:'1166' } });
  });
  it('prefers device duration without converting zero or missing data and formats corrected start time', async () => {
    const { activityDuration, formatStartTime } = await import('../../src/lib/api/activities');
    expect(activityDuration({ ...activity, elapsed_seconds:'1322', timer_seconds:'1166' })).toBe('1166');
    expect(activityDuration({ ...activity, elapsed_seconds:'1322', timer_seconds:0 })).toBe(0);
    expect(activityDuration(activity)).toBeNull();
    expect(formatStartTime('2026-10-04T08:15:20Z', 'Asia/Shanghai')).toBe('16:15:20');
  });
  it('rejects corrupted physiological metrics instead of showing impossible values', async () => {
    for (const fields of [{ avg_heart_rate_bpm:999 }, { steps:-1 }, { calories_kcal:2.5 }, { timer_seconds:'NaN' }]) {
      await expect(readActivity(activity.id, async () => envelope({ ...activity,...fields }))).rejects.toThrow('无效响应');
    }
  });
});
