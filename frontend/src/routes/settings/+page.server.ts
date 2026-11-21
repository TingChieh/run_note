import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  if (!locals.user) redirect(303, '/admin?next=' + encodeURIComponent(url.pathname + url.search));
  if (!locals.user.is_admin) redirect(303, '/workspace/settings' + url.search);
};
