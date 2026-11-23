import { ActivityError, parseActivity, request } from '#lib/api/activities.ts';
import {
  clearPrivateOfflineCache,
  getOfflineCacheBackend,
  pruneCachedActivities,
  readSyncMetadata,
  saveSyncMetadata,
  upsertCachedActivities,
  type ActivitySyncMetadata,
  type CachedActivity,
  type CacheStorageBackend,
} from '#lib/offline-cache.ts';

export interface ActivitySyncPage {
  data_version: number;
  unchanged: boolean;
  server_time: string;
  total_count: number;
  items: CachedActivity[];
  next_cursor: string | null;
  has_more: boolean;
  active_ids: string[] | null;
  full_resync_required: boolean;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth_expired';

export interface SyncOutcome {
  status: SyncStatus;
  dataVersion: number | null;
  unchanged: boolean;
  upsertedCount: number;
  removedCount: number;
  totalCount: number;
  lastSyncedAt: string | null;
  message: string | null;
}

export interface SyncOptions {
  namespace: string;
  fetcher?: typeof fetch;
  backend?: CacheStorageBackend;
  limit?: number;
  maxPages?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  forceFull?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalidSyncResponse(): never {
  throw new ActivityError('增量同步返回了无效响应，请稍后重试', 502, 'INVALID_RESPONSE');
}

export function parseActivitySyncPage(value: unknown): ActivitySyncPage {
  if (
    !isObject(value) ||
    typeof value.data_version !== 'number' ||
    !Number.isSafeInteger(value.data_version) ||
    value.data_version < 0 ||
    typeof value.unchanged !== 'boolean' ||
    typeof value.server_time !== 'string' ||
    !Number.isFinite(Date.parse(value.server_time)) ||
    typeof value.total_count !== 'number' ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0 ||
    !Array.isArray(value.items) ||
    typeof value.has_more !== 'boolean' ||
    typeof value.full_resync_required !== 'boolean'
  ) {
    invalidSyncResponse();
  }
  if (value.next_cursor !== null && (typeof value.next_cursor !== 'string' || !value.next_cursor)) {
    invalidSyncResponse();
  }
  let activeIds: string[] | null = null;
  if (value.active_ids !== null && value.active_ids !== undefined) {
    if (
      !Array.isArray(value.active_ids) ||
      value.active_ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      invalidSyncResponse();
    }
    activeIds = value.active_ids as string[];
  }
  const items: CachedActivity[] = value.items.map((raw) => {
    const parsed = parseActivity(raw) as CachedActivity;
    if (!isObject(raw) || typeof raw.updated_at !== 'string' || !Number.isFinite(Date.parse(raw.updated_at))) {
      invalidSyncResponse();
    }
    return { ...parsed, updated_at: raw.updated_at };
  });
  return {
    data_version: value.data_version,
    unchanged: value.unchanged,
    server_time: value.server_time,
    total_count: value.total_count,
    items,
    next_cursor: value.next_cursor,
    has_more: value.has_more,
    active_ids: activeIds,
    full_resync_required: value.full_resync_required,
  };
}

export async function fetchActivitySyncPage(
  params: {
    limit?: number;
    sinceVersion?: number | null;
    updatedSince?: string | null;
    cursor?: string | null;
  },
  fetcher: typeof fetch = fetch,
): Promise<ActivitySyncPage> {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit ?? 50));
  if (params.sinceVersion !== null && params.sinceVersion !== undefined) {
    query.set('since_version', String(params.sinceVersion));
  }
  if (params.updatedSince) {
    query.set('updated_since', params.updatedSince);
  }
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  const data = await request(`/api/v1/activities/sync?${query.toString()}`, {}, fetcher);
  return parseActivitySyncPage(data);
}

const inFlightByNamespace = new Map<string, Promise<SyncOutcome>>();

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(cause: unknown): boolean {
  if (cause instanceof ActivityError) {
    return cause.status === 503 || cause.status === 502 || cause.status === 429 || cause.code === 'NETWORK_ERROR';
  }
  return true;
}

async function runSyncOnce(options: SyncOptions): Promise<SyncOutcome> {
  const backend = options.backend ?? getOfflineCacheBackend();
  const fetcher = options.fetcher ?? fetch;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const maxPages = options.maxPages ?? 50;
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 400;

  const previousMeta = await readSyncMetadata(options.namespace, backend);

  if (!isOnline()) {
    return {
      status: 'offline',
      dataVersion: previousMeta?.dataVersion ?? null,
      unchanged: false,
      upsertedCount: 0,
      removedCount: 0,
      totalCount: previousMeta?.totalCount ?? 0,
      lastSyncedAt: previousMeta?.lastSyncedAt ?? null,
      message: '当前处于离线模式，将在恢复网络后自动同步。',
    };
  }

  const fetchWithRetry = async (params: {
    limit: number;
    sinceVersion?: number | null;
    updatedSince?: string | null;
    cursor?: string | null;
  }): Promise<ActivitySyncPage> => {
    let attempt = 0;
    for (;;) {
      try {
        return await fetchActivitySyncPage(params, fetcher);
      } catch (cause) {
        if (cause instanceof ActivityError && cause.status === 401) {
          throw cause;
        }
        if (!isOnline() || !isRetryableError(cause) || attempt >= maxRetries) {
          throw cause;
        }
        attempt += 1;
        await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
  };

  try {
    let sinceVersion = options.forceFull ? null : (previousMeta?.dataVersion ?? null);
    let updatedSince = options.forceFull ? null : (previousMeta?.serverTime ?? null);
    let cursor: string | null = null;
    let pagesFetched = 0;
    let targetDataVersion: number | null = null;
    let serverTime: string | null = null;
    let totalCount = previousMeta?.totalCount ?? 0;
    let activeIds: Set<string> | null = null;
    let fullSyncMode = sinceVersion === null;
    const mergedById = new Map<string, CachedActivity>();

    for (;;) {
      if (pagesFetched >= maxPages) break;
      const page = await fetchWithRetry({
        limit,
        sinceVersion: pagesFetched === 0 ? sinceVersion : null,
        updatedSince,
        cursor,
      });
      pagesFetched += 1;
      targetDataVersion = page.data_version;
      serverTime = page.server_time;
      totalCount = page.total_count;

      if (page.unchanged && pagesFetched === 1) {
        const syncedAt = now().toISOString();
        const existingEntries = await backend.listByPrefix(`${options.namespace}:activity:`);
        const updatedMeta: ActivitySyncMetadata = {
          dataVersion: page.data_version,
          lastSyncedAt: syncedAt,
          serverTime: page.server_time,
          totalCount: page.total_count,
          cachedCount: existingEntries.length,
        };
        await saveSyncMetadata(options.namespace, updatedMeta, backend);
        return {
          status: 'synced',
          dataVersion: page.data_version,
          unchanged: true,
          upsertedCount: 0,
          removedCount: 0,
          totalCount: page.total_count,
          lastSyncedAt: syncedAt,
          message: null,
        };
      }

      if (page.full_resync_required && !fullSyncMode) {
        // Server indicated incremental reconciliation exceeds active_ids budget; restart full sync cleanly.
        fullSyncMode = true;
        sinceVersion = null;
        updatedSince = null;
        cursor = null;
        pagesFetched = 0;
        mergedById.clear();
        activeIds = null;
        continue;
      }

      if (page.active_ids !== null && activeIds === null) {
        activeIds = new Set(page.active_ids);
      }

      // Server-authoritative deduplication: later server records overwrite earlier entries for the same ID.
      for (const item of page.items) {
        mergedById.set(item.id, item);
      }

      if (!page.has_more || !page.next_cursor) {
        break;
      }
      cursor = page.next_cursor;
    }

    const dedupedItems = Array.from(mergedById.values());
    const nowMs = now().getTime();
    await upsertCachedActivities(options.namespace, dedupedItems, {
      dataVersion: targetDataVersion,
      now: nowMs,
      backend,
    });

    let removedCount = 0;
    if (fullSyncMode) {
      removedCount = await pruneCachedActivities(options.namespace, new Set(mergedById.keys()), backend);
    } else if (activeIds !== null) {
      removedCount = await pruneCachedActivities(options.namespace, activeIds, backend);
    }

    const finalEntries = await backend.listByPrefix(`${options.namespace}:activity:`);
    const syncedAt = now().toISOString();
    const meta: ActivitySyncMetadata = {
      dataVersion: targetDataVersion,
      lastSyncedAt: syncedAt,
      serverTime,
      totalCount,
      cachedCount: finalEntries.length,
    };
    await saveSyncMetadata(options.namespace, meta, backend);

    return {
      status: 'synced',
      dataVersion: targetDataVersion,
      unchanged: false,
      upsertedCount: dedupedItems.length,
      removedCount,
      totalCount,
      lastSyncedAt: syncedAt,
      message: null,
    };
  } catch (cause) {
    if (cause instanceof ActivityError && cause.status === 401) {
      await clearPrivateOfflineCache(backend);
      return {
        status: 'auth_expired',
        dataVersion: null,
        unchanged: false,
        upsertedCount: 0,
        removedCount: 0,
        totalCount: 0,
        lastSyncedAt: null,
        message: '登录已过期，本地离线缓存已清理。',
      };
    }
    if (!isOnline()) {
      return {
        status: 'offline',
        dataVersion: previousMeta?.dataVersion ?? null,
        unchanged: false,
        upsertedCount: 0,
        removedCount: 0,
        totalCount: previousMeta?.totalCount ?? 0,
        lastSyncedAt: previousMeta?.lastSyncedAt ?? null,
        message: '网络连接已断开，已保留本地缓存，恢复网络后重试。',
      };
    }
    return {
      status: 'error',
      dataVersion: previousMeta?.dataVersion ?? null,
      unchanged: false,
      upsertedCount: 0,
      removedCount: 0,
      totalCount: previousMeta?.totalCount ?? 0,
      lastSyncedAt: previousMeta?.lastSyncedAt ?? null,
      message: cause instanceof Error ? cause.message : '增量同步失败，请稍后重试。',
    };
  }
}

/**
 * Single-flight incremental sync for a given account namespace.
 * Concurrent invocations share the active sync promise to avoid duplicate requests.
 */
export function syncCompanionActivities(options: SyncOptions): Promise<SyncOutcome> {
  const existing = inFlightByNamespace.get(options.namespace);
  if (existing) return existing;
  const run = runSyncOnce(options).finally(() => {
    inFlightByNamespace.delete(options.namespace);
  });
  inFlightByNamespace.set(options.namespace, run);
  return run;
}
