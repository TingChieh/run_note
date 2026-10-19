import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => { if (!locals.user?.is_admin) error(403, '无权访问'); };
