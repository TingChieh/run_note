import { ActivityError, uploadGpx } from '#lib/api/activities.ts';
import { readSession } from '#lib/api/auth.ts';
import {
  RecordingPersistenceError,
  clearAccountIfPreemptedAtomic,
  clearStaleAccountGenerationAtomic,
  deleteUploadQueueItem,
  getActiveRecordingAccount,
  getActiveRecordingAccountSnapshot,
  getDefaultRecordingBackend,
  listUploadQueueItems,
  putUploadQueueItem,
  readUploadQueueItem,
  updateExistingUploadQueueItem,
  type RecordingStorageBackend,
  type UploadQueueItem,
} from '#lib/recording-store.ts';
import { serializeRecordingToGpx, type RecordedTrackPoint } from '#lib/gpx-serializer.ts';

/**
 * Single-flight, account-bound idempotent upload engine for finalized Phase 3 running recordings.
 *
 * Security & reliability guarantees:
 * - Requires durable local storage (`backend.durable === true`) and verifies read-back after
 *   IndexedDB transaction commit before `enqueueFinalizedRecording` resolves, so native handoff
 *   files are never acknowledged/deleted before a durable queue entry exists.
 * - Verifies active browser session identity (`readSession`) and active-account marker before
 *   every upload and sends `expected_owner_id` so the backend atomically rejects cross-tab
 *   account switches (`409 ACCOUNT_MISMATCH`).
 * - Account-mismatch cleanup is strictly scoped to the stale account (`clearAccountRecordingData`)
 *   and never deletes a newly signed-in account's drafts or upload queue.
 * - Reuses `POST /api/v1/gpx-imports` with client-generated UUID `Idempotency-Key` header.
 * - Schedules exact due-time timers for exponential backoff (`5s -> 15s -> 45s -> 120s -> 300s`),
 *   preserves timers across routine same-account auth probes, and re-arms persisted retries after
 *   same-account verification (`rearmScheduledRecordingUpload`).
 */

export const UPLOAD_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export interface FinalizeAndEnqueueInput {
  accountId: string;
  sessionId: string;
  idempotencyKey: string;
  title: string;
  timezone: string;
  startedAtMs: number;
  endedAtMs: number;
  activeDurationMs: number;
  points: RecordedTrackPoint[];
}

export interface UploadFlushOutcome {
  status: 'idle' | 'offline' | 'uploaded' | 'partial' | 'auth_expired' | 'account_mismatch' | 'aborted' | 'failed';
  uploadedCount: number;
  failedCount: number;
  pendingCount: number;
  uploadedActivityIds: string[];
  nextRetryAt: number | null;
  message: string | null;
}

export interface FlushUploadOptions {
  accountId: string;
  fetcher?: typeof fetch;
  backend?: RecordingStorageBackend;
  forceRetry?: boolean;
  now?: () => number;
  isOnline?: () => boolean;
  /** Disable automatic timer scheduling only when unit tests drive retries manually. */
  scheduleRetry?: boolean;
}

const inFlightByAccount = new Map<string, Promise<UploadFlushOutcome>>();
const activeControllersByAccount = new Map<string, AbortController>();
const retryTimersByAccount = new Map<string, ReturnType<typeof setTimeout>>();
const retryDueAtByAccount = new Map<string, number>();

function notifyQueueUpdated(detail?: { reason?: 'account_mismatch' | 'auth_expired'; message?: string }): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('runnote-recording-queue-updated', { detail }));
  }
}

/**
 * Classifies `BroadcastChannel('runnote-auth')` messages so routine `'check'` probes from a
 * newly opened same-account tab never cancel scheduled backoff retries, while explicit
 * `'account-changed'` notifications abort immediately.
 */
export function isAccountChangeAuthBroadcast(data: unknown): boolean {
  if (data === 'account-changed') return true;
  if (typeof data === 'object' && data !== null && 'type' in data) {
    return (data as { type?: unknown }).type === 'account-changed';
  }
  return false;
}

export function computeBackoffDelayMs(attemptCount: number): number {
  const index = Math.min(Math.max(0, attemptCount - 1), UPLOAD_BACKOFF_MS.length - 1);
  return UPLOAD_BACKOFF_MS[index];
}

export function isTransientUploadError(cause: unknown): boolean {
  if (cause instanceof ActivityError) {
    return (
      cause.code === 'NETWORK_ERROR' ||
      cause.status === 429 ||
      cause.status === 502 ||
      cause.status === 503 ||
      cause.status === 504
    );
  }
  return true;
}

export function cancelScheduledRecordingUpload(accountId?: string): void {
  if (accountId !== undefined) {
    const timer = retryTimersByAccount.get(accountId);
    if (timer !== undefined) {
      clearTimeout(timer);
      retryTimersByAccount.delete(accountId);
    }
    retryDueAtByAccount.delete(accountId);
    return;
  }
  for (const timer of retryTimersByAccount.values()) {
    clearTimeout(timer);
  }
  retryTimersByAccount.clear();
  retryDueAtByAccount.clear();
}

/**
 * Immediately aborts in-flight upload requests and clears scheduled backoff timers.
 * Pass `accountId` whenever possible to avoid cancelling another account's work.
 */
export function abortAllRecordingUploads(accountId?: string): void {
  cancelScheduledRecordingUpload(accountId);
  if (accountId !== undefined) {
    const controller = activeControllersByAccount.get(accountId);
    if (controller) {
      controller.abort();
      activeControllersByAccount.delete(accountId);
    }
    return;
  }
  for (const controller of activeControllersByAccount.values()) {
    controller.abort();
  }
  activeControllersByAccount.clear();
}

export function scheduleNextRecordingUpload(options: FlushUploadOptions, dueAtMs: number): void {
  const { accountId } = options;
  cancelScheduledRecordingUpload(accountId);
  const now = options.now ?? (() => Date.now());
  const delayMs = Math.max(0, dueAtMs - now());
  retryDueAtByAccount.set(accountId, dueAtMs);
  const timer = setTimeout(() => {
    retryTimersByAccount.delete(accountId);
    retryDueAtByAccount.delete(accountId);
    void flushRecordingUploadQueue({ ...options, forceRetry: false });
  }, delayMs);
  retryTimersByAccount.set(accountId, timer);
}

/**
 * Re-arms any eligible persisted retry for `accountId` (respecting `nextRetryAt`) after a
 * same-account identity verification, without cancelling an already-armed timer or running flush.
 */
export async function rearmScheduledRecordingUpload(options: FlushUploadOptions): Promise<number | null> {
  const { accountId } = options;
  if (inFlightByAccount.has(accountId)) return null;
  if (retryTimersByAccount.has(accountId)) {
    return retryDueAtByAccount.get(accountId) ?? null;
  }
  const isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  if (!isOnline()) return null;

  const backend = options.backend ?? getDefaultRecordingBackend();
  const activeAccount = await getActiveRecordingAccount(backend);
  if (activeAccount && activeAccount !== accountId) {
    return null;
  }

  const now = options.now ?? (() => Date.now());
  const items = await listUploadQueueItems(accountId, backend);
  let earliestDueAt: number | null = null;
  for (const item of items) {
    if (item.status === 'uploaded' || item.permanentError) continue;
    const dueAt = item.nextRetryAt !== null ? item.nextRetryAt : item.status === 'pending' ? now() : null;
    if (dueAt !== null && (earliestDueAt === null || dueAt < earliestDueAt)) {
      earliestDueAt = dueAt;
    }
  }
  if (earliestDueAt === null) return null;
  if (!inFlightByAccount.has(accountId) && !retryTimersByAccount.has(accountId)) {
    scheduleNextRecordingUpload(options, earliestDueAt);
  }
  return earliestDueAt;
}

export async function enqueueFinalizedRecording(
  input: FinalizeAndEnqueueInput,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  nowMs = Date.now(),
): Promise<UploadQueueItem> {
  if (!backend.durable) {
    throw new RecordingPersistenceError(
      'STORAGE_UNAVAILABLE',
      '当前设备本地持久化存储不可用，已保留原生轨迹数据，请检查存储空间后重试保存。',
    );
  }
  const existing = await readUploadQueueItem(input.accountId, input.idempotencyKey, backend);
  if (existing && (existing.status === 'uploaded' || existing.gpxXml.length > 0)) {
    return existing;
  }
  const serialized = serializeRecordingToGpx({
    title: input.title,
    startedAtMs: input.startedAtMs,
    points: input.points,
  });
  const item: UploadQueueItem = {
    idempotencyKey: input.idempotencyKey,
    accountId: input.accountId,
    sessionId: input.sessionId,
    title: input.title.trim() || 'RunNote 实时跑步记录',
    timezone: input.timezone || 'Asia/Shanghai',
    startedAtMs: input.startedAtMs,
    endedAtMs: Math.max(input.endedAtMs, input.startedAtMs),
    pointCount: serialized.pointCount,
    segmentCount: serialized.segmentCount,
    previewDistanceM: serialized.previewDistanceM,
    activeDurationMs: Math.max(0, input.activeDurationMs),
    gpxXml: serialized.gpxXml,
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    permanentError: false,
    uploadedActivityId: null,
    serverDistanceM: null,
    serverDurationS: null,
    serverPaceSPerKm: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  await putUploadQueueItem(item, backend);
  const verified = await readUploadQueueItem(item.accountId, item.idempotencyKey, backend);
  if (
    !verified ||
    verified.idempotencyKey !== item.idempotencyKey ||
    verified.accountId !== item.accountId ||
    verified.gpxXml !== item.gpxXml
  ) {
    throw new RecordingPersistenceError(
      'STORAGE_VERIFY_FAILED',
      '本地上传队列持久化校验失败，已保留原生轨迹数据，请重试保存。',
    );
  }
  notifyQueueUpdated();
  return verified;
}

export async function flushRecordingUploadQueue(options: FlushUploadOptions): Promise<UploadFlushOutcome> {
  const { accountId } = options;
  const active = inFlightByAccount.get(accountId);
  if (active) return active;

  cancelScheduledRecordingUpload(accountId);
  const controller = new AbortController();
  activeControllersByAccount.set(accountId, controller);

  const work = runFlush(options, controller).finally(() => {
    inFlightByAccount.delete(accountId);
    if (activeControllersByAccount.get(accountId) === controller) {
      activeControllersByAccount.delete(accountId);
    }
  });
  inFlightByAccount.set(accountId, work);
  return work;
}

async function verifyActiveSessionAccount(
  expectedAccountId: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<'match' | 'expired' | 'mismatch' | 'aborted' | 'network_error'> {
  if (signal.aborted) return 'aborted';
  try {
    const activeUser = await readSession(fetcher);
    if (signal.aborted) return 'aborted';
    if (!activeUser) return 'expired';
    return activeUser.id === expectedAccountId ? 'match' : 'mismatch';
  } catch {
    if (signal.aborted) return 'aborted';
    return 'network_error';
  }
}

async function runFlush(options: FlushUploadOptions, controller: AbortController): Promise<UploadFlushOutcome> {
  const backend = options.backend ?? getDefaultRecordingBackend();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => Date.now());
  const isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const shouldSchedule = options.scheduleRetry !== false;

  const items = await listUploadQueueItems(options.accountId, backend);
  if (controller.signal.aborted) {
    return {
      status: 'aborted',
      uploadedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      uploadedActivityIds: [],
      nextRetryAt: null,
      message: null,
    };
  }

  const candidates = items.filter((item) => item.status !== 'uploaded' && !item.permanentError);
  if (candidates.length === 0) {
    return {
      status: 'idle',
      uploadedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      uploadedActivityIds: [],
      nextRetryAt: null,
      message: null,
    };
  }

  // Guard with active-account marker before issuing network requests: if another tab already
  // switched to a different account, atomically clean ONLY this stale account's records.
  const preemptedBefore = await clearAccountIfPreemptedAtomic(options.accountId, backend);
  if (preemptedBefore.preempted) {
    const msg = '检测到当前登录账号已切换，已取消上传并清理原账号待传轨迹。';
    notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
    return {
      status: 'account_mismatch',
      uploadedCount: 0,
      failedCount: candidates.length,
      pendingCount: 0,
      uploadedActivityIds: [],
      nextRetryAt: null,
      message: msg,
    };
  }

  if (!isOnline()) {
    return {
      status: 'offline',
      uploadedCount: 0,
      failedCount: 0,
      pendingCount: candidates.length,
      uploadedActivityIds: [],
      nextRetryAt: null,
      message: '当前处于离线状态，恢复网络后将自动上传。',
    };
  }

  let uploadedCount = 0;
  let failedCount = 0;
  let skippedBackoffCount = 0;
  let earliestNextRetryAt: number | null = null;
  const uploadedActivityIds: string[] = [];

  const trackNextRetry = (dueAt: number | null) => {
    if (dueAt !== null && (earliestNextRetryAt === null || dueAt < earliestNextRetryAt)) {
      earliestNextRetryAt = dueAt;
    }
  };

  const abortIfAccountSwitched = async (staleAccountId: string): Promise<UploadFlushOutcome | null> => {
    const preempted = await clearAccountIfPreemptedAtomic(staleAccountId, backend);
    if (preempted.preempted) {
      const msg = '检测到当前登录账号已切换，已取消上传并清理原账号待传轨迹。';
      notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
      return {
        status: 'account_mismatch',
        uploadedCount,
        failedCount: failedCount + 1,
        pendingCount: 0,
        uploadedActivityIds,
        nextRetryAt: null,
        message: msg,
      };
    }
    return null;
  };

  for (const item of candidates) {
    if (controller.signal.aborted) {
      return {
        status: 'aborted',
        uploadedCount,
        failedCount,
        pendingCount: 0,
        uploadedActivityIds,
        nextRetryAt: null,
        message: null,
      };
    }

    const currentNow = now();
    if (!options.forceRetry && item.nextRetryAt !== null && item.nextRetryAt > currentNow) {
      skippedBackoffCount += 1;
      trackNextRetry(item.nextRetryAt);
      continue;
    }

    const snapshotBeforeItem = await getActiveRecordingAccountSnapshot(backend);
    // Bind upload strictly to the queue item's owning account before requesting CSRF or posting.
    const identityCheck = await verifyActiveSessionAccount(item.accountId, fetcher, controller.signal);
    if (identityCheck === 'aborted' || controller.signal.aborted) {
      return {
        status: 'aborted',
        uploadedCount,
        failedCount,
        pendingCount: 0,
        uploadedActivityIds,
        nextRetryAt: null,
        message: null,
      };
    }
    if (identityCheck === 'mismatch') {
      const msg = '检测到当前登录账号已切换，已取消上传并清理原账号待传轨迹。';
      await clearStaleAccountGenerationAtomic(
        item.accountId,
        {
          expectedActiveAccountId: snapshotBeforeItem.activeAccountId,
          expectedSavedAt: snapshotBeforeItem.savedAt ?? undefined,
          expectedClaimRevision: snapshotBeforeItem.claimRevision,
          maxStaleClaimRevision:
            snapshotBeforeItem.activeAccountId === item.accountId
              ? (snapshotBeforeItem.claimRevision ?? snapshotBeforeItem.claimEpoch)
              : snapshotBeforeItem.claimEpoch,
        },
        backend,
      );
      notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
      return {
        status: 'account_mismatch',
        uploadedCount,
        failedCount: failedCount + 1,
        pendingCount: 0,
        uploadedActivityIds,
        nextRetryAt: null,
        message: msg,
      };
    }
    if (identityCheck === 'expired') {
      const preempted = await clearAccountIfPreemptedAtomic(item.accountId, backend);
      if (preempted.preempted) {
        const msg = '检测到当前登录账号已切换，已取消上传并清理原账号待传轨迹。';
        notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
        return {
          status: 'account_mismatch',
          uploadedCount,
          failedCount: failedCount + 1,
          pendingCount: 0,
          uploadedActivityIds,
          nextRetryAt: null,
          message: msg,
        };
      }
      await updateExistingUploadQueueItem(
        {
          ...item,
          status: 'failed',
          lastError: '登录状态已过期，重新登录后可继续上传。',
          nextRetryAt: null,
          updatedAtMs: now(),
        },
        backend,
      );
      notifyQueueUpdated();
      return {
        status: 'auth_expired',
        uploadedCount,
        failedCount: failedCount + 1,
        pendingCount: candidates.length - uploadedCount,
        uploadedActivityIds,
        nextRetryAt: null,
        message: '登录已过期，请重新登录后继续上传本地记录。',
      };
    }
    if (identityCheck === 'network_error') {
      const switched = await abortIfAccountSwitched(item.accountId);
      if (switched) return switched;
      const nextAttempts = item.attemptCount + 1;
      const dueAt = now() + computeBackoffDelayMs(nextAttempts);
      trackNextRetry(dueAt);
      await updateExistingUploadQueueItem(
        {
          ...item,
          status: 'failed',
          attemptCount: nextAttempts,
          nextRetryAt: dueAt,
          lastError: '无法连接服务确认身份，将在退避后自动重试。',
          permanentError: false,
          updatedAtMs: now(),
        },
        backend,
      );
      failedCount += 1;
      continue;
    }

    const switchedBeforeUploading = await abortIfAccountSwitched(item.accountId);
    if (switchedBeforeUploading) return switchedBeforeUploading;

    const uploading: UploadQueueItem = {
      ...item,
      status: 'uploading',
      updatedAtMs: currentNow,
    };
    const markedUploading = await updateExistingUploadQueueItem(uploading, backend);
    if (!markedUploading) {
      continue;
    }
    notifyQueueUpdated();

    try {
      const form = new FormData();
      const file = new File([item.gpxXml], `runnote-recording-${item.idempotencyKey}.gpx`, {
        type: 'application/gpx+xml',
      });
      form.append('file', file);
      form.append('time_mode', 'absolute');
      form.append('expected_owner_id', item.accountId);
      if (item.timezone) form.append('timezone', item.timezone);
      if (item.title.trim()) form.append('title', item.title.trim().slice(0, 120));

      const result = await uploadGpx(form, fetcher, {
        idempotencyKey: item.idempotencyKey,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return {
          status: 'aborted',
          uploadedCount,
          failedCount,
          pendingCount: 0,
          uploadedActivityIds,
          nextRetryAt: null,
          message: null,
        };
      }

      const switchedAfterUpload = await abortIfAccountSwitched(item.accountId);
      if (switchedAfterUpload) return switchedAfterUpload;

      const completed: UploadQueueItem = {
        ...uploading,
        status: 'uploaded',
        gpxXml: '', // Free raw track bytes once server has authoritatively persisted the activity.
        lastError: null,
        nextRetryAt: null,
        permanentError: false,
        uploadedActivityId: result.activity.id,
        serverDistanceM: result.activity.distance_m !== null ? String(result.activity.distance_m) : null,
        serverDurationS: result.activity.elapsed_seconds !== null ? String(result.activity.elapsed_seconds) : null,
        serverPaceSPerKm:
          result.activity.avg_pace_seconds_per_km !== null ? String(result.activity.avg_pace_seconds_per_km) : null,
        updatedAtMs: now(),
      };
      await updateExistingUploadQueueItem(completed, backend);
      uploadedCount += 1;
      uploadedActivityIds.push(result.activity.id);
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof ActivityError && cause.code === 'ABORTED')) {
        return {
          status: 'aborted',
          uploadedCount,
          failedCount,
          pendingCount: 0,
          uploadedActivityIds,
          nextRetryAt: null,
          message: null,
        };
      }

      if (cause instanceof ActivityError && cause.status === 409 && cause.code === 'ACCOUNT_MISMATCH') {
        const msg = '当前登录账号已变更，已中止上传并清理原账号待传轨迹。';
        await clearStaleAccountGenerationAtomic(
          item.accountId,
          {
            expectedActiveAccountId: snapshotBeforeItem.activeAccountId,
            expectedSavedAt: snapshotBeforeItem.savedAt ?? undefined,
            expectedClaimRevision: snapshotBeforeItem.claimRevision,
            maxStaleClaimRevision:
              snapshotBeforeItem.activeAccountId === item.accountId
                ? (snapshotBeforeItem.claimRevision ?? snapshotBeforeItem.claimEpoch)
                : snapshotBeforeItem.claimEpoch,
          },
          backend,
        );
        notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
        return {
          status: 'account_mismatch',
          uploadedCount,
          failedCount: failedCount + 1,
          pendingCount: 0,
          uploadedActivityIds,
          nextRetryAt: null,
          message: msg,
        };
      }

      if (cause instanceof ActivityError && cause.status === 401) {
        const preempted = await clearAccountIfPreemptedAtomic(item.accountId, backend);
        if (preempted.preempted) {
          const msg = '当前登录账号已变更，已中止上传并清理原账号待传轨迹。';
          notifyQueueUpdated({ reason: 'account_mismatch', message: msg });
          return {
            status: 'account_mismatch',
            uploadedCount,
            failedCount: failedCount + 1,
            pendingCount: 0,
            uploadedActivityIds,
            nextRetryAt: null,
            message: msg,
          };
        }
        await updateExistingUploadQueueItem(
          {
            ...uploading,
            status: 'failed',
            lastError: '登录状态已过期，重新登录后可继续上传。',
            nextRetryAt: null,
            updatedAtMs: now(),
          },
          backend,
        );
        notifyQueueUpdated();
        return {
          status: 'auth_expired',
          uploadedCount,
          failedCount: failedCount + 1,
          pendingCount: candidates.length - uploadedCount,
          uploadedActivityIds,
          nextRetryAt: null,
          message: '登录已过期，请重新登录后继续上传本地记录。',
        };
      }

      if (cause instanceof ActivityError && cause.status === 409 && cause.existingActivityId) {
        const switchedOnDup = await abortIfAccountSwitched(item.accountId);
        if (switchedOnDup) return switchedOnDup;
        const deduplicated: UploadQueueItem = {
          ...uploading,
          status: 'uploaded',
          gpxXml: '',
          lastError: null,
          nextRetryAt: null,
          permanentError: false,
          uploadedActivityId: cause.existingActivityId,
          updatedAtMs: now(),
        };
        await updateExistingUploadQueueItem(deduplicated, backend);
        uploadedCount += 1;
        uploadedActivityIds.push(cause.existingActivityId);
        continue;
      }

      const switchedOnFailure = await abortIfAccountSwitched(item.accountId);
      if (switchedOnFailure) return switchedOnFailure;

      const nextAttempts = uploading.attemptCount + 1;
      const transient = isTransientUploadError(cause);
      const delayMs = transient ? computeBackoffDelayMs(nextAttempts) : null;
      const dueAt = delayMs !== null ? now() + delayMs : null;
      trackNextRetry(dueAt);
      const message = cause instanceof Error ? cause.message : '上传失败，请稍后重试';
      await updateExistingUploadQueueItem(
        {
          ...uploading,
          status: 'failed',
          attemptCount: nextAttempts,
          nextRetryAt: dueAt,
          lastError: message,
          permanentError: !transient,
          updatedAtMs: now(),
        },
        backend,
      );
      failedCount += 1;
    }
  }

  notifyQueueUpdated();
  if (uploadedCount > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
  }

  if (shouldSchedule && earliestNextRetryAt !== null && isOnline() && !controller.signal.aborted) {
    scheduleNextRecordingUpload(options, earliestNextRetryAt);
  }

  const remaining = failedCount + skippedBackoffCount;
  if (failedCount > 0 && uploadedCount === 0) {
    return {
      status: 'failed',
      uploadedCount,
      failedCount,
      pendingCount: remaining,
      uploadedActivityIds,
      nextRetryAt: earliestNextRetryAt,
      message: '部分记录上传失败，已进入退避自动重试队列。',
    };
  }
  if (remaining > 0) {
    return {
      status: 'partial',
      uploadedCount,
      failedCount,
      pendingCount: remaining,
      uploadedActivityIds,
      nextRetryAt: earliestNextRetryAt,
      message:
        uploadedCount > 0
          ? `已上传 ${uploadedCount} 条，仍有 ${remaining} 条等待退避自动重试。`
          : `仍有 ${remaining} 条等待退避自动重试。`,
    };
  }
  return {
    status: 'uploaded',
    uploadedCount,
    failedCount: 0,
    pendingCount: 0,
    uploadedActivityIds,
    nextRetryAt: null,
    message: null,
  };
}

export async function discardUploadQueueItem(
  accountId: string,
  idempotencyKey: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  await deleteUploadQueueItem(accountId, idempotencyKey, backend);
  notifyQueueUpdated();
}
