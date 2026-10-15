import { describe, expect, it } from 'vitest';
import { updateActivity, deleteActivity } from '../../src/lib/api/activities';
import { sampleActivity } from '../fixtures/activities';
const envelope = (data: unknown) => Response.json({ data, error: null });

describe('activity mutation protocol', () => {
  it('sends only metadata with fresh CSRF and validates saved details and deletion', async () => {
    let tokens = 0;
    const fetcher: typeof fetch = async (input, init) => {
      expect(init?.credentials).toBe('same-origin');
      if (input === '/api/v1/auth/csrf') return envelope({ csrf_token: `token-${++tokens}` });
      expect(input).toBe(`/api/v1/activities/${sampleActivity.id}`);
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe(`token-${tokens}`);
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ title: '新标题', notes: '私人备注' });
        return envelope({ ...sampleActivity, title: '新标题', notes: '私人备注' });
      }
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toBeUndefined();
      return envelope({ deleted: true });
    };
    await expect(updateActivity(sampleActivity.id, { title: '新标题', notes: '私人备注' }, fetcher)).resolves.toMatchObject({ title: '新标题', notes: '私人备注' });
    await expect(deleteActivity(sampleActivity.id, fetcher)).resolves.toBeUndefined();
    expect(tokens).toBe(2);
  });

  it('rejects mismatched or malformed mutation responses without pretending success', async () => {
    const fetcher = (result: unknown): typeof fetch => async input => input === '/api/v1/auth/csrf' ? envelope({ csrf_token: 'token' }) : envelope(result);
    for (const result of [{ ...sampleActivity, id: '22222222-2222-4222-8222-222222222222', notes: '' }, { ...sampleActivity, notes: null }]) {
      await expect(updateActivity(sampleActivity.id, { title: '新标题', notes: '' }, fetcher(result))).rejects.toThrow('无效响应');
    }
    for (const result of [{}, { deleted: false }, null]) await expect(deleteActivity(sampleActivity.id, fetcher(result))).rejects.toThrow('无效响应');
    await expect(deleteActivity(sampleActivity.id, async () => new Response('expired', { status: 401 }))).rejects.toMatchObject({ status: 401 });
    await expect(deleteActivity(sampleActivity.id, async () => envelope({ csrf_token: '' }))).rejects.toThrow();
    await expect(deleteActivity('../other', fetcher({ deleted: true }))).rejects.toMatchObject({ status: 404 });
  });
});
