import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals, depends, url }) => {
  depends('auth:session');
  // Track client navigation so hooks can resolve the new display subject and timezone.
  void url.pathname;
  return { user: locals.user, authError: locals.authError, showcase: locals.showcase, showcaseError: locals.showcaseError, site: locals.site };
};
