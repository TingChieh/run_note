import { INTERNAL_API_BASE_URL } from '$app/env/private';
import { upstreamTimeout } from './proxy-policy';

export async function backendRequest(path: string, request: Request, method = 'GET', body?: ArrayBuffer): Promise<Response> {
  const target = new URL(INTERNAL_API_BASE_URL);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Invalid internal API origin');
  }
  const url = new URL(path, target);
  if (url.origin !== target.origin || !url.pathname.startsWith('/api/')) throw new Error('Invalid API path');
  const headers = new Headers();
  // Never synthesize Origin or trust client forwarding headers. FastAPI checks the real source.
  for (const name of ['cookie', 'origin', 'referer', 'x-csrf-token', 'content-type', 'accept', 'idempotency-key']) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  return fetch(url, { method, headers, body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(upstreamTimeout(path, method)) });
}
