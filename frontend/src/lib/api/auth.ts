import { safeImagePath } from './site.ts';

export interface User {
  is_admin: boolean;
  showcase_enabled: boolean;
  id: string;
  email: string;
  username: string;
  display_name: string;
  timezone: string;
  created_at: string;
  bio: string;
  profile_is_public: boolean;
  avatar_url?: string | null;
}
export class AuthError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
async function request<T>(path: string, init: RequestInit, fetcher: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  } catch { throw new AuthError('无法连接认证服务，请稍后重试', 503, 'NETWORK_ERROR'); }
  let body;
  try { body = await response.json(); } catch { throw new AuthError('认证服务返回了无效响应', 502, 'INVALID_RESPONSE'); }
  if (!response.ok || body?.error) {
    let message = body?.error?.message ?? '认证请求失败，请稍后重试';
    if (response.status === 422) message = '请检查邮箱、用户名与密码格式（密码需 12–128 个字符）';
    const retry = response.headers.get('Retry-After');
    if (response.status === 429 && retry && /^\d+$/.test(retry)) message += `，请在 ${retry} 秒后重试`;
    throw new AuthError(message, response.status, body?.error?.code ?? 'REQUEST_FAILED');
  }
  if (!body?.data || typeof body.data !== 'object') throw new AuthError('认证服务返回了无效响应', 502, 'INVALID_RESPONSE');
  return body.data as T;
}
export async function readSession(fetcher: typeof fetch = fetch): Promise<User | null> {
  try { return parseUser((await request<{ user: unknown }>('/api/v1/auth/session', {}, fetcher)).user); }
  catch (cause) { if (cause instanceof AuthError && cause.status === 401) return null; throw cause; }
}
export async function authWrite(action: 'login' | 'logout', data: unknown, fetcher: typeof fetch = fetch) {
  // Fresh token for the current Cookie; no global cache, no write retries on CSRF errors.
  const { csrf_token } = await request<{ csrf_token: string }>('/api/v1/auth/csrf', {}, fetcher);
  const result = await request<{ user?: User; csrf_token?: string; logged_out?: boolean }>(`/api/v1/auth/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf_token }, body: JSON.stringify(data)
  }, fetcher);
  if (action !== 'logout') result.user = parseUser(result.user);
  return result;
}
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\s%]/.test(value)) return '/';
  const path = value.split(/[?#]/)[0];
  if (/^\/(login|register|api|admin)(\/|$)/.test(path)) return '/';
  return value;
}
export function isProtected(path: string): boolean { return /^\/(settings|workspace|wellbeing|admin\/users)(\/|$)/.test(path); }

export function parseUser(value: unknown): User {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('认证身份无效',502,'INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  if (['id','email','username','display_name','timezone','created_at','bio'].some(k => typeof v[k] !== 'string') || ['is_admin','showcase_enabled','profile_is_public'].some(k => typeof v[k] !== 'boolean')) throw new AuthError('认证身份无效',502,'INVALID_RESPONSE');
  return { ...(v as unknown as User), avatar_url: safeImagePath(v.avatar_url) };
}
export async function changePassword(current_password: string, new_password: string, fetcher: typeof fetch = fetch): Promise<void> {
  const { csrf_token } = await request<{csrf_token: string}>('/api/v1/auth/csrf', {}, fetcher);
  if (typeof csrf_token !== 'string' || !csrf_token) throw new AuthError('认证令牌无效', 502, 'INVALID_RESPONSE');
  const result = await request<{password_changed: boolean}>('/api/v1/me/password', { method: 'PATCH', headers: {'Content-Type':'application/json', 'X-CSRF-Token':csrf_token}, body: JSON.stringify({current_password,new_password}) }, fetcher);
  if (result.password_changed !== true) throw new AuthError('密码修改响应无效', 502, 'INVALID_RESPONSE');
}
