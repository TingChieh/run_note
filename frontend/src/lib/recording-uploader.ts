import { ActivityError, uploadGpx } from '#lib/api/activities.ts';
import {
  deleteUploadQueueItem,
  getDefaultRecordingBackend,
  listUploadQueueItems,
  putUploadQueueItem,
  type RecordingStorageBackend,
  type UploadQueueItem,
} from '#lib/recording-store.ts';
import { serializeRecordingToGpx, type RecordedTrackPoint } from '#lib/gpx-serializer.ts';

/**
 * Single-flight idempotent upload engine for finalized Phase 3 running recordings.
 *
 * Guarantees:
 * - Reuses `POST /api/v1/gpx-imports` with client-generated UUID `Idempotency-Key` header.
 * - Retrying after offline/airplane-mode/timeout/503 never creates duplicate activities:
 *   server replays 200 OK for same key + payload, and `409 GPX_DUPLICATE` links to `existingActivityId`.
 * - Exponential backoff on transient failures (`5s -> 15s -> 45s -> 120s -> 300s`).
 * - Stops immediately on 401 without silently discarding the user's queued track; account switch
 *   or explicit logout clears private storage cleanly.
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
  status: 'idle' | 'offline' | 'uploaded' | 'partial' | 'auth_expired' | 'failed';
  uploadedCount: number;
  failedCount: number;
  pendingCount: number;
  uploadedActivityIds: string[];
  message: string | null;
}

const inFlightByAccount = new Map<string, Promise<UploadFlushOutcome>>();

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

export async function enqueueFinalizedRecording(
  input: FinalizeAndEnqueueInput,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
  nowMs = Date.now(),
): Promise<UploadQueueItem> {
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
  return item;
}

export async function flushRecordingUploadQueue(options: {
  accountId: string;
  fetcher?: typeof fetch;
  backend?: RecordingStorageBackend;
  forceRetry?: boolean;
  now?: () => number;
  isOnline?: () => boolean;
}): Promise<UploadFlushOutcome> {
  const { accountId } = options;
  const active = inFlightByAccount.get(accountId);
  if (active) return active;

  const work = runFlush(options).finally(() => {
    inFlightByAccount.delete(accountId);
  });
  inFlightByAccount.set(accountId, work);
  return work;
}

async function runFlush(options: {
  accountId: string;
  fetcher?: typeof fetch;
  backend?: RecordingStorageBackend;
  forceRetry?: boolean;
  now?: () => number;
  isOnline?: () => boolean;
}): Promise<UploadFlushOutcome> {
  const backend = options.backend ?? getDefaultRecordingBackend();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => Date.now());
  const isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const items = await listUploadQueueItems(options.accountId, backend);
  const candidates = items.filter((item) => item.status !== 'uploaded' && !item.permanentError);
  if (candidates.length === 0) {
    return {
      status: 'idle',
      uploadedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      uploadedActivityIds: [],
      message: null,
    };
  }

  if (!isOnline()) {
    return {
      status: 'offline',
      uploadedCount: 0,
      failedCount: 0,
      pendingCount: candidates.length,
      uploadedActivityIds: [],
      message: '当前处于离线状态，恢复网络后将自动上传。',
    };
  }

  let uploadedCount = 0;
  let failedCount = 0;
  let skippedBackoffCount = 0;
  const uploadedActivityIds: string[] = [];

  for (const item of candidates) {
    const currentNow = now();
    if (!options.forceRetry && item.nextRetryAt !== null && item.nextRetryAt > currentNow) {
      skippedBackoffCount += 1;
      continue;
    }

    const uploading: UploadQueueItem = {
      ...item,
      status: 'uploading',
      updatedAtMs: currentNow,
    };
    await putUploadQueueItem(uploading, backend);

    try {
      const form = new FormData();
      const file = new File([item.gpxXml], `runnote-recording-${item.idempotencyKey}.gpx`, {
        type: 'application/gpx+xml',
      });
      form.append('file', file);
      form.append('time_mode', 'absolute');
      if (item.timezone) form.append('timezone', item.timezone);
      if (item.title.trim()) form.append('title', item.title.trim().slice(0, 120));

      const result = await uploadGpx(form, fetcher, { idempotencyKey: item.idempotencyKey });
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
      await putUploadQueueItem(completed, backend);
      uploadedCount += 1;
      uploadedActivityIds.push(result.activity.id);
    } catch (cause) {
      if (cause instanceof ActivityError && cause.status === 401) {
        await putUploadQueueItem(
          {
            ...uploading,
            status: 'failed',
            lastError: '登录状态已过期，重新登录后可继续上传。',
            nextRetryAt: null,
            updatedAtMs: now(),
          },
          backend,
        );
        return {
          status: 'auth_expired',
          uploadedCount,
          failedCount: failedCount + 1,
          pendingCount: candidates.length - uploadedCount,
          uploadedActivityIds,
          message: '登录已过期，请重新登录后继续上传本地记录。',
        };
      }

      if (cause instanceof ActivityError && cause.status === 409 && cause.existingActivityId) {
        // Server confirmed this exact track was already imported — resolve idempotently without duplicating.
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
        await putUploadQueueItem(deduplicated, backend);
        uploadedCount += 1;
        uploadedActivityIds.push(cause.existingActivityId);
        continue;
      }

      const nextAttempts = uploading.attemptCount + 1;
      const transient = isTransientUploadError(cause);
      const delayMs = transient ? computeBackoffDelayMs(nextAttempts) : null;
      const message = cause instanceof Error ? cause.message : '上传失败，请稍后重试';
      await putUploadQueueItem(
        {
          ...uploading,
          status: 'failed',
          attemptCount: nextAttempts,
          nextRetryAt: delayMs !== null ? now() + delayMs : null,
          lastError: message,
          permanentError: !transient,
          updatedAtMs: now(),
        },
        backend,
      );
      failedCount += 1;
    }
  }

  if (uploadedCount > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
  }

  const remaining = failedCount + skippedBackoffCount;
  if (failedCount > 0 && uploadedCount === 0) {
    return {
      status: 'failed',
      uploadedCount,
      failedCount,
      pendingCount: remaining,
      uploadedActivityIds,
      message: '部分记录上传失败，已进入退避重试队列。',
    };
  }
  if (remaining > 0) {
    return {
      status: 'partial',
      uploadedCount,
      failedCount,
      pendingCount: remaining,
      uploadedActivityIds,
      message: `已上传 ${uploadedCount} 条，仍有 ${remaining} 条待重试。`,
    };
  }
  return {
    status: 'uploaded',
    uploadedCount,
    failedCount: 0,
    pendingCount: 0,
    uploadedActivityIds,
    message: null,
  };
}

export async function discardUploadQueueItem(
  accountId: string,
  idempotencyKey: string,
  backend: RecordingStorageBackend = getDefaultRecordingBackend(),
): Promise<void> {
  await deleteUploadQueueItem(accountId, idempotencyKey, backend);
}
