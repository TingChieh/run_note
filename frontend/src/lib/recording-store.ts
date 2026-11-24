import { assertSafeCachePayload } from '#lib/offline-cache.ts';
import type { RecordedTrackPoint } from '#lib/gpx-serializer.ts';

/**
 * Account-isolated local persistence for Phase 3 active recording drafts and offline upload queue.
 *
 * Durability & security invariants:
 * - Strictly namespaced by `user:<userId>:...`.
 * - IndexedDB writes resolve ONLY after the underlying `IDBTransaction` emits `complete`;
 *   `abort` and `error` events always reject and never silently fall back to non-durable memory.
 * - Account-mismatch and stale-tab cleanup is strictly scoped to the stale account's own
 *   `user:<staleId>:*` prefix and guarded by `ACTIVE_ACCOUNT_KEY` so another newly signed-in
 *   account's drafts or upload queue are never wiped.
 * - Never persists session cookies, CSRF tokens, passwords, or private wellbeing fields.
 */

export const RECORDING_STORE_DB_NAME = 'runnote-recording-store';
export const RECORDING_STORE_SCHEMA_VERSION = 1;
const STORE_NAME = 'records';
const ACTIVE_ACCOUNT_KEY = 'meta:recording_active_account';

export type RecordingLifecycleStatus = 'idle' | 'recording' | 'paused' | 'interrupted' | 'stopped';

export type RecordingPersistenceErrorCode =
  'STORAGE_UNAVAILABLE' | 'STORAGE_TX_ABORTED' | 'STORAGE_TX_ERROR' | 'STORAGE_VERIFY_FAILED';

export class RecordingPersistenceError extends Error {
  readonly code: RecordingPersistenceErrorCode;

  constructor(code: RecordingPersistenceErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'RecordingPersistenceError';
    this.code = code;
  }
}

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
  /** True only when writes are durably persisted across process restarts (committed IndexedDB). */
  readonly durable: boolean;
  get(key: string): Promise<StoredRecord | null>;
  put(entry: StoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<StoredRecord[]>;
  deleteByPrefix(prefix: string): Promise<number>;
  clearAccountAtomic?(accountId: string, activeKey: string, prefix: string): Promise<number>;
  clearAll(): Promise<void>;
}

export function createMemoryRecordingBackend(options?: { durableForTests?: boolean }): RecordingStorageBackend {
  const map = new Map<string, StoredRecord>();
  return {
    durable: options?.durableForTests === true,
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
    async clearAccountAtomic(accountId, activeKey, prefix) {
      let removed = 0;
      for (const key of Array.from(map.keys())) {
        if (key.startsWith(prefix)) {
          map.delete(key);
          removed += 1;
        }
      }
      const active = map.get(activeKey);
      if (active && typeof active.payload === 'string' && active.payload.trim() === accountId) {
        map.delete(activeKey);
      }
      return removed;
    },
    async clearAll() {
      map.clear();
    },
  };
}

function createUnavailableRecordingBackend(): RecordingStorageBackend {
  const unavailable = () =>
    new RecordingPersistenceError(
      'STORAGE_UNAVAILABLE',
      '当前设备本地持久化存储不可用，已保留原生轨迹数据，请检查存储空间或浏览器权限后重试。',
    );
  return {
    durable: false,
    async get() {
      return null;
    },
    async put() {
      throw unavailable();
    },
    async delete() {
      return;
    },
    async listByPrefix() {
      return [];
    },
    async deleteByPrefix() {
      return 0;
    },
    async clearAll() {
      return;
    },
  };
}

function attachListener(target: EventTarget | Record<string, unknown>, event: string, handler: () => void): void {
  if (typeof (target as EventTarget).addEventListener === 'function') {
    (target as EventTarget).addEventListener(event, handler, { once: true });
    return;
  }
  const prop = `on${event}`;
  const prev = (target as Record<string, unknown>)[prop];
  (target as Record<string, unknown>)[prop] = (...args: unknown[]) => {
    if (typeof prev === 'function') {
      (prev as (...a: unknown[]) => void).apply(target, args);
    }
    handler();
  };
}

function openDb(idb: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(dbName, RECORDING_STORE_SCHEMA_VERSION);
    } catch (cause) {
      reject(
        new RecordingPersistenceError(
          'STORAGE_UNAVAILABLE',
          cause instanceof Error ? cause.message : '无法打开本地 IndexedDB 存储',
          cause,
        ),
      );
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    attachListener(req, 'success', () => resolve(req.result));
    attachListener(req, 'error', () =>
      reject(
        new RecordingPersistenceError(
          'STORAGE_UNAVAILABLE',
          req.error?.message || '无法打开本地 IndexedDB 存储',
          req.error,
        ),
      ),
    );
    attachListener(req, 'blocked', () =>
      reject(new RecordingPersistenceError('STORAGE_UNAVAILABLE', '本地 IndexedDB 存储被阻塞，请稍后重试')),
    );
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    attachListener(req, 'success', () => resolve(req.result));
    attachListener(req, 'error', () =>
      reject(
        new RecordingPersistenceError('STORAGE_TX_ERROR', req.error?.message || '本地存储读写请求失败', req.error),
      ),
    );
  });
}

function runIdbTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, mode);
    } catch (cause) {
      reject(
        new RecordingPersistenceError(
          'STORAGE_TX_ERROR',
          cause instanceof Error ? cause.message : '无法创建本地存储事务',
          cause,
        ),
      );
      return;
    }

    let settled = false;
    let workDone = false;
    let txDone = false;
    let workResult!: T;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (err instanceof RecordingPersistenceError) {
        reject(err);
      } else {
        reject(
          new RecordingPersistenceError(
            'STORAGE_TX_ERROR',
            err instanceof Error ? err.message : '本地存储事务失败',
            err,
          ),
        );
      }
    };

    const tryResolve = () => {
      if (settled || !workDone || !txDone) return;
      settled = true;
      resolve(workResult);
    };

    attachListener(tx, 'complete', () => {
      txDone = true;
      tryResolve();
    });
    attachListener(tx, 'abort', () => {
      fail(
        new RecordingPersistenceError(
          'STORAGE_TX_ABORTED',
          tx.error?.message ? `本地存储事务已中止：${tx.error.message}` : '本地存储事务已中止，未完成持久化提交',
          tx.error,
        ),
      );
    });
    attachListener(tx, 'error', () => {
      fail(
        new RecordingPersistenceError(
          'STORAGE_TX_ERROR',
          tx.error?.message ? `本地存储事务错误：${tx.error.message}` : '本地存储事务执行失败',
          tx.error,
        ),
      );
    });

    work(tx.objectStore(STORE_NAME)).then(
      (result) => {
        workResult = result;
        workDone = true;
        tryResolve();
      },
      (err) => {
        try {
          tx.abort();
        } catch {
          // Transaction may already be aborted or finished.
        }
        fail(err);
      },
    );
  });
}

export function createIndexedDbRecordingBackend(
  dbName = RECORDING_STORE_DB_NAME,
  idbFactory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): RecordingStorageBackend {
  if (!idbFactory) return createUnavailableRecordingBackend();

  let dbPromise: Promise<IDBDatabase> | null = null;

  const getDb = async (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = openDb(idbFactory, dbName)
        .then((db) => {
          attachListener(db, 'versionchange', () => {
            try {
              db.close();
            } catch {
              // Ignore close errors.
            }
            dbPromise = null;
          });
          attachListener(db, 'close', () => {
            dbPromise = null;
          });
          return db;
        })
        .catch((err) => {
          dbPromise = null;
          throw err;
        });
    }
    return dbPromise;
  };

  const runTx = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const db = await getDb();
    try {
      return await runIdbTransaction(db, mode, work);
    } catch (err) {
      const rootCause = err instanceof RecordingPersistenceError ? err.cause : err;
      if (rootCause instanceof DOMException && rootCause.name === 'InvalidStateError') {
        dbPromise = null;
      }
      throw err;
    }
  };

  return {
    durable: true,
    async get(key) {
      return runTx(
        'readonly',
        async (store) => ((await reqPromise(store.get(key))) as StoredRecord | undefined) ?? null,
      );
    },
    async put(entry) {
      await runTx('readwrite', async (store) => {
        await reqPromise(store.put(entry));
      });
    },
    async delete(key) {
      await runTx('readwrite', async (store) => {
        await reqPromise(store.delete(key));
      });
    },
    async listByPrefix(prefix) {
      return runTx('readonly', async (store) => {
        const all = (await reqPromise(store.getAll())) as StoredRecord[];
        return all.filter((entry) => typeof entry?.key === 'string' && entry.key.startsWith(prefix));
      });
    },
    async deleteByPrefix(prefix) {
      return runTx('readwrite', async (store) => {
        const all = (await reqPromise(store.getAll())) as StoredRecord[];
        const deletes: Array<Promise<unknown>> = [];
        for (const entry of all) {
          if (typeof entry?.key === 'string' && entry.key.startsWith(prefix)) {
            deletes.push(reqPromise(store.delete(entry.key)));
          }
        }
        await Promise.all(deletes);
        return deletes.length;
      });
    },
    async clearAccountAtomic(accountId, activeKey, prefix) {
      return runTx('readwrite', async (store) => {
        const [all, activeEntry] = (await Promise.all([
          reqPromise(store.getAll()),
          reqPromise(store.get(activeKey)),
        ])) as [StoredRecord[], StoredRecord | undefined];
        const deletes: Array<Promise<unknown>> = [];
        let removed = 0;
        for (const entry of all) {
          if (typeof entry?.key === 'string' && entry.key.startsWith(prefix)) {
            deletes.push(reqPromise(store.delete(entry.key)));
            removed += 1;
          }
        }
        if (activeEntry && typeof activeEntry.payload === 'string' && activeEntry.payload.trim() === accountId) {
          deletes.push(reqPromise(store.delete(activeKey)));
        }
        await Promise.all(deletes);
        return removed;
      });
    },
    async clearAll() {
      await runTx('readwrite', async (store) => {
        await reqPromise(store.clear());
      });
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

const accountPrefix = (accountId: string) => `user:${accountId}:`;
const activeDraftKey = (accountId: string) => `user:${accountId}:draft:active`;
const uploadKey = (accountId: string, idempotencyKey: string) => `user:${accountId}:upload:${idempotencyKey}`;
const uploadPrefix = (accountId: string) => `user:${accountId}:upload:`;

export async function getActiveRecordingAccount(
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<string | null> {
  const existing = await backend.get(ACTIVE_ACCOUNT_KEY);
  return existing && typeof existing.payload === 'string' && existing.payload.trim() ? existing.payload : null;
}

/**
 * Records `accountId` as the active recording account ONLY if no other account currently holds
 * `ACTIVE_ACCOUNT_KEY`. Never deletes another account's records.
 */
export async function claimRecordingAccountIfUnsetOrMatch(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<'claimed' | 'conflict'> {
  if (!accountId.trim()) return 'conflict';
  const existing = await getActiveRecordingAccount(backend);
  if (existing && existing !== accountId) {
    return 'conflict';
  }
  await backend.put({
    key: ACTIVE_ACCOUNT_KEY,
    accountId,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    payload: accountId,
  });
  return 'claimed';
}

/**
 * Deletes only the specified account's drafts and upload queue entries.
 * Preserves any other account's `user:<other>:*` records and only clears `ACTIVE_ACCOUNT_KEY`
 * if it still points to `accountId`.
 */
export async function clearAccountRecordingData(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<number> {
  if (!accountId.trim()) return 0;
  if (backend.clearAccountAtomic) {
    return backend.clearAccountAtomic(accountId, ACTIVE_ACCOUNT_KEY, accountPrefix(accountId));
  }
  const removed = await backend.deleteByPrefix(accountPrefix(accountId));
  const activeAccount = await getActiveRecordingAccount(backend);
  if (activeAccount === accountId) {
    await backend.delete(ACTIVE_ACCOUNT_KEY);
  }
  return removed;
}

/**
 * Deletes `user:*` entries belonging to any account other than `keepAccountId`,
 * never deleting `keepAccountId`'s own records.
 */
export async function clearOtherAccountsRecordingData(
  keepAccountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<number> {
  const keepPrefix = accountPrefix(keepAccountId);
  const all = await backend.listByPrefix('user:');
  let removed = 0;
  for (const entry of all) {
    if (!entry.key.startsWith(keepPrefix)) {
      await backend.delete(entry.key);
      removed += 1;
    }
  }
  return removed;
}

export async function ensureRecordingAccountIsolation(
  currentAccountId: string | null,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<boolean> {
  const previousAccountId = await getActiveRecordingAccount(backend);

  if (!currentAccountId) {
    if (previousAccountId !== null) {
      await clearAccountRecordingData(previousAccountId, backend);
      return true;
    }
    return false;
  }

  let wiped = false;
  if (previousAccountId && previousAccountId !== currentAccountId) {
    const removed = await clearOtherAccountsRecordingData(currentAccountId, backend);
    wiped = removed > 0 || previousAccountId !== currentAccountId;
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

export async function readUploadQueueItem(
  accountId: string,
  idempotencyKey: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<UploadQueueItem | null> {
  const entry = await backend.get(uploadKey(accountId, idempotencyKey));
  if (!entry || entry.schemaVersion !== RECORDING_STORE_SCHEMA_VERSION || entry.accountId !== accountId) {
    return null;
  }
  const item = entry.payload as Partial<UploadQueueItem> | null;
  if (
    !item ||
    typeof item.idempotencyKey !== 'string' ||
    item.idempotencyKey !== idempotencyKey ||
    item.accountId !== accountId ||
    typeof item.status !== 'string'
  ) {
    return null;
  }
  return item as UploadQueueItem;
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
