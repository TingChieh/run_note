import { assertSafeCachePayload } from '#lib/offline-cache.ts';
import type { RecordedTrackPoint } from '#lib/gpx-serializer.ts';

/**
 * Account-isolated local persistence for Phase 3 active recording drafts and offline upload queue.
 *
 * Security & privacy invariants:
 * - Strictly namespaced by `user:<userId>:...`.
 * - Switching accounts or logging out wipes ALL recording drafts & upload queue entries so tracks
 *   never leak across accounts or get uploaded under the wrong user.
 * - Never persists session cookies, CSRF tokens, passwords, or private wellbeing fields.
 */

export const RECORDING_STORE_DB_NAME = 'runnote-recording-store';
export const RECORDING_STORE_SCHEMA_VERSION = 1;
const STORE_NAME = 'records';
const ACTIVE_ACCOUNT_KEY = 'meta:recording_active_account';

export type RecordingLifecycleStatus = 'idle' | 'recording' | 'paused' | 'interrupted' | 'stopped';

export interface LocalRecordingDraft {
  sessionId: string;
  accountId: string;
  idempotencyKey: string;
  title: string;
  status: RecordingLifecycleStatus;
  startedAtMs: number;
  endedAtMs: number | null;
  activeDurationMs: number;
  lastSegmentStartMs: number | null;
  segmentIndex: number;
  previewDistanceM: number;
  lastPointTimeMs: number | null;
  lastAccuracyM: number | null;
  interruptedReason: string | null;
  points: RecordedTrackPoint[];
}

export type UploadItemStatus = 'pending' | 'uploading' | 'failed' | 'uploaded';

export interface UploadQueueItem {
  idempotencyKey: string;
  accountId: string;
  sessionId: string;
  title: string;
  timezone: string;
  startedAtMs: number;
  endedAtMs: number;
  pointCount: number;
  segmentCount: number;
  previewDistanceM: number;
  activeDurationMs: number;
  gpxXml: string;
  status: UploadItemStatus;
  attemptCount: number;
  nextRetryAt: number | null;
  lastError: string | null;
  permanentError: boolean;
  uploadedActivityId: string | null;
  serverDistanceM: string | null;
  serverDurationS: string | null;
  serverPaceSPerKm: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

interface StoredRecord<T = unknown> {
  key: string;
  accountId: string | null;
  schemaVersion: number;
  savedAt: number;
  payload: T;
}

export interface RecordingStorageBackend {
  get(key: string): Promise<StoredRecord | null>;
  put(entry: StoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<StoredRecord[]>;
  deleteByPrefix(prefix: string): Promise<number>;
  clearAll(): Promise<void>;
}

export function createMemoryRecordingBackend(): RecordingStorageBackend {
  const map = new Map<string, StoredRecord>();
  return {
    async get(key) {
      const hit = map.get(key);
      return hit ? structuredClone(hit) : null;
    },
    async put(entry) {
      map.set(entry.key, structuredClone(entry));
    },
    async delete(key) {
      map.delete(key);
    },
    async listByPrefix(prefix) {
      const out: StoredRecord[] = [];
      for (const [key, value] of map.entries()) {
        if (key.startsWith(prefix)) out.push(structuredClone(value));
      }
      return out;
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
    async clearAll() {
      map.clear();
    },
  };
}

function openDb(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName, RECORDING_STORE_SCHEMA_VERSION);
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

function deleteDb(idb: IDBFactory, dbName: string): Promise<void> {
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

export function createIndexedDbRecordingBackend(
  dbName = RECORDING_STORE_DB_NAME,
  idbFactory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): RecordingStorageBackend {
  if (!idbFactory) return createMemoryRecordingBackend();
  const fallback = createMemoryRecordingBackend();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let degraded = false;

  const getDb = async (): Promise<IDBDatabase | null> => {
    if (degraded) return null;
    if (!dbPromise) {
      dbPromise = openDb(idbFactory, dbName).catch(async () => {
        await deleteDb(idbFactory, dbName);
        try {
          return await openDb(idbFactory, dbName);
        } catch {
          degraded = true;
          return null;
        }
      });
    }
    const db = await dbPromise;
    if (!db) degraded = true;
    return db;
  };

  const reqPromise = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
    });

  const runTx = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
    onFallback: () => Promise<T>,
  ): Promise<T> => {
    const db = await getDb();
    if (!db) return onFallback();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      return await work(tx.objectStore(STORE_NAME));
    } catch {
      dbPromise = null;
      await deleteDb(idbFactory, dbName);
      return onFallback();
    }
  };

  return {
    async get(key) {
      return runTx(
        'readonly',
        async (store) => ((await reqPromise(store.get(key))) as StoredRecord | undefined) ?? null,
        () => fallback.get(key),
      );
    },
    async put(entry) {
      return runTx(
        'readwrite',
        async (store) => {
          await reqPromise(store.put(entry));
        },
        () => fallback.put(entry),
      );
    },
    async delete(key) {
      return runTx(
        'readwrite',
        async (store) => {
          await reqPromise(store.delete(key));
        },
        () => fallback.delete(key),
      );
    },
    async listByPrefix(prefix) {
      return runTx(
        'readonly',
        async (store) => {
          const all = (await reqPromise(store.getAll())) as StoredRecord[];
          return all.filter((entry) => typeof entry?.key === 'string' && entry.key.startsWith(prefix));
        },
        () => fallback.listByPrefix(prefix),
      );
    },
    async deleteByPrefix(prefix) {
      return runTx(
        'readwrite',
        async (store) => {
          const all = (await reqPromise(store.getAll())) as StoredRecord[];
          let removed = 0;
          for (const entry of all) {
            if (typeof entry?.key === 'string' && entry.key.startsWith(prefix)) {
              await reqPromise(store.delete(entry.key));
              removed += 1;
            }
          }
          return removed;
        },
        () => fallback.deleteByPrefix(prefix),
      );
    },
    async clearAll() {
      return runTx(
        'readwrite',
        async (store) => {
          await reqPromise(store.clear());
        },
        () => fallback.clearAll(),
      );
    },
  };
}

let defaultBackend: RecordingStorageBackend | null = null;

export function getDefaultRecordingBackend(): RecordingStorageBackend {
  if (!defaultBackend) {
    defaultBackend = createIndexedDbRecordingBackend();
  }
  return defaultBackend;
}

export function setDefaultRecordingBackendForTests(backend: RecordingStorageBackend | null): void {
  defaultBackend = backend;
}

const activeDraftKey = (accountId: string) => `user:${accountId}:draft:active`;
const uploadKey = (accountId: string, idempotencyKey: string) => `user:${accountId}:upload:${idempotencyKey}`;
const uploadPrefix = (accountId: string) => `user:${accountId}:upload:`;

export async function ensureRecordingAccountIsolation(
  currentAccountId: string | null,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<boolean> {
  const existing = await backend.get(ACTIVE_ACCOUNT_KEY);
  const previousAccountId =
    existing && typeof existing.payload === 'string' && existing.payload.trim() ? existing.payload : null;

  if (!currentAccountId) {
    if (previousAccountId !== null) {
      await clearPrivateRecordingData(backend);
      return true;
    }
    return false;
  }

  let wiped = false;
  if (previousAccountId && previousAccountId !== currentAccountId) {
    await backend.deleteByPrefix('user:');
    wiped = true;
  }
  await backend.put({
    key: ACTIVE_ACCOUNT_KEY,
    accountId: currentAccountId,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    payload: currentAccountId,
  });
  return wiped;
}

export async function clearPrivateRecordingData(
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  await backend.deleteByPrefix('user:');
  await backend.delete(ACTIVE_ACCOUNT_KEY);
}

export async function saveActiveRecordingDraft(
  draft: LocalRecordingDraft,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  assertSafeCachePayload(draft);
  await backend.put({
    key: activeDraftKey(draft.accountId),
    accountId: draft.accountId,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    payload: draft,
  });
}

export async function readActiveRecordingDraft(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<LocalRecordingDraft | null> {
  const entry = await backend.get(activeDraftKey(accountId));
  if (!entry || entry.schemaVersion !== RECORDING_STORE_SCHEMA_VERSION || entry.accountId !== accountId) {
    return null;
  }
  const payload = entry.payload as Partial<LocalRecordingDraft> | null;
  if (
    !payload ||
    typeof payload.sessionId !== 'string' ||
    typeof payload.idempotencyKey !== 'string' ||
    !Array.isArray(payload.points)
  ) {
    await backend.delete(activeDraftKey(accountId));
    return null;
  }
  return payload as LocalRecordingDraft;
}

export async function deleteActiveRecordingDraft(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  await backend.delete(activeDraftKey(accountId));
}

export async function putUploadQueueItem(
  item: UploadQueueItem,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  assertSafeCachePayload(item);
  await backend.put({
    key: uploadKey(item.accountId, item.idempotencyKey),
    accountId: item.accountId,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    payload: item,
  });
}

export async function listUploadQueueItems(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<UploadQueueItem[]> {
  const entries = await backend.listByPrefix(uploadPrefix(accountId));
  const items: UploadQueueItem[] = [];
  for (const entry of entries) {
    if (entry.schemaVersion !== RECORDING_STORE_SCHEMA_VERSION || entry.accountId !== accountId) {
      await backend.delete(entry.key);
      continue;
    }
    const item = entry.payload as Partial<UploadQueueItem> | null;
    if (!item || typeof item.idempotencyKey !== 'string' || typeof item.status !== 'string') {
      await backend.delete(entry.key);
      continue;
    }
    items.push(item as UploadQueueItem);
  }
  return items.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function deleteUploadQueueItem(
  accountId: string,
  idempotencyKey: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  await backend.delete(uploadKey(accountId, idempotencyKey));
}
