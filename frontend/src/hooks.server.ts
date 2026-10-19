import type { Handle } from '@sveltejs/kit/hooks';
import { backendRequest } from '#lib/server/backend.ts';
import { readShowcaseProfile } from '#lib/api/showcase.ts';
import { viewContext } from '#lib/api/view-context.ts';
import { isProtected, readSession } from '#lib/api/auth.ts';
import { parseSite } from '#lib/api/site.ts';
import { SITE_DEFAULTS } from '#lib/site.ts';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/')) return resolve(event);
  event.locals.user = null;
  event.locals.authError = null;
  event.locals.showcase = null;
  event.locals.showcaseError = null;
  event.locals.site = SITE_DEFAULTS;
  try {
    const upstream = await backendRequest('/api/v1/site', event.request);
    const body = upstream.ok ? await upstream.json() : null;
    if (body?.data) event.locals.site = parseSite(body.data);
  } catch { /* Settings are cosmetic: fall back to built-in defaults. */ }
  if (/^\/(login|register)(\/|$)/.test(event.url.pathname)) return new Response('页面不存在', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (event.cookies.get('run_session') || event.cookies.get('__Host-run_session')) event.locals.user = await readSession(async () => backendRequest('/api/v1/auth/session', event.request));
  } catch (cause) { event.locals.authError = cause instanceof Error ? cause.message : '认证服务暂不可用'; }
  const context = viewContext(event.url.pathname, event.locals.user?.is_admin === true);
  const profilePath = context.kind === 'public' ? `/api/v1/showcase/users/${encodeURIComponent(context.username!)}/profile` : '/api/v1/showcase/profile';
  if (context.kind === 'workspace' && event.locals.user) event.locals.showcase = { display_name: event.locals.user.display_name, timezone: event.locals.user.timezone, avatar_url: event.locals.user.avatar_url ?? null };
  try { if (context.kind !== 'workspace') event.locals.showcase = await readShowcaseProfile(async () => backendRequest(profilePath, event.request)); }
  catch (cause) { event.locals.showcaseError = cause instanceof Error ? cause.message : '展示资料暂不可用'; }
  if (isProtected(event.url.pathname) && !event.locals.user) {
    if (event.locals.authError) return new Response('认证服务暂不可用，请稍后重试。', { status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(null, { status: 303, headers: { Location: `/admin?next=${encodeURIComponent(event.url.pathname + event.url.search)}`, 'Cache-Control': 'no-store' } });
  }
  if (context.kind === 'public' && !event.locals.showcase) return new Response('页面不存在', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (/^\/admin\/users(?:\/|$)/.test(event.url.pathname) && !event.locals.user?.is_admin) return new Response('无权访问', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (/^\/settings\/site(?:\/|$)/.test(event.url.pathname) && !event.locals.user?.is_admin) return new Response('无权访问', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const site = event.locals.site;
  const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html
      .replace('%runnote.favicon%', escape(site.favicon_url ?? '/favicon.ico'))
      .replace('%runnote.theme%', site.default_theme),
  });
  response.headers.set('Cache-Control', 'no-store');
  if (!event.locals.user) {
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Robots-Tag','noindex, nofollow');
  }
  response.headers.append('Vary', 'Cookie');
  return response;
};
