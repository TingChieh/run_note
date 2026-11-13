import { describe, expect, it } from 'vitest';
import { readAdminActivities, readAdminActivity, readAdminRoute } from '../../src/lib/api/admin-readonly-activities.ts';

const id = '11111111-1111-4111-8111-111111111111';
const activity = {
  id,
  title: '晨跑',
  notes: '合成备注',
  activity_date: '2026-10-12',
  timezone: 'UTC',
  started_at: null,
  ended_at: null,
  distance_m: '1000',
  elapsed_seconds: null,
  avg_pace_seconds_per_km: null,
  temporal_quality: 'manual',
  quality_summary: {},
  metrics_version: 'test',
  has_route: false,
  created_at: '2026-10-12T00:00:00Z',
  visibility: 'private',
  allow_shared_route: false,
};
const envelope = (data: unknown) => Response.json({ data, error: null });
describe('administrator activity reads', () => {
  it('validates list, detail and route', async () => {
    await expect(
      readAdminActivities(id, 0, async () => envelope({ items: [activity], total: 1, limit: 20, offset: 0 })),
    ).resolves.toMatchObject({ total: 1 });
    await expect(readAdminActivity(id, id, async () => envelope(activity))).resolves.toMatchObject({
      notes: '合成备注',
    });
    await expect(
      readAdminActivities(id, 0, async () =>
        envelope({ items: [{ ...activity, has_route: 'yes' }], total: 1, limit: 20, offset: 0 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(readAdminActivity(id, id, async () => envelope({ ...activity, id: 'wrong' }))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(readAdminRoute(id, id, async () => envelope({ features: 'bad' }))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([401, 403, 404])('preserves HTTP %i', async (status) => {
    await expect(
      readAdminActivity(id, id, async () => Response.json({ error: { message: '失败' } }, { status })),
    ).rejects.toMatchObject({ status });
  });
});
