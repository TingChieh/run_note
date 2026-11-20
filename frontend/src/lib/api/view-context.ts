export interface ViewContext { kind: 'root' | 'public' | 'workspace'; prefix: string; username: string | null; manage: boolean }
export function viewContext(path: string, admin = false): ViewContext {
  const named = /^\/p\/([^/]+)(?:\/|$)/.exec(path);
  if (named) { const username = decodeURIComponent(named[1]); return { kind: 'public', prefix: `/p/${encodeURIComponent(username)}`, username, manage: false }; }
  if (/^\/workspace(?:\/|$)/.test(path)) return { kind: 'workspace', prefix: '/workspace', username: null, manage: true };
  return { kind: 'root', prefix: '', username: null, manage: admin };
}
export function contextPath(context: ViewContext, path: string): string {
  // The site home is the data summary. Named and workspace views keep their own /dashboard.
  if (context.kind === 'root' && /^\/dashboard([?#]|$)/.test(path)) {
    const rest = path.slice('/dashboard'.length);
    return rest ? `/${rest}` : '/';
  }
  return /^\/(dashboard|activities|footprints|records|routes|ai|settings|wellbeing)(\/|\?|#|$)/.test(path) ? context.prefix + path : path;
}
export function contextAPI(context: ViewContext, path: string): string {
  if (!path.startsWith('/api/v1/showcase/')) return path;
  const resource = path.slice('/api/v1/showcase/'.length);
  if (context.kind === 'public') return `/api/v1/showcase/users/${encodeURIComponent(context.username!)}/${resource}`;
  if (context.kind === 'workspace') return `/api/v1/${resource.startsWith('running-goals') ? 'me/' : ''}${resource}`;
  return path;
}
/** A signed-in viewer looking at their own records: their workspace, the root showcase as site owner, or their own named showcase. */
export function viewsOwnRecords(path: string, user: { is_admin?: boolean; username?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const subject = viewContext(path, user.is_admin === true);
  return subject.kind === 'workspace' || (subject.kind === 'root' && user.is_admin === true) || (subject.kind === 'public' && subject.username === user.username);
}
