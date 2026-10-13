import type { Handle } from '@sveltejs/kit/hooks';
import { backendRequest } from '#lib/server/backend.ts';
import { isProtected, readSession } from '#lib/api/auth.ts';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/')) return resolve(event);
  event.locals.user = null;
  event.locals.authError = null;
  try {
    event.locals.user = await readSession(async () => backendRequest('/api/v1/auth/session', event.request));
  } catch (cause) { event.locals.authError = cause instanceof Error ? cause.message : '认证服务暂不可用'; }
  if (isProtected(event.url.pathname) && !event.locals.user) {
    if (event.locals.authError) return new Response('认证服务暂不可用，请稍后重试。', { status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(null, { status: 303, headers: { Location: `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`, 'Cache-Control': 'no-store' } });
  }
  const response = await resolve(event);
  response.headers.set('Cache-Control', 'no-store');
  if (/^\/(shared|public|u)(\/|$)/.test(event.url.pathname)) {
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Robots-Tag','noindex, nofollow');
  }
  response.headers.append('Vary', 'Cookie');
  return response;
};
