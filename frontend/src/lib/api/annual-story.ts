import { ActivityError, request, type Metric } from './activities';
import { parseSummary, type Summary } from './statistics';

export type StoryMilestone = 'first' | 'longest' | 'best' | 'new_city' | 'frequent';
export type LonLat = [number, number];

export interface StoryRunHighlight {
  activity_id: string;
  activity_date: string;
  timezone: string;
  started_at: string | null;
  title: string;
  distance_m: Metric;
  duration_seconds: Metric;
  avg_pace_seconds_per_km: Metric;
  city_name: string | null;
  shoe_name: string | null;
  has_track: boolean;
  shape: LonLat[][];
}

export interface StoryLongestHighlight extends StoryRunHighlight {
  tied_count: number;
  same_as_first: boolean;
}

export interface StoryCategoryBest {
  category: string;
  activity_id: string;
  activity_date: string;
  distance_m: Metric;
  duration_seconds: Metric;
  avg_pace_seconds_per_km: Metric;
}

export interface StoryBestHighlight {
  basis: 'standard_band' | 'fastest_run' | 'distance_fallback';
  category: string;
  activity_id: string;
  activity_date: string;
  timezone: string;
  started_at: string | null;
  title: string;
  distance_m: Metric;
  duration_seconds: Metric;
  avg_pace_seconds_per_km: Metric;
  city_name: string | null;
  has_track: boolean;
  shape: LonLat[][];
  is_all_time_pb: boolean;
  pace_gain_seconds_per_km: Metric;
  other_bests: StoryCategoryBest[];
}

export interface StoryCityItem {
  code: string;
  name: string;
  region_name: string | null;
  is_new: boolean;
  first_date: string;
  last_date: string;
  activity_count: number;
  distance_m: Metric;
  lon: number;
  lat: number;
}

export interface StoryCitiesSection {
  status: 'ready' | 'pending';
  total_cities: number;
  new_cities_count: number;
  total_regions: number;
  located_activity_count: number;
  unlocated_activity_count: number;
  pending_activity_count: number;
  items: StoryCityItem[];
}

export interface StoryFrequentRouteSection {
  status: 'ready' | 'building' | 'none';
  group_id: string | null;
  name: string | null;
  city_name: string | null;
  run_count: number;
  share_pct: number;
  median_distance_m: Metric;
  first_date: string | null;
  last_date: string | null;
  first_pace_seconds_per_km: Metric;
  best_pace_seconds_per_km: Metric;
  avg_pace_seconds_per_km: Metric;
  pace_improvement_seconds_per_km: Metric;
  monthly_hits: number[];
  shape: LonLat[][];
  overlay_shapes: LonLat[][][];
}

export interface StoryTimelineItem {
  activity_id: string;
  activity_date: string;
  month: number;
  title: string;
  distance_m: Metric;
  cumulative_distance_m: Metric;
  avg_pace_seconds_per_km: Metric;
  city_code: string | null;
  city_name: string | null;
  milestone: StoryMilestone | null;
  points: LonLat[];
}

export interface StoryFootprintTimeline {
  has_tracks: boolean;
  truncated: boolean;
  total_runs: number;
  shown_runs: number;
  monthly_distance_m: Metric[];
  monthly_activity_count: number[];
  items: StoryTimelineItem[];
}

export interface AnnualStory {
  year: number;
  date_from: string;
  date_to: string;
  is_partial: boolean;
  cutoff_date: string | null;
  today: string;
  date_assignment: 'activity_local_date';
  summary: Summary;
  longest_streak_days: number;
  longest_streak_weeks: number;
  first_run: StoryRunHighlight | null;
  longest_route: StoryLongestHighlight | null;
  best_performance: StoryBestHighlight | null;
  explored_cities: StoryCitiesSection;
  frequent_route: StoryFrequentRouteSection;
  footprint_timeline: StoryFootprintTimeline;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min = 0) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isTimezone = (v: unknown): v is string => {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
const isOptStr = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isMetric = (v: unknown, nullable = false): v is Metric =>
  v === null
    ? nullable
    : (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))) &&
      Number.isFinite(Number(v)) &&
      Number(v) >= 0;

function invalid(): never {
  throw new ActivityError('年度故事服务返回了无效响应，请刷新重试', 502, 'INVALID_RESPONSE');
}

function parsePoint(v: unknown): LonLat {
  if (!Array.isArray(v) || v.length !== 2) invalid();
  const [lon, lat] = v;
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    invalid();
  }
  return [lon, lat];
}

function parseLine(v: unknown): LonLat[] {
  if (!Array.isArray(v)) invalid();
  return v.map(parsePoint);
}

function parseShape(v: unknown): LonLat[][] {
  if (!Array.isArray(v)) invalid();
  return v.map(parseLine);
}

function parseRunHighlight(v: unknown): StoryRunHighlight {
  if (!isObj(v)) invalid();
  if (
    !isStr(v.activity_id) ||
    !isIsoDate(v.activity_date) ||
    !isTimezone(v.timezone) ||
    !isOptStr(v.started_at) ||
    !isStr(v.title) ||
    !isMetric(v.distance_m) ||
    !isMetric(v.duration_seconds, true) ||
    !isMetric(v.avg_pace_seconds_per_km, true) ||
    !isOptStr(v.city_name) ||
    !isOptStr(v.shoe_name) ||
    typeof v.has_track !== 'boolean'
  ) {
    invalid();
  }
  return {
    activity_id: v.activity_id,
    activity_date: v.activity_date,
    timezone: v.timezone,
    started_at: v.started_at,
    title: v.title,
    distance_m: v.distance_m,
    duration_seconds: v.duration_seconds,
    avg_pace_seconds_per_km: v.avg_pace_seconds_per_km,
    city_name: v.city_name,
    shoe_name: v.shoe_name,
    has_track: v.has_track,
    shape: parseShape(v.shape),
  };
}

function parseLongest(v: unknown): StoryLongestHighlight | null {
  if (v === null) return null;
  if (!isObj(v)) invalid();
  const base = parseRunHighlight(v);
  if (!isInt(v.tied_count, 1) || typeof v.same_as_first !== 'boolean') invalid();
  return {
    ...base,
    tied_count: v.tied_count as number,
    same_as_first: v.same_as_first,
  };
}

function parseCategoryBest(v: unknown): StoryCategoryBest {
  if (!isObj(v)) invalid();
  if (
    !isStr(v.category) ||
    !isStr(v.activity_id) ||
    !isIsoDate(v.activity_date) ||
    !isMetric(v.distance_m) ||
    !isMetric(v.duration_seconds) ||
    !isMetric(v.avg_pace_seconds_per_km)
  ) {
    invalid();
  }
  return {
    category: v.category,
    activity_id: v.activity_id,
    activity_date: v.activity_date,
    distance_m: v.distance_m,
    duration_seconds: v.duration_seconds,
    avg_pace_seconds_per_km: v.avg_pace_seconds_per_km,
  };
}

function parseBest(v: unknown): StoryBestHighlight | null {
  if (v === null) return null;
  if (!isObj(v)) invalid();
  if (
    (v.basis !== 'standard_band' && v.basis !== 'fastest_run' && v.basis !== 'distance_fallback') ||
    !isStr(v.category) ||
    !isStr(v.activity_id) ||
    !isIsoDate(v.activity_date) ||
    !isTimezone(v.timezone) ||
    !isOptStr(v.started_at) ||
    !isStr(v.title) ||
    !isMetric(v.distance_m) ||
    !isMetric(v.duration_seconds, true) ||
    !isMetric(v.avg_pace_seconds_per_km, true) ||
    !isOptStr(v.city_name) ||
    typeof v.has_track !== 'boolean' ||
    typeof v.is_all_time_pb !== 'boolean' ||
    !isMetric(v.pace_gain_seconds_per_km, true) ||
    !Array.isArray(v.other_bests)
  ) {
    invalid();
  }
  return {
    basis: v.basis,
    category: v.category,
    activity_id: v.activity_id,
    activity_date: v.activity_date,
    timezone: v.timezone,
    started_at: v.started_at,
    title: v.title,
    distance_m: v.distance_m,
    duration_seconds: v.duration_seconds,
    avg_pace_seconds_per_km: v.avg_pace_seconds_per_km,
    city_name: v.city_name,
    has_track: v.has_track,
    shape: parseShape(v.shape),
    is_all_time_pb: v.is_all_time_pb,
    pace_gain_seconds_per_km: v.pace_gain_seconds_per_km,
    other_bests: v.other_bests.map(parseCategoryBest),
  };
}

function parseCityItem(v: unknown): StoryCityItem {
  if (!isObj(v)) invalid();
  if (
    !isStr(v.code) ||
    !isStr(v.name) ||
    !isOptStr(v.region_name) ||
    typeof v.is_new !== 'boolean' ||
    !isIsoDate(v.first_date) ||
    !isIsoDate(v.last_date) ||
    !isInt(v.activity_count, 1) ||
    !isMetric(v.distance_m) ||
    typeof v.lon !== 'number' ||
    typeof v.lat !== 'number' ||
    !Number.isFinite(v.lon) ||
    !Number.isFinite(v.lat) ||
    v.lon < -180 ||
    v.lon > 180 ||
    v.lat < -90 ||
    v.lat > 90
  ) {
    invalid();
  }
  return {
    code: v.code,
    name: v.name,
    region_name: v.region_name,
    is_new: v.is_new,
    first_date: v.first_date,
    last_date: v.last_date,
    activity_count: v.activity_count as number,
    distance_m: v.distance_m,
    lon: v.lon,
    lat: v.lat,
  };
}

function parseCities(v: unknown): StoryCitiesSection {
  if (!isObj(v)) invalid();
  if (
    (v.status !== 'ready' && v.status !== 'pending') ||
    !isInt(v.total_cities) ||
    !isInt(v.new_cities_count) ||
    !isInt(v.total_regions) ||
    !isInt(v.located_activity_count) ||
    !isInt(v.unlocated_activity_count) ||
    !isInt(v.pending_activity_count) ||
    !Array.isArray(v.items)
  ) {
    invalid();
  }
  return {
    status: v.status,
    total_cities: v.total_cities as number,
    new_cities_count: v.new_cities_count as number,
    total_regions: v.total_regions as number,
    located_activity_count: v.located_activity_count as number,
    unlocated_activity_count: v.unlocated_activity_count as number,
    pending_activity_count: v.pending_activity_count as number,
    items: v.items.map(parseCityItem),
  };
}

function parseFrequentRoute(v: unknown): StoryFrequentRouteSection {
  if (!isObj(v)) invalid();
  if (
    (v.status !== 'ready' && v.status !== 'building' && v.status !== 'none') ||
    !isOptStr(v.group_id) ||
    !isOptStr(v.name) ||
    !isOptStr(v.city_name) ||
    !isInt(v.run_count) ||
    !isInt(v.share_pct) ||
    !isMetric(v.median_distance_m, true) ||
    (v.first_date !== null && !isIsoDate(v.first_date)) ||
    (v.last_date !== null && !isIsoDate(v.last_date)) ||
    !isMetric(v.first_pace_seconds_per_km, true) ||
    !isMetric(v.best_pace_seconds_per_km, true) ||
    !isMetric(v.avg_pace_seconds_per_km, true) ||
    !isMetric(v.pace_improvement_seconds_per_km, true) ||
    !Array.isArray(v.monthly_hits) ||
    v.monthly_hits.length !== 12 ||
    !v.monthly_hits.every((n) => isInt(n)) ||
    !Array.isArray(v.overlay_shapes)
  ) {
    invalid();
  }
  return {
    status: v.status,
    group_id: v.group_id,
    name: v.name,
    city_name: v.city_name,
    run_count: v.run_count as number,
    share_pct: v.share_pct as number,
    median_distance_m: v.median_distance_m,
    first_date: v.first_date as string | null,
    last_date: v.last_date as string | null,
    first_pace_seconds_per_km: v.first_pace_seconds_per_km,
    best_pace_seconds_per_km: v.best_pace_seconds_per_km,
    avg_pace_seconds_per_km: v.avg_pace_seconds_per_km,
    pace_improvement_seconds_per_km: v.pace_improvement_seconds_per_km,
    monthly_hits: v.monthly_hits as number[],
    shape: parseShape(v.shape),
    overlay_shapes: v.overlay_shapes.map(parseShape),
  };
}

const MILESTONES = new Set(['first', 'longest', 'best', 'new_city', 'frequent']);

function parseTimelineItem(v: unknown): StoryTimelineItem {
  if (!isObj(v)) invalid();
  if (
    !isStr(v.activity_id) ||
    !isIsoDate(v.activity_date) ||
    !isInt(v.month, 1) ||
    (v.month as number) > 12 ||
    !isStr(v.title) ||
    !isMetric(v.distance_m) ||
    !isMetric(v.cumulative_distance_m) ||
    !isMetric(v.avg_pace_seconds_per_km, true) ||
    !isOptStr(v.city_code) ||
    !isOptStr(v.city_name) ||
    (v.milestone !== null && (!isStr(v.milestone) || !MILESTONES.has(v.milestone)))
  ) {
    invalid();
  }
  return {
    activity_id: v.activity_id,
    activity_date: v.activity_date,
    month: v.month as number,
    title: v.title,
    distance_m: v.distance_m,
    cumulative_distance_m: v.cumulative_distance_m,
    avg_pace_seconds_per_km: v.avg_pace_seconds_per_km,
    city_code: v.city_code,
    city_name: v.city_name,
    milestone: v.milestone as StoryMilestone | null,
    points: parseLine(v.points),
  };
}

function parseTimeline(v: unknown): StoryFootprintTimeline {
  if (!isObj(v)) invalid();
  if (
    typeof v.has_tracks !== 'boolean' ||
    typeof v.truncated !== 'boolean' ||
    !isInt(v.total_runs) ||
    !isInt(v.shown_runs) ||
    !Array.isArray(v.monthly_distance_m) ||
    v.monthly_distance_m.length !== 12 ||
    !v.monthly_distance_m.every((m) => isMetric(m)) ||
    !Array.isArray(v.monthly_activity_count) ||
    v.monthly_activity_count.length !== 12 ||
    !v.monthly_activity_count.every((c) => isInt(c)) ||
    !Array.isArray(v.items)
  ) {
    invalid();
  }
  return {
    has_tracks: v.has_tracks,
    truncated: v.truncated,
    total_runs: v.total_runs as number,
    shown_runs: v.shown_runs as number,
    monthly_distance_m: v.monthly_distance_m as Metric[],
    monthly_activity_count: v.monthly_activity_count as number[],
    items: v.items.map(parseTimelineItem),
  };
}

export function parseAnnualStory(v: unknown): AnnualStory {
  if (!isObj(v)) invalid();
  let summary: Summary;
  try {
    summary = parseSummary(v.summary);
  } catch {
    invalid();
  }
  if (
    !isInt(v.year, 1900) ||
    (v.year as number) > 2100 ||
    !isIsoDate(v.date_from) ||
    !isIsoDate(v.date_to) ||
    typeof v.is_partial !== 'boolean' ||
    (v.cutoff_date !== null && !isIsoDate(v.cutoff_date)) ||
    v.is_partial !== (v.cutoff_date !== null) ||
    !isIsoDate(v.today) ||
    v.date_assignment !== 'activity_local_date' ||
    !isInt(v.longest_streak_days) ||
    !isInt(v.longest_streak_weeks)
  ) {
    invalid();
  }
  const year = v.year as number;
  const expectedStart = `${year}-01-01`;
  const expectedEnd = `${year + 1}-01-01`;
  if (v.date_from !== expectedStart || v.date_to < v.date_from || v.date_to > expectedEnd) invalid();

  return {
    year,
    date_from: v.date_from,
    date_to: v.date_to,
    is_partial: v.is_partial,
    cutoff_date: v.cutoff_date as string | null,
    today: v.today,
    date_assignment: 'activity_local_date',
    summary,
    longest_streak_days: v.longest_streak_days as number,
    longest_streak_weeks: v.longest_streak_weeks as number,
    first_run: v.first_run === null ? null : parseRunHighlight(v.first_run),
    longest_route: parseLongest(v.longest_route),
    best_performance: parseBest(v.best_performance),
    explored_cities: parseCities(v.explored_cities),
    frequent_route: parseFrequentRoute(v.frequent_route),
    footprint_timeline: parseTimeline(v.footprint_timeline),
  };
}

export const ANNUAL_STORY_TIMEOUT_MS = 22000;

export async function readAnnualStory(year: number, fetcher: typeof fetch = fetch): Promise<AnnualStory> {
  return parseAnnualStory(
    await request(`/api/v1/statistics/annual-story?year=${year}`, {}, fetcher, ANNUAL_STORY_TIMEOUT_MS),
  );
}
