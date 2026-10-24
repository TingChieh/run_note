import type { PageServerLoad } from './$types';
import { ensurePublicActivity } from '#lib/server/resource-status.ts';

export const load: PageServerLoad = ({ params, request }) => ensurePublicActivity(request, params.id ?? '', `/api/v1/public/activities/${params.id}`);
