import { describe, it, expect } from 'vitest';
import { parsePublicActivity, parseShares, sharingWrite } from '../../src/lib/api/sharing';
import { isProtected } from '../../src/lib/api/auth';
const id = '11111111-1111-4111-8111-111111111111';
describe('public sharing', () => {
  it('anonymous pages are outside the authentication gate', () => {
    for (const path of ['/u/runner', '/shared/token', '/public/activities/id']) expect(isProtected(path)).toBe(false);
  });
  it('rejects invalid summaries and coordinate exposure', () => {
    const value = {
      id,
      title: 'Run',
      activity_date: '2024-01-01',
      distance_m: '1000.000',
      elapsed_seconds: null,
      avg_pace_seconds_per_km: null,
      author: { username: 'runner', display_name: 'Runner', email: 'hidden@example.com' },
      has_shared_route: false,
      notes: 'private',
    };
    const parsed = parsePublicActivity(value);
    expect(parsed).toEqual({
      id,
      title: 'Run',
      activity_date: '2024-01-01',
      distance_m: '1000.000',
      elapsed_seconds: null,
      avg_pace_seconds_per_km: null,
      author: { username: 'runner', display_name: 'Runner' },
      has_shared_route: false,
    });
    expect(parsed).not.toHaveProperty('notes');
    expect(parsed.author).not.toHaveProperty('email');
    for (const bad of [
      { ...value, id: '1' },
      { ...value, activity_date: '2024-02-31' },
      { ...value, has_shared_route: true },
      { ...value, distance_m: -1 },
      { ...value, distance_m: '1e3' },
      { ...value, elapsed_seconds: ' 600' },
      { ...value, avg_pace_seconds_per_km: '' },
    ])
      expect(() => parsePublicActivity(bad)).toThrow();
    expect(
      parsePublicActivity({ ...value, elapsed_seconds: 600, avg_pace_seconds_per_km: '351.3' }).elapsed_seconds,
    ).toBe(600);
  });
  it('rejects share lists that cannot safely drive revoke controls', () => {
    const link = {
      link_id: id,
      created_at: '2026-10-13T02:00:00Z',
      expires_at: null,
      revoked_at: null,
      status: 'active',
      token: 'secret',
    };
    expect(parseShares({ items: [link] })).toEqual({
      items: [
        {
          link_id: id,
          created_at: '2026-10-13T02:00:00Z',
          expires_at: null,
          revoked_at: null,
          status: 'active',
        },
      ],
    });
    for (const bad of [
      null,
      { items: 'nope' },
      { items: [{ ...link, link_id: '1' }] },
      { items: [{ ...link, created_at: 'yesterday' }] },
      { items: [{ ...link, expires_at: '' }] },
      { items: [{ ...link, status: 'live' }] },
      { items: [{ ...link, status: 'revoked', revoked_at: 'not-a-date' }] },
    ])
      expect(() => parseShares(bad)).toThrow('无效响应');
  });
  it('uses fresh csrf for writes', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fake = (async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      return Response.json({ data: path.endsWith('csrf') ? { csrf_token: 'fresh' } : { revoked: true }, error: null });
    }) as typeof fetch;
    await sharingWrite('/api/v1/activities/id/shares/link', 'DELETE', undefined, fake);
    expect(calls.map((c) => c[0])).toEqual(['/api/v1/auth/csrf', '/api/v1/activities/id/shares/link']);
    expect(calls[1][1]?.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fresh' });
  });
});
