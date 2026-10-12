import type { RequestHandler } from './$types';
import { backendRequest } from '#lib/server/backend.ts';
import { isGpxUpload, readProxyBody, ProxyBodyError } from '#lib/server/proxy-policy.ts';

const proxy: RequestHandler = async ({ request, url }) => {
  try {
    const body = await readProxyBody(request, isGpxUpload(url.pathname, request.method));
    const upstream = await backendRequest(url.pathname + url.search, request, request.method, body);
    const headers = new Headers(upstream.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (cause) {
    if (cause instanceof ProxyBodyError) return Response.json({ data: null, error: { code: 'PAYLOAD_TOO_LARGE', message: cause.message }, meta: { request_id: crypto.randomUUID() } }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: '无法连接服务，请稍后重试' }, meta: { request_id: crypto.randomUUID() } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
