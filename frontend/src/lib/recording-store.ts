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
const CLAIM_EPOCH_KEY = 'meta:recording_claim_epoch';

export type RecordingLifecycleStatus = 'idle' | 'recording' | 'paused' | 'interrupted' | 'stopped';

export type RecordingPersistenceErrorCode =
  'STORAGE_UNAVAILABLE' | 'STORAGE_TX_ABORTED' | 'STORAGE_TX_ERROR' | 'STORAGE_VERIFY_FAILED' | 'STORAGE_CLAIM_STALE';

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
  claimRevision?: number;
  payload: T;
}

export interface ActiveAccountGuard {
  expectedAccountId: string | null;
  expectedSavedAt?: number;
  expectedClaimRevision?: number;
}

export interface ActiveAccountSnapshot {
  activeAccountId: string | null;
  savedAt: number | null;
  claimRevision: number | undefined;
  claimEpoch: number;
}

export interface StaleGenerationGuard {
  expectedActiveAccountId: string | null;
  expectedSavedAt?: number | null;
  expectedClaimRevision?: number;
  maxStaleClaimRevision: number;
}

export interface GenerationScopedCleanupResult {
  status: 'cleaned' | 'aborted';
  removedCount: number;
  activeAccountId: string | null;
  activeClaimRevision: number | undefined;
}

export interface DraftWriteGuardOptions {
  expectedClaimRevision?: number;
}

export interface DraftDeleteGuardOptions {
  expectedClaimRevision?: number;
  expectedSessionId?: string;
}

export interface ActiveRecordingDraftWithMeta {
  draft: LocalRecordingDraft;
  claimRevision: number | undefined;
}

export interface ClaimAccountResult {
  status: 'claimed' | 'conflict';
  activeAccountId: string | null;
  savedAt: number | null;
  claimRevision: number | undefined;
  claimEpoch: number;
}

export interface ClaimAccountOptions {
  /** When true, reuses an existing active claim for the same `accountId` without advancing `claimRevision`. */
  reuseExistingClaim?: boolean;
}

export interface GuardedAccountCleanupResult {
  status: 'cleaned' | 'aborted';
  removedCount: number;
  activeAccountId: string | null;
}

export interface PreemptedAccountCleanupResult {
  preempted: boolean;
  removedCount: number;
  activeAccountId: string | null;
}

export type ReconcileRecordingAccountResult =
  | { status: 'active'; activeAccountId: string; clearedStaleAccountId?: string }
  | { status: 'stale'; confirmedAccountId: string | null; activeAccountId: string | null }
  | { status: 'preempted'; activeAccountId: string | null };

function extractActiveAccountId(entry: StoredRecord | null | undefined): string | null {
  return entry && typeof entry.payload === 'string' && entry.payload.trim() ? entry.payload.trim() : null;
}

function extractClaimEpoch(entry: StoredRecord | null | undefined): number {
  if (!entry) return 0;
  if (typeof entry.payload === 'number' && Number.isFinite(entry.payload) && entry.payload > 0) {
    return entry.payload;
  }
  if (typeof entry.claimRevision === 'number' && Number.isFinite(entry.claimRevision) && entry.claimRevision > 0) {
    return entry.claimRevision;
  }
  return 0;
}

function stampEntryWithActiveClaim(
  entry: StoredRecord,
  activeEntry: StoredRecord | null | undefined,
  existingEntry?: StoredRecord | null | undefined,
): StoredRecord {
  if (!entry.accountId || entry.claimRevision !== undefined || !entry.key.startsWith('user:')) {
    return entry;
  }
  if (
    entry.key.includes(':upload:') &&
    existingEntry &&
    existingEntry.accountId === entry.accountId &&
    typeof existingEntry.claimRevision === 'number'
  ) {
    return { ...entry, claimRevision: existingEntry.claimRevision };
  }
  if (extractActiveAccountId(activeEntry) === entry.accountId && typeof activeEntry?.claimRevision === 'number') {
    return { ...entry, claimRevision: activeEntry.claimRevision };
  }
  return entry;
}

function buildEpochEntry(epochKey: string, nextEpoch: number, nowMs: number): StoredRecord<number> {
  return {
    key: epochKey,
    accountId: null,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: nowMs,
    claimRevision: nextEpoch,
    payload: nextEpoch,
  };
}

function matchesActiveAccountGuard(entry: StoredRecord | null | undefined, guard: ActiveAccountGuard): boolean {
  const actualAccountId = extractActiveAccountId(entry);
  if (actualAccountId !== guard.expectedAccountId) {
    return false;
  }
  if (guard.expectedAccountId !== null) {
    if (guard.expectedSavedAt !== undefined && entry?.savedAt !== guard.expectedSavedAt) {
      return false;
    }
    if (guard.expectedClaimRevision !== undefined && entry?.claimRevision !== guard.expectedClaimRevision) {
      return false;
    }
  }
  return true;
}

function evaluateStaleGenerationCleanup(
  staleAccountId: string,
  activeEntry: StoredRecord | null | undefined,
  epochEntry: StoredRecord | null | undefined,
  guard: StaleGenerationGuard,
): {
  currentActiveId: string | null;
  currentActiveRev: number | undefined;
  sameAccountStillActive: boolean;
  newerClaimForStaleAccount: boolean;
} {
  const currentActiveId = extractActiveAccountId(activeEntry);
  const currentActiveRev = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
  const currentEpoch = Math.max(extractClaimEpoch(epochEntry), currentActiveRev ?? 0);
  const sameAccountStillActive = currentActiveId === staleAccountId;
  const guardMatchesActive =
    sameAccountStillActive &&
    guard.expectedActiveAccountId === staleAccountId &&
    (guard.expectedClaimRevision === undefined || currentActiveRev === guard.expectedClaimRevision) &&
    (guard.expectedSavedAt === undefined ||
      guard.expectedSavedAt === null ||
      activeEntry?.savedAt === guard.expectedSavedAt);
  const newerClaimForStaleAccount =
    sameAccountStillActive &&
    (!guardMatchesActive ||
      (currentActiveRev !== undefined && currentActiveRev > guard.maxStaleClaimRevision) ||
      currentEpoch > guard.maxStaleClaimRevision);
  return { currentActiveId, currentActiveRev, sameAccountStillActive, newerClaimForStaleAccount };
}

function shouldDeleteEntryForGeneration(
  entry: StoredRecord | null | undefined,
  stalePrefix: string,
  guard: StaleGenerationGuard,
  newerClaimForStaleAccount: boolean,
  currentActiveRev: number | undefined,
): boolean {
  if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith(stalePrefix)) {
    return false;
  }
  if (newerClaimForStaleAccount) {
    return (
      typeof entry.claimRevision === 'number' &&
      entry.claimRevision <= guard.maxStaleClaimRevision &&
      (currentActiveRev === undefined || entry.claimRevision < currentActiveRev)
    );
  }
  return entry.claimRevision === undefined || entry.claimRevision <= guard.maxStaleClaimRevision;
}

export interface RecordingStorageBackend {
  /** True only when writes are durably persisted across process restarts (committed IndexedDB). */
  readonly durable: boolean;
  get(key: string): Promise<StoredRecord | null>;
  put(entry: StoredRecord): Promise<void>;
  putIfExists(entry: StoredRecord): Promise<boolean>;
  saveDraftGuardedAtomic(
    entry: StoredRecord,
    activeKey: string,
    epochKey: string,
    expectedClaimRevision: number,
  ): Promise<boolean>;
  deleteDraftGuardedAtomic(
    key: string,
    accountId: string,
    activeKey: string,
    epochKey: string,
    expectedClaimRevision: number,
    expectedSessionId?: string,
  ): Promise<'deleted' | 'missing' | 'stale'>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<StoredRecord[]>;
  deleteByPrefix(prefix: string): Promise<number>;
  getActiveAccountSnapshot(activeKey: string, epochKey: string): Promise<ActiveAccountSnapshot>;
  claimAccountAtomic(
    accountId: string,
    activeKey: string,
    epochKey: string,
    nowMs: number,
    options?: ClaimAccountOptions,
  ): Promise<ClaimAccountResult>;
  clearAccountAtomic(accountId: string, activeKey: string, prefix: string): Promise<number>;
  clearAccountIfPreemptedAtomic(
    accountId: string,
    activeKey: string,
    prefix: string,
  ): Promise<PreemptedAccountCleanupResult>;
  clearAccountForGenerationAtomic(
    staleAccountId: string,
    activeKey: string,
    epochKey: string,
    stalePrefix: string,
    guard: StaleGenerationGuard,
  ): Promise<GenerationScopedCleanupResult>;
  clearStaleAccountGuardedAtomic(
    staleAccountId: string,
    nextAccountId: string | null,
    activeKey: string,
    epochKey: string,
    stalePrefix: string,
    guard: ActiveAccountGuard,
    nowMs: number,
  ): Promise<GuardedAccountCleanupResult>;
  isolateAccountAtomic(
    currentAccountId: string | null,
    activeKey: string,
    epochKey: string,
    nowMs: number,
  ): Promise<boolean>;
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
      const needsStamp = Boolean(entry.accountId && entry.claimRevision === undefined && entry.key.startsWith('user:'));
      const activeEntry = needsStamp ? map.get(ACTIVE_ACCOUNT_KEY) : undefined;
      const existingEntry = needsStamp && entry.key.includes(':upload:') ? map.get(entry.key) : undefined;
      map.set(entry.key, structuredClone(stampEntryWithActiveClaim(entry, activeEntry, existingEntry)));
    },
    async putIfExists(entry) {
      const existingEntry = map.get(entry.key);
      if (!existingEntry) return false;
      const activeEntry =
        entry.accountId && entry.claimRevision === undefined && entry.key.startsWith('user:')
          ? map.get(ACTIVE_ACCOUNT_KEY)
          : undefined;
      map.set(entry.key, structuredClone(stampEntryWithActiveClaim(entry, activeEntry, existingEntry)));
      return true;
    },
    async saveDraftGuardedAtomic(entry, activeKey, epochKey, expectedClaimRevision) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const existingDraft = map.get(entry.key);
      const activeAccountId = extractActiveAccountId(activeEntry);
      const activeClaimRev = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
      const currentEpoch = Math.max(extractClaimEpoch(epochEntry), activeClaimRev ?? 0);
      const existingDraftRev =
        typeof existingDraft?.claimRevision === 'number' ? existingDraft.claimRevision : undefined;
      if (
        !entry.accountId ||
        activeAccountId !== entry.accountId ||
        activeClaimRev === undefined ||
        activeClaimRev !== expectedClaimRevision ||
        currentEpoch > expectedClaimRevision ||
        (existingDraftRev !== undefined && existingDraftRev > expectedClaimRevision)
      ) {
        return false;
      }
      map.set(entry.key, structuredClone({ ...entry, claimRevision: expectedClaimRevision }));
      return true;
    },
    async deleteDraftGuardedAtomic(key, accountId, activeKey, epochKey, expectedClaimRevision, expectedSessionId) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const existingDraft = map.get(key);
      if (!existingDraft) return 'missing';
      const activeAccountId = extractActiveAccountId(activeEntry);
      const activeClaimRev = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
      const currentEpoch = Math.max(extractClaimEpoch(epochEntry), activeClaimRev ?? 0);
      const existingDraftRev =
        typeof existingDraft.claimRevision === 'number' ? existingDraft.claimRevision : undefined;
      const existingSessionId = (existingDraft.payload as Partial<LocalRecordingDraft> | undefined)?.sessionId;
      if (
        activeAccountId !== accountId ||
        activeClaimRev === undefined ||
        activeClaimRev !== expectedClaimRevision ||
        currentEpoch > expectedClaimRevision ||
        (existingDraftRev !== undefined && existingDraftRev > expectedClaimRevision) ||
        (expectedSessionId !== undefined && existingSessionId !== undefined && existingSessionId !== expectedSessionId)
      ) {
        return 'stale';
      }
      map.delete(key);
      return 'deleted';
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
    async getActiveAccountSnapshot(activeKey, epochKey) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const activeAccountId = extractActiveAccountId(activeEntry);
      const claimRevision = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
      return {
        activeAccountId,
        savedAt: activeEntry && typeof activeEntry.savedAt === 'number' ? activeEntry.savedAt : null,
        claimRevision,
        claimEpoch: Math.max(extractClaimEpoch(epochEntry), claimRevision ?? 0),
      };
    },
    async claimAccountAtomic(accountId, activeKey, epochKey, nowMs, options) {
      const existing = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const currentEpoch = Math.max(
        extractClaimEpoch(epochEntry),
        typeof existing?.claimRevision === 'number' ? existing.claimRevision : 0,
      );
      const existingAccount = extractActiveAccountId(existing);
      if (existingAccount && existingAccount !== accountId) {
        return {
          status: 'conflict',
          activeAccountId: existingAccount,
          savedAt: typeof existing?.savedAt === 'number' ? existing.savedAt : null,
          claimRevision: existing?.claimRevision,
          claimEpoch: currentEpoch,
        };
      }
      if (options?.reuseExistingClaim && existingAccount === accountId && typeof existing?.claimRevision === 'number') {
        return {
          status: 'claimed',
          activeAccountId: accountId,
          savedAt: typeof existing.savedAt === 'number' ? existing.savedAt : null,
          claimRevision: existing.claimRevision,
          claimEpoch: currentEpoch,
        };
      }
      const nextRevision = currentEpoch + 1;
      map.set(epochKey, buildEpochEntry(epochKey, nextRevision, nowMs));
      map.set(activeKey, {
        key: activeKey,
        accountId,
        schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
        savedAt: nowMs,
        claimRevision: nextRevision,
        payload: accountId,
      });
      return {
        status: 'claimed',
        activeAccountId: accountId,
        savedAt: nowMs,
        claimRevision: nextRevision,
        claimEpoch: nextRevision,
      };
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
      if (extractActiveAccountId(active) === accountId) {
        map.delete(activeKey);
      }
      return removed;
    },
    async clearAccountIfPreemptedAtomic(accountId, activeKey, prefix) {
      const activeEntry = map.get(activeKey);
      const activeAccountId = extractActiveAccountId(activeEntry);
      if (!activeAccountId || activeAccountId === accountId) {
        return { preempted: false, removedCount: 0, activeAccountId };
      }
      let removedCount = 0;
      for (const key of Array.from(map.keys())) {
        if (key.startsWith(prefix)) {
          map.delete(key);
          removedCount += 1;
        }
      }
      return { preempted: true, removedCount, activeAccountId };
    },
    async clearAccountForGenerationAtomic(staleAccountId, activeKey, epochKey, stalePrefix, guard) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const { currentActiveId, currentActiveRev, sameAccountStillActive, newerClaimForStaleAccount } =
        evaluateStaleGenerationCleanup(staleAccountId, activeEntry, epochEntry, guard);
      let removedCount = 0;
      for (const [key, entry] of Array.from(map.entries())) {
        if (shouldDeleteEntryForGeneration(entry, stalePrefix, guard, newerClaimForStaleAccount, currentActiveRev)) {
          map.delete(key);
          removedCount += 1;
        }
      }
      if (newerClaimForStaleAccount) {
        return {
          status: 'aborted',
          removedCount,
          activeAccountId: currentActiveId,
          activeClaimRevision: currentActiveRev,
        };
      }
      if (sameAccountStillActive) {
        map.delete(activeKey);
      }
      return {
        status: 'cleaned',
        removedCount,
        activeAccountId: sameAccountStillActive ? null : currentActiveId,
        activeClaimRevision: sameAccountStillActive ? undefined : currentActiveRev,
      };
    },
    async clearStaleAccountGuardedAtomic(
      staleAccountId,
      nextAccountId,
      activeKey,
      epochKey,
      stalePrefix,
      guard,
      nowMs,
    ) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const currentActive = extractActiveAccountId(activeEntry);
      const normalizedNext = nextAccountId && nextAccountId.trim() ? nextAccountId.trim() : null;
      if (
        !staleAccountId.trim() ||
        staleAccountId === normalizedNext ||
        !matchesActiveAccountGuard(activeEntry, guard)
      ) {
        return { status: 'aborted', removedCount: 0, activeAccountId: currentActive };
      }
      let removedCount = 0;
      for (const key of Array.from(map.keys())) {
        if (key.startsWith(stalePrefix)) {
          map.delete(key);
          removedCount += 1;
        }
      }
      let resultingActive: string | null = currentActive;
      if (normalizedNext) {
        const nextRevision =
          Math.max(
            extractClaimEpoch(epochEntry),
            typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : 0,
          ) + 1;
        map.set(epochKey, buildEpochEntry(epochKey, nextRevision, nowMs));
        map.set(activeKey, {
          key: activeKey,
          accountId: normalizedNext,
          schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
          savedAt: nowMs,
          claimRevision: nextRevision,
          payload: normalizedNext,
        });
        resultingActive = normalizedNext;
      } else if (currentActive === staleAccountId) {
        map.delete(activeKey);
        resultingActive = null;
      }
      return { status: 'cleaned', removedCount, activeAccountId: resultingActive };
    },
    async isolateAccountAtomic(currentAccountId, activeKey, epochKey, nowMs) {
      const activeEntry = map.get(activeKey);
      const epochEntry = map.get(epochKey);
      const previousAccountId = extractActiveAccountId(activeEntry);
      if (!currentAccountId) {
        if (previousAccountId !== null) {
          const prevPrefix = accountPrefix(previousAccountId);
          for (const key of Array.from(map.keys())) {
            if (key.startsWith(prevPrefix)) {
              map.delete(key);
            }
          }
          map.delete(activeKey);
          return true;
        }
        return false;
      }
      let wiped = false;
      if (previousAccountId && previousAccountId !== currentAccountId) {
        const prevPrefix = accountPrefix(previousAccountId);
        for (const key of Array.from(map.keys())) {
          if (key.startsWith(prevPrefix)) {
            map.delete(key);
          }
        }
        wiped = true;
      }
      const nextRevision =
        Math.max(
          extractClaimEpoch(epochEntry),
          typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : 0,
        ) + 1;
      map.set(epochKey, buildEpochEntry(epochKey, nextRevision, nowMs));
      map.set(activeKey, {
        key: activeKey,
        accountId: currentAccountId,
        schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
        savedAt: nowMs,
        claimRevision: nextRevision,
        payload: currentAccountId,
      });
      return wiped;
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
    async putIfExists() {
      throw unavailable();
    },
    async saveDraftGuardedAtomic() {
      throw unavailable();
    },
    async deleteDraftGuardedAtomic() {
      return 'missing';
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
    async getActiveAccountSnapshot() {
      return { activeAccountId: null, savedAt: null, claimRevision: undefined, claimEpoch: 0 };
    },
    async claimAccountAtomic() {
      throw unavailable();
    },
    async clearAccountAtomic() {
      return 0;
    },
    async clearAccountIfPreemptedAtomic() {
      return { preempted: false, removedCount: 0, activeAccountId: null };
    },
    async clearAccountForGenerationAtomic() {
      return { status: 'aborted', removedCount: 0, activeAccountId: null, activeClaimRevision: undefined };
    },
    async clearStaleAccountGuardedAtomic(_staleAccountId, nextAccountId) {
      if (nextAccountId && nextAccountId.trim()) {
        throw unavailable();
      }
      return { status: 'aborted', removedCount: 0, activeAccountId: null };
    },
    async isolateAccountAtomic(currentAccountId) {
      if (currentAccountId) {
        throw unavailable();
      }
      return false;
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
        let entryToStore = entry;
        if (entry.accountId && entry.claimRevision === undefined && entry.key.startsWith('user:')) {
          const [activeEntry, existingEntry] = (await Promise.all([
            reqPromise(store.get(ACTIVE_ACCOUNT_KEY)),
            entry.key.includes(':upload:') ? reqPromise(store.get(entry.key)) : Promise.resolve(undefined),
          ])) as [StoredRecord | undefined, StoredRecord | undefined];
          entryToStore = stampEntryWithActiveClaim(entry, activeEntry, existingEntry);
        }
        await reqPromise(store.put(entryToStore));
      });
    },
    async putIfExists(entry) {
      return runTx('readwrite', async (store) => {
        const existingEntry = (await reqPromise(store.get(entry.key))) as StoredRecord | undefined;
        if (!existingEntry) return false;
        let entryToStore = entry;
        if (entry.accountId && entry.claimRevision === undefined && entry.key.startsWith('user:')) {
          const activeEntry = (await reqPromise(store.get(ACTIVE_ACCOUNT_KEY))) as StoredRecord | undefined;
          entryToStore = stampEntryWithActiveClaim(entry, activeEntry, existingEntry);
        }
        await reqPromise(store.put(entryToStore));
        return true;
      });
    },
    async saveDraftGuardedAtomic(entry, activeKey, epochKey, expectedClaimRevision) {
      return runTx('readwrite', async (store) => {
        const [activeEntry, epochEntry, existingDraft] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
          reqPromise(store.get(entry.key)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined, StoredRecord | undefined];
        const activeAccountId = extractActiveAccountId(activeEntry);
        const activeClaimRev = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
        const currentEpoch = Math.max(extractClaimEpoch(epochEntry), activeClaimRev ?? 0);
        const existingDraftRev =
          typeof existingDraft?.claimRevision === 'number' ? existingDraft.claimRevision : undefined;
        if (
          !entry.accountId ||
          activeAccountId !== entry.accountId ||
          activeClaimRev === undefined ||
          activeClaimRev !== expectedClaimRevision ||
          currentEpoch > expectedClaimRevision ||
          (existingDraftRev !== undefined && existingDraftRev > expectedClaimRevision)
        ) {
          return false;
        }
        await reqPromise(store.put({ ...entry, claimRevision: expectedClaimRevision }));
        return true;
      });
    },
    async deleteDraftGuardedAtomic(key, accountId, activeKey, epochKey, expectedClaimRevision, expectedSessionId) {
      return runTx('readwrite', async (store) => {
        const [activeEntry, epochEntry, existingDraft] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
          reqPromise(store.get(key)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined, StoredRecord | undefined];
        if (!existingDraft) return 'missing';
        const activeAccountId = extractActiveAccountId(activeEntry);
        const activeClaimRev = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
        const currentEpoch = Math.max(extractClaimEpoch(epochEntry), activeClaimRev ?? 0);
        const existingDraftRev =
          typeof existingDraft.claimRevision === 'number' ? existingDraft.claimRevision : undefined;
        const existingSessionId = (existingDraft.payload as Partial<LocalRecordingDraft> | undefined)?.sessionId;
        if (
          activeAccountId !== accountId ||
          activeClaimRev === undefined ||
          activeClaimRev !== expectedClaimRevision ||
          currentEpoch > expectedClaimRevision ||
          (existingDraftRev !== undefined && existingDraftRev > expectedClaimRevision) ||
          (expectedSessionId !== undefined &&
            existingSessionId !== undefined &&
            existingSessionId !== expectedSessionId)
        ) {
          return 'stale';
        }
        await reqPromise(store.delete(key));
        return 'deleted';
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
    async getActiveAccountSnapshot(activeKey, epochKey) {
      return runTx('readonly', async (store) => {
        const [activeEntry, epochEntry] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined];
        const activeAccountId = extractActiveAccountId(activeEntry);
        const claimRevision = typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : undefined;
        return {
          activeAccountId,
          savedAt: activeEntry && typeof activeEntry.savedAt === 'number' ? activeEntry.savedAt : null,
          claimRevision,
          claimEpoch: Math.max(extractClaimEpoch(epochEntry), claimRevision ?? 0),
        };
      });
    },
    async claimAccountAtomic(accountId, activeKey, epochKey, nowMs, options) {
      return runTx('readwrite', async (store) => {
        const [existing, epochEntry] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined];
        const currentEpoch = Math.max(
          extractClaimEpoch(epochEntry),
          typeof existing?.claimRevision === 'number' ? existing.claimRevision : 0,
        );
        const existingAccount = extractActiveAccountId(existing);
        if (existingAccount && existingAccount !== accountId) {
          return {
            status: 'conflict',
            activeAccountId: existingAccount,
            savedAt: typeof existing?.savedAt === 'number' ? existing.savedAt : null,
            claimRevision: existing?.claimRevision,
            claimEpoch: currentEpoch,
          };
        }
        if (
          options?.reuseExistingClaim &&
          existingAccount === accountId &&
          typeof existing?.claimRevision === 'number'
        ) {
          return {
            status: 'claimed',
            activeAccountId: accountId,
            savedAt: typeof existing.savedAt === 'number' ? existing.savedAt : null,
            claimRevision: existing.claimRevision,
            claimEpoch: currentEpoch,
          };
        }
        const nextRevision = currentEpoch + 1;
        await Promise.all([
          reqPromise(store.put(buildEpochEntry(epochKey, nextRevision, nowMs))),
          reqPromise(
            store.put({
              key: activeKey,
              accountId,
              schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
              savedAt: nowMs,
              claimRevision: nextRevision,
              payload: accountId,
            }),
          ),
        ]);
        return {
          status: 'claimed',
          activeAccountId: accountId,
          savedAt: nowMs,
          claimRevision: nextRevision,
          claimEpoch: nextRevision,
        };
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
        if (extractActiveAccountId(activeEntry) === accountId) {
          deletes.push(reqPromise(store.delete(activeKey)));
        }
        await Promise.all(deletes);
        return removed;
      });
    },
    async clearAccountIfPreemptedAtomic(accountId, activeKey, prefix) {
      return runTx('readwrite', async (store) => {
        const activeEntry = (await reqPromise(store.get(activeKey))) as StoredRecord | undefined;
        const activeAccountId = extractActiveAccountId(activeEntry);
        if (!activeAccountId || activeAccountId === accountId) {
          return { preempted: false, removedCount: 0, activeAccountId };
        }
        const all = (await reqPromise(store.getAll())) as StoredRecord[];
        const deletes: Array<Promise<unknown>> = [];
        let removedCount = 0;
        for (const entry of all) {
          if (typeof entry?.key === 'string' && entry.key.startsWith(prefix)) {
            deletes.push(reqPromise(store.delete(entry.key)));
            removedCount += 1;
          }
        }
        await Promise.all(deletes);
        return { preempted: true, removedCount, activeAccountId };
      });
    },
    async clearAccountForGenerationAtomic(staleAccountId, activeKey, epochKey, stalePrefix, guard) {
      return runTx('readwrite', async (store) => {
        const [activeEntry, epochEntry, all] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
          reqPromise(store.getAll()),
        ])) as [StoredRecord | undefined, StoredRecord | undefined, StoredRecord[]];
        const { currentActiveId, currentActiveRev, sameAccountStillActive, newerClaimForStaleAccount } =
          evaluateStaleGenerationCleanup(staleAccountId, activeEntry, epochEntry, guard);
        const writes: Array<Promise<unknown>> = [];
        let removedCount = 0;
        for (const entry of all) {
          if (shouldDeleteEntryForGeneration(entry, stalePrefix, guard, newerClaimForStaleAccount, currentActiveRev)) {
            writes.push(reqPromise(store.delete(entry.key)));
            removedCount += 1;
          }
        }
        if (newerClaimForStaleAccount) {
          await Promise.all(writes);
          return {
            status: 'aborted',
            removedCount,
            activeAccountId: currentActiveId,
            activeClaimRevision: currentActiveRev,
          };
        }
        if (sameAccountStillActive) {
          writes.push(reqPromise(store.delete(activeKey)));
        }
        await Promise.all(writes);
        return {
          status: 'cleaned',
          removedCount,
          activeAccountId: sameAccountStillActive ? null : currentActiveId,
          activeClaimRevision: sameAccountStillActive ? undefined : currentActiveRev,
        };
      });
    },
    async clearStaleAccountGuardedAtomic(
      staleAccountId,
      nextAccountId,
      activeKey,
      epochKey,
      stalePrefix,
      guard,
      nowMs,
    ) {
      return runTx('readwrite', async (store) => {
        const [activeEntry, epochEntry] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined];
        const currentActive = extractActiveAccountId(activeEntry);
        const normalizedNext = nextAccountId && nextAccountId.trim() ? nextAccountId.trim() : null;
        if (
          !staleAccountId.trim() ||
          staleAccountId === normalizedNext ||
          !matchesActiveAccountGuard(activeEntry, guard)
        ) {
          return { status: 'aborted', removedCount: 0, activeAccountId: currentActive };
        }
        const all = (await reqPromise(store.getAll())) as StoredRecord[];
        const writes: Array<Promise<unknown>> = [];
        let removedCount = 0;
        for (const entry of all) {
          if (typeof entry?.key === 'string' && entry.key.startsWith(stalePrefix)) {
            writes.push(reqPromise(store.delete(entry.key)));
            removedCount += 1;
          }
        }
        let resultingActive: string | null = currentActive;
        if (normalizedNext) {
          const nextRevision =
            Math.max(
              extractClaimEpoch(epochEntry),
              typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : 0,
            ) + 1;
          writes.push(reqPromise(store.put(buildEpochEntry(epochKey, nextRevision, nowMs))));
          writes.push(
            reqPromise(
              store.put({
                key: activeKey,
                accountId: normalizedNext,
                schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
                savedAt: nowMs,
                claimRevision: nextRevision,
                payload: normalizedNext,
              }),
            ),
          );
          resultingActive = normalizedNext;
        } else if (currentActive === staleAccountId) {
          writes.push(reqPromise(store.delete(activeKey)));
          resultingActive = null;
        }
        await Promise.all(writes);
        return { status: 'cleaned', removedCount, activeAccountId: resultingActive };
      });
    },
    async isolateAccountAtomic(currentAccountId, activeKey, epochKey, nowMs) {
      return runTx('readwrite', async (store) => {
        const [activeEntry, epochEntry] = (await Promise.all([
          reqPromise(store.get(activeKey)),
          reqPromise(store.get(epochKey)),
        ])) as [StoredRecord | undefined, StoredRecord | undefined];
        const previousAccountId = extractActiveAccountId(activeEntry);
        if (!currentAccountId) {
          if (previousAccountId !== null) {
            const all = (await reqPromise(store.getAll())) as StoredRecord[];
            const prevPrefix = accountPrefix(previousAccountId);
            const writes: Array<Promise<unknown>> = [reqPromise(store.delete(activeKey))];
            for (const entry of all) {
              if (typeof entry?.key === 'string' && entry.key.startsWith(prevPrefix)) {
                writes.push(reqPromise(store.delete(entry.key)));
              }
            }
            await Promise.all(writes);
            return true;
          }
          return false;
        }
        const writes: Array<Promise<unknown>> = [];
        let wiped = false;
        if (previousAccountId && previousAccountId !== currentAccountId) {
          const all = (await reqPromise(store.getAll())) as StoredRecord[];
          const prevPrefix = accountPrefix(previousAccountId);
          for (const entry of all) {
            if (typeof entry?.key === 'string' && entry.key.startsWith(prevPrefix)) {
              writes.push(reqPromise(store.delete(entry.key)));
            }
          }
          wiped = true;
        }
        const nextRevision =
          Math.max(
            extractClaimEpoch(epochEntry),
            typeof activeEntry?.claimRevision === 'number' ? activeEntry.claimRevision : 0,
          ) + 1;
        writes.push(reqPromise(store.put(buildEpochEntry(epochKey, nextRevision, nowMs))));
        writes.push(
          reqPromise(
            store.put({
              key: activeKey,
              accountId: currentAccountId,
              schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
              savedAt: nowMs,
              claimRevision: nextRevision,
              payload: currentAccountId,
            }),
          ),
        );
        await Promise.all(writes);
        return wiped;
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

export async function getActiveRecordingAccountSnapshot(
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<ActiveAccountSnapshot> {
  return backend.getActiveAccountSnapshot(ACTIVE_ACCOUNT_KEY, CLAIM_EPOCH_KEY);
}

/**
 * Atomically claims `ACTIVE_ACCOUNT_KEY` for `accountId` in a single transaction ONLY if it is
 * unset or already owned by `accountId`. Never deletes or overwrites another account's marker.
 */
export async function claimRecordingAccountAtomic(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  nowMs = Date.now(),
  options?: ClaimAccountOptions,
): Promise<ClaimAccountResult> {
  if (!accountId.trim()) {
    return { status: 'conflict', activeAccountId: null, savedAt: null, claimRevision: undefined, claimEpoch: 0 };
  }
  return backend.claimAccountAtomic(accountId, ACTIVE_ACCOUNT_KEY, CLAIM_EPOCH_KEY, nowMs, options);
}

/**
 * Records `accountId` as the active recording account ONLY if no other account currently holds
 * `ACTIVE_ACCOUNT_KEY`. Never deletes another account's records.
 */
export async function claimRecordingAccountIfUnsetOrMatch(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<'claimed' | 'conflict'> {
  const result = await claimRecordingAccountAtomic(accountId, backend);
  return result.status;
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
  return backend.clearAccountAtomic(accountId, ACTIVE_ACCOUNT_KEY, accountPrefix(accountId));
}

/**
 * Atomically checks `ACTIVE_ACCOUNT_KEY` and deletes ONLY `accountId`'s records if another
 * account currently owns the active marker. Never deletes another account's data.
 */
export async function clearAccountIfPreemptedAtomic(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<PreemptedAccountCleanupResult> {
  if (!accountId.trim()) {
    return { preempted: false, removedCount: 0, activeAccountId: null };
  }
  return backend.clearAccountIfPreemptedAtomic(accountId, ACTIVE_ACCOUNT_KEY, accountPrefix(accountId));
}

/**
 * Atomically verifies the claim generation/epoch inside one IndexedDB transaction before clearing
 * `staleAccountId`. If `staleAccountId` obtained a newer claim after verification began, aborts
 * cleanup and preserves the new marker and new-generation records (removing only explicitly
 * older-generation `user:<staleAccountId>:*` entries).
 */
export async function clearStaleAccountGenerationAtomic(
  staleAccountId: string,
  guard: StaleGenerationGuard,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<GenerationScopedCleanupResult> {
  if (!staleAccountId.trim()) {
    const snap = await getActiveRecordingAccountSnapshot(backend);
    return {
      status: 'aborted',
      removedCount: 0,
      activeAccountId: snap.activeAccountId,
      activeClaimRevision: snap.claimRevision,
    };
  }
  return backend.clearAccountForGenerationAtomic(
    staleAccountId,
    ACTIVE_ACCOUNT_KEY,
    CLAIM_EPOCH_KEY,
    accountPrefix(staleAccountId),
    guard,
  );
}

/**
 * Atomically verifies the `guard` on `ACTIVE_ACCOUNT_KEY` inside a single IndexedDB transaction,
 * deletes ONLY `staleAccountId`'s records (`user:<staleAccountId>:*`), and updates/clears the
 * active marker. If the active marker changed before cleanup, aborts and leaves all records intact.
 */
export async function clearStaleRecordingAccountAtomic(
  options: {
    staleAccountId: string;
    nextAccountId?: string | null;
    guard: ActiveAccountGuard;
  },
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  nowMs = Date.now(),
): Promise<GuardedAccountCleanupResult> {
  if (!options.staleAccountId.trim()) {
    return { status: 'aborted', removedCount: 0, activeAccountId: await getActiveRecordingAccount(backend) };
  }
  return backend.clearStaleAccountGuardedAtomic(
    options.staleAccountId,
    options.nextAccountId ?? null,
    ACTIVE_ACCOUNT_KEY,
    CLAIM_EPOCH_KEY,
    accountPrefix(options.staleAccountId),
    options.guard,
    nowMs,
  );
}

export async function ensureRecordingAccountIsolation(
  currentAccountId: string | null,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  options?: { expectedActiveGuard?: ActiveAccountGuard },
): Promise<boolean> {
  if (options?.expectedActiveGuard) {
    const guard = options.expectedActiveGuard;
    if (!currentAccountId) {
      if (!guard.expectedAccountId) return false;
      const res = await clearStaleRecordingAccountAtomic(
        { staleAccountId: guard.expectedAccountId, nextAccountId: null, guard },
        backend,
      );
      return res.status === 'cleaned';
    }
    if (guard.expectedAccountId === null || guard.expectedAccountId === currentAccountId) {
      await claimRecordingAccountAtomic(currentAccountId, backend);
      return false;
    }
    const res = await clearStaleRecordingAccountAtomic(
      { staleAccountId: guard.expectedAccountId, nextAccountId: currentAccountId, guard },
      backend,
    );
    return res.status === 'cleaned';
  }
  return backend.isolateAccountAtomic(currentAccountId, ACTIVE_ACCOUNT_KEY, CLAIM_EPOCH_KEY, Date.now());
}

/**
 * Atomically reconciles a verified tab identity (`accountId`) against `ACTIVE_ACCOUNT_KEY`:
 * - Attempts an atomic single-transaction claim first.
 * - On conflict with another account `observedActiveId`, re-verifies the authoritative server
 *   session via `verifySession()` before any deletion.
 * - If this tab's session is stale or expired (`!confirmed || confirmed.id !== accountId`),
 *   runs generation-guarded cleanup for `accountId` so any concurrent same-account re-login
 *   (`claimRevision > maxStaleRev`) aborts cleanup and preserves the new claim/drafts.
 * - If this tab's session is still authoritative (`confirmed.id === accountId`), atomically cleans
 *   ONLY `observedActiveId` guarded by the exact `savedAt`/`claimRevision` observed during claim;
 *   if another tab preempted in between, aborts without deleting anything.
 */
export async function reconcileVerifiedRecordingAccount(options: {
  accountId: string;
  verifySession: () => Promise<{ id: string } | null>;
  backend?: RecordingStorageBackend;
  now?: () => number;
}): Promise<ReconcileRecordingAccountResult> {
  const backend = options.backend ?? getDefaultRecordingBackend();
  const now = options.now ?? (() => Date.now());
  const claim = await claimRecordingAccountAtomic(options.accountId, backend, now(), { reuseExistingClaim: true });
  if (claim.status === 'claimed') {
    return { status: 'active', activeAccountId: options.accountId };
  }

  const observedActiveId = claim.activeAccountId;
  const maxStaleRev = typeof claim.claimRevision === 'number' ? Math.max(0, claim.claimRevision - 1) : claim.claimEpoch;
  const confirmed = await options.verifySession();
  if (!confirmed || confirmed.id !== options.accountId) {
    const cleanup = await clearStaleAccountGenerationAtomic(
      options.accountId,
      {
        expectedActiveAccountId: observedActiveId,
        expectedSavedAt: claim.savedAt ?? undefined,
        expectedClaimRevision: claim.claimRevision,
        maxStaleClaimRevision: maxStaleRev,
      },
      backend,
    );
    if (cleanup.status === 'aborted' && cleanup.activeAccountId === options.accountId) {
      return {
        status: 'preempted',
        activeAccountId: cleanup.activeAccountId,
      };
    }
    return {
      status: 'stale',
      confirmedAccountId: confirmed?.id ?? null,
      activeAccountId: cleanup.activeAccountId,
    };
  }

  if (!observedActiveId || observedActiveId === options.accountId) {
    const retryClaim = await claimRecordingAccountAtomic(options.accountId, backend, now());
    if (retryClaim.status === 'claimed') {
      return { status: 'active', activeAccountId: options.accountId };
    }
    return { status: 'preempted', activeAccountId: retryClaim.activeAccountId };
  }

  const cleanup = await clearStaleRecordingAccountAtomic(
    {
      staleAccountId: observedActiveId,
      nextAccountId: options.accountId,
      guard: {
        expectedAccountId: observedActiveId,
        expectedSavedAt: claim.savedAt ?? undefined,
        expectedClaimRevision: claim.claimRevision,
      },
    },
    backend,
    now(),
  );
  if (cleanup.status === 'aborted') {
    return { status: 'preempted', activeAccountId: cleanup.activeAccountId };
  }
  return {
    status: 'active',
    activeAccountId: options.accountId,
    clearedStaleAccountId: observedActiveId,
  };
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
  options?: DraftWriteGuardOptions,
): Promise<void> {
  assertSafeCachePayload(draft);
  const entry: StoredRecord<LocalRecordingDraft> = {
    key: activeDraftKey(draft.accountId),
    accountId: draft.accountId,
    schemaVersion: RECORDING_STORE_SCHEMA_VERSION,
    savedAt: Date.now(),
    payload: draft,
  };
  if (options?.expectedClaimRevision !== undefined) {
    const saved = await backend.saveDraftGuardedAtomic(
      entry,
      ACTIVE_ACCOUNT_KEY,
      CLAIM_EPOCH_KEY,
      options.expectedClaimRevision,
    );
    if (!saved) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前记录会话已被其他标签页或新登录接管，已阻止覆盖最新草稿。',
      );
    }
    return;
  }
  await backend.put(entry);
}

export async function readActiveRecordingDraftWithMeta(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<ActiveRecordingDraftWithMeta | null> {
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
  return {
    draft: payload as LocalRecordingDraft,
    claimRevision: typeof entry.claimRevision === 'number' ? entry.claimRevision : undefined,
  };
}

export async function readActiveRecordingDraft(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<LocalRecordingDraft | null> {
  const hit = await readActiveRecordingDraftWithMeta(accountId, backend);
  return hit?.draft ?? null;
}

export async function deleteActiveRecordingDraft(
  accountId: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  options?: DraftDeleteGuardOptions,
): Promise<void> {
  if (options?.expectedClaimRevision !== undefined) {
    const result = await backend.deleteDraftGuardedAtomic(
      activeDraftKey(accountId),
      accountId,
      ACTIVE_ACCOUNT_KEY,
      CLAIM_EPOCH_KEY,
      options.expectedClaimRevision,
      options.expectedSessionId,
    );
    if (result === 'stale') {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前记录会话已被其他标签页或新登录接管，已阻止删除最新草稿。',
      );
    }
    return;
  }
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

/**
 * Atomically updates an existing upload queue item in one transaction only if it still exists
 * (never resurrecting items concurrently removed by stale-generation cleanup or user discard).
 */
export async function updateExistingUploadQueueItem(
  item: UploadQueueItem,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<boolean> {
  assertSafeCachePayload(item);
  return backend.putIfExists({
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
