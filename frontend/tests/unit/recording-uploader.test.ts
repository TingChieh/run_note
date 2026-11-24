import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RecordingPersistenceError,
  claimRecordingAccountAtomic,
  createMemoryRecordingBackend,
  ensureRecordingAccountIsolation,
  getActiveRecordingAccount,
  listUploadQueueItems,
  readActiveRecordingDraft,
  saveActiveRecordingDraft,
  type RecordingStorageBackend,
} from '../../src/lib/recording-store.ts';
import {
  UPLOAD_BACKOFF_MS,
  abortAllRecordingUploads,
  computeBackoffDelayMs,
  enqueueFinalizedRecording,
  flushRecordingUploadQueue,
  isAccountChangeAuthBroadcast,
  rearmScheduledRecordingUpload,
} from '../../src/lib/recording-uploader.ts';

const SAMPLE_POINTS = [
  { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 6, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 },
  { lat: 31.231, lon: 121.47, elevationM: 11, accuracyM: 6, recordedAtMs: 1_700_000_030_000, segmentIndex: 0 },
];

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333331';

/** Enqueues the way the recording page does: under the account's current (or newly made) claim. */
async function enqueueUnderClaim(
  input: Parameters<typeof enqueueFinalizedRecording>[0],
  backend: RecordingStorageBackend,
  nowMs?: number,
) {
  const claim = await claimRecordingAccountAtomic(input.accountId, backend, undefined, { reuseExistingClaim: true });
  if (claim.status !== 'claimed' || typeof claim.claimRevision !== 'number') {
    throw new Error(`test setup: ${input.accountId} cannot claim while ${claim.activeAccountId} is active`);
  }
  return enqueueFinalizedRecording(input, { expectedClaimRevision: claim.claimRevision }, backend, nowMs);
}

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

function sessionResponse(userId: string): Response {
  return jsonResponse({
    data: {
      user: {
        id: userId,
        email: `${userId.slice(0, 8)}@example.com`,
        username: `runner_${userId.slice(0, 4)}`,
        display_name: 'Runner',
        timezone: 'Asia/Shanghai',
        created_at: '2026-01-01T00:00:00Z',
        bio: '',
        is_admin: false,
        showcase_enabled: false,
        profile_is_public: false,
        wellbeing_allowed: false,
        wellbeing_enabled: false,
        together_allowed: false,
        together_enabled: false,
      },
    },
    error: null,
  });
}

afterEach(() => {
  abortAllRecordingUploads();
  vi.useRealTimers();
});

describe('recording-uploader idempotent queue', () => {
  it('queues offline recording and uploads once with Idempotency-Key and expected_owner_id when network returns', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await enqueueUnderClaim(
      {
        accountId: USER_A,
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
    let seenExpectedOwner: string | null = null;
    const mockFetch: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') {
        return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      }
      if (path === '/api/v1/gpx-imports') {
        postCount += 1;
        seenIdempotencyHeader = new Headers(init?.headers).get('Idempotency-Key');
        if (init?.body instanceof FormData) {
          seenExpectedOwner = String(init.body.get('expected_owner_id') ?? '');
        }
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
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      isOnline: () => false,
    });
    expect(offlineOutcome.status).toBe('offline');
    expect(postCount).toBe(0);

    // Online flush uploads exactly once with Idempotency-Key and expected_owner_id
    const onlineOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(onlineOutcome.status).toBe('uploaded');
    expect(onlineOutcome.uploadedCount).toBe(1);
    expect(postCount).toBe(1);
    expect(seenIdempotencyHeader).toBe(idempotencyKey);
    expect(seenExpectedOwner).toBe(USER_A);

    // Second flush is a no-op (never duplicates)
    const secondOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(secondOutcome.status).toBe('idle');
    expect(postCount).toBe(1);

    const stored = await listUploadQueueItems(USER_A, backend);
    expect(stored[0].status).toBe('uploaded');
    expect(stored[0].uploadedActivityId).toBe(SERVER_ACTIVITY.id);
    expect(stored[0].gpxXml).toBe(''); // Raw bytes freed after authoritative server save
    expect(stored[0].serverDistanceM).toBe('112.500');
  });

  it('applies exponential backoff on 503 and deduplicates cleanly on 409 GPX_DUPLICATE', async () => {
    expect(computeBackoffDelayMs(1)).toBe(UPLOAD_BACKOFF_MS[0]);
    expect(computeBackoffDelayMs(2)).toBe(UPLOAD_BACKOFF_MS[1]);
    expect(computeBackoffDelayMs(99)).toBe(UPLOAD_BACKOFF_MS.at(-1));

    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await enqueueUnderClaim(
      {
        accountId: USER_B,
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
      if (path === '/api/v1/auth/session') return sessionResponse(USER_B);
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
      accountId: USER_B,
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
      scheduleRetry: false,
    });
    expect(fail1.status).toBe('failed');
    expect(attempt).toBe(1);

    // Calling again before backoff expires skips without hammering server
    nowMs += 2_000;
    const skipped = await flushRecordingUploadQueue({
      accountId: USER_B,
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
      scheduleRetry: false,
    });
    expect(attempt).toBe(1);
    expect(skipped.pendingCount).toBe(1);

    // After backoff expires, 409 GPX_DUPLICATE resolves idempotently to existing activity
    nowMs += 10_000;
    const recovered = await flushRecordingUploadQueue({
      accountId: USER_B,
      fetcher: flakyFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
      scheduleRetry: false,
    });
    expect(recovered.status).toBe('uploaded');
    expect(recovered.uploadedActivityIds).toEqual([SERVER_ACTIVITY.id]);
  });

  it('automatically fires due-time backoff timer after 503 and reschedules after early reconnect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_100_000);

    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-timer',
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: '定时退避自动重试跑',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    let postCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      postCount += 1;
      if (postCount === 1) {
        return jsonResponse({ data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' } }, 503);
      }
      return jsonResponse(
        {
          data: {
            activity: SERVER_ACTIVITY,
            import_id: '55555555-5555-4555-8555-555555555555',
            warnings: [],
            point_count: 2,
            segment_count: 1,
            metrics_version: 'gpx-v1',
          },
          error: null,
        },
        201,
      );
    };

    const first = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(first.status).toBe('failed');
    expect(first.nextRetryAt).toBe(1_700_000_105_000);
    expect(postCount).toBe(1);

    // Simulate an early reconnect 2s later (before the 5s deadline): must skip AND re-arm timer for remaining 3s
    await vi.advanceTimersByTimeAsync(2_000);
    const earlyReconnect = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      isOnline: () => true,
    });
    expect(earlyReconnect.status).toBe('partial');
    expect(earlyReconnect.nextRetryAt).toBe(1_700_000_105_000);
    expect(postCount).toBe(1);

    // Advancing the remaining 3s triggers the scheduled retry automatically
    await vi.advanceTimersByTimeAsync(3_000);
    expect(postCount).toBe(2);
    const items = await listUploadQueueItems(USER_A, backend);
    expect(items[0].status).toBe('uploaded');
    expect(items[0].uploadedActivityId).toBe(SERVER_ACTIVITY.id);
  });

  it('refuses to upload account A queue when active browser session belongs to account B (pre-flight & 409 ACCOUNT_MISMATCH)', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-a',
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        title: '账号 A 轨迹',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    let gpxPosts = 0;
    const crossTabFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_B);
      if (path === '/api/v1/gpx-imports') gpxPosts += 1;
      throw new Error(`Should never reach ${path}`);
    };

    const mismatch = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: crossTabFetch,
      backend,
      isOnline: () => true,
    });
    expect(mismatch.status).toBe('account_mismatch');
    expect(gpxPosts).toBe(0);
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);

    // Also verify server-side 409 ACCOUNT_MISMATCH (race between pre-flight check and POST) wipes queue cleanly
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-race',
        idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        title: '竞态切号轨迹',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    const serverRejectFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      return jsonResponse(
        { data: null, error: { code: 'ACCOUNT_MISMATCH', message: '当前登录账号与待上传记录所属账号不一致' } },
        409,
      );
    };

    const raceOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: serverRejectFetch,
      backend,
      isOnline: () => true,
    });
    expect(raceOutcome.status).toBe('account_mismatch');
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
  });

  it('aborts in-flight upload immediately on logout/account switch without mutating cleared store', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-abort',
        idempotencyKey: '12121212-1212-4121-8121-121212121212',
        title: '登出中断测试',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    let postStarted!: () => void;
    const postStartedPromise = new Promise<void>((resolve) => {
      postStarted = resolve;
    });
    let signalAborted = false;

    const slowFetch: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      postStarted();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          signalAborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    };

    const flushPromise = flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: slowFetch,
      backend,
      isOnline: () => true,
    });

    await postStartedPromise;
    abortAllRecordingUploads();
    const outcome = await flushPromise;
    expect(signalAborted).toBe(true);
    expect(outcome.status).toBe('aborted');
  });

  it('pauses on 401 without silently dropping queued track', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await enqueueUnderClaim(
      {
        accountId: USER_C,
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
      accountId: USER_C,
      fetcher: expiredFetch,
      backend,
      isOnline: () => true,
    });
    expect(out.status).toBe('auth_expired');
    const stored = await listUploadQueueItems(USER_C, backend);
    expect(stored).toHaveLength(1);
    expect(stored[0].gpxXml).toContain('<gpx');
  });

  it('rejects enqueueing on non-durable memory fallback or when durable read-back verification fails', async () => {
    const nonDurable = createMemoryRecordingBackend();
    expect(nonDurable.durable).toBe(false);
    await expect(
      enqueueFinalizedRecording(
        {
          accountId: USER_A,
          sessionId: 'sess-nondurable',
          idempotencyKey: '11111111-2222-4333-8444-555555555555',
          title: '非持久存储测试',
          timezone: 'Asia/Shanghai',
          startedAtMs: 1_700_000_000_000,
          endedAtMs: 1_700_000_030_000,
          activeDurationMs: 30_000,
          points: SAMPLE_POINTS,
        },
        { expectedClaimRevision: 1 },
        nonDurable,
      ),
    ).rejects.toMatchObject({
      name: 'RecordingPersistenceError',
      code: 'STORAGE_UNAVAILABLE',
    });

    const base = createMemoryRecordingBackend({ durableForTests: true });
    const silentDropBackend: RecordingStorageBackend = {
      ...base,
      durable: true,
      async mutateDraftAtomic(key, activeKey, epochKey, plan) {
        // Decide against the real rows, then pretend the write committed without persisting it.
        const ctx = {
          activeEntry: (await base.get(activeKey)) ?? undefined,
          epochEntry: (await base.get(epochKey)) ?? undefined,
          existing: (await base.get(key)) ?? undefined,
          extras: {},
        };
        return plan(ctx).result;
      },
    };
    const claim = await claimRecordingAccountAtomic(USER_A, base);
    await expect(
      enqueueFinalizedRecording(
        {
          accountId: USER_A,
          sessionId: 'sess-verify-fail',
          idempotencyKey: '22222222-3333-4444-8555-666666666666',
          title: '校验失败测试',
          timezone: 'Asia/Shanghai',
          startedAtMs: 1_700_000_000_000,
          endedAtMs: 1_700_000_030_000,
          activeDurationMs: 30_000,
          points: SAMPLE_POINTS,
        },
        { expectedClaimRevision: claim.claimRevision! },
        silentDropBackend,
      ),
    ).rejects.toBeInstanceOf(RecordingPersistenceError);
  });

  it('classifies auth-channel broadcasts and re-arms due-time backoff retries after same-account check', async () => {
    expect(isAccountChangeAuthBroadcast('check')).toBe(false);
    expect(isAccountChangeAuthBroadcast({ type: 'check' })).toBe(false);
    expect(isAccountChangeAuthBroadcast('account-changed')).toBe(true);
    expect(isAccountChangeAuthBroadcast({ type: 'account-changed' })).toBe(true);

    vi.useFakeTimers();
    let nowMs = 1_700_000_200_000;
    vi.setSystemTime(nowMs);

    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await ensureRecordingAccountIsolation(USER_A, backend);
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-rearm',
        idempotencyKey: '33333333-4444-4555-8666-777777777777',
        title: '同号校验保活重试跑',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );

    let postCount = 0;
    const mockFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      postCount += 1;
      if (postCount === 1) {
        return jsonResponse({ data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用' } }, 503);
      }
      return jsonResponse(
        {
          data: {
            activity: SERVER_ACTIVITY,
            import_id: '66666666-6666-4666-8666-666666666666',
            warnings: [],
            point_count: 2,
            segment_count: 1,
            metrics_version: 'gpx-v1',
          },
          error: null,
        },
        201,
      );
    };

    const fail = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
      scheduleRetry: false,
    });
    expect(fail.nextRetryAt).toBe(nowMs + 5_000);
    expect(postCount).toBe(1);

    // Re-arming after a same-account verification schedules for the exact due time without firing early
    const armedDue = await rearmScheduledRecordingUpload({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
    });
    expect(armedDue).toBe(nowMs + 5_000);

    // Calling re-arm a second time (e.g. another check) keeps the existing armed timer intact
    const alreadyArmed = await rearmScheduledRecordingUpload({
      accountId: USER_A,
      fetcher: mockFetch,
      backend,
      now: () => nowMs,
      isOnline: () => true,
    });
    expect(alreadyArmed).toBe(nowMs + 5_000);

    nowMs += 2_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postCount).toBe(1);

    nowMs += 3_000;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(postCount).toBe(2);
    expect((await listUploadQueueItems(USER_A, backend))[0].status).toBe('uploaded');
  });

  it('scopes stale-account cleanup to the stale account across all mismatch paths without deleting account B data', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    const seedB = async () => {
      await ensureRecordingAccountIsolation(USER_B, backend);
      await saveActiveRecordingDraft(
        {
          sessionId: 'sess-b',
          accountId: USER_B,
          idempotencyKey: 'bbbbbbbb-1111-4111-8111-111111111111',
          title: '账号 B 草稿',
          status: 'paused',
          startedAtMs: 1_700_000_000_000,
          endedAtMs: null,
          activeDurationMs: 60_000,
          lastSegmentStartMs: null,
          segmentIndex: 0,
          previewDistanceM: 250,
          lastPointTimeMs: 1_700_000_060_000,
          lastAccuracyM: 6,
          interruptedReason: null,
          points: SAMPLE_POINTS,
        },
        backend,
      );
      await enqueueUnderClaim(
        {
          accountId: USER_B,
          sessionId: 'sess-b-q',
          idempotencyKey: 'bbbbbbbb-2222-4222-8222-222222222222',
          title: '账号 B 待上传队列',
          timezone: 'Asia/Shanghai',
          startedAtMs: 1_700_000_000_000,
          endedAtMs: 1_700_000_030_000,
          activeDurationMs: 30_000,
          points: SAMPLE_POINTS,
        },
        backend,
      );
    };

    const assertBIntact = async () => {
      expect(await getActiveRecordingAccount(backend)).toBe(USER_B);
      expect((await readActiveRecordingDraft(USER_B, backend))?.sessionId).toBe('sess-b');
      const itemsB = await listUploadQueueItems(USER_B, backend);
      expect(itemsB).toHaveLength(1);
      expect(itemsB[0].idempotencyKey).toBe('bbbbbbbb-2222-4222-8222-222222222222');
      expect(itemsB[0].gpxXml).toContain('<gpx');
    };

    // 1. Active marker already belongs to USER_B while stale USER_A tries to flush
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-a1',
        idempotencyKey: 'aaaaaaaa-1111-4111-8111-111111111111',
        title: '账号 A 1',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );
    // Leave A's row behind without an active marker, as an earlier generation would have.
    await backend.delete('meta:recording_active_account');
    await seedB();
    const markerMismatch = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: async () => sessionResponse(USER_B),
      backend,
      isOnline: () => true,
    });
    expect(markerMismatch.status).toBe('account_mismatch');
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
    await assertBIntact();

    // 2. Mid-flight switch: USER_A starts uploading when active marker wasn't B yet, then B takes over before 503 returns
    await backend.delete('meta:recording_active_account');
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-a2',
        idempotencyKey: 'aaaaaaaa-2222-4222-8222-222222222222',
        title: '账号 A 2',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );
    // Leave A's row behind without an active marker, as an earlier generation would have.
    await backend.delete('meta:recording_active_account');
    const raceFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') return sessionResponse(USER_A);
      if (path === '/api/v1/auth/csrf') return jsonResponse({ data: { csrf_token: 'csrf-ok' }, error: null });
      // Another tab switches to USER_B while POST is in flight
      await seedB();
      return jsonResponse({ data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: '503' } }, 503);
    };
    const midFlightOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: raceFetch,
      backend,
      isOnline: () => true,
    });
    expect(midFlightOutcome.status).toBe('account_mismatch');
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
    await assertBIntact();

    // 3. Concurrent preemption during 401/expired session: B claims marker while A's session check is in flight
    await backend.delete('meta:recording_active_account');
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-a3',
        idempotencyKey: 'aaaaaaaa-3333-4333-8333-333333333333',
        title: '账号 A 3',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );
    // Leave A's row behind without an active marker, as an earlier generation would have.
    await backend.delete('meta:recording_active_account');
    const preemptOnExpiredFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') {
        await claimRecordingAccountAtomic(USER_B, backend);
        return jsonResponse({ data: { user: null }, error: null });
      }
      return jsonResponse({}, 500);
    };
    const expiredPreemptOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: preemptOnExpiredFetch,
      backend,
      isOnline: () => true,
    });
    expect(expiredPreemptOutcome.status).toBe('account_mismatch');
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
    await assertBIntact();

    // 4. Round 4 same-account re-login during mismatch check:
    // USER_A had rev 1 item; while verifyActiveSessionAccount runs and briefly sees USER_B,
    // another tab re-logs in as USER_A (rev 2) and writes a new draft & new upload item.
    await backend.clearAll();
    await claimRecordingAccountAtomic(USER_A, backend, 1_000);
    await enqueueUnderClaim(
      {
        accountId: USER_A,
        sessionId: 'sess-a-stale-r4',
        idempotencyKey: 'aaaaaaaa-4444-4444-8444-444444444444',
        title: '账号 A 旧代',
        timezone: 'Asia/Shanghai',
        startedAtMs: 1_700_000_000_000,
        endedAtMs: 1_700_000_030_000,
        activeDurationMs: 30_000,
        points: SAMPLE_POINTS,
      },
      backend,
    );
    const sameAccountReloginFetch: typeof fetch = async (input) => {
      const path = String(input);
      if (path === '/api/v1/auth/session') {
        await claimRecordingAccountAtomic(USER_A, backend, 2_000);
        await saveActiveRecordingDraft(
          {
            sessionId: 'sess-a-relogin-new',
            accountId: USER_A,
            idempotencyKey: 'aaaaaaaa-5555-4555-8555-555555555555',
            title: '账号 A 新代草稿',
            status: 'paused',
            startedAtMs: 1_700_000_100_000,
            endedAtMs: null,
            activeDurationMs: 20_000,
            lastSegmentStartMs: null,
            segmentIndex: 0,
            previewDistanceM: 120,
            lastPointTimeMs: 1_700_000_120_000,
            lastAccuracyM: 6,
            interruptedReason: null,
            points: SAMPLE_POINTS,
          },
          backend,
        );
        await enqueueUnderClaim(
          {
            accountId: USER_A,
            sessionId: 'sess-a-relogin-upload',
            idempotencyKey: 'aaaaaaaa-6666-4666-8666-666666666666',
            title: '账号 A 新代上传',
            timezone: 'Asia/Shanghai',
            startedAtMs: 1_700_000_100_000,
            endedAtMs: 1_700_000_130_000,
            activeDurationMs: 30_000,
            points: SAMPLE_POINTS,
          },
          backend,
        );
        return sessionResponse(USER_B);
      }
      return jsonResponse({}, 500);
    };
    const reloginOutcome = await flushRecordingUploadQueue({
      accountId: USER_A,
      fetcher: sameAccountReloginFetch,
      backend,
      isOnline: () => true,
    });
    expect(reloginOutcome.status).toBe('account_mismatch');
    expect(await getActiveRecordingAccount(backend)).toBe(USER_A);
    expect((await readActiveRecordingDraft(USER_A, backend))?.sessionId).toBe('sess-a-relogin-new');
    const survivingItems = await listUploadQueueItems(USER_A, backend);
    expect(survivingItems.map((i) => i.idempotencyKey)).toEqual(['aaaaaaaa-6666-4666-8666-666666666666']);
  });
});

describe('native handoff enqueue under a pinned account claim', () => {
  const input = (idempotencyKey: string) => ({
    accountId: USER_A,
    sessionId: 'sess-native-handoff',
    idempotencyKey,
    title: '原生交接',
    timezone: 'Asia/Shanghai',
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_030_000,
    activeDurationMs: 30_000,
    points: SAMPLE_POINTS,
  });

  it('never recreates the queue row after a cleanup removed the active marker since the pin', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    const pinned = await claimRecordingAccountAtomic(USER_A, backend);
    await backend.delete('meta:recording_active_account');
    await expect(
      enqueueFinalizedRecording(
        input('aaaaaaaa-7777-4777-8777-777777777777'),
        {
          expectedClaimRevision: pinned.claimRevision!,
        },
        backend,
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_CLAIM_STALE' });
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
  });

  it('rejects a pin from before a same-account logout and re-login, then enqueues once under the new claim', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    const pinned = await claimRecordingAccountAtomic(USER_A, backend, 1_000);
    await backend.delete('meta:recording_active_account');
    const relogin = await claimRecordingAccountAtomic(USER_A, backend, 2_000);
    expect(relogin.claimRevision).toBeGreaterThan(pinned.claimRevision!);
    const key = 'aaaaaaaa-8888-4888-8888-888888888888';
    await expect(
      enqueueFinalizedRecording(input(key), { expectedClaimRevision: pinned.claimRevision! }, backend),
    ).rejects.toMatchObject({ code: 'STORAGE_CLAIM_STALE' });
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);

    const first = await enqueueFinalizedRecording(
      input(key),
      { expectedClaimRevision: relogin.claimRevision! },
      backend,
    );
    const again = await enqueueFinalizedRecording(
      input(key),
      { expectedClaimRevision: relogin.claimRevision! },
      backend,
    );
    expect(again.createdAtMs).toBe(first.createdAtMs);
    const stored = await listUploadQueueItems(USER_A, backend);
    expect(stored.map((item) => item.idempotencyKey)).toEqual([key]);
  });

  it('does not write for an account whose claim another account now holds', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    const pinned = await claimRecordingAccountAtomic(USER_A, backend);
    await backend.delete('meta:recording_active_account');
    await claimRecordingAccountAtomic(USER_B, backend);
    await expect(
      enqueueFinalizedRecording(
        input('aaaaaaaa-9999-4999-8999-999999999999'),
        {
          expectedClaimRevision: pinned.claimRevision!,
        },
        backend,
      ),
    ).rejects.toBeInstanceOf(RecordingPersistenceError);
    expect(await listUploadQueueItems(USER_A, backend)).toEqual([]);
  });
});
