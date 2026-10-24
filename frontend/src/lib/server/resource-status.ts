import { error } from '@sveltejs/kit';
import { backendRequest } from '#lib/server/backend.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function statusOf(request: Request, path: string): Promise<number | null> {
  try {
    const response = await backendRequest(path, request);
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

export async function ensureActivity(request: Request, id: string, path: string): Promise<void> {
  if (!UUID.test(id)) error(404, '找不到这条活动');
  const status = await statusOf(request, path);
  if (status === 404 || status === 422) error(404, '找不到这条活动');
}

export async function ensurePublicActivity(request: Request, id: string, path: string): Promise<void> {
  if (!UUID.test(id)) error(404, '分享不存在或已停止');
  const status = await statusOf(request, path);
  if (status === 404 || status === 422) error(404, '分享不存在或已停止');
}

export async function ensureShare(request: Request, path: string): Promise<void> {
  const status = await statusOf(request, path);
  if (status === 404 || status === 422) error(404, '分享不存在或已停止');
}
