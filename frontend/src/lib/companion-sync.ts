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

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'partial' | 'offline' | 'error' | 'auth_expired';

export interface SyncOutcome {
  status: SyncStatus;
  dataVersion: number | null;
  unchanged: boolean;
  truncated: boolean;
  hasMore: boolean;
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
  if (value.has_more && !value.next_cursor) {
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
  const maxPages = Math.max(1, options.maxPages ?? 50);
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 400;

  const previousMeta = await readSyncMetadata(options.namespace, backend);

  if (!isOnline()) {
    return {
      status: 'offline',
      dataVersion: previousMeta?.dataVersion ?? null,
      unchanged: false,
      truncated: false,
      hasMore: Boolean(previousMeta?.pendingCursor),
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

  const resuming = !options.forceFull && Boolean(previousMeta?.pendingCursor);

  try {
    let fullSyncMode = resuming
      ? previousMeta?.pendingFullSync === true
      : options.forceFull || (previousMeta?.dataVersion ?? null) === null;
    let sinceVersion = resuming || options.forceFull ? null : (previousMeta?.dataVersion ?? null);
    let updatedSince = resuming
      ? fullSyncMode
        ? null
        : (previousMeta?.pendingUpdatedSince ?? null)
      : options.forceFull
        ? null
        : (previousMeta?.serverTime ?? null);
    let cursor: string | null = resuming ? (previousMeta?.pendingCursor ?? null) : null;
    let runStartDataVersion: number | null = resuming ? (previousMeta?.pendingTargetVersion ?? null) : null;
    let pagesFetched = 0;
    let targetDataVersion: number | null = null;
    let serverTime: string | null = null;
    let totalCount = previousMeta?.totalCount ?? 0;
    let activeIds: Set<string> | null =
      resuming && !fullSyncMode && previousMeta?.pendingActiveIds ? new Set(previousMeta.pendingActiveIds) : null;
    const accumulatedFullIds = new Set<string>(
      resuming && fullSyncMode && previousMeta?.pendingFullSyncedIds ? previousMeta.pendingFullSyncedIds : [],
    );
    let truncated = false;
    let nextResumeCursor: string | null = null;
    const mergedById = new Map<string, CachedActivity>();

    for (;;) {
      const page = await fetchWithRetry({
        limit,
        sinceVersion: pagesFetched === 0 && !resuming ? sinceVersion : null,
        updatedSince,
        cursor,
      });
      pagesFetched += 1;
      if (runStartDataVersion === null) {
        runStartDataVersion = page.data_version;
      }
      targetDataVersion = page.data_version;
      serverTime = page.server_time;
      totalCount = page.total_count;

      if (page.unchanged && pagesFetched === 1 && !resuming) {
        const syncedAt = now().toISOString();
        const existingEntries = await backend.listByPrefix(`${options.namespace}:activity:`);
        const updatedMeta: ActivitySyncMetadata = {
          dataVersion: page.data_version,
          lastSyncedAt: syncedAt,
          serverTime: page.server_time,
          totalCount: page.total_count,
          cachedCount: existingEntries.length,
          pendingCursor: null,
          pendingFullSync: false,
          pendingUpdatedSince: null,
          pendingTargetVersion: null,
          pendingFullSyncedIds: null,
          pendingActiveIds: null,
        };
        await saveSyncMetadata(options.namespace, updatedMeta, backend);
        return {
          status: 'synced',
          dataVersion: page.data_version,
          unchanged: true,
          truncated: false,
          hasMore: false,
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
        runStartDataVersion = null;
        mergedById.clear();
        accumulatedFullIds.clear();
        activeIds = null;
        continue;
      }

      if (page.active_ids !== null && activeIds === null) {
        activeIds = new Set(page.active_ids);
      }

      // Server-authoritative deduplication: later server records overwrite earlier entries for the same ID.
      for (const item of page.items) {
        mergedById.set(item.id, item);
        if (fullSyncMode) {
          accumulatedFullIds.add(item.id);
        }
      }

      if (!page.has_more || !page.next_cursor) {
        truncated = false;
        nextResumeCursor = null;
        break;
      }

      if (pagesFetched >= maxPages) {
        truncated = true;
        nextResumeCursor = page.next_cursor;
        break;
      }

      cursor = page.next_cursor;
    }

    const dedupedItems = Array.from(mergedById.values());
    const nowMs = now().getTime();

    if (truncated) {
      // Preserve fetched pages without advancing the completed watermark or pruning unseen tail records.
      await upsertCachedActivities(options.namespace, dedupedItems, {
        dataVersion: previousMeta?.dataVersion ?? null,
        now: nowMs,
        backend,
      });
      const currentEntries = await backend.listByPrefix(`${options.namespace}:activity:`);
      const partialMeta: ActivitySyncMetadata = {
        dataVersion: previousMeta?.dataVersion ?? null,
        lastSyncedAt: previousMeta?.lastSyncedAt ?? null,
        serverTime: previousMeta?.serverTime ?? null,
        totalCount,
        cachedCount: currentEntries.length,
        pendingCursor: nextResumeCursor,
        pendingFullSync: fullSyncMode,
        pendingUpdatedSince: fullSyncMode ? null : updatedSince,
        pendingTargetVersion: runStartDataVersion,
        pendingFullSyncedIds: fullSyncMode ? Array.from(accumulatedFullIds) : null,
        pendingActiveIds: !fullSyncMode && activeIds ? Array.from(activeIds) : null,
      };
      await saveSyncMetadata(options.namespace, partialMeta, backend);
      return {
        status: 'partial',
        dataVersion: previousMeta?.dataVersion ?? null,
        unchanged: false,
        truncated: true,
        hasMore: true,
        upsertedCount: dedupedItems.length,
        removedCount: 0,
        totalCount,
        lastSyncedAt: previousMeta?.lastSyncedAt ?? null,
        message: `已拉取 ${dedupedItems.length} 条记录，仍有剩余页待继续同步。`,
      };
    }

    await upsertCachedActivities(options.namespace, dedupedItems, {
      dataVersion: targetDataVersion,
      now: nowMs,
      backend,
    });

    const versionDriftedDuringResume =
      resuming &&
      runStartDataVersion !== null &&
      targetDataVersion !== null &&
      targetDataVersion !== runStartDataVersion;

    let removedCount = 0;
    if (fullSyncMode && !versionDriftedDuringResume) {
      removedCount = await pruneCachedActivities(options.namespace, accumulatedFullIds, backend);
    } else if (!fullSyncMode && activeIds !== null && !versionDriftedDuringResume) {
      removedCount = await pruneCachedActivities(options.namespace, activeIds, backend);
    }

    const completedDataVersion = versionDriftedDuringResume ? runStartDataVersion : targetDataVersion;
    const finalEntries = await backend.listByPrefix(`${options.namespace}:activity:`);
    const syncedAt = now().toISOString();
    const meta: ActivitySyncMetadata = {
      dataVersion: completedDataVersion,
      lastSyncedAt: syncedAt,
      serverTime,
      totalCount,
      cachedCount: finalEntries.length,
      pendingCursor: null,
      pendingFullSync: false,
      pendingUpdatedSince: null,
      pendingTargetVersion: null,
      pendingFullSyncedIds: null,
      pendingActiveIds: null,
    };
    await saveSyncMetadata(options.namespace, meta, backend);

    return {
      status: 'synced',
      dataVersion: completedDataVersion,
      unchanged: false,
      truncated: false,
      hasMore: false,
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
        truncated: false,
        hasMore: false,
        upsertedCount: 0,
        removedCount: 0,
        totalCount: 0,
        lastSyncedAt: null,
        message: '登录已过期，本地离线缓存已清理。',
      };
    }
    if (cause instanceof ActivityError && cause.status === 422 && resuming && previousMeta) {
      // Drop an expired/malformed resumption cursor while keeping the last completed watermark intact.
      await saveSyncMetadata(
        options.namespace,
        {
          ...previousMeta,
          pendingCursor: null,
          pendingFullSync: false,
          pendingUpdatedSince: null,
          pendingTargetVersion: null,
          pendingFullSyncedIds: null,
          pendingActiveIds: null,
        },
        backend,
      );
    }
    if (!isOnline()) {
      return {
        status: 'offline',
        dataVersion: previousMeta?.dataVersion ?? null,
        unchanged: false,
        truncated: false,
        hasMore: Boolean(previousMeta?.pendingCursor),
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
      truncated: false,
      hasMore: Boolean(previousMeta?.pendingCursor),
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
