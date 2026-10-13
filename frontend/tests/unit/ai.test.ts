import { expect, it } from 'vitest';
import { AIError, confirmedRequestOutcome, generateReport, parseReport } from '../../src/lib/api/ai';
import { isProtected } from '../../src/lib/api/auth';
const key = '00000000-0000-4000-8000-000000000001';
const payload = { date_from: '2024-01-01', date_to: '2024-01-29', consent_to_send_summary: true as const };
it('protects AI pages and rejects malformed reports', () => {
  expect(isProtected('/ai')).toBe(true);
  expect(isProtected('/ai/nested')).toBe(true);
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
