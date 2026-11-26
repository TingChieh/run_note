/**
 * Phone/tablet (<800px) navigation model, item 49 方案 B: four root tabs plus a centre "开跑" action.
 * Desktop keeps the full list in AppNavigation; these helpers only decide what the bottom bar shows.
 */
export type MobileTabKey = 'today' | 'records' | 'explore' | 'me';

export interface MobileTab {
  key: MobileTabKey;
  label: string;
  href: string;
  icon: string;
}

export interface MobileNavigation {
  tabs: MobileTab[];
  /** The centre action: an ordinary link into the immersive recorder, never a stateful tab. */
  record: string | null;
}

interface Viewer {
  is_admin?: boolean;
  wellbeing_allowed?: boolean;
  wellbeing_enabled?: boolean;
}

const ICONS = {
  today: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',
  records: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7',
  explore: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1.6-3.6 4.5-5 8-5s6.4 1.4 8 5',
};

/** Pages reached from the 探索 tab. They keep their own routes; on phones a section switcher links them. */
export const EXPLORE_SECTIONS = [
  { path: '/footprints', label: '个人足迹' },
  { path: '/routes', label: '常跑路线' },
  { path: '/records', label: '个人记录' },
  { path: '/together', label: '一起跑步' },
] as const;

/** The path inside the current view: `/workspace/…` and `/p/{username}/…` share the root page names. */
function localPath(pathname: string): string {
  const path = pathname.replace(/^\/(?:workspace|p\/[^/]+)(?=\/|$)/, '').replace(/(.)\/$/, '$1');
  return path || '/';
}

/** The immersive recorder hides the bottom bar so nothing competes with pause/stop. */
export function isRecordingRoute(pathname: string): boolean {
  return /^(?:\/workspace)?\/activities\/record\/?$/.test(pathname);
}

export function mobileTabFor(pathname: string): MobileTabKey | null {
  if (isRecordingRoute(pathname)) return null;
  if (/^\/admin\/users(?:\/|$)/.test(pathname)) return 'me';
  const path = localPath(pathname);
  if (path === '/' || /^\/dashboard(?:\/|$)/.test(path)) return 'today';
  if (/^\/activities(?:\/|$)/.test(path)) return 'records';
  if (/^\/(?:footprints|routes|records|together)(?:\/|$)/.test(path)) return 'explore';
  if (/^\/(?:settings|wellbeing|ai)(?:\/|$)/.test(path)) return 'me';
  return null;
}

/** The section switcher only sits on the four section pages themselves, not on their detail pages. */
export function exploreSectionFor(pathname: string): string | null {
  const path = localPath(pathname);
  return EXPLORE_SECTIONS.find((section) => section.path === path)?.path ?? null;
}

export function canSeeAssistant(user: Viewer | null | undefined, manage: boolean): boolean {
  return !!user && manage;
}

export function canSeeWellbeing(user: Viewer | null | undefined, manage: boolean): boolean {
  return !!user && manage && user.wellbeing_allowed === true && user.wellbeing_enabled === true;
}

/**
 * `href` maps a root path into the current view (useViewContext().href), so 今天/记录/探索 follow the
 * workspace or named showcase being browsed. 我的 and 开跑 always belong to the signed-in account:
 * the site owner manages the root, every other account its own /workspace.
 */
export function mobileNavigation(user: Viewer | null | undefined, href: (path: string) => string): MobileNavigation {
  const tabs: MobileTab[] = [
    { key: 'today', label: '今天', href: href('/dashboard'), icon: ICONS.today },
    { key: 'records', label: '记录', href: href('/activities'), icon: ICONS.records },
    { key: 'explore', label: '探索', href: href('/footprints'), icon: ICONS.explore },
  ];
  if (!user) return { tabs, record: null };
  const own = user.is_admin ? '' : '/workspace';
  tabs.push({ key: 'me', label: '我的', href: `${own}/settings`, icon: ICONS.me });
  return { tabs, record: `${own}/activities/record` };
}
