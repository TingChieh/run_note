import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends('auth:session');
  return { user: locals.user, authError: locals.authError };
};
