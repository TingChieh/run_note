import { describe, expect, it } from 'vitest';
import {
  assertSafeCachePayload,
  buildCacheNamespace,
  clearPrivateOfflineCache,
  createMemoryCacheBackend,
  ensureAccountCacheIsolation,
  extractFootprintMetadata,
  inspectNamespaceCacheStats,
  OFFLINE_CACHE_SCHEMA_VERSION,
  pruneCachedActivities,
  readCachedActivity,
  readCachedActivityPage,
  readFootprintMetaCache,
  readSummaryCache,
  saveFootprintMetaCache,
  saveSummaryCache,
  upsertCachedActivities,
  writeCacheEntry,
} from '../../src/lib/offline-cache.ts';
import type { Activity } from '../../src/lib/api/activities.ts';
import type { Summary } from '../../src/lib/api/statistics.ts';
import type { FootprintSnapshot } from '../../src/lib/api/footprints.ts';

function makeActivity(id: string, date: string, title: string): Activity {
  return {
    id,
    title,
    notes: '',
    category: '路跑',
    tags: [],
    activity_date: date,
    timezone: 'Asia/Shanghai',
    started_at: `${date}T00:00:00Z`,
    ended_at: `${date}T00:30:00Z`,
    distance_m: '5000.000',
    elapsed_seconds: '1800.000',
    timer_seconds: null,
    calories_kcal: 320,
    steps: 4900,
    avg_heart_rate_bpm: 148,
    max_heart_rate_bpm: 168,
    min_heart_rate_bpm: 120,
    avg_pace_seconds_per_km: '360.000',
    temporal_quality: 'complete',
    visibility: 'private',
    allow_shared_route: false,
    quality_summary: {},
    metrics_version: 'v1',
    has_route: true,
    created_at: `${date}T01:00:00Z`,
  };
}

const sampleSummary: Summary = {
  activity_count: 12,
  distance_m: '84200.000',
  duration_sum_seconds: '28800.000',
  known_duration_count: 12,
  missing_duration_count: 0,
  activity_days: 10,
  pace_eligible_count: 12,
  pace_eligible_distance_m: '84200.000',
  avg_pace_seconds_per_km: '342.000',
  quality_warning_count: 0,
  date_assignment: 'activity_local_date',
};

describe('offline-cache account isolation, TTL, corruption recovery, and secret guard', () => {
  it('refuses to cache plaintext tokens, cookies, passwords, or private wellbeing fields', async () => {
    const backend = createMemoryCacheBackend();
    const ns = buildCacheNamespace('user-1', 'owner');
    expect(() => assertSafeCachePayload({ csrf_token: 'abc' })).toThrow(/sensitive field/i);
    expect(() => assertSafeCachePayload({ nested: { access_token: 'secret' } })).toThrow(/sensitive field/i);
    expect(() => assertSafeCachePayload({ medication_name: 'Rx' })).toThrow(/sensitive field/i);
    await expect(writeCacheEntry(ns, 'bad', { token: 'plaintext' }, { backend })).rejects.toThrow();
  });

  it('isolates accounts and purges all private entries on logout or account switch', async () => {
    const backend = createMemoryCacheBackend();
    const nsA = buildCacheNamespace('user-a', 'owner');
    const nsB = buildCacheNamespace('user-b', 'owner');
    const nsPublic = buildCacheNamespace(null, 'root');

    await ensureAccountCacheIsolation('user-a', backend);
    await saveSummaryCache(nsA, 'all', sampleSummary, backend);
    await saveSummaryCache(nsPublic, 'all', sampleSummary, backend);
    expect((await readSummaryCache(nsA, 'all', backend))?.value.activity_count).toBe(12);

    // User B cannot read User A's namespace, and switching to User B wipes all `user:*` entries.
    expect(await readSummaryCache(nsB, 'all', backend)).toBeNull();
    const switched = await ensureAccountCacheIsolation('user-b', backend);
    expect(switched.cleared).toBe(true);
    expect(await readSummaryCache(nsA, 'all', backend)).toBeNull();
    // Public cache remains unaffected by private account purge.
    expect(await readSummaryCache(nsPublic, 'all', backend)).not.toBeNull();

    // Explicit logout clears private cache.
    await saveSummaryCache(nsB, 'all', sampleSummary, backend);
    const removed = await clearPrivateOfflineCache(backend);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await readSummaryCache(nsB, 'all', backend)).toBeNull();
  });

  it('self-heals corrupted entries, wrong schema versions, and expired TTL entries', async () => {
    const backend = createMemoryCacheBackend();
    const ns = buildCacheNamespace('user-1', 'owner');

    // Corrupted summary payload is deleted on read and returns null cleanly.
    await backend.put({
      key: `${ns}:summary:all`,
      namespace: ns,
      schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      dataVersion: 1,
      payload: { broken: true },
    });
    expect(await readSummaryCache(ns, 'all', backend)).toBeNull();
    expect(await backend.get(`${ns}:summary:all`)).toBeNull();

    // Schema version mismatch is dropped automatically.
    await backend.put({
      key: `${ns}:summary:2026`,
      namespace: ns,
      schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION + 99,
      savedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      dataVersion: 1,
      payload: sampleSummary,
    });
    expect(await readSummaryCache(ns, 2026, backend)).toBeNull();

    // Expired TTL entry is dropped automatically.
    await writeCacheEntry(ns, 'summary:2025', sampleSummary, {
      ttlMs: 1000,
      now: 10_000,
      backend,
    });
    expect(await readSummaryCache(ns, 2025, backend)).toBeNull();
  });

  it('caches activities in descending date/id order, supports pruning, and stores lightweight footprint metadata only', async () => {
    const backend = createMemoryCacheBackend();
    const ns = buildCacheNamespace('user-1', 'owner');
    const a1 = makeActivity('11111111-1111-4111-8111-111111111111', '2026-11-20', '晨跑 1');
    const a2 = makeActivity('22222222-2222-4222-8222-222222222222', '2026-11-22', '晨跑 2');
    const a3 = makeActivity('33333333-3333-4333-8333-333333333333', '2026-11-21', '晨跑 3');

    await upsertCachedActivities(ns, [a1, a2, a3], { dataVersion: 3, backend });
    const page = await readCachedActivityPage(ns, 0, 2, { backend });
    expect(page?.list.items.map((x) => x.id)).toEqual([a2.id, a3.id]);
    expect((await readCachedActivity(ns, a1.id, { backend }))?.value.title).toBe('晨跑 1');

    // Prune deleted activity a1.
    const pruned = await pruneCachedActivities(ns, new Set([a2.id, a3.id]), backend);
    expect(pruned).toBe(1);
    expect(await readCachedActivity(ns, a1.id, { backend })).toBeNull();

    // Footprint metadata strips GeoJSON features completely.
    const snapshot: FootprintSnapshot = {
      status: 'ready',
      generated_at: '2026-11-23T08:00:00Z',
      refreshing: false,
      refresh_failed: false,
      result: {
        type: 'FeatureCollection',
        scope: 'all',
        mode: 'tracks',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [120.1, 30.2],
                [120.2, 30.3],
              ],
            },
            properties: { activity_id: a2.id, title: '晨跑 2', activity_date: '2026-11-22', segment_index: 0 },
          },
        ],
        activity_count: 12,
        visible_activity_count: 10,
        unsupported_segment_count: 0,
        grid_size_m: 100,
        grid_crs: 'EPSG:3857',
        count_basis: 'distinct_activity_per_cell',
        max_count: 4,
      },
    };
    const meta = extractFootprintMetadata('tracks', snapshot);
    expect(meta).not.toBeNull();
    expect('features' in (meta as unknown as Record<string, unknown>)).toBe(false);
    await saveFootprintMetaCache(ns, 'tracks', meta!, backend);
    const cachedMeta = await readFootprintMetaCache(ns, 'tracks', backend);
    expect(cachedMeta?.value.activity_count).toBe(12);

    const stats = await inspectNamespaceCacheStats(ns, backend);
    expect(stats.cachedActivities).toBe(2);
    expect(stats.hasFootprintMeta).toBe(true);
  });
});
