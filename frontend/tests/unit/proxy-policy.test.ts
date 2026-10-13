import { expect, it } from 'vitest';
import { readProxyBody, upstreamTimeout } from '../../src/lib/server/proxy-policy';
it('reserves the AI generation deadline only for explicit report creation', () => {
  expect(upstreamTimeout('/api/v1/ai-reports', 'POST')).toBe(40000);
  expect(upstreamTimeout('/api/v1/ai-reports', 'GET')).toBe(8000);
  expect(upstreamTimeout('/api/v1/ai-reports/other', 'POST')).toBe(8000);
});
it('extends only the exact GPX upload timeout', () => {
  expect(upstreamTimeout('/api/v1/gpx-imports?x=1', 'POST')).toBe(45000);
  expect(upstreamTimeout('/api/v1/auth/login', 'POST')).toBe(8000);
  expect(upstreamTimeout('/api/v1/gpx-imports', 'GET')).toBe(8000);
});
it('bounds GPX body streams even without trustworthy Content-Length', async () => {
  const request = (chunks: Uint8Array[], length?: string) => new Request('http://localhost/api/v1/gpx-imports', { method: 'POST', headers: length ? { 'Content-Length': length } : {}, body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), duplex: 'half' } as RequestInit);
  expect((await readProxyBody(request([new Uint8Array(10)]), true))?.byteLength).toBe(10);
  await expect(readProxyBody(request([new Uint8Array(11 * 1024 * 1024), new Uint8Array(1)], '1'), true)).rejects.toMatchObject({ status: 413 });
  await expect(readProxyBody(request([], String(11 * 1024 * 1024 + 1)), true)).rejects.toMatchObject({ status: 413 });
});
