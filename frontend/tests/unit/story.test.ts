import { describe, expect, it } from 'vitest';
import { ANNUAL_STORY_TIMEOUT_MS, parseAnnualStory, type AnnualStory } from '#lib/api/annual-story.ts';
import {
  computeGeoBounds,
  makeCanvasProjector,
  storyCoverage,
  storyLeadSentence,
  storyLocalClock,
  storyRangeText,
  storyYearSelection,
} from '#lib/story.ts';

function validPayload(): AnnualStory {
  return {
    year: 2025,
    date_from: '2025-01-01',
    date_to: '2026-01-01',
    is_partial: false,
    cutoff_date: null,
    today: '2026-11-21',
    date_assignment: 'activity_local_date',
    summary: {
      activity_count: 2,
      distance_m: '15000.000',
      activity_days: 2,
      duration_sum_seconds: '4800.000',
      known_duration_count: 2,
      missing_duration_count: 0,
      pace_eligible_count: 2,
      pace_eligible_distance_m: '15000.000',
      avg_pace_seconds_per_km: '320.000',
      quality_warning_count: 0,
      date_assignment: 'activity_local_date',
    },
    longest_streak_days: 2,
    longest_streak_weeks: 1,
    first_run: {
      activity_id: '00000000-0000-4000-8000-000000000001',
      activity_date: '2025-01-01',
      timezone: 'Asia/Shanghai',
      started_at: '2024-12-31T23:00:00Z',
      title: '新年第一跑',
      distance_m: '5000.000',
      duration_seconds: '1600.000',
      avg_pace_seconds_per_km: '320.000',
      city_name: '青岬市',
      shoe_name: null,
      has_track: true,
      shape: [
        [
          [120.1, 30.2],
          [120.12, 30.22],
        ],
      ],
    },
    longest_route: {
      activity_id: '00000000-0000-4000-8000-000000000002',
      activity_date: '2025-06-01',
      timezone: 'Asia/Shanghai',
      started_at: null,
      title: '十公里拉练',
      distance_m: '10000.000',
      duration_seconds: '3200.000',
      avg_pace_seconds_per_km: '320.000',
      city_name: '青岬市',
      shoe_name: '轻云 3',
      has_track: false,
      shape: [],
      tied_count: 1,
      same_as_first: false,
    },
    best_performance: {
      basis: 'standard_band',
      category: '10km',
      activity_id: '00000000-0000-4000-8000-000000000002',
      activity_date: '2025-06-01',
      timezone: 'Asia/Shanghai',
      started_at: null,
      title: '十公里拉练',
      distance_m: '10000.000',
      duration_seconds: '3200.000',
      avg_pace_seconds_per_km: '320.000',
      city_name: '青岬市',
      has_track: false,
      shape: [],
      is_all_time_pb: true,
      pace_gain_seconds_per_km: null,
      other_bests: [],
    },
    explored_cities: {
      status: 'ready',
      total_cities: 1,
      new_cities_count: 1,
      total_regions: 1,
      located_activity_count: 1,
      unlocated_activity_count: 1,
      pending_activity_count: 0,
      items: [
        {
          code: 'C-1',
          name: '青岬市',
          region_name: '岚海州',
          is_new: true,
          first_date: '2025-01-01',
          last_date: '2025-01-01',
          activity_count: 1,
          distance_m: '5000.000',
          lon: 120.1,
          lat: 30.2,
        },
      ],
    },
    frequent_route: {
      status: 'none',
      group_id: null,
      name: null,
      city_name: null,
      run_count: 0,
      share_pct: 0,
      median_distance_m: null,
      first_date: null,
      last_date: null,
      first_pace_seconds_per_km: null,
      best_pace_seconds_per_km: null,
      avg_pace_seconds_per_km: null,
      pace_improvement_seconds_per_km: null,
      monthly_hits: Array(12).fill(0),
      shape: [],
      overlay_shapes: [],
    },
    footprint_timeline: {
      has_tracks: true,
      truncated: false,
      total_runs: 2,
      shown_runs: 2,
      monthly_distance_m: ['5000', '0', '0', '0', '0', '10000', '0', '0', '0', '0', '0', '0'],
      monthly_activity_count: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      items: [
        {
          activity_id: '00000000-0000-4000-8000-000000000001',
          activity_date: '2025-01-01',
          month: 1,
          title: '新年第一跑',
          distance_m: '5000.000',
          cumulative_distance_m: '5000.000',
          avg_pace_seconds_per_km: '320.000',
          city_code: 'C-1',
          city_name: '青岬市',
          milestone: 'first',
          points: [
            [120.1, 30.2],
            [120.12, 30.22],
          ],
        },
      ],
    },
  };
}

describe('annual story parsing and formatting', () => {
  it('validates a complete response and rejects corrupted coordinates or partial mismatch', () => {
    const ok = parseAnnualStory(validPayload());
    expect(ok.year).toBe(2025);
    expect(ok.explored_cities.items[0].name).toBe('青岬市');

    const badPartial = { ...validPayload(), is_partial: true, cutoff_date: null };
    expect(() => parseAnnualStory(badPartial)).toThrow();

    const badCoords = validPayload();
    badCoords.first_run!.shape = [[[999, 30]]];
    expect(() => parseAnnualStory(badCoords)).toThrow();

    const badTz = validPayload();
    badTz.first_run!.timezone = 'Mars/Olympus';
    expect(() => parseAnnualStory(badTz)).toThrow();
  });

  it('parses URL year selection and builds range/lead/coverage strings without conflating pending states', () => {
    expect(ANNUAL_STORY_TIMEOUT_MS).toBeGreaterThanOrEqual(20000);
    expect(storyYearSelection(new URLSearchParams('year=2024'), 2026)).toBe(2024);
    expect(storyYearSelection(new URLSearchParams('year=1800'), 2026)).toBe(2026);
    const story = validPayload();
    expect(storyRangeText(story)).toBe('2025.01.01 — 2025.12.31');
    expect(storyLeadSentence(story)).toContain('青岬市');

    // Cross-timezone first run clock respects the activity's own timezone rather than account timezone.
    expect(storyLocalClock('2022-01-01T12:30:00Z', 'America/New_York')).toBe('07:30');
    expect(storyLocalClock('2022-01-01T12:30:00Z', 'Asia/Shanghai')).toBe('20:30');

    const degraded = validPayload();
    degraded.footprint_timeline.has_tracks = false;
    degraded.explored_cities.status = 'pending';
    degraded.explored_cities.pending_activity_count = 12;
    degraded.explored_cities.total_cities = 0;
    degraded.explored_cities.items = [];
    degraded.frequent_route.status = 'building';
    const cov = storyCoverage(degraded);
    expect(cov).toContain('节律脉冲回放');
    expect(cov).toContain('12 条轨迹的城市统计仍在后台计算');
    expect(cov).toContain('常跑路线仍在后台归并');
    expect(storyLeadSentence(degraded)).toContain('仍在计算');
    expect(storyLeadSentence(degraded)).not.toContain('深耕');
  });

  it('normalizes antimeridian-crossing coordinates into finite canvas bounds', () => {
    const bounds = computeGeoBounds([
      [179.5, 20],
      [-179.5, 20.5],
    ]);
    expect(bounds).not.toBeNull();
    expect(bounds!.shiftAntimeridian).toBe(true);
    const proj = makeCanvasProjector(bounds!, 600, 400);
    const [x1, y1] = proj([179.5, 20]);
    const [x2, y2] = proj([-179.5, 20.5]);
    expect(Number.isFinite(x1) && Number.isFinite(y1)).toBe(true);
    expect(Number.isFinite(x2) && Number.isFinite(y2)).toBe(true);
    expect(x2).toBeGreaterThan(x1);
  });
});
