export interface ViewContext { kind: 'root' | 'public' | 'workspace'; prefix: string; username: string | null; manage: boolean }
export function viewContext(path: string, admin = false): ViewContext {
  const named = /^\/p\/([^/]+)(?:\/|$)/.exec(path);
  if (named) { const username = decodeURIComponent(named[1]); return { kind: 'public', prefix: `/p/${encodeURIComponent(username)}`, username, manage: false }; }
  if (/^\/workspace(?:\/|$)/.test(path)) return { kind: 'workspace', prefix: '/workspace', username: null, manage: true };
  return { kind: 'root', prefix: '', username: null, manage: admin };
}
export function contextPath(context: ViewContext, path: string): string {
  return /^\/(dashboard|activities|footprints|routes|ai|settings)(\/|\?|#|$)/.test(path) ? context.prefix + path : path;
}
export function contextAPI(context: ViewContext, path: string): string {
  if (!path.startsWith('/api/v1/showcase/')) return path;
  const resource = path.slice('/api/v1/showcase/'.length);
  if (context.kind === 'public') return `/api/v1/showcase/users/${encodeURIComponent(context.username!)}/${resource}`;
  if (context.kind === 'workspace') return `/api/v1/${resource.startsWith('running-goals') ? 'me/' : ''}${resource}`;
  return path;
}
