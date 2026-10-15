import { expect, it } from 'vitest';
import * as api from '../../src/lib/api/activities';
import { sampleActivity } from '../fixtures/activities';
const envelope = (data: unknown) => Response.json({ data, error: null });
it('persists category and tags in the metadata request and rejects malformed labels', async () => {
  const changes = { title: '10公里晨跑', notes: '', category: '长距离', tags: ['公园', '晨跑'] };
  let sent: unknown;
  const fetcher: typeof fetch = async (input, init) => {
    if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: 'fresh' });
    sent = JSON.parse(String(init?.body));
    return envelope({ ...sampleActivity, ...changes });
  };
  await expect(api.updateActivity(sampleActivity.id, changes, fetcher)).resolves.toMatchObject(changes);
  expect(sent).toEqual(changes);
  for (const fields of [{ category: null }, { tags: 'bad' }, { tags: [null] }, { tags: [''] }, { tags: Array(11).fill('a') }]) {
    await expect(api.readActivity(sampleActivity.id, async () => envelope({ ...sampleActivity, ...fields }))).rejects.toThrow('无效响应');
  }
});
it('batch deletion uses fresh CSRF, confirms exact count and rejects unsafe input before sending', async () => {
  const ids = [sampleActivity.id, '22222222-2222-4222-8222-222222222222'];
  const fetcher: typeof fetch = async (input, init) => {
    if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: 'fresh' });
    expect(input).toBe('/api/v1/activities/batch-delete');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh');
    expect(JSON.parse(String(init?.body))).toEqual({ ids });
    return envelope({ deleted: true, deleted_count: 2 });
  };
  await expect(api.deleteActivities(ids, fetcher)).resolves.toBeUndefined();
  for (const result of [{ deleted: true, deleted_count: 1 }, { deleted: false, deleted_count: 2 }, {}]) {
    await expect(api.deleteActivities(ids, async input => input === '/api/v1/auth/csrf' ? envelope({ csrf_token: 'fresh' }) : envelope(result))).rejects.toThrow('无效响应');
  }
  for (const input of [[], [ids[0], ids[0]], ['../bad'], Array(101).fill(ids[0])]) {
    let calls = 0;
    await expect(api.deleteActivities(input, async () => { calls++; return envelope({}); })).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
