import { afterEach, expect, test, vi } from 'vitest';
import { backendRequest } from '../../src/lib/server/backend.ts';

vi.mock('$app/env/private', () => ({ INTERNAL_API_BASE_URL: 'http://internal.test' }));

afterEach(() => vi.unstubAllGlobals());

test('the SSR proxy forwards the cells query with only the seven permitted client headers', async () => {
  const path = '/api/v1/me/footprints/exploration/city/310000/cells?year=2025&zoom=12&bbox=1%2C2%2C3%2C4';
  const allowed = {
    cookie: 'run_session=synthetic',
    origin: 'https://site.test',
    referer: 'https://site.test/footprints/exploration',
    'x-csrf-token': 'synthetic-token',
    'content-type': 'application/json',
    accept: 'application/json',
    'idempotency-key': 'synthetic-key',
  };
  const request = new Request(`https://site.test${path}`, {
    headers: { ...allowed, 'x-footprint-viewport': '5,6,7,8', 'x-forwarded-for': '192.0.2.1' },
  });
  const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  vi.stubGlobal('fetch', upstream);

  await backendRequest(path, request);

  expect(upstream).toHaveBeenCalledTimes(1);
  const [url, options] = upstream.mock.calls[0];
  expect(url.toString()).toBe(`http://internal.test${path}`);
  expect(Object.fromEntries(new Headers(options?.headers))).toEqual(allowed);
});
