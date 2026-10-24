import type { PageServerLoad } from './$types';
import { ensureShare } from '#lib/server/resource-status.ts';

export const load: PageServerLoad = ({ params, request }) => ensureShare(request, `/api/v1/shared/${encodeURIComponent(params.token ?? '')}`);
