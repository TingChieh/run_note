import type { Metric } from './activities';

export function activityAchievement(distance: Metric): string | null {
  if (typeof distance !== 'number' && (typeof distance !== 'string' || !/^\d+(\.\d+)?$/.test(distance))) return null;
  const meters = Number(distance);
  if (!Number.isFinite(meters)) return null;
  if (meters >= 20000) return '20 km 达成';
  if (meters >= 10000) return '10 km 达成';
  if (meters >= 5000) return '5 km 达成';
  return null;
}
