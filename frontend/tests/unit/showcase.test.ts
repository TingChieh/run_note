import { describe, expect, it, vi } from 'vitest';
import { isProtected } from '../../src/lib/api/auth.ts';
import { readShowcaseProfile, parseShowcaseActivity, showcasePath } from '../../src/lib/api/showcase.ts';

describe('single-owner showcase contract', () => {
  it('keeps browsing public and protects account settings', () => {
    for (const path of ['/dashboard', '/activities', '/activities/example', '/activities/wall', '/footprints', '/ai', '/admin']) expect(isProtected(path)).toBe(false);
    expect(isProtected('/settings')).toBe(true);
  });

  it('maps only read resources to dedicated showcase endpoints', () => {
    expect(showcasePath('/api/v1/activities?limit=20')).toBe('/api/v1/showcase/activities?limit=20');
    expect(showcasePath('/api/v1/me/running-goals')).toBe('/api/v1/showcase/running-goals');
    expect(() => showcasePath('/api/v1/me')).toThrow();
    expect(() => showcasePath('https://example.com/api/v1/activities')).toThrow();
  });

  it('rebuilds public profile and rejects unknown timezone', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { display_name: '展示跑者', timezone: 'Asia/Shanghai', email: 'private@example.com', id: 'private-id' } })));
    expect(await readShowcaseProfile(fetcher)).toEqual({ display_name: '展示跑者', timezone: 'Asia/Shanghai', avatar_url: null });
    fetcher.mockResolvedValue(new Response(JSON.stringify({ data: { display_name: '展示跑者', timezone: 'Invalid/Zone' } })));
    await expect(readShowcaseProfile(fetcher)).rejects.toThrow();
  });

  it('drops notes and nested private extras from public activities', () => {
    const result = parseShowcaseActivity({
      id: '00000000-0000-4000-8000-000000000001', title: '合成晨跑', activity_date: '2026-10-01', timezone: 'Asia/Shanghai',
      started_at: null, ended_at: null, distance_m: '1000', elapsed_seconds: '400', avg_pace_seconds_per_km: '400',
      temporal_quality: 'complete', has_route: true, metrics_version: 'v1', created_at: '2026-10-01T00:00:00Z',
      notes: 'private', email: 'private@example.com', quality_summary: { filename: 'private.gpx' },
    });
    expect(result.notes).toBeUndefined();
    expect(result.quality_summary).toEqual({});
    expect(result).not.toHaveProperty('email');
  });
});
