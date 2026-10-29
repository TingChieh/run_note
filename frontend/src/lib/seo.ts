const descriptions: [RegExp, string][] = [
  [/^\/$/, '查看跑步距离、活动日历、趋势和最近的运动记录。'],
  [/\/activities\/wall$/, '每次跑步一张足迹卡片，回顾全部路线。'],
  [/\/activities\/[^/]+$/, '查看这次跑步的距离、用时、配速和路线。'],
  [/\/activities$/, '浏览跑步记录。导入 GPX 或 TCX 后，可以回顾每一次出发。'],
  [/\/footprints$/, '在地图上查看跑过的路线和运动热力。'],
  [/\/records$/, '查看 5K、10K 最佳成绩、月度里程、配速进步和训练频率，并逐年回顾。'],
  [/\/ai$/, '根据运动统计查看趋势说明和训练建议。分析只使用汇总数据。'],
  [/\/settings\/site$/, '修改站点名称、标语、默认外观和图标。'],
  [/\/admin\/users$/, '管理账号、登录权限和个人展示。'],
  [/\/settings$/, '管理账户资料、头像和公开设置。'],
  [/^\/admin$/, '使用已启用账号登录，管理自己的运动记录。'],
  [/^\/(public\/activities|shared)(\/|$)/, '查看一条公开的运动摘要。页面不包含轨迹坐标。'],
];

export function pageDescription(pathname: string, status: number, fallback: string): string {
  if (status === 404) return '这个页面不存在，或链接已经失效。';
  if (status >= 400) return '这次请求没有完成，请稍后重试。';
  const path = pathname.replace(/\/$/, '') || '/';
  if (path.endsWith('/dashboard')) return descriptions[0][1];
  return descriptions.find(([pattern]) => pattern.test(path))?.[1] ?? fallback;
}

export function pageNoindex(pathname: string, status: number): boolean {
  return status >= 400 || /^\/(admin|workspace|settings|wellbeing)(\/|$)/.test(pathname);
}

export const SITEMAP_PATHS = ['/', '/activities', '/activities/wall', '/footprints', '/ai'] as const;

const ROBOTS_DISALLOW = ['/admin', '/workspace', '/settings', '/wellbeing', '/api', '/shared', '/public'] as const;

export function robotsTxt(origin: string): string {
  const rules = ROBOTS_DISALLOW.map(path => `Disallow: ${path}`).join('\n');
  return `User-agent: *\n${rules}\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin: string): string {
  const urls = SITEMAP_PATHS.map(path => `  <url><loc>${origin}${path}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
