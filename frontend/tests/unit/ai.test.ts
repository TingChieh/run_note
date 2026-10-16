import { expect, it } from 'vitest';
import { AIError, confirmedRequestOutcome, generateReport, parseReport } from '../../src/lib/api/ai';
import { isProtected } from '../../src/lib/api/auth';
const key = '00000000-0000-4000-8000-000000000001';
const payload = { date_from: '2024-01-01', date_to: '2024-01-29', consent_to_send_summary: true as const };
it('allows public AI pages and rejects malformed reports', () => {
  expect(isProtected('/ai')).toBe(false);
  expect(isProtected('/ai/nested')).toBe(false);
  expect(isProtected('/air')).toBe(false);
  expect(() => parseReport({})).toThrow('无效');
});
it('forwards consent and caller key exactly once without automatic retries', async () => {
  let writes = 0;
  const fetcher: typeof fetch = async (path, init) => {
    if (path === '/api/v1/auth/csrf') return Response.json({ data: { csrf_token: 'csrf' } });
    writes++;
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(key);
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf');
    expect(JSON.parse(init?.body as string)).toEqual(payload);
    return Response.json({ error: { code: 'AI_TIMEOUT', message: '分析超时', details: [{ report_id: key }] } }, { status: 503 });
  };
  await expect(generateReport(payload, key, fetcher)).rejects.toMatchObject({ code: 'AI_TIMEOUT', reportId: key });
  expect(writes).toBe(1);
});
it('preserves unknown network outcomes without automatically starting another paid call', async () => {
  let writes = 0;
  await expect(generateReport(payload, key, async path => {
    if (path === '/api/v1/auth/csrf') return Response.json({ data: { csrf_token: 'csrf' } });
    writes++; throw new Error('offline');
  })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(writes).toBe(1);
});

it('retains request key for unknown server outcomes and clears only confirmed outcomes', () => {
  for (const code of ['INTERNAL_ERROR', 'REQUEST_FAILED', 'NETWORK_ERROR', 'AI_IN_PROGRESS', 'INVALID_RESPONSE']) {
    expect(confirmedRequestOutcome(new AIError('failed', 500, code))).toBe(false);
  }
  expect(confirmedRequestOutcome(new AIError('failed', 503, 'AI_TIMEOUT', key))).toBe(true);
  expect(confirmedRequestOutcome(new AIError('quota', 429, 'AI_QUOTA_EXCEEDED'))).toBe(true);
  expect(confirmedRequestOutcome(new AIError('unconfigured', 503, 'AI_NOT_CONFIGURED'))).toBe(true);
});

const device = { heart_rate_record_count: 2, heart_rate_weighted_count: 1, heart_rate_weighted_duration_seconds: '1200.5', avg_heart_rate_bpm: '145.250', calories_record_count: 1, calories_kcal: 0, steps_record_count: 1, steps: 3000 };
function fixture(version = 'running-summary-v2') {
  const summary = { activity_count: 3, distance_m: '12000', avg_pace_seconds_per_km: '300' };
  return { id: key, status: 'succeeded', is_stale: false, model: 'mock', analysis: { trend_summary: '', recommendations: [], limitations: '' }, stats_snapshot: { schema_version: version, summary, weeks: [{ ...summary, device_metrics: { ...device } }], device_metrics: { ...device }, average_runs_per_week: '1', evidence_limited: false, limitations: [] } };
}
it('accepts complete v2 metrics and historical v1', () => {
  expect(parseReport(fixture()).stats_snapshot.schema_version).toBe('running-summary-v2');
  const old = fixture('running-summary-v1');
  Reflect.deleteProperty(old.stats_snapshot, 'device_metrics');
  Reflect.deleteProperty(old.stats_snapshot.weeks[0], 'device_metrics');
  expect(parseReport(old).stats_snapshot.schema_version).toBe('running-summary-v1');
});
it('accepts null metrics with zero coverage', () => {
  const value = fixture();
  Object.assign(value.stats_snapshot.device_metrics, { heart_rate_record_count: 0, heart_rate_weighted_count: 0, heart_rate_weighted_duration_seconds: null, avg_heart_rate_bpm: null, calories_record_count: 0, calories_kcal: null, steps_record_count: 0, steps: null });
  expect(() => parseReport(value)).not.toThrow();
});
it.each([null, {}, { ...device, steps: -1 }, { ...device, steps: 1.5 }, { ...device, steps_record_count: 4 }, { ...device, calories_record_count: 0 }, { ...device, calories_kcal: null }, { ...device, heart_rate_record_count: 0 }, { ...device, heart_rate_weighted_count: 3 }, { ...device, heart_rate_weighted_count: 0 }, { ...device, heart_rate_weighted_duration_seconds: '0' }, { ...device, avg_heart_rate_bpm: '301' }, { ...device, avg_heart_rate_bpm: 'NaN' }, { ...device, calories_kcal: Infinity }])('rejects invalid v2 root and weekly metrics: %j', metrics => {
  for (const weekly of [false, true]) {
    const value = fixture();
    Object.assign(weekly ? value.stats_snapshot.weeks[0] : value.stats_snapshot, { device_metrics: metrics });
    expect(() => parseReport(value)).toThrow('无效');
  }
});

it('rejects absent root and weekly v2 metrics', () => {
  for (const weekly of [false, true]) {
    const value = fixture();
    Reflect.deleteProperty(weekly ? value.stats_snapshot.weeks[0] : value.stats_snapshot, 'device_metrics');
    expect(() => parseReport(value)).toThrow('无效');
  }
});
