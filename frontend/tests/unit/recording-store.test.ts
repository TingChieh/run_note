import { describe, expect, it } from 'vitest';
import {
  RecordingPersistenceError,
  claimRecordingAccountIfUnsetOrMatch,
  clearAccountRecordingData,
  clearPrivateRecordingData,
  createIndexedDbRecordingBackend,
  createMemoryRecordingBackend,
  ensureRecordingAccountIsolation,
  getActiveRecordingAccount,
  listUploadQueueItems,
  putUploadQueueItem,
  readActiveRecordingDraft,
  readUploadQueueItem,
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

  it('rejects IndexedDB writes if transaction aborts during request success or emits error, and resolves only on complete', async () => {
    type FakeMode = 'commit' | 'abort-on-put-success' | 'tx-error';
    let mode: FakeMode = 'commit';
    const committedStore = new Map<string, unknown>();

    const makeFakeFactory = (): {
      factory: IDBFactory;
      triggerComplete: () => void;
      events: string[];
    } => {
      let pendingComplete: (() => void) | null = null;
      const events: string[] = [];

      const createReq = <T>(
        setup: (
          req: EventTarget & { result: T; error: DOMException | null; onupgradeneeded: (() => void) | null },
        ) => void,
      ) => {
        const target = new EventTarget() as EventTarget & {
          result: T;
          error: DOMException | null;
          onupgradeneeded: (() => void) | null;
        };
        target.error = null;
        target.onupgradeneeded = null;
        queueMicrotask(() => setup(target));
        return target;
      };

      const fakeDb = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: () => {
          const tx = new EventTarget() as EventTarget & {
            error: DOMException | null;
            abort: () => void;
            objectStore: () => IDBObjectStore;
          };
          tx.error = null;
          const staged = new Map(committedStore);
          let aborted = false;

          tx.abort = () => {
            if (aborted) return;
            aborted = true;
            tx.error = new DOMException('Aborted transaction', 'AbortError');
            queueMicrotask(() => {
              events.push('tx:abort');
              tx.dispatchEvent(new Event('abort'));
            });
          };

          const finishCommit = () => {
            if (aborted) return;
            for (const [k, v] of staged.entries()) {
              committedStore.set(k, v);
            }
            events.push('tx:complete');
            tx.dispatchEvent(new Event('complete'));
          };

          const scheduleFinish = () => {
            if (aborted) return;
            if (mode === 'tx-error') {
              tx.error = new DOMException('Quota exceeded', 'QuotaExceededError');
              queueMicrotask(() => {
                events.push('tx:error');
                tx.dispatchEvent(new Event('error'));
              });
              return;
            }
            if (mode === 'commit') {
              pendingComplete = finishCommit;
            }
          };

          const objectStore = {
            get(key: string) {
              return createReq<unknown>((req) => {
                req.result = staged.get(key);
                req.dispatchEvent(new Event('success'));
                scheduleFinish();
              });
            },
            put(entry: { key: string }) {
              return createReq<IDBValidKey>((req) => {
                staged.set(entry.key, structuredClone(entry));
                events.push('put:success');
                req.result = entry.key;
                req.dispatchEvent(new Event('success'));
                if (mode === 'abort-on-put-success') {
                  tx.abort();
                } else {
                  scheduleFinish();
                }
              });
            },
            delete(key: string) {
              return createReq<undefined>((req) => {
                staged.delete(key);
                req.result = undefined;
                req.dispatchEvent(new Event('success'));
                scheduleFinish();
              });
            },
            getAll() {
              return createReq<unknown[]>((req) => {
                req.result = Array.from(staged.values());
                req.dispatchEvent(new Event('success'));
                scheduleFinish();
              });
            },
            clear() {
              return createReq<undefined>((req) => {
                staged.clear();
                req.result = undefined;
                req.dispatchEvent(new Event('success'));
                scheduleFinish();
              });
            },
          };

          tx.objectStore = () => objectStore as unknown as IDBObjectStore;
          return tx as unknown as IDBTransaction;
        },
      } as unknown as IDBDatabase;

      const factory = {
        open: () =>
          createReq<IDBDatabase>((req) => {
            req.result = fakeDb;
            req.onupgradeneeded?.();
            req.dispatchEvent(new Event('success'));
          }),
      } as unknown as IDBFactory;

      return {
        factory,
        triggerComplete: () => {
          const fn = pendingComplete;
          pendingComplete = null;
          fn?.();
        },
        events,
      };
    };

    const fake = makeFakeFactory();
    const backend = createIndexedDbRecordingBackend('test-recording-db', fake.factory);
    expect(backend.durable).toBe(true);

    // 1. Resolve ONLY on transaction complete (remains pending after put:success until tx:complete)
    let resolved = false;
    const item1 = sampleUpload('user-a', '33333333-3333-4333-8333-333333333333');
    const writePromise = putUploadQueueItem(item1, backend).then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.events).toContain('put:success');
    expect(resolved).toBe(false);
    fake.triggerComplete();
    await writePromise;
    expect(resolved).toBe(true);
    expect(fake.events).toEqual(['put:success', 'tx:complete']);

    // Read-back completes cleanly when transaction commits
    const readPromise = readUploadQueueItem('user-a', item1.idempotencyKey, backend);
    await new Promise((r) => setTimeout(r, 10));
    fake.triggerComplete();
    expect((await readPromise)?.idempotencyKey).toBe(item1.idempotencyKey);

    // 2. Abort triggered during put:success MUST reject and must NOT persist data
    mode = 'abort-on-put-success';
    const item2 = sampleUpload('user-a', '44444444-4444-4444-8444-444444444444');
    await expect(putUploadQueueItem(item2, backend)).rejects.toMatchObject({
      name: 'RecordingPersistenceError',
      code: 'STORAGE_TX_ABORTED',
    });
    expect(committedStore.has(`user:user-a:upload:${item2.idempotencyKey}`)).toBe(false);

    // 3. Transaction error MUST reject with STORAGE_TX_ERROR
    mode = 'tx-error';
    await expect(putUploadQueueItem(item2, backend)).rejects.toMatchObject({
      name: 'RecordingPersistenceError',
      code: 'STORAGE_TX_ERROR',
    });
  });

  it('marks unavailable/failing IndexedDB backends as non-durable or rejects with STORAGE_UNAVAILABLE', async () => {
    const missingIdb = createIndexedDbRecordingBackend('missing-db', undefined);
    expect(missingIdb.durable).toBe(false);
    await expect(
      putUploadQueueItem(sampleUpload('user-a', '55555555-5555-4555-8555-555555555555'), missingIdb),
    ).rejects.toBeInstanceOf(RecordingPersistenceError);

    const brokenFactory = {
      open: () => {
        const req = new EventTarget() as EventTarget & { error: DOMException | null; onupgradeneeded: null };
        req.error = new DOMException('Storage disabled', 'UnknownError');
        req.onupgradeneeded = null;
        queueMicrotask(() => req.dispatchEvent(new Event('error')));
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    const brokenBackend = createIndexedDbRecordingBackend('broken-db', brokenFactory);
    await expect(
      putUploadQueueItem(sampleUpload('user-a', '55555555-5555-4555-8555-555555555555'), brokenBackend),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('scopes stale-account cleanup strictly to stale account and protects active account B', async () => {
    const backend = createMemoryRecordingBackend({ durableForTests: true });
    await ensureRecordingAccountIsolation('user-b', backend);
    await saveActiveRecordingDraft(sampleDraft('user-b'), backend);
    await putUploadQueueItem(sampleUpload('user-b', '66666666-6666-4666-8666-666666666666'), backend);

    // Seed stale account A records without touching active marker (simulating suspended tab A leftovers)
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', '77777777-7777-4777-8777-777777777777'), backend);

    // Claim check for A detects conflict and never deletes B
    expect(await claimRecordingAccountIfUnsetOrMatch('user-a', backend)).toBe('conflict');
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);

    // Clearing stale account A leaves B draft, queue, and active marker completely intact
    const removed = await clearAccountRecordingData('user-a', backend);
    expect(removed).toBe(2);
    expect(await listUploadQueueItems('user-a', backend)).toHaveLength(0);
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-1');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);
  });
});
