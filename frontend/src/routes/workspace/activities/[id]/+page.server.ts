import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { backendRequest } from '#lib/server/backend.ts';
import { ensureActivity, statusOf } from '#lib/server/resource-status.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const load: PageServerLoad = async ({ params, request, locals }) => {
  const id = params.id ?? '';
  if (locals.user?.is_admin && uuid.test(id)) {
    const status = await statusOf(request, `/api/v1/activities/${id}`);
    if (status === 422) error(404, '找不到这条活动');
    if (status !== 404) return;
    let owner: string | null = null;
    try {
      const response = await backendRequest(`/api/v1/admin/activities/${id}/owner`, request);
      if (response.ok) {
        const body: unknown = await response.json();
        if (
          body &&
          typeof body === 'object' &&
          'data' in body &&
          body.data &&
          typeof body.data === 'object' &&
          'user_id' in body.data &&
          typeof body.data.user_id === 'string' &&
          uuid.test(body.data.user_id)
        )
          owner = body.data.user_id;
      } else await response.body?.cancel();
    } catch {
      /* An unavailable owner lookup cannot resolve a missing activity. */
    }
    if (owner) redirect(307, `/admin/users/${owner}/activities/${id}`);
    error(404, '找不到这条活动');
  }
  return ensureActivity(request, id, `/api/v1/activities/${id}`);
};
