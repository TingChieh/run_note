import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('#lib/server/backend.ts', () => ({ backendRequest: vi.fn() }));
import { backendRequest } from '#lib/server/backend.ts';
import { load } from '../../src/routes/workspace/activities/[id]/+page.server.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = new Request('http://localhost/');
const event = (is_admin: boolean, activityId = id) =>
  ({ params: { id: activityId }, request, locals: { user: { is_admin } } }) as Parameters<typeof load>[0];
const backend = vi.mocked(backendRequest);

beforeEach(() => backend.mockReset());

it.each([200, 401, 500])('checks an admin own activity only once on status %i', async (status) => {
  backend.mockResolvedValue(new Response(null, { status }));
  await expect(load(event(true))).resolves.toBeUndefined();
  expect(backend).toHaveBeenCalledTimes(1);
});

it('maps 422 to 404 without another request', async () => {
  backend.mockResolvedValue(new Response(null, { status: 422 }));
  await expect(load(event(true))).rejects.toMatchObject({ status: 404 });
  expect(backend).toHaveBeenCalledTimes(1);
});

it('redirects to the owner after a 404 and returns 404 if no owner is found', async () => {
  backend.mockResolvedValueOnce(new Response(null, { status: 404 }));
  backend.mockResolvedValueOnce(Response.json({ data: { user_id: owner } }));
  await expect(load(event(true))).rejects.toMatchObject({ status: 307, location: `/admin/users/${owner}/activities/${id}` });
  expect(backend).toHaveBeenCalledTimes(2);
  backend.mockReset();
  backend.mockResolvedValue(new Response(null, { status: 404 }));
  await expect(load(event(true))).rejects.toMatchObject({ status: 404 });
  expect(backend).toHaveBeenCalledTimes(2);
});

it('keeps the ordinary-user and unavailable-backend behavior', async () => {
  backend.mockRejectedValue(new Error('unavailable'));
  await expect(load(event(true))).resolves.toBeUndefined();
  expect(backend).toHaveBeenCalledTimes(1);
  backend.mockReset();
  backend.mockResolvedValue(new Response(null, { status: 404 }));
  await expect(load(event(false))).rejects.toMatchObject({ status: 404 });
  expect(backend).toHaveBeenCalledTimes(1);
  backend.mockReset();
  await expect(load(event(true, 'bad-id'))).rejects.toMatchObject({ status: 404 });
  expect(backend).not.toHaveBeenCalled();
});
