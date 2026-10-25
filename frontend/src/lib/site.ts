export type SiteTheme = 'system' | 'light' | 'dark';
export interface Site { title: string; subtitle: string; footer_tagline: string; description: string; default_theme: SiteTheme; favicon_url: string | null; logo_url: string | null }
export const SITE_DEFAULTS: Site = {
  title: 'RunNote', subtitle: '跑步与足迹', footer_tagline: '记录每一步，看见你的进步。',
  description: '汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。',
  default_theme: 'system', favicon_url: null, logo_url: null,
};
export const PROJECT_URL = 'https://github.com/TingChieh/run_note';
export const pageTitle = (name: string, site: Pick<Site, 'title'> | null | undefined) => `${name} · ${site?.title || SITE_DEFAULTS.title}`;
export const brandInitial = (title: string) => Array.from(title.trim())[0] ?? 'R';
