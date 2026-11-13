import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user?.is_admin) error(403, '无权访问');
};
