import { parseActivity, type Activity, type ActivityList } from '#lib/api/activities.ts';
import { parseSummary, type Calendar, type CalendarMetric, type Summary, type Trends } from '#lib/api/statistics.ts';
import type { FootprintSnapshot, Selection } from '#lib/api/footprints.ts';

/**
 * Companion Offline Cache (IndexedDB with automatic corruption recovery & in-memory fallback).
 *
 * Security & privacy invariants:
 * - Strictly namespaced by account (`user:<userId>:...` or `public:<scope>:...`).
 * - Switching accounts, logging out, or receiving 401 wipes ALL `user:*` entries immediately.
 * - Never stores session cookies, CSRF tokens, passwords, or private wellbeing diary records.
 * - Footprint cache stores lightweight metadata only (no multi-MB GeoJSON tracks or basemap tiles).
 */
export const OFFLINE_CACHE_DB_NAME = 'runnote-companion-cache';
export const OFFLINE_CACHE_SCHEMA_VERSION = 1;
const STORE_NAME = 'entries';
const ACTIVE_ACCOUNT_KEY = 'meta:active_account';

export const DEFAULT_SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_FOOTPRINT_META_TTL_MS = 24 * 60 * 60 * 1000;

const FORBIDDEN_KEYS = new Set([
  'token',
  'csrf_token',
  'access_token',
  'refresh_token',
  'id_token',
  'session_token',
  'authorization',
  'cookie',
  'password',
  'password_hash',
  'secret',
  'medication_name',
  'medications',
  'symptom',
  'symptoms',
  'mood',
  'anxiety',
]);

export interface CacheEnvelope<T = unknown> {
  key: string;
  namespace: string;
  schemaVersion: number;
  savedAt: number;
  expiresAt: number;
  dataVersion: number | null;
  payload: T;
}

export interface FootprintMetaSnapshot {
  status: FootprintSnapshot['status'];
  mode: Selection['mode'];
  generated_at: string | null;
  refreshing: boolean;
  refresh_failed: boolean;
  activity_count: number;
  visible_activity_count: number;
  unsupported_segment_count: number;
  max_count: number;
  grid_size_m: number;
  grid_crs: string;
  count_basis: string;
}

export interface ActivitySyncMetadata {
  dataVersion: number | null;
  lastSyncedAt: string | null;
  serverTime: string | null;
  totalCount: number;
  cachedCount: number;
  /** Resumption cursor saved when a sync run hits maxPages before exhausting server pages. */
  pendingCursor?: string | null;
  /** True when the interrupted sync is a full resync (resuming without updated_since). */
  pendingFullSync?: boolean;
  /** The updated_since filter used by an interrupted incremental sync, if any. */
  pendingUpdatedSince?: string | null;
  /** Target data_version observed when an interrupted sync began (guards against mid-sync drift). */
  pendingTargetVersion?: number | null;
  /** Activity IDs accumulated across pages of an interrupted full sync so pruning runs only on completion. */
  pendingFullSyncedIds?: string[] | null;
  /** Active IDs received on page 1 of an interrupted incremental sync, applied only on completion. */
  pendingActiveIds?: string[] | null;
}

export interface CacheStorageBackend {
  get(key: string): Promise<CacheEnvelope | null>;
  put(entry: CacheEnvelope): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  listByPrefix(prefix: string): Promise<CacheEnvelope[]>;
  clearAll(): Promise<void>;
}

/**
 * Recursively asserts that a payload never contains auth tokens, cookies, passwords,
 * or private wellbeing fields before persistence.
 */
export function assertSafeCachePayload(value: unknown, depth = 0): void {
  if (depth > 16 || value === null || value === undefined || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeCachePayload(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`Refusing to cache sensitive field: ${key}`);
    }
    assertSafeCachePayload(nested, depth + 1);
  }
}

export function buildCacheNamespace(userId: string | null | undefined, viewScope: string): string {
  const cleanScope = viewScope.replace(/[^a-zA-Z0-9:_-]/g, '_') || 'root';
  if (userId && userId.trim()) {
    return `user:${userId.trim()}:${cleanScope}`;
  }
  return `public:${cleanScope}`;
}

export function createMemoryCacheBackend(): CacheStorageBackend {
  const map = new Map<string, CacheEnvelope>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(entry) {
      map.set(entry.key, structuredClone(entry));
    },
    async delete(key) {
      map.delete(key);
    },
    async deleteByPrefix(prefix) {
      let removed = 0;
      for (const key of Array.from(map.keys())) {
        if (key.startsWith(prefix)) {
          map.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async listByPrefix(prefix) {
      const result: CacheEnvelope[] = [];
      for (const [key, entry] of map.entries()) {
        if (key.startsWith(prefix)) result.push(structuredClone(entry));
      }
      return result;
    },
    async clearAll() {
      map.clear();
    },
  };
}

function openIndexedDb(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName, OFFLINE_CACHE_SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function deleteIndexedDb(idb: IDBFactory, dbName: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = idb.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function createIndexedDbCacheBackend(
  dbName = OFFLINE_CACHE_DB_NAME,
  idbFactory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): CacheStorageBackend {
  if (!idbFactory) {
    return createMemoryCacheBackend();
  }
  const fallback = createMemoryCacheBackend();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let useFallback = false;

  const getDb = async (): Promise<IDBDatabase | null> => {
    if (useFallback) return null;
    if (!dbPromise) {
      dbPromise = openIndexedDb(idbFactory, dbName).catch(async () => {
        // Attempt one clean database rebuild on corruption / version mismatch before degrading.
        await deleteIndexedDb(idbFactory, dbName);
        try {
          return await openIndexedDb(idbFactory, dbName);
        } catch {
          useFallback = true;
          return null;
        }
      });
    }
    const db = await dbPromise;
    if (!db) useFallback = true;
    return db;
  };

  const runTx = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
    onFallback: () => Promise<T>,
  ): Promise<T> => {
    const db = await getDb();
    if (!db) return onFallback();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      return await work(store);
    } catch {
      dbPromise = null;
      await deleteIndexedDb(idbFactory, dbName);
      return onFallback();
    }
  };

  const reqToPromise = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });

  return {
    async get(key) {
      return runTx(
        'readonly',
        async (store) => {
          const value = await reqToPromise(store.get(key));
          return (value as CacheEnvelope | undefined) ?? null;
        },
        () => fallback.get(key),
      );
    },
    async put(entry) {
      return runTx(
        'readwrite',
        async (store) => {
          await reqToPromise(store.put(entry));
        },
        () => fallback.put(entry),
      );
    },
    async delete(key) {
      return runTx(
        'readwrite',
        async (store) => {
          await reqToPromise(store.delete(key));
        },
        () => fallback.delete(key),
      );
    },
    async deleteByPrefix(prefix) {
      return runTx(
        'readwrite',
        async (store) => {
          const keys = (await reqToPromise(store.getAllKeys())) as string[];
          let removed = 0;
          for (const key of keys) {
            if (typeof key === 'string' && key.startsWith(prefix)) {
              await reqToPromise(store.delete(key));
              removed += 1;
            }
          }
          return removed;
        },
        () => fallback.deleteByPrefix(prefix),
      );
    },
    async listByPrefix(prefix) {
      return runTx(
        'readonly',
        async (store) => {
          const all = (await reqToPromise(store.getAll())) as CacheEnvelope[];
          return all.filter((item) => item && typeof item.key === 'string' && item.key.startsWith(prefix));
        },
        () => fallback.listByPrefix(prefix),
      );
    },
    async clearAll() {
      return runTx(
        'readwrite',
        async (store) => {
          await reqToPromise(store.clear());
        },
        () => fallback.clearAll(),
      );
    },
  };
}

let activeBackend: CacheStorageBackend | null = null;

export function getOfflineCacheBackend(): CacheStorageBackend {
  if (!activeBackend) {
    activeBackend = createIndexedDbCacheBackend();
  }
  return activeBackend;
}

export function setOfflineCacheBackendForTests(backend: CacheStorageBackend | null): void {
  activeBackend = backend;
}

export interface CacheReadResult<T> {
  value: T;
  savedAt: number;
  dataVersion: number | null;
}

function isValidEnvelope(entry: unknown, expectedNamespace: string, now: number): entry is CacheEnvelope {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  return (
    e.schemaVersion === OFFLINE_CACHE_SCHEMA_VERSION &&
    e.namespace === expectedNamespace &&
    typeof e.key === 'string' &&
    typeof e.savedAt === 'number' &&
    Number.isFinite(e.savedAt) &&
    typeof e.expiresAt === 'number' &&
    Number.isFinite(e.expiresAt) &&
    e.expiresAt >= now
  );
}

export async function writeCacheEntry<T>(
  namespace: string,
  slot: string,
  payload: T,
  options: { ttlMs?: number; dataVersion?: number | null; now?: number; backend?: CacheStorageBackend } = {},
): Promise<void> {
  assertSafeCachePayload(payload);
  const backend = options.backend ?? getOfflineCacheBackend();
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_SUMMARY_TTL_MS;
  const key = `${namespace}:${slot}`;
  await backend.put({
    key,
    namespace,
    schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
    savedAt: now,
    expiresAt: now + ttlMs,
    dataVersion: options.dataVersion ?? null,
    payload,
  });
}

export async function readCacheEntry<T>(
  namespace: string,
  slot: string,
  validate: (raw: unknown) => T,
  options: { now?: number; backend?: CacheStorageBackend } = {},
): Promise<CacheReadResult<T> | null> {
  const backend = options.backend ?? getOfflineCacheBackend();
  const now = options.now ?? Date.now();
  const key = `${namespace}:${slot}`;
  const entry = await backend.get(key);
  if (!entry) return null;
  if (!isValidEnvelope(entry, namespace, now)) {
    await backend.delete(key);
    return null;
  }
  try {
    const validated = validate(entry.payload);
    return {
      value: validated,
      savedAt: entry.savedAt,
      dataVersion: typeof entry.dataVersion === 'number' ? entry.dataVersion : null,
    };
  } catch {
    // Corrupted cached payload: self-heal by deleting the bad entry and returning cache miss.
    await backend.delete(key);
    return null;
  }
}

/**
 * Ensures cached private data can never bleed across account switches or logouts.
 * Whenever the signed-in user changes (or signs out), all `user:*` entries are purged.
 */
export async function ensureAccountCacheIsolation(
  currentUserId: string | null | undefined,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<{ cleared: boolean }> {
  const normalized = currentUserId && currentUserId.trim() ? currentUserId.trim() : null;
  const marker = await backend.get(ACTIVE_ACCOUNT_KEY);
  const previousUserId =
    marker && typeof marker.payload === 'string' && marker.payload.trim() ? marker.payload.trim() : null;

  if (previousUserId && previousUserId !== normalized) {
    await backend.deleteByPrefix('user:');
    if (normalized) {
      await backend.put({
        key: ACTIVE_ACCOUNT_KEY,
        namespace: 'meta',
        schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
        savedAt: Date.now(),
        expiresAt: Number.MAX_SAFE_INTEGER,
        dataVersion: null,
        payload: normalized,
      });
    } else {
      await backend.delete(ACTIVE_ACCOUNT_KEY);
    }
    return { cleared: true };
  }

  if (!previousUserId && normalized) {
    await backend.put({
      key: ACTIVE_ACCOUNT_KEY,
      namespace: 'meta',
      schemaVersion: OFFLINE_CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
      dataVersion: null,
      payload: normalized,
    });
  }
  return { cleared: false };
}

/**
 * Purges all private signed-in account caches (called on logout, 401, password change, or user action).
 */
export async function clearPrivateOfflineCache(
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<number> {
  const removed = await backend.deleteByPrefix('user:');
  await backend.delete(ACTIVE_ACCOUNT_KEY);
  return removed;
}

export async function clearNamespaceOfflineCache(
  namespace: string,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<number> {
  return backend.deleteByPrefix(`${namespace}:`);
}

// --- Domain helpers: Dashboard summary / calendar / trends ---

export async function saveSummaryCache(
  namespace: string,
  year: number | 'all',
  summary: Summary,
  backend?: CacheStorageBackend,
): Promise<void> {
  await writeCacheEntry(namespace, `summary:${year}`, summary, {
    ttlMs: DEFAULT_SUMMARY_TTL_MS,
    backend,
  });
}

export async function readSummaryCache(
  namespace: string,
  year: number | 'all',
  backend?: CacheStorageBackend,
): Promise<CacheReadResult<Summary> | null> {
  return readCacheEntry(namespace, `summary:${year}`, parseSummary, { backend });
}

export async function saveCalendarCache(
  namespace: string,
  year: number,
  metric: CalendarMetric,
  calendar: Calendar,
  backend?: CacheStorageBackend,
): Promise<void> {
  await writeCacheEntry(namespace, `calendar:${year}:${metric}`, calendar, {
    ttlMs: DEFAULT_SUMMARY_TTL_MS,
    backend,
  });
}

export async function readCalendarCache(
  namespace: string,
  year: number,
  metric: CalendarMetric,
  backend?: CacheStorageBackend,
): Promise<CacheReadResult<Calendar> | null> {
  return readCacheEntry(
    namespace,
    `calendar:${year}:${metric}`,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid calendar');
      const v = raw as Record<string, unknown>;
      if (v.year !== year || v.metric !== metric || !Array.isArray(v.days)) throw new Error('invalid calendar');
      return raw as Calendar;
    },
    { backend },
  );
}

export async function saveTrendsCache(
  namespace: string,
  year: number,
  period: Trends['period'],
  trends: Trends,
  backend?: CacheStorageBackend,
): Promise<void> {
  await writeCacheEntry(namespace, `trends:${year}:${period}`, trends, {
    ttlMs: DEFAULT_SUMMARY_TTL_MS,
    backend,
  });
}

export async function readTrendsCache(
  namespace: string,
  year: number,
  period: Trends['period'],
  backend?: CacheStorageBackend,
): Promise<CacheReadResult<Trends> | null> {
  return readCacheEntry(
    namespace,
    `trends:${year}:${period}`,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid trends');
      const v = raw as Record<string, unknown>;
      if (v.period !== period || !Array.isArray(v.buckets)) throw new Error('invalid trends');
      return raw as Trends;
    },
    { backend },
  );
}

// --- Domain helpers: Activities (synced index + detail + paginated offline read) ---

export type CachedActivity = Activity & { updated_at?: string };

function compareActivitiesDesc(a: CachedActivity, b: CachedActivity): number {
  if (a.activity_date !== b.activity_date) {
    return a.activity_date > b.activity_date ? -1 : 1;
  }
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

export async function upsertCachedActivities(
  namespace: string,
  items: readonly CachedActivity[],
  options: { dataVersion?: number | null; now?: number; backend?: CacheStorageBackend } = {},
): Promise<void> {
  const backend = options.backend ?? getOfflineCacheBackend();
  for (const item of items) {
    const validated = parseActivity(item) as CachedActivity;
    if (typeof item.updated_at === 'string') {
      validated.updated_at = item.updated_at;
    }
    await writeCacheEntry(namespace, `activity:${validated.id}`, validated, {
      ttlMs: DEFAULT_ACTIVITY_TTL_MS,
      dataVersion: options.dataVersion ?? null,
      now: options.now,
      backend,
    });
  }
}

export async function pruneCachedActivities(
  namespace: string,
  activeIds: ReadonlySet<string>,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<number> {
  const prefix = `${namespace}:activity:`;
  const existing = await backend.listByPrefix(prefix);
  let removed = 0;
  for (const entry of existing) {
    const id = entry.key.slice(prefix.length);
    if (!activeIds.has(id)) {
      await backend.delete(entry.key);
      removed += 1;
    }
  }
  return removed;
}

export async function readCachedActivity(
  namespace: string,
  id: string,
  options: { now?: number; backend?: CacheStorageBackend } = {},
): Promise<CacheReadResult<CachedActivity> | null> {
  return readCacheEntry(
    namespace,
    `activity:${id}`,
    (raw) => {
      const parsed = parseActivity(raw) as CachedActivity;
      if (raw && typeof raw === 'object' && 'updated_at' in raw && typeof raw.updated_at === 'string') {
        parsed.updated_at = raw.updated_at;
      }
      return parsed;
    },
    options,
  );
}

export async function readCachedActivityPage(
  namespace: string,
  offset = 0,
  limit = 20,
  options: { now?: number; backend?: CacheStorageBackend } = {},
): Promise<{ list: ActivityList; savedAt: number } | null> {
  const backend = options.backend ?? getOfflineCacheBackend();
  const now = options.now ?? Date.now();
  const prefix = `${namespace}:activity:`;
  const entries = await backend.listByPrefix(prefix);
  const validItems: CachedActivity[] = [];
  let latestSavedAt = 0;

  for (const entry of entries) {
    const entryKey = entry.key;
    if (!isValidEnvelope(entry, namespace, now)) {
      await backend.delete(entryKey);
      continue;
    }
    try {
      const parsed = parseActivity(entry.payload) as CachedActivity;
      validItems.push(parsed);
      if (entry.savedAt > latestSavedAt) latestSavedAt = entry.savedAt;
    } catch {
      await backend.delete(entryKey);
    }
  }

  const syncMeta = await readSyncMetadata(namespace, backend);
  if (validItems.length === 0 && !syncMeta?.lastSyncedAt) {
    return null;
  }

  validItems.sort(compareActivitiesDesc);
  const total = Math.max(validItems.length, syncMeta?.totalCount ?? 0);
  const slice = validItems.slice(offset, offset + limit);
  return {
    list: { items: slice, total, limit, offset },
    savedAt: latestSavedAt || (syncMeta?.lastSyncedAt ? Date.parse(syncMeta.lastSyncedAt) : now),
  };
}

export async function saveSyncMetadata(
  namespace: string,
  meta: ActivitySyncMetadata,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<void> {
  await writeCacheEntry(namespace, 'sync:meta', meta, {
    ttlMs: DEFAULT_ACTIVITY_TTL_MS,
    dataVersion: meta.dataVersion,
    backend,
  });
}

export async function readSyncMetadata(
  namespace: string,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<ActivitySyncMetadata | null> {
  const entry = await readCacheEntry(
    namespace,
    'sync:meta',
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid sync meta');
      const v = raw as Record<string, unknown>;
      const parseStringArray = (field: unknown): string[] | null =>
        Array.isArray(field) && field.every((item) => typeof item === 'string') ? (field as string[]) : null;
      return {
        dataVersion: typeof v.dataVersion === 'number' && Number.isSafeInteger(v.dataVersion) ? v.dataVersion : null,
        lastSyncedAt: typeof v.lastSyncedAt === 'string' ? v.lastSyncedAt : null,
        serverTime: typeof v.serverTime === 'string' ? v.serverTime : null,
        totalCount: typeof v.totalCount === 'number' && Number.isSafeInteger(v.totalCount) ? v.totalCount : 0,
        cachedCount: typeof v.cachedCount === 'number' && Number.isSafeInteger(v.cachedCount) ? v.cachedCount : 0,
        pendingCursor: typeof v.pendingCursor === 'string' && v.pendingCursor ? v.pendingCursor : null,
        pendingFullSync: v.pendingFullSync === true,
        pendingUpdatedSince:
          typeof v.pendingUpdatedSince === 'string' && v.pendingUpdatedSince ? v.pendingUpdatedSince : null,
        pendingTargetVersion:
          typeof v.pendingTargetVersion === 'number' && Number.isSafeInteger(v.pendingTargetVersion)
            ? v.pendingTargetVersion
            : null,
        pendingFullSyncedIds: parseStringArray(v.pendingFullSyncedIds),
        pendingActiveIds: parseStringArray(v.pendingActiveIds),
      };
    },
    { backend },
  );
  return entry?.value ?? null;
}

// --- Domain helpers: Footprint lightweight metadata (no heavy GeoJSON or basemap tiles) ---

export function extractFootprintMetadata(
  mode: Selection['mode'],
  snapshot: FootprintSnapshot,
): FootprintMetaSnapshot | null {
  if (!snapshot.result) return null;
  return {
    status: snapshot.status,
    mode,
    generated_at: snapshot.generated_at,
    refreshing: snapshot.refreshing,
    refresh_failed: snapshot.refresh_failed,
    activity_count: snapshot.result.activity_count,
    visible_activity_count: snapshot.result.visible_activity_count,
    unsupported_segment_count: snapshot.result.unsupported_segment_count,
    max_count: snapshot.result.max_count,
    grid_size_m: snapshot.result.grid_size_m,
    grid_crs: snapshot.result.grid_crs,
    count_basis: snapshot.result.count_basis,
  };
}

export async function saveFootprintMetaCache(
  namespace: string,
  mode: Selection['mode'],
  meta: FootprintMetaSnapshot,
  backend?: CacheStorageBackend,
): Promise<void> {
  await writeCacheEntry(namespace, `footprint-meta:${mode}`, meta, {
    ttlMs: DEFAULT_FOOTPRINT_META_TTL_MS,
    backend,
  });
}

export async function readFootprintMetaCache(
  namespace: string,
  mode: Selection['mode'],
  backend?: CacheStorageBackend,
): Promise<CacheReadResult<FootprintMetaSnapshot> | null> {
  return readCacheEntry(
    namespace,
    `footprint-meta:${mode}`,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid footprint meta');
      const v = raw as Record<string, unknown>;
      if (
        (v.mode !== 'tracks' && v.mode !== 'heatmap') ||
        !Number.isInteger(v.activity_count) ||
        !Number.isInteger(v.visible_activity_count) ||
        !Number.isInteger(v.unsupported_segment_count) ||
        !Number.isInteger(v.max_count) ||
        typeof v.grid_size_m !== 'number' ||
        typeof v.grid_crs !== 'string' ||
        typeof v.count_basis !== 'string'
      ) {
        throw new Error('invalid footprint meta');
      }
      return raw as FootprintMetaSnapshot;
    },
    { backend },
  );
}

export async function inspectNamespaceCacheStats(
  namespace: string,
  backend: CacheStorageBackend = getOfflineCacheBackend(),
): Promise<{
  cachedActivities: number;
  hasSummary: boolean;
  hasFootprintMeta: boolean;
  syncMeta: ActivitySyncMetadata | null;
}> {
  const entries = await backend.listByPrefix(`${namespace}:`);
  let cachedActivities = 0;
  let hasSummary = false;
  let hasFootprintMeta = false;
  for (const entry of entries) {
    const suffix = entry.key.slice(namespace.length + 1);
    if (suffix.startsWith('activity:')) cachedActivities += 1;
    else if (suffix.startsWith('summary:')) hasSummary = true;
    else if (suffix.startsWith('footprint-meta:')) hasFootprintMeta = true;
  }
  const syncMeta = await readSyncMetadata(namespace, backend);
  return { cachedActivities, hasSummary, hasFootprintMeta, syncMeta };
}
