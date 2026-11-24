import { describe, expect, it } from 'vitest';
import {
  clearPrivateRecordingData,
  createMemoryRecordingBackend,
  ensureRecordingAccountIsolation,
  listUploadQueueItems,
  putUploadQueueItem,
  readActiveRecordingDraft,
  saveActiveRecordingDraft,
  type LocalRecordingDraft,
  type UploadQueueItem,
} from '../../src/lib/recording-store.ts';

function sampleDraft(accountId: string): LocalRecordingDraft {
  return {
    sessionId: 'sess-1',
    accountId,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    title: '晨跑',
    status: 'paused',
    startedAtMs: 1_700_000_000_000,
    endedAtMs: null,
    activeDurationMs: 120_000,
    lastSegmentStartMs: null,
    segmentIndex: 0,
    previewDistanceM: 420,
    lastPointTimeMs: 1_700_000_120_000,
    lastAccuracyM: 8,
    interruptedReason: null,
    points: [
      { lat: 31.23, lon: 121.47, elevationM: 10, accuracyM: 8, recordedAtMs: 1_700_000_000_000, segmentIndex: 0 },
    ],
  };
}

function sampleUpload(accountId: string, idempotencyKey: string): UploadQueueItem {
  return {
    idempotencyKey,
    accountId,
    sessionId: 'sess-1',
    title: '离线晨跑',
    timezone: 'Asia/Shanghai',
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_600_000,
    pointCount: 2,
    segmentCount: 1,
    previewDistanceM: 500,
    activeDurationMs: 600_000,
    gpxXml: '<gpx version="1.1"></gpx>',
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    permanentError: false,
    uploadedActivityId: null,
    serverDistanceM: null,
    serverDurationS: null,
    serverPaceSPerKm: null,
    createdAtMs: 1_700_000_600_000,
    updatedAtMs: 1_700_000_600_000,
  };
}

describe('recording-store account isolation and persistence', () => {
  it('persists drafts and upload queue items scoped by account and wipes on account switch', async () => {
    const backend = createMemoryRecordingBackend();
    await ensureRecordingAccountIsolation('user-a', backend);
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', '11111111-1111-4111-8111-111111111111'), backend);

    expect((await readActiveRecordingDraft('user-a', backend))?.sessionId).toBe('sess-1');
    expect(await listUploadQueueItems('user-a', backend)).toHaveLength(1);
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(0);

    // Account switch wipes all prior account data immediately
    const wiped = await ensureRecordingAccountIsolation('user-b', backend);
    expect(wiped).toBe(true);
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await listUploadQueueItems('user-a', backend)).toHaveLength(0);
  });

  it('clears all private recording data on logout', async () => {
    const backend = createMemoryRecordingBackend();
    await ensureRecordingAccountIsolation('user-a', backend);
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', '22222222-2222-4222-8222-222222222222'), backend);

    await clearPrivateRecordingData(backend);
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await listUploadQueueItems('user-a', backend)).toHaveLength(0);
  });

  it('rejects payloads containing forbidden sensitive keys', async () => {
    const backend = createMemoryRecordingBackend();
    const unsafe = { ...sampleDraft('user-a'), csrf_token: 'secret' } as unknown as LocalRecordingDraft;
    await expect(saveActiveRecordingDraft(unsafe, backend)).rejects.toThrow(/sensitive/i);
  });
});
