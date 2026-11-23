import { describe, expect, it, vi } from 'vitest';
import { syncCompanionActivities } from '../../src/lib/companion-sync.ts';
import {
  buildCacheNamespace,
  createMemoryCacheBackend,
  readCachedActivity,
  readCachedActivityPage,
  readSyncMetadata,
} from '../../src/lib/offline-cache.ts';

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, error: null, meta: { request_id: 'req-1' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeServerActivity(id: string, date: string, title: string, updatedAt: string) {
  return {
    id,
    title,
    notes: '',
    category: '',
    tags: [],
    activity_date: date,
    timezone: 'Asia/Shanghai',
    started_at: `${date}T00:00:00Z`,
    ended_at: `${date}T00:25:00Z`,
    distance_m: '5000.000',
    elapsed_seconds: '1500.000',
    timer_seconds: null,
    calories_kcal: 300,
    steps: 4500,
    avg_heart_rate_bpm: 150,
    max_heart_rate_bpm: 170,
    min_heart_rate_bpm: 120,
    avg_pace_seconds_per_km: '300.000',
    temporal_quality: 'complete',
    visibility: 'private',
    allow_shared_route: false,
    quality_summary: {},
    metrics_version: 'v1',
    has_route: true,
    created_at: `${date}T00:30:00Z`,
    updated_at: updatedAt,
  };
}

describe('companion incremental sync engine', () => {
  it('paginates with cursor, deduplicates by server-wins, short-circuits unchanged, and reconciles deletions', async () => {
    const backend = createMemoryCacheBackend();
    const ns = buildCacheNamespace('user-1', 'owner');
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const id3 = '33333333-3333-4333-8333-333333333333';

    let phase: 'initial' | 'unchanged' | 'delta' = 'initial';
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (phase === 'initial') {
        if (!url.includes('cursor=')) {
          return envelope({
            data_version: 5,
            unchanged: false,
            server_time: '2026-11-23T08:00:00Z',
            total_count: 3,
            items: [
              makeServerActivity(id1, '2026-11-20', '第一次晨跑', '2026-11-20T01:00:00Z'),
              makeServerActivity(id2, '2026-11-21', '旧标题', '2026-11-21T01:00:00Z'),
            ],
            next_cursor: 'cur-page-2',
            has_more: true,
            active_ids: null,
            full_resync_required: false,
          });
        }
        // Page 2 intentionally repeats id2 with newer server title to verify deduplication (server wins).
        return envelope({
          data_version: 5,
          unchanged: false,
          server_time: '2026-11-23T08:00:00Z',
          total_count: 3,
          items: [
            makeServerActivity(id2, '2026-11-21', '服务端较新标题', '2026-11-21T02:00:00Z'),
            makeServerActivity(id3, '2026-11-22', '周末长跑', '2026-11-22T01:00:00Z'),
          ],
          next_cursor: null,
          has_more: false,
          active_ids: null,
          full_resync_required: false,
        });
      }
      if (phase === 'unchanged') {
        return envelope({
          data_version: 5,
          unchanged: true,
          server_time: '2026-11-23T08:05:00Z',
          total_count: 3,
          items: [],
          next_cursor: null,
          has_more: false,
          active_ids: null,
          full_resync_required: false,
        });
      }
      // Delta sync: id2 edited again, id1 deleted on server.
      return envelope({
        data_version: 7,
        unchanged: false,
        server_time: '2026-11-23T08:10:00Z',
        total_count: 2,
        items: [makeServerActivity(id2, '2026-11-21', '增量编辑后标题', '2026-11-23T08:09:00Z')],
        next_cursor: null,
        has_more: false,
        active_ids: [id2, id3],
        full_resync_required: false,
      });
    }) as unknown as typeof fetch;

    const first = await syncCompanionActivities({
      namespace: ns,
      fetcher,
      backend,
      limit: 2,
      sleep: async () => {},
    });
    expect(first.status).toBe('synced');
    expect(first.upsertedCount).toBe(3);
    expect((await readCachedActivity(ns, id2, { backend }))?.value.title).toBe('服务端较新标题');

    // Second sync with matching data_version short-circuits.
    phase = 'unchanged';
    const second = await syncCompanionActivities({
      namespace: ns,
      fetcher,
      backend,
      sleep: async () => {},
    });
    expect(second.status).toBe('synced');
    expect(second.unchanged).toBe(true);
    expect(urls.at(-1)).toContain('since_version=5');

    // Third sync applies server edit and prunes server-deleted id1.
    phase = 'delta';
    const third = await syncCompanionActivities({
      namespace: ns,
      fetcher,
      backend,
      sleep: async () => {},
    });
    expect(third.status).toBe('synced');
    expect(third.upsertedCount).toBe(1);
    expect(third.removedCount).toBe(1);
    expect(await readCachedActivity(ns, id1, { backend })).toBeNull();
    expect((await readCachedActivity(ns, id2, { backend }))?.value.title).toBe('增量编辑后标题');
    const cachedPage = await readCachedActivityPage(ns, 0, 20, { backend });
    expect(cachedPage?.list.items.map((x) => x.id)).toEqual([id3, id2]);
    expect((await readSyncMetadata(ns, backend))?.dataVersion).toBe(7);
  });

  it('pauses when offline, retries transient failures with backoff, and clears private cache on 401', async () => {
    const backend = createMemoryCacheBackend();
    const ns = buildCacheNamespace('user-2', 'owner');
    const id1 = '44444444-4444-4444-8444-444444444444';

    // Offline pause makes zero network calls.
    const offlineFetch = vi.fn();
    const offlineOutcome = await syncCompanionActivities({
      namespace: ns,
      fetcher: offlineFetch as unknown as typeof fetch,
      backend,
      isOnline: () => false,
    });
    expect(offlineOutcome.status).toBe('offline');
    expect(offlineFetch).not.toHaveBeenCalled();

    // Transient network error followed by success retries with backoff.
    let attempts = 0;
    const sleeps: number[] = [];
    const flakyFetch = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) throw new TypeError('network down');
      return envelope({
        data_version: 1,
        unchanged: false,
        server_time: '2026-11-23T09:00:00Z',
        total_count: 1,
        items: [makeServerActivity(id1, '2026-11-23', '重试成功记录', '2026-11-23T09:00:00Z')],
        next_cursor: null,
        has_more: false,
        active_ids: null,
        full_resync_required: false,
      });
    }) as unknown as typeof fetch;

    const recovered = await syncCompanionActivities({
      namespace: ns,
      fetcher: flakyFetch,
      backend,
      retryBaseDelayMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(recovered.status).toBe('synced');
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([100]);
    expect(await readCachedActivity(ns, id1, { backend })).not.toBeNull();

    // 401 immediately purges private cache and returns auth_expired without retrying.
    const expiredFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null, error: { code: 'AUTH_REQUIRED', message: '请登录' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const expired = await syncCompanionActivities({
      namespace: ns,
      fetcher: expiredFetch,
      backend,
      sleep: async () => {},
    });
    expect(expired.status).toBe('auth_expired');
    expect(expiredFetch).toHaveBeenCalledTimes(1);
    expect(await readCachedActivity(ns, id1, { backend })).toBeNull();
  });
});
