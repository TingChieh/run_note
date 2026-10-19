import { ActivityError, parseActivity, request, type Activity } from './activities.ts';
import { safeImagePath } from './site.ts';

export interface ShowcaseProfile { display_name: string; timezone: string; avatar_url?: string | null }
export function showcasePath(path: string): string {
  if (path === '/api/v1/me/running-goals') return '/api/v1/showcase/running-goals';
  if (!/^\/api\/v1\/(activities|statistics|footprints|ai-reports)(\/|\?|$)/.test(path)) throw new Error('不支持的展示资源');
  return path.replace('/api/v1/', '/api/v1/showcase/');
}
export async function readShowcaseProfile(fetcher: typeof fetch = fetch): Promise<ShowcaseProfile> {
  const value = await request('/api/v1/showcase/profile', {}, fetcher);
  if (!value || typeof value !== 'object') throw new ActivityError('展示资料无效', 502, 'INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  if (typeof v.display_name !== 'string' || !v.display_name.trim() || v.display_name.length > 80 || typeof v.timezone !== 'string') throw new ActivityError('展示资料无效', 502, 'INVALID_RESPONSE');
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: v.timezone }); }
  catch { throw new ActivityError('展示时区无效', 502, 'INVALID_RESPONSE'); }
  return { display_name: v.display_name, timezone: v.timezone, avatar_url: safeImagePath(v.avatar_url) };
}
const publicActivityFields = [
  'id', 'title', 'activity_date', 'timezone', 'category', 'tags', 'started_at', 'ended_at',
  'distance_m', 'elapsed_seconds', 'timer_seconds', 'calories_kcal', 'steps', 'avg_heart_rate_bpm',
  'max_heart_rate_bpm', 'min_heart_rate_bpm', 'avg_cadence_spm', 'max_cadence_spm',
  'vo2_max_ml_kg_min', 'training_load', 'aerobic_training_effect', 'anaerobic_training_effect',
  'avg_pace_seconds_per_km', 'temporal_quality', 'metrics_version', 'has_route', 'created_at',
] as const;
export function parseShowcaseActivity(value: unknown): Activity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActivityError('展示记录无效', 502, 'INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  // UI compatibility fields are local; no private response object is spread into the view.
  return parseActivity({ ...Object.fromEntries(publicActivityFields.filter(k => k in v).map(k => [k, v[k]])), quality_summary: {}, visibility: 'public', allow_shared_route: true });
}
