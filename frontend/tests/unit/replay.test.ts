import { describe, expect, it } from 'vitest';
import { parseReplay, type ReplayData } from '../../src/lib/api/replay';
import {
  GAP_SCREEN_SECONDS,
  MAX_PLAYBACK_SECONDS,
  MAX_DISPLAY_VERTICES,
  buildTrack,
  playbackSeconds,
  displayLines,
  locate,
  sampleAt,
  tipCoordinates,
  displayEdges,
  edgesThrough,
} from '../../src/lib/replay/engine';
import { createPlayback } from '../../src/lib/replay/playback';
import type { ReplayState } from '../../src/lib/replay/engine';

/** Two segments, 4 m/s, with a 600 s signal gap between them. */
function sample(): ReplayData {
  return {
    mode: 'real',
    point_count: 6,
    interpolated_point_count: 0,
    distance_m: 80,
    elapsed_seconds: 620,
    moving_seconds: 20,
    segments: [
      {
        segment_index: 0,
        coordinates: [
          [121, 31],
          [121.0001, 31],
          [121.0002, 31],
        ],
        elapsed_s: [0, 5, 10],
        moving_s: [0, 5, 10],
        distance_m: [0, 20, 40],
        pace_s_per_km: [null, 250, 250],
      },
      {
        segment_index: 2,
        coordinates: [
          [121.01, 31],
          [121.0101, 31],
          [121.0102, 31],
        ],
        elapsed_s: [610, 615, 620],
        moving_s: [10, 15, 20],
        distance_m: [40, 60, 80],
        pace_s_per_km: [null, 260, 240],
      },
    ],
  };
}

function longTrack(points: number): ReplayData {
  const coordinates: [number, number][] = [],
    elapsed: number[] = [],
    distance: number[] = [],
    pace: number[] = [];
  for (let i = 0; i < points; i++) {
    coordinates.push([116 + i * 0.00003, 39.9 + Math.sin(i / 500) * 0.01]);
    elapsed.push(i);
    distance.push(i * 3);
    pace.push(333.3);
  }
  return {
    mode: 'real',
    point_count: points,
    interpolated_point_count: 0,
    distance_m: distance.at(-1)!,
    elapsed_seconds: points - 1,
    moving_seconds: points - 1,
    segments: [
      {
        segment_index: 0,
        coordinates,
        elapsed_s: elapsed,
        moving_s: elapsed,
        distance_m: distance,
        pace_s_per_km: pace,
      },
    ],
  };
}

describe('parseReplay', () => {
  it('accepts a valid payload and unwraps longitudes across the antimeridian', () => {
    const value = sample();
    value.segments[0].coordinates = [
      [179.9999, 0],
      [-179.9999, 0],
      [-179.9998, 0],
    ];
    const parsed = parseReplay(value);
    expect(parsed.segments[0].coordinates[1][0]).toBeCloseTo(180.0001, 6);
    expect(parsed.segments[1].segment_index).toBe(2);
  });
  it.each([
    [
      'unknown mode',
      (v: any) => {
        v.mode = 'fast';
      },
    ],
    [
      'mismatched array lengths',
      (v: any) => {
        v.segments[0].elapsed_s.pop();
      },
    ],
    [
      'time going backwards',
      (v: any) => {
        v.segments[1].elapsed_s[0] = 3;
      },
    ],
    [
      'distance going backwards',
      (v: any) => {
        v.segments[1].distance_m[0] = 10;
      },
    ],
    [
      'out-of-range coordinate',
      (v: any) => {
        v.segments[0].coordinates[0] = [200, 0];
      },
    ],
    [
      'point count disagreeing with segments',
      (v: any) => {
        v.point_count = 7;
      },
    ],
    [
      'simulated payload carrying pace',
      (v: any) => {
        v.mode = 'simulated';
      },
    ],
    [
      'negative pace',
      (v: any) => {
        v.segments[0].pace_s_per_km[1] = -1;
      },
    ],
    [
      'repeated segment index',
      (v: any) => {
        v.segments[1].segment_index = 0;
      },
    ],
  ])('rejects %s', (_, change) => {
    const value = sample();
    change(value);
    expect(() => parseReplay(value)).toThrow('回放数据无效');
  });
});

describe('replay engine', () => {
  it('paces typical runs to 15-30 s and gives longer activities more time, up to a cap', () => {
    expect(playbackSeconds(5 * 60)).toBe(15);
    for (const minutes of [20, 30, 45, 60, 75]) {
      expect(playbackSeconds(minutes * 60)).toBeGreaterThanOrEqual(15);
      expect(playbackSeconds(minutes * 60)).toBeLessThanOrEqual(30.5);
    }
    expect(playbackSeconds(4 * 3600)).toBeGreaterThan(playbackSeconds(2 * 3600));
    expect(playbackSeconds(2 * 3600)).toBeGreaterThan(30);
    expect(playbackSeconds(48 * 3600)).toBe(MAX_PLAYBACK_SECONDS);
  });
  it('plays the whole track in playbackSeconds at 1x, with each signal gap a short fixed pause', () => {
    const track = buildTrack(parseReplay(longTrack(3601)));
    expect(track.duration / track.rate).toBeCloseTo(playbackSeconds(3600), 9);

    const gapped = buildTrack(parseReplay(sample()));
    // 20 s inside segments, so the replay is paced at 20 / 15 track seconds per screen second.
    expect(gapped.rate).toBeCloseTo(20 / 15, 9);
    const gap = GAP_SCREEN_SECONDS * gapped.rate;
    const clock = Array.from(gapped.clock);
    expect(clock.slice(0, 3)).toEqual([0, 5, 10]);
    [10 + gap, 15 + gap, 20 + gap].forEach((value, k) => expect(clock[3 + k]).toBeCloseTo(value, 9));
    expect(gapped.segmentStarts).toEqual([0, 3]);
  });
  it('interpolates position, distance, time and pace inside a segment', () => {
    const track = buildTrack(parseReplay(sample()));
    const point = sampleAt(track, 7.5);
    expect(point).toMatchObject({
      index: 1,
      segment: 0,
      gap: false,
      elapsed: 7.5,
      moving: 7.5,
      distance: 30,
      pace: 250,
    });
    expect(point.lon).toBeCloseTo(121.00015, 8);
    expect(sampleAt(track, 2.5).pace).toBe(250); // the missing neighbour pace is not invented as zero
  });
  it('holds the runner still across a gap while elapsed time runs on', () => {
    const track = buildTrack(parseReplay(sample()));
    const middle = (track.clock[2] + track.clock[3]) / 2;
    const point = sampleAt(track, middle);
    expect(point).toMatchObject({ gap: true, index: 2, lon: 121.0002, distance: 40, moving: 10, pace: null });
    expect(point.elapsed).toBeCloseTo(310, 9);
    expect(sampleAt(track, track.clock[3])).toMatchObject({ index: 3, segment: 1, lon: 121.01, elapsed: 610 });
  });
  it('clamps outside the clock and ends on the last point', () => {
    const track = buildTrack(parseReplay(sample()));
    expect(sampleAt(track, -5)).toMatchObject({ index: 0, elapsed: 0 });
    expect(sampleAt(track, 999)).toMatchObject({ index: 5, elapsed: 620, distance: 80, pace: 240 });
  });
  it('locates by binary search with a forward hint and handles repeated values', () => {
    const values = [0, 1, 1, 1, 4, 9];
    expect(locate(values, 1)).toBe(3);
    expect(locate(values, 1, 1)).toBe(3);
    expect(locate(values, 5, 4)).toBe(4);
    expect(locate(values, 8, 0)).toBe(4);
    expect(locate(values, 100, 5)).toBe(5);
    expect(locate(values, -1)).toBe(0);
  });
  it('splits the track into fixed edges per segment and counts the travelled ones', () => {
    const value = sample();
    value.segments.push({
      segment_index: 3,
      coordinates: [[121.02, 31]],
      elapsed_s: [630],
      moving_s: [20],
      distance_m: [80],
      pace_s_per_km: [null],
    });
    value.point_count = 7;
    value.elapsed_seconds = 630;
    const track = buildTrack(parseReplay(value));
    const edges = displayEdges(displayLines(track));
    // Two edges per three-point segment, never bridging the gap, and a lone point for the one-point segment.
    expect(edges.features.map((f) => f.geometry.type)).toEqual([
      'LineString',
      'LineString',
      'LineString',
      'LineString',
      'Point',
    ]);
    expect(edges.features.map((f) => f.id)).toEqual([0, 1, 2, 3, 4]);
    expect(edges.ends).toEqual([1, 2, 4, 5, 6]);
    expect(edges.segments).toEqual([0, 0, 1, 1, 2]);
    expect(edges.features[2].geometry.coordinates).toEqual([
      [121.01, 31],
      [121.0101, 31],
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => edgesThrough(edges.ends, index))).toEqual([0, 1, 2, 2, 3, 4, 5]);
  });
  it('builds the live tip from the last travelled vertex to the interpolated position', () => {
    const track = buildTrack(parseReplay(sample()));
    const point = sampleAt(track, 7.5);
    expect(tipCoordinates(track, 1, point)).toEqual([
      [121.0001, 31],
      [point.lon, point.lat],
    ]);
    expect(tipCoordinates(track, 0, point)).toEqual([
      [121, 31],
      [121.0001, 31],
      [point.lon, point.lat],
    ]);
  });
  it('handles 50,000 points: thinned display, fast sampling, no per-frame scans', () => {
    const started = performance.now();
    const track = buildTrack(parseReplay(longTrack(50000)));
    const built = performance.now() - started;
    const [line] = displayLines(track);
    const edges = displayEdges([line]);
    expect(line.coordinates.length).toBeLessThanOrEqual(MAX_DISPLAY_VERTICES + 1);
    expect(edges.features.length).toBe(line.coordinates.length - 1);
    expect(line.indices[0]).toBe(0);
    expect(line.indices.at(-1)).toBe(49999);
    // A minute of 60 fps playback at 10x, sampled the way the player does (with the forward hint).
    let hint = 0;
    const sampling = performance.now();
    for (let frame = 0; frame < 3600; frame++) {
      const point = sampleAt(track, frame * (10 / 60), hint);
      hint = point.index;
      edgesThrough(edges.ends, point.index);
    }
    const sampled = performance.now() - sampling;
    expect(sampleAt(track, 12345.5).distance).toBeCloseTo(37036.5, 6);
    expect(built).toBeLessThan(1500);
    expect(sampled).toBeLessThan(200);
  });
});

describe('playback clock', () => {
  function fakeScheduler() {
    let now = 1000,
      next: ((t: number) => void) | null = null,
      handles = 0;
    return {
      scheduler: {
        request: (cb: (t: number) => void) => {
          next = cb;
          return ++handles;
        },
        cancel: () => {
          next = null;
        },
        now: () => now,
      },
      advance(ms: number) {
        now += ms;
        const cb = next;
        next = null;
        cb?.(now);
      },
      /** Real frames are ~16 ms apart; step in 50 ms frames to stay under the stall cap. */
      run(ms: number) {
        for (let left = ms; left > 0; left -= 50) this.advance(Math.min(50, left));
      },
      get pending() {
        return next !== null;
      },
    };
  }
  it('advances by real elapsed time times speed, pauses, seeks and ends', () => {
    const fake = fakeScheduler(),
      states: ReplayState[] = [];
    const playback = createPlayback(10, 1, (s) => states.push(s), fake.scheduler);
    playback.play();
    fake.run(1000);
    expect(playback.state.time).toBeCloseTo(1, 9);
    playback.setSpeed(5);
    fake.run(400);
    expect(playback.state.time).toBeCloseTo(3, 9);
    playback.pause();
    expect(fake.pending).toBe(false);
    expect(playback.state.status).toBe('paused');
    playback.seek(9.9);
    playback.play();
    fake.advance(100);
    expect(playback.state).toMatchObject({ status: 'ended', time: 10 });
    expect(fake.pending).toBe(false);
    playback.play(); // replay from the start after the end
    expect(playback.state).toMatchObject({ status: 'playing', time: 0 });
    playback.destroy();
    expect(fake.pending).toBe(false);
  });
  it('scales real time by the track rate as well as the chosen speed', () => {
    const fake = fakeScheduler();
    const playback = createPlayback(3600, 120, () => {}, fake.scheduler);
    playback.play();
    fake.run(1000);
    expect(playback.state.time).toBeCloseTo(120, 6);
    playback.setSpeed(2);
    fake.run(500);
    expect(playback.state.time).toBeCloseTo(240, 6);
  });
  it('caps a stalled frame instead of leaping ahead', () => {
    const fake = fakeScheduler();
    const playback = createPlayback(100, 1, () => {}, fake.scheduler);
    playback.play();
    fake.advance(60000);
    expect(playback.state.time).toBe(0.25);
  });
  it('restart and seeking clamp to the clock', () => {
    const fake = fakeScheduler();
    const playback = createPlayback(10, 1, () => {}, fake.scheduler);
    playback.seek(-3);
    expect(playback.state).toMatchObject({ time: 0, status: 'paused' });
    playback.seek(50);
    expect(playback.state).toMatchObject({ time: 10, status: 'ended' });
    playback.restart();
    expect(playback.state).toMatchObject({ time: 0, status: 'playing' });
  });
});
