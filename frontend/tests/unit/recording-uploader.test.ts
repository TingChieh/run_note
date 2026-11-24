import { describe, expect, it } from 'vitest';
import { createMemoryRecordingBackend, listUploadQueueItems } from '../../src/lib/recording-store.ts';
import {
  UPLOAD_BACKOFF_MS,
  computeBackoffDelayMs,
  enqueueFinalizedRecording,
  flushRecordingUploadQueue,
} from '../../src/lib/recording-uploader.ts';

const SAMPLE_POINTS = [
  { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 },
  { lat: 31.231, lon: 121.47, elevationM: 11, accuracyM: 6, recordedAtMs: 1_700_000_030_000, segmentIndex: 0 },
];

const SERVER_ACTIVITY = {
  id: '33333333-3333-4333-8333-333333333333',
  title: '离线晨跑',
  notes: '',
  category: '路跑',
  tags: [],
  activity_date: '2026-11-24',
  timezone: 'Asia/Shanghai',
  started_at: '2026-11-24T00:00:00Z',
  ended_at: '2026-11-24T00:05:00Z',
  distance_m: '112.500',
  elapsed_seconds: '30.000',
  timer_seconds: null,
  avg_pace_seconds_per_km: '266.000',
  temporal_quality: 'complete',
  visibility: 'private',
  allow_shared_route: false,
  quality_summary: { warnings: [] },
  metrics_version: 'gpx-v1',
  has_route: true,
  created_at: '2026-11-24T00:05:05Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('recording-uploader idempotent queue', () => {
  it('queues offline recording and uploads once with Idempotency-Key when network returns', async () => {
    const backend = createMemoryRecordingBackend();
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await enqueueFinalizedRecording(
      {
        accountId: 'user-1',
        sessionId: 'sess-1',
        idempotencyKey,
        title: '离线晨跑',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
      1_700_000_031_000,
    );

    let postCount = 0;
    let seenIdempotencyHeader: string | null = null;
    const mockFetch: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path === '/api/v1/auth/csrf') {
        return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      }
      if (path === '/api/v1/gpx-imports') {
        postCount += 1;
        seenIdempotencyHeader = new Headers(init?.headers).get('Idempotency-Key');
        return jsonResponse(
          {
            data: {
              activity: SERVER_ACTIVITY,
              import_id: '44444444-4444-4444-8444-444444444444',
              warnings: [],
              point_count: 2,
              segment_count: 1,
              metrics_version: 'gpx-v1',
            },
            error: null,
          },
          201,
        );
      }
      throw new Error(`Unexpected fetch: ${path}`);
    };

    // Offline flush sends zero requests
    const offlineOutcome = await flushRecordingUploadQueue({
      accountId: 'user-1',
      fetcher: mockFetch,
      backend,
      isOnline: () => false,
    });
    expect(offlineOutcome.status).toBe('offline');
    expect(postCount).toBe(0);

    // Online flush uploads exactly once with Idempotency-Key
    const onlineOutcome = await flushRecordingUploadQueue({
      accountId: 'user-1',
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(onlineOutcome.status).toBe('uploaded');
    expect(onlineOutcome.uploadedCount).toBe(1);
    expect(postCount).toBe(1);
    expect(seenIdempotencyHeader).toBe(idempotencyKey);

    // Second flush is a no-op (never duplicates)
    const secondOutcome = await flushRecordingUploadQueue({
      accountId: 'user-1',
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(secondOutcome.status).toBe('idle');
    expect(postCount).toBe(1);

    const stored = await listUploadQueueItems('user-1', backend);
    expect(stored[0].status).toBe('uploaded');
    expect(stored[0].uploadedActivityId).toBe(SERVER_ACTIVITY.id);
    expect(stored[0].gpxXml).toBe(''); // Raw bytes freed after authoritative server save
    expect(stored[0].serverDistanceM).toBe('112.500');
  });

  it('applies exponential backoff on 503 and deduplicates cleanly on 409 GPX_DUPLICATE', async () => {
    expect(computeBackoffDelayMs(1)).toBe(UPLOAD_BACKOFF_MS[0]);
    expect(computeBackoffDelayMs(2)).toBe(UPLOAD_BACKOFF_MS[1]);
    expect(computeBackoffDelayMs(99)).toBe(UPLOAD_BACKOFF_MS.at(-1));

    const backend = createMemoryRecordingBackend();
    await enqueueFinalizedRecording(
      {
        accountId: 'user-2',
        sessionId: 'sess-2',
        idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '退避重试跑',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    let nowMs = 1_700_000_100_000;
    let attempt = 0;
    const flakyFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({ data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' } }, 503);
      }
      return jsonResponse(
        {
          data: null,
          error: {
            code: 'GPX_DUPLICATE',
            message: '此运动记录已经导入',
            details: [{ existing_activity_id: SERVER_ACTIVITY.id, duplicate_kind: 'raw' }],
          },
        },
        409,
      );
    };

    const fail1 = await flushRecordingUploadQueue({
      accountId: 'user-2',
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
    });
    expect(fail1.status).toBe('failed');
    expect(attempt).toBe(1);

    // Calling again before backoff expires skips without hammering server
    nowMs += 2_000;
    const skipped = await flushRecordingUploadQueue({
      accountId: 'user-2',
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
    });
    expect(attempt).toBe(1);
    expect(skipped.pendingCount).toBe(1);

    // After backoff expires, 409 GPX_DUPLICATE resolves idempotently to existing activity
    nowMs += 10_000;
    const recovered = await flushRecordingUploadQueue({
      accountId: 'user-2',
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
    });
    expect(recovered.status).toBe('uploaded');
    expect(recovered.uploadedActivityIds).toEqual([SERVER_ACTIVITY.id]);
  });

  it('pauses on 401 without silently dropping queued track', async () => {
    const backend = createMemoryRecordingBackend();
    await enqueueFinalizedRecording(
      {
        accountId: 'user-3',
        sessionId: 'sess-3',
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: '会话过期测试',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    const expiredFetch: typeof fetch = async () =>
      jsonResponse({ data: null, error: { code: 'AUTH_REQUIRED', message: '请重新登录' } }, 401);
    const out = await flushRecordingUploadQueue({
      accountId: 'user-3',
      fetcher: expiredFetch,
      backend,
      isOnline: () => true,
    });
    expect(out.status).toBe('auth_expired');
    const stored = await listUploadQueueItems('user-3', backend);
    expect(stored).toHaveLength(1);
    expect(stored[0].gpxXml).toContain('<gpx');
  });
});
