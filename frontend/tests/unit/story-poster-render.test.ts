import { describe, expect, it } from 'vitest';
import type { AnnualStory } from '#lib/api/annual-story.ts';
import { drawStoryPoster } from '#lib/share/story-poster-render.ts';

function mockContext() {
  const texts: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    rect() {},
    roundRect() {},
    fillRect() {},
    fill() {},
    stroke() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    measureText(text: string) {
      return { width: text.length * 14 };
    },
    fillText(text: string) {
      texts.push(text);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const sampleStory: AnnualStory = {
  year: 2025,
  date_from: '2025-01-01',
  date_to: '2026-01-01',
  is_partial: false,
  cutoff_date: null,
  today: '2026-11-21',
  date_assignment: 'activity_local_date',
  summary: {
    activity_count: 10,
    distance_m: '85000.000',
    activity_days: 9,
    duration_sum_seconds: '26000.000',
    known_duration_count: 10,
    missing_duration_count: 0,
    pace_eligible_count: 10,
    pace_eligible_distance_m: '85000.000',
    avg_pace_seconds_per_km: '306.000',
    quality_warning_count: 0,
    date_assignment: 'activity_local_date',
  },
  longest_streak_days: 3,
  longest_streak_weeks: 4,
  first_run: {
    activity_id: '11111111-1111-4111-8111-111111111111',
    activity_date: '2025-01-01',
    timezone: 'Asia/Shanghai',
    started_at: '2024-12-31T23:00:00Z',
    title: '青岬海湾迎新慢跑',
    distance_m: '6240.000',
    duration_seconds: '2148.000',
    avg_pace_seconds_per_km: '344.000',
    city_name: '青岬市',
    shoe_name: '私人跑鞋',
    has_track: true,
    shape: [
      [
        [120.1, 30.2],
        [120.12, 30.22],
      ],
    ],
  },
  longest_route: {
    activity_id: '22222222-2222-4222-8222-222222222222',
    activity_date: '2025-10-19',
    timezone: 'Asia/Shanghai',
    started_at: null,
    title: '桐溪河滨半马',
    distance_m: '21420.000',
    duration_seconds: '6492.000',
    avg_pace_seconds_per_km: '303.000',
    city_name: '桐溪市',
    shoe_name: null,
    has_track: true,
    shape: [
      [
        [121.4, 31.2],
        [121.45, 31.25],
      ],
    ],
    tied_count: 1,
    same_as_first: false,
  },
  best_performance: {
    basis: 'standard_band',
    category: '10km',
    activity_id: '33333333-3333-4333-8333-333333333333',
    activity_date: '2025-11-08',
    timezone: 'Asia/Shanghai',
    started_at: null,
    title: '松风湖竞速 10K',
    distance_m: '10040.000',
    duration_seconds: '2658.000',
    avg_pace_seconds_per_km: '265.000',
    city_name: '青岬市',
    has_track: true,
    shape: [
      [
        [120.1, 30.2],
        [120.13, 30.23],
      ],
    ],
    is_all_time_pb: true,
    pace_gain_seconds_per_km: '38.000',
    other_bests: [],
  },
  explored_cities: {
    status: 'ready',
    total_cities: 2,
    new_cities_count: 1,
    total_regions: 2,
    located_activity_count: 10,
    unlocated_activity_count: 0,
    pending_activity_count: 0,
    items: [
      {
        code: 'C-1',
        name: '青岬市',
        region_name: '岚海州',
        is_new: false,
        first_date: '2025-01-01',
        last_date: '2025-12-01',
        activity_count: 8,
        distance_m: '60000',
        lon: 120.1,
        lat: 30.2,
      },
      {
        code: 'C-2',
        name: '桐溪市',
        region_name: '云岭州',
        is_new: true,
        first_date: '2025-10-19',
        last_date: '2025-10-19',
        activity_count: 2,
        distance_m: '25000',
        lon: 121.4,
        lat: 31.2,
      },
    ],
  },
  frequent_route: {
    status: 'ready',
    group_id: '44444444-4444-4444-8444-444444444444',
    name: '松风湖环湖 6K',
    city_name: '青岬市',
    run_count: 5,
    share_pct: 50,
    median_distance_m: '6100.000',
    first_date: '2025-01-11',
    last_date: '2025-11-20',
    first_pace_seconds_per_km: '330.000',
    best_pace_seconds_per_km: '295.000',
    avg_pace_seconds_per_km: '312.000',
    pace_improvement_seconds_per_km: '35.000',
    monthly_hits: [1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
    shape: [
      [
        [120.1, 30.2],
        [120.12, 30.22],
      ],
    ],
    overlay_shapes: [],
  },
  footprint_timeline: {
    has_tracks: true,
    truncated: false,
    total_runs: 2,
    shown_runs: 2,
    monthly_distance_m: Array(12).fill('7000'),
    monthly_activity_count: Array(12).fill(1),
    items: [
      {
        activity_id: '11111111-1111-4111-8111-111111111111',
        activity_date: '2025-01-01',
        month: 1,
        title: '青岬海湾迎新慢跑',
        distance_m: '6240',
        cumulative_distance_m: '6240',
        avg_pace_seconds_per_km: '344',
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

describe('story poster renderer privacy and themes', () => {
  it('draws default Chronicle poster and strips city/route names when privacy toggles are on', () => {
    const normal = mockContext();
    drawStoryPoster(normal.ctx, sampleStory, null, { theme: 'light', hideCities: false, hideRouteNames: false });
    const joinedNormal = normal.texts.join(' | ');
    expect(joinedNormal).toContain('2025 跑步年度故事');
    expect(joinedNormal).toContain('青岬市');
    expect(joinedNormal).toContain('青岬海湾迎新慢跑');
    expect(joinedNormal).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(joinedNormal).not.toContain('私人跑鞋');

    const privateMode = mockContext();
    drawStoryPoster(privateMode.ctx, sampleStory, null, { theme: 'dark', hideCities: true, hideRouteNames: true });
    const joinedPrivate = privateMode.texts.join(' | ');
    expect(joinedPrivate).not.toContain('青岬市');
    expect(joinedPrivate).not.toContain('桐溪市');
    expect(joinedPrivate).not.toContain('青岬海湾迎新慢跑');
    expect(joinedPrivate).not.toContain('桐溪河滨半马');
    expect(joinedPrivate).not.toContain('松风湖环湖 6K');
    expect(joinedPrivate).toContain('跨越 2 座城');
    expect(joinedPrivate).toContain('开年首跑记录');
  });

  it('handles confirmed ready zero-city trackless stories cleanly without NaN or errors', () => {
    const trackless: AnnualStory = {
      ...sampleStory,
      explored_cities: {
        ...sampleStory.explored_cities,
        status: 'ready',
        total_cities: 0,
        new_cities_count: 0,
        located_activity_count: 0,
        unlocated_activity_count: 10,
        pending_activity_count: 0,
        items: [],
      },
      frequent_route: { ...sampleStory.frequent_route, status: 'none', name: null, run_count: 0 },
      footprint_timeline: { ...sampleStory.footprint_timeline, has_tracks: false, items: [] },
    };
    const res = mockContext();
    drawStoryPoster(res.ctx, trackless, null, { theme: 'light' });
    const joined = res.texts.join(' ');
    expect(joined).toContain('无定位记录');
    expect(joined).toContain('全年无户外 GPS 定位');
    expect(joined).toContain('每次都是新路');
    expect(joined).toContain('全年未重复同一户外轨迹');
  });

  it('aligns poster city beat copy when tracks exist but zero cities matched', () => {
    const unmatched: AnnualStory = {
      ...sampleStory,
      explored_cities: {
        ...sampleStory.explored_cities,
        status: 'ready',
        total_cities: 0,
        new_cities_count: 0,
        total_regions: 0,
        located_activity_count: 0,
        unlocated_activity_count: 10,
        pending_activity_count: 0,
        items: [],
      },
      footprint_timeline: { ...sampleStory.footprint_timeline, has_tracks: true },
    };
    const res = mockContext();
    drawStoryPoster(res.ctx, unmatched, null, { theme: 'light' });
    const joined = res.texts.join(' | ');
    expect(joined).toContain('暂无匹配城市记录');
    expect(joined).toContain('已有户外轨迹，暂未归入图谱城市');
    expect(joined).not.toContain('无定位记录');
    expect(joined).not.toContain('全年无户外 GPS 定位');
  });

  it('never claims no-GPS or no-repeat when explored_cities is pending or frequent_route is building', () => {
    const pendingZero: AnnualStory = {
      ...sampleStory,
      explored_cities: {
        status: 'pending',
        total_cities: 0,
        new_cities_count: 0,
        total_regions: 0,
        located_activity_count: 0,
        unlocated_activity_count: 1,
        pending_activity_count: 28,
        items: [],
      },
      frequent_route: { ...sampleStory.frequent_route, status: 'building', name: null, run_count: 0 },
    };
    const resPending = mockContext();
    drawStoryPoster(resPending.ctx, pendingZero, null, { theme: 'light' });
    const textPending = resPending.texts.join(' | ');
    expect(textPending).toContain('部分轨迹计算中');
    expect(textPending).toContain('28 条轨迹待解析城市');
    expect(textPending).toContain('常跑路线计算中');
    expect(textPending).toContain('后台正在归并当年重复轨迹');
    expect(textPending).not.toContain('室内');
    expect(textPending).not.toContain('无户外 GPS');
    expect(textPending).not.toContain('每次都是新路');
    expect(textPending).not.toContain('全年未重复');

    // Pending with partial cities already ready
    const pendingPartial: AnnualStory = {
      ...sampleStory,
      explored_cities: {
        ...sampleStory.explored_cities,
        status: 'pending',
        pending_activity_count: 15,
      },
    };
    const resPartial = mockContext();
    drawStoryPoster(resPartial.ctx, pendingPartial, null, { theme: 'dark', hideCities: true });
    const textPartial = resPartial.texts.join(' | ');
    expect(textPartial).toContain('2 座城（计算中）');
    expect(textPartial).toContain('部分待计算');
    expect(textPartial).not.toContain('青岬市');
  });
});
