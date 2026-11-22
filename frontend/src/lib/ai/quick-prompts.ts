export interface QuickPrompt {
  id: string;
  label: string;
  prompt: string;
  tools: readonly string[];
}

/** Curated starter prompts mapped directly to the server's 10 read-only running-data tools. */
export const QUICK_PROMPTS: readonly QuickPrompt[] = [
  {
    id: 'recent-trend',
    label: '近 4 周趋势与建议',
    prompt: '总结我最近 4 周的跑步趋势，并给下周一点保守建议',
    tools: ['get_running_trends', 'get_running_summary'],
  },
  {
    id: 'yoy-compare',
    label: '今年 vs 去年同期',
    prompt: '今年到目前为止和去年同期比，跑量和配速有什么变化？',
    tools: ['compare_periods'],
  },
  {
    id: 'personal-bests',
    label: '5K / 10K 最佳成绩',
    prompt: '看看我的 5K 和 10K 最佳成绩，以及最近进步情况',
    tools: ['get_personal_records'],
  },
  {
    id: 'footprints',
    label: '足迹与城市分布',
    prompt: '我一共在哪些省份和城市跑过？去得最多的是哪里？',
    tools: ['get_footprint_summary'],
  },
  {
    id: 'frequent-routes',
    label: '常跑路线复盘',
    prompt: '我最常跑的几条路线分别是哪些，配速有提升吗？',
    tools: ['get_frequent_routes'],
  },
  {
    id: 'streaks-goals',
    label: '连续记录与目标',
    prompt: '我最近的连续跑步记录和跑量目标完成进度怎么样？',
    tools: ['get_streaks_and_goals'],
  },
];
