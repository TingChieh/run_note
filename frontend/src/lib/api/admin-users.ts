import type { User } from './auth.ts';
import { ActivityError, request } from './activities.ts';

export interface AdminUser extends User { is_admin: boolean; is_active: boolean; showcase_enabled: boolean }
export interface AdminUserList { items: AdminUser[]; total: number; limit: number; offset: number }
export interface AdminUserCreate {
  email: string; username: string; password: string; display_name: string; timezone: string;
  is_active: boolean; showcase_enabled: boolean;
}
export type AdminUserUpdate = Partial<Pick<AdminUser, 'email' | 'display_name' | 'timezone' | 'bio' | 'is_active' | 'showcase_enabled'>>;
export class AdminUserError extends Error {
  constructor(message: string, public status = 502, public code = 'INVALID_RESPONSE') { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new AdminUserError('用户管理服务返回了无效响应'); }
function parseUser(value: unknown): AdminUser {
  if (!object(value) || typeof value.id !== 'string' || !uuid.test(value.id) ||
    typeof value.email !== 'string' || !value.email.includes('@') || value.email.length > 254 ||
    typeof value.username !== 'string' || !/^[a-z0-9_]{3,30}$/.test(value.username) ||
    typeof value.display_name !== 'string' || !value.display_name.trim() || value.display_name.length > 80 ||
    typeof value.timezone !== 'string' || typeof value.bio !== 'string' || value.bio.length > 500 ||
    typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.profile_is_public !== 'boolean' || typeof value.is_admin !== 'boolean' ||
    typeof value.is_active !== 'boolean' || typeof value.showcase_enabled !== 'boolean') invalid();
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: value.timezone }); } catch { invalid(); }
  return {
    id: value.id, email: value.email, username: value.username, display_name: value.display_name,
    timezone: value.timezone, bio: value.bio, created_at: value.created_at,
    profile_is_public: value.profile_is_public, is_admin: value.is_admin,
    is_active: value.is_active, showcase_enabled: value.showcase_enabled,
  };
}
async function read(path: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  try { return await request(path, init, fetcher); }
  catch (cause) {
    if (cause instanceof ActivityError) throw new AdminUserError(cause.message, cause.status, cause.code);
    throw cause;
  }
}
async function write(path: string, method: string, data: unknown, fetcher: typeof fetch): Promise<unknown> {
  const csrf = await read('/api/v1/auth/csrf', {}, fetcher);
  if (!object(csrf) || typeof csrf.csrf_token !== 'string' || !csrf.csrf_token) invalid();
  return read(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token }, body: JSON.stringify(data) }, fetcher);
}
function identifier(id: string): string {
  if (!uuid.test(id)) throw new AdminUserError('用户标识无效', 422, 'VALIDATION_ERROR');
  return id;
}
export async function readAdminUsers(filters: { search?: string; is_active?: boolean; limit?: number; offset?: number } = {}, fetcher: typeof fetch = fetch): Promise<AdminUserList> {
  const params = new URLSearchParams({ limit: String(filters.limit ?? 20), offset: String(filters.offset ?? 0) });
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.is_active !== undefined) params.set('is_active', String(filters.is_active));
  const value = await read(`/api/v1/admin/users?${params}`, {}, fetcher);
  if (!object(value) || !Array.isArray(value.items) ||
    !Number.isInteger(value.total) || Number(value.total) < 0 ||
    !Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 100 ||
    !Number.isInteger(value.offset) || Number(value.offset) < 0 || Number(value.offset) > 1000000 ||
    value.items.length > Number(value.limit) || value.items.length > Number(value.total)) invalid();
  return { items: value.items.map(parseUser), total: Number(value.total), limit: Number(value.limit), offset: Number(value.offset) };
}
export async function createAdminUser(data: AdminUserCreate, fetcher: typeof fetch = fetch): Promise<AdminUser> {
  return parseUser(await write('/api/v1/admin/users', 'POST', data, fetcher));
}
export async function updateAdminUser(id: string, data: AdminUserUpdate, fetcher: typeof fetch = fetch): Promise<AdminUser> {
  return parseUser(await write(`/api/v1/admin/users/${identifier(id)}`, 'PATCH', data, fetcher));
}
export async function resetAdminUserPassword(id: string, newPassword: string, fetcher: typeof fetch = fetch): Promise<void> {
  const value = await write(`/api/v1/admin/users/${identifier(id)}/reset-password`, 'POST', { new_password: newPassword }, fetcher);
  if (!object(value) || value.password_reset !== true) invalid();
}
