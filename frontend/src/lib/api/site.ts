import { ActivityError, request } from './activities.ts';
import { SITE_DEFAULTS, type Site, type SiteTheme } from '../site.ts';

export class SiteError extends Error {
  constructor(message: string, public status = 502, public code = 'INVALID_RESPONSE') { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new SiteError('站点设置服务返回了无效响应'); }
const imagePath = /^\/api\/v1\/(?:site\/images\/(?:favicon|logo)|me\/avatar|showcase(?:\/users\/[a-z0-9_]{3,30})?\/avatar)\?v=[0-9a-f]{16}$/;
export const safeImagePath = (value: unknown): string | null => typeof value === 'string' && imagePath.test(value) ? value : null;
const limits = { title: 40, subtitle: 40, footer_tagline: 80, description: 200 } as const;
const themes: SiteTheme[] = ['system', 'light', 'dark'];
export function parseSite(value: unknown): Site {
  if (!object(value)) invalid();
  for (const [key, max] of Object.entries(limits)) { const text = value[key]; if (typeof text !== 'string' || text.length > max) invalid(); }
  if (!(value.title as string).trim() || !themes.includes(value.default_theme as SiteTheme)) invalid();
  const image = (key: 'favicon_url' | 'logo_url') => { const raw = value[key]; if (raw === null) return null; const safe = safeImagePath(raw); if (!safe) invalid(); return safe; };
  return { title: value.title as string, subtitle: value.subtitle as string, footer_tagline: value.footer_tagline as string, description: value.description as string, default_theme: value.default_theme as SiteTheme, favicon_url: image('favicon_url'), logo_url: image('logo_url') };
}
async function call(path: string, init: RequestInit, fetcher: typeof fetch, timeout?: number): Promise<unknown> {
  try { return await request(path, init, fetcher, timeout); }
  catch (cause) { if (cause instanceof ActivityError) throw new SiteError(cause.message, cause.status, cause.code); throw cause; }
}
async function csrf(fetcher: typeof fetch): Promise<string> {
  const value = await call('/api/v1/auth/csrf', {}, fetcher);
  if (!object(value) || typeof value.csrf_token !== 'string' || !value.csrf_token) invalid();
  return value.csrf_token;
}
export async function readSite(fetcher: typeof fetch = fetch): Promise<Site> { return parseSite(await call('/api/v1/site', {}, fetcher)); }
export async function updateSite(patch: Partial<Pick<Site, 'title' | 'subtitle' | 'footer_tagline' | 'description' | 'default_theme'>>, fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call('/api/v1/site', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(patch) }, fetcher));
}
const form = (file: File) => { const body = new FormData(); body.append('file', file); return body; };
export async function uploadSiteImage(kind: 'favicon' | 'logo', file: File, fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call(`/api/v1/site/images/${kind}`, { method: 'PUT', headers: { 'X-CSRF-Token': token }, body: form(file) }, fetcher, 20000));
}
export async function removeSiteImage(kind: 'favicon' | 'logo', fetcher: typeof fetch = fetch): Promise<Site> {
  const token = await csrf(fetcher);
  return parseSite(await call(`/api/v1/site/images/${kind}`, { method: 'DELETE', headers: { 'X-CSRF-Token': token } }, fetcher));
}
export async function uploadAvatar(file: File, fetcher: typeof fetch = fetch): Promise<string> {
  const token = await csrf(fetcher);
  const value = await call('/api/v1/me/avatar', { method: 'PUT', headers: { 'X-CSRF-Token': token }, body: form(file) }, fetcher, 20000);
  const url = object(value) ? safeImagePath(value.avatar_url) : null;
  if (!url || !url.startsWith('/api/v1/me/avatar?')) invalid();
  return url;
}
export async function removeAvatar(fetcher: typeof fetch = fetch): Promise<void> {
  const token = await csrf(fetcher);
  const value = await call('/api/v1/me/avatar', { method: 'DELETE', headers: { 'X-CSRF-Token': token } }, fetcher);
  if (!object(value) || value.avatar_url !== null) invalid();
}
export { SITE_DEFAULTS };
