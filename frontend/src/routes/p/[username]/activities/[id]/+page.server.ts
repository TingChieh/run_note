import type { PageServerLoad } from './$types';
import { ensureActivity } from '#lib/server/resource-status.ts';

export const load: PageServerLoad = ({ params, request }) => ensureActivity(
  request,
  params.id ?? '',
  `/api/v1/showcase/users/${encodeURIComponent(params.username ?? '')}/activities/${params.id}`,
);
