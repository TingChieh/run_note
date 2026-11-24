import { describe, expect, it } from 'vitest';
import {
  RecordingPersistenceError,
  claimRecordingAccountAtomic,
  claimRecordingAccountIfUnsetOrMatch,
  clearAccountIfPreemptedAtomic,
  clearAccountRecordingData,
  clearPrivateRecordingData,
  clearStaleAccountGenerationAtomic,
  clearStaleRecordingAccountAtomic,
  createIndexedDbRecordingBackend,
  createMemoryRecordingBackend,
  deleteActiveRecordingDraft,
  ensureRecordingAccountIsolation,
  getActiveRecordingAccount,
  getActiveRecordingAccountSnapshot,
  listUploadQueueItems,
  putUploadQueueItem,
  readActiveRecordingDraft,
  readActiveRecordingDraftWithMeta,
  readUploadQueueItem,
  reconcileVerifiedRecordingAccount,
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

function createSerializedFakeIdbFactory() {
  const committedStore = new Map<string, unknown>();
  const txLogs: Array<{
    id: number;
    mode: IDBTransactionMode;
    ops: Array<{ op: 'get' | 'getAll' | 'put' | 'delete' | 'clear'; key?: string }>;
  }> = [];
  let txSeq = 0;
  let txQueue = Promise.resolve();
  let holdNextReadwriteGate: Promise<void> | null = null;
  let onNextReadwriteStarted: (() => void) | null = null;

  const createReq = <T>(
    setup: (req: EventTarget & { result: T; error: DOMException | null; onupgradeneeded: (() => void) | null }) => void,
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
    transaction: (_storeName: string, mode: IDBTransactionMode = 'readonly') => {
      const txId = ++txSeq;
      const log = {
        id: txId,
        mode,
        ops: [] as Array<{ op: 'get' | 'getAll' | 'put' | 'delete' | 'clear'; key?: string }>,
      };
      txLogs.push(log);

      const tx = new EventTarget() as EventTarget & {
        error: DOMException | null;
        abort: () => void;
        objectStore: () => IDBObjectStore;
      };
      tx.error = null;
      let aborted = false;
      let commitTimer: ReturnType<typeof setTimeout> | null = null;
      let staged!: Map<string, unknown>;
      let releaseTurn!: () => void;

      const gate = holdNextReadwriteGate && mode === 'readwrite' ? holdNextReadwriteGate : null;
      const notifyStarted = mode === 'readwrite' ? onNextReadwriteStarted : null;
      if (gate) {
        holdNextReadwriteGate = null;
        onNextReadwriteStarted = null;
      }

      const txReady =
        mode === 'readwrite'
          ? new Promise<void>((resolve) => {
              txQueue = txQueue.then(
                () =>
                  new Promise<void>((done) => {
                    releaseTurn = done;
                    staged = new Map(committedStore);
                    resolve();
                  }),
              );
            })
          : Promise.resolve().then(() => {
              staged = new Map(committedStore);
            });

      const scheduleAutoCommit = () => {
        if (aborted) return;
        if (commitTimer !== null) clearTimeout(commitTimer);
        commitTimer = setTimeout(() => {
          commitTimer = null;
          if (aborted) return;
          if (mode === 'readwrite') {
            committedStore.clear();
            for (const [k, v] of staged.entries()) {
              committedStore.set(k, v);
            }
          }
          releaseTurn?.();
          tx.dispatchEvent(new Event('complete'));
        }, 0);
      };

      tx.abort = () => {
        if (aborted) return;
        aborted = true;
        if (commitTimer !== null) {
          clearTimeout(commitTimer);
          commitTimer = null;
        }
        tx.error = new DOMException('Aborted transaction', 'AbortError');
        queueMicrotask(() => {
          releaseTurn?.();
          tx.dispatchEvent(new Event('abort'));
        });
      };

      let gatedOnce = false;
      const runOp = <T>(fn: (req: EventTarget & { result: T; error: DOMException | null }) => void) => {
        if (commitTimer !== null) {
          clearTimeout(commitTimer);
          commitTimer = null;
        }
        return createReq<T>((req) => {
          void txReady.then(async () => {
            if (aborted) return;
            if (gate && !gatedOnce) {
              gatedOnce = true;
              notifyStarted?.();
              await gate;
              if (aborted) return;
            }
            fn(req);
            scheduleAutoCommit();
          });
        });
      };

      const objectStore = {
        get(key: string) {
          log.ops.push({ op: 'get', key });
          return runOp<unknown>((req) => {
            req.result = staged.get(key);
            req.dispatchEvent(new Event('success'));
          });
        },
        put(entry: { key: string }) {
          log.ops.push({ op: 'put', key: entry.key });
          return runOp<IDBValidKey>((req) => {
            staged.set(entry.key, structuredClone(entry));
            req.result = entry.key;
            req.dispatchEvent(new Event('success'));
          });
        },
        delete(key: string) {
          log.ops.push({ op: 'delete', key });
          return runOp<undefined>((req) => {
            staged.delete(key);
            req.result = undefined;
            req.dispatchEvent(new Event('success'));
          });
        },
        getAll() {
          log.ops.push({ op: 'getAll' });
          return runOp<unknown[]>((req) => {
            req.result = Array.from(staged.values()).map((v) => structuredClone(v));
            req.dispatchEvent(new Event('success'));
          });
        },
        clear() {
          log.ops.push({ op: 'clear' });
          return runOp<undefined>((req) => {
            staged.clear();
            req.result = undefined;
            req.dispatchEvent(new Event('success'));
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
    committedStore,
    txLogs,
    holdNextReadwrite(): { started: Promise<void>; release: () => void } {
      let release!: () => void;
      holdNextReadwriteGate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        onNextReadwriteStarted = r;
      });
      return { started, release };
    },
  };
}

describe('recording-store Round 3 atomic guard, interleaving, and preemption', () => {
  it('reconcileVerifiedRecordingAccount removes only expired A records and preserves newly active B data on interleaving', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round3-interleave', fake.factory);

    // Tab A had an active session + expired draft and upload queue item
    await ensureRecordingAccountIsolation('user-a', backend);
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-1111-4111-8111-111111111111'), backend);

    // Interleaving: A read session 'user-a' earlier, then Tab B switches to 'user-b' and enqueues B's data
    await ensureRecordingAccountIsolation('user-b', backend);
    await saveActiveRecordingDraft({ ...sampleDraft('user-b'), sessionId: 'sess-b' }, backend);
    await putUploadQueueItem(sampleUpload('user-b', 'bbbbbbbb-1111-4111-8111-111111111111'), backend);

    // Now Tab A reconciles; re-verification shows server session is now 'user-b'
    const res = await reconcileVerifiedRecordingAccount({
      accountId: 'user-a',
      verifySession: async () => ({ id: 'user-b' }),
      backend,
    });
    expect(res).toEqual({
      status: 'stale',
      confirmedAccountId: 'user-b',
      activeAccountId: 'user-b',
    });

    // Account A's expired records are removed; Account B's marker, draft, and queue remain intact
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await listUploadQueueItems('user-a', backend)).toEqual([]);
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-b');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);

    // Also verify when session expired completely (verifySession returns null)
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-2222-4222-8222-222222222222'), backend);
    const expiredRes = await reconcileVerifiedRecordingAccount({
      accountId: 'user-a',
      verifySession: async () => null,
      backend,
    });
    expect(expiredRes).toEqual({
      status: 'stale',
      confirmedAccountId: null,
      activeAccountId: 'user-b',
    });
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await listUploadQueueItems('user-a', backend)).toEqual([]);
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-b');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);
  });

  it('clearStaleRecordingAccountAtomic executes check + delete + marker update in one tx and aborts cleanly if marker changed', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round3-guarded-cleanup', fake.factory);

    const claimA = await claimRecordingAccountAtomic('user-a', backend, 1_000);
    expect(claimA.status).toBe('claimed');
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-3333-4333-8333-333333333333'), backend);

    // Another tab switches to user-b before A's guarded cleanup runs
    await ensureRecordingAccountIsolation('user-b', backend);
    await saveActiveRecordingDraft({ ...sampleDraft('user-b'), sessionId: 'sess-b' }, backend);
    await putUploadQueueItem(sampleUpload('user-b', 'bbbbbbbb-3333-4333-8333-333333333333'), backend);
    // Re-seed user-a entry to verify even stale entries are not touched when guard fails
    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);

    const txCountBefore = fake.txLogs.length;
    const aborted = await clearStaleRecordingAccountAtomic(
      {
        staleAccountId: 'user-a',
        nextAccountId: 'user-c',
        guard: {
          expectedAccountId: 'user-a',
          expectedSavedAt: claimA.savedAt ?? undefined,
          expectedClaimRevision: claimA.claimRevision,
        },
      },
      backend,
      2_000,
    );
    expect(aborted).toEqual({ status: 'aborted', removedCount: 0, activeAccountId: 'user-b' });
    const cleanupTxs = fake.txLogs.slice(txCountBefore);
    expect(cleanupTxs).toHaveLength(1);
    expect(cleanupTxs[0].mode).toBe('readwrite');
    expect(cleanupTxs[0].ops.some((o) => o.op === 'delete' || o.op === 'put')).toBe(false);

    // All records and active marker remain completely intact
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-b');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);
    expect(await readActiveRecordingDraft('user-a', backend)).not.toBeNull();

    // Also test revision mismatch on same account name (re-claimed later)
    const claimB = await claimRecordingAccountAtomic('user-b', backend, 3_000);
    const revMismatch = await clearStaleRecordingAccountAtomic(
      {
        staleAccountId: 'user-b',
        nextAccountId: 'user-c',
        guard: {
          expectedAccountId: 'user-b',
          expectedClaimRevision: (claimB.claimRevision ?? 1) - 1,
        },
      },
      backend,
      4_000,
    );
    expect(revMismatch.status).toBe('aborted');
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');

    // When guard matches user-b, ONLY user-b is removed and marker becomes user-c in 1 single transaction
    const txBeforeSuccess = fake.txLogs.length;
    const cleaned = await clearStaleRecordingAccountAtomic(
      {
        staleAccountId: 'user-b',
        nextAccountId: 'user-c',
        guard: {
          expectedAccountId: 'user-b',
          expectedSavedAt: claimB.savedAt ?? undefined,
          expectedClaimRevision: claimB.claimRevision,
        },
      },
      backend,
      5_000,
    );
    expect(cleaned).toEqual({ status: 'cleaned', removedCount: 2, activeAccountId: 'user-c' });
    expect(fake.txLogs.slice(txBeforeSuccess)).toHaveLength(1);
    expect(await getActiveRecordingAccount(backend)).toBe('user-c');
    expect(await readActiveRecordingDraft('user-b', backend)).toBeNull();
    expect(await listUploadQueueItems('user-b', backend)).toEqual([]);
    // Non-target user-a draft was not deleted because cleanup targeted only staleAccountId='user-b'
    expect(await readActiveRecordingDraft('user-a', backend)).not.toBeNull();
  });

  it('claimRecordingAccountAtomic and claimRecordingAccountIfUnsetOrMatch serialize concurrent claims in a single transaction', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round3-concurrent-claim', fake.factory);

    // Hold the first readwrite transaction while a second claim starts concurrently
    const gate = fake.holdNextReadwrite();
    const txCountBefore = fake.txLogs.length;
    const claimAPromise = claimRecordingAccountAtomic('user-a', backend, 1_000);
    await gate.started;
    const claimBPromise = claimRecordingAccountIfUnsetOrMatch('user-b', backend);
    gate.release();

    const [resA, resB] = await Promise.all([claimAPromise, claimBPromise]);
    expect(resA.status).toBe('claimed');
    expect(resA.activeAccountId).toBe('user-a');
    expect(resB).toBe('conflict');

    // Each claim used exactly 1 readwrite transaction (no separate get then put transactions)
    const claimTxs = fake.txLogs.slice(txCountBefore);
    expect(claimTxs).toHaveLength(2);
    expect(claimTxs.every((t) => t.mode === 'readwrite')).toBe(true);
    expect(await getActiveRecordingAccount(backend)).toBe('user-a');
  });

  it('reconcileVerifiedRecordingAccount aborts with preempted if another tab claims between verifySession and cleanup', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round3-reconcile-preempt', fake.factory);

    await claimRecordingAccountAtomic('user-old', backend, 1_000);

    const res = await reconcileVerifiedRecordingAccount({
      accountId: 'user-a',
      verifySession: async () => {
        // Before cleanup runs, Tab B becomes active and stores B's draft & upload queue
        await clearStaleRecordingAccountAtomic(
          {
            staleAccountId: 'user-old',
            nextAccountId: 'user-b',
            guard: { expectedAccountId: 'user-old' },
          },
          backend,
          2_000,
        );
        await saveActiveRecordingDraft({ ...sampleDraft('user-b'), sessionId: 'sess-b' }, backend);
        await putUploadQueueItem(sampleUpload('user-b', 'bbbbbbbb-4444-4444-8444-444444444444'), backend);
        return { id: 'user-a' };
      },
      backend,
    });

    expect(res).toEqual({ status: 'preempted', activeAccountId: 'user-b' });
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-b');
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);
  });

  it('clearAccountIfPreemptedAtomic atomically removes only preempted account data in one transaction', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round3-preempted-cleanup', fake.factory);

    await saveActiveRecordingDraft(sampleDraft('user-a'), backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-5555-4555-8555-555555555555'), backend);

    // Unset marker -> not preempted
    const unsetRes = await clearAccountIfPreemptedAtomic('user-a', backend);
    expect(unsetRes).toEqual({ preempted: false, removedCount: 0, activeAccountId: null });
    expect(await listUploadQueueItems('user-a', backend)).toHaveLength(1);

    // Marker owned by user-b -> preempted, removes ONLY user-a in 1 single tx
    await claimRecordingAccountAtomic('user-b', backend, 1_000);
    await saveActiveRecordingDraft({ ...sampleDraft('user-b'), sessionId: 'sess-b' }, backend);
    const txBefore = fake.txLogs.length;
    const preemptedRes = await clearAccountIfPreemptedAtomic('user-a', backend);
    expect(preemptedRes).toEqual({ preempted: true, removedCount: 2, activeAccountId: 'user-b' });
    expect(fake.txLogs.slice(txBefore)).toHaveLength(1);
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
    expect(await listUploadQueueItems('user-a', backend)).toEqual([]);
    expect((await readActiveRecordingDraft('user-b', backend))?.sessionId).toBe('sess-b');
    expect(await getActiveRecordingAccount(backend)).toBe('user-b');
  });
});

describe('recording-store Round 4 claim-generation guarded cleanup', () => {
  it('aborts stale cleanup and preserves new A claim and draft when Tab B re-logs in as A during verification', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round4-relogin-interleave', fake.factory);

    // Tab A claims user-a at rev 1 and saves old draft + old upload item (auto-stamped rev 1)
    const claim1 = await claimRecordingAccountAtomic('user-a', backend, 1_000);
    expect(claim1.claimRevision).toBe(1);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-old' }, backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-1111-4111-8111-111111111111'), backend);

    // Tab A snapshots active-account state before its async session verification
    const snapshotBeforeVerify = await getActiveRecordingAccountSnapshot(backend);
    expect(snapshotBeforeVerify.activeAccountId).toBe('user-a');
    expect(snapshotBeforeVerify.claimRevision).toBe(1);

    // Interleaving: Tab B re-logs in as user-a (rev 2) and writes new draft + new upload item (rev 2)
    const claim2 = await claimRecordingAccountAtomic('user-a', backend, 2_000);
    expect(claim2.status).toBe('claimed');
    expect(claim2.claimRevision).toBe(2);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-new' }, backend);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-2222-4222-8222-222222222222'), backend);

    // Also ensure an unrelated account B record if present is untouched
    await putUploadQueueItem(sampleUpload('user-b', 'bbbbbbbb-1111-4111-8111-111111111111'), backend);

    // Tab A's verification returned stale/expired and runs generation-guarded cleanup in 1 single tx
    const txBefore = fake.txLogs.length;
    const cleanup = await clearStaleAccountGenerationAtomic(
      'user-a',
      {
        expectedActiveAccountId: snapshotBeforeVerify.activeAccountId,
        expectedSavedAt: snapshotBeforeVerify.savedAt,
        expectedClaimRevision: snapshotBeforeVerify.claimRevision,
        maxStaleClaimRevision: snapshotBeforeVerify.claimRevision ?? snapshotBeforeVerify.claimEpoch,
      },
      backend,
    );
    const cleanupTxs = fake.txLogs.slice(txBefore);
    expect(cleanupTxs).toHaveLength(1);
    expect(cleanupTxs[0].mode).toBe('readwrite');

    // Cleanup aborts because rev 2 > rev 1: removes ONLY stale rev-1 upload, keeps rev-2 draft/upload/marker
    expect(cleanup).toEqual({
      status: 'aborted',
      removedCount: 1,
      activeAccountId: 'user-a',
      activeClaimRevision: 2,
    });
    expect(await getActiveRecordingAccount(backend)).toBe('user-a');
    expect((await getActiveRecordingAccountSnapshot(backend)).claimRevision).toBe(2);
    expect((await readActiveRecordingDraft('user-a', backend))?.sessionId).toBe('sess-a-new');
    const remainingA = await listUploadQueueItems('user-a', backend);
    expect(remainingA.map((i) => i.idempotencyKey)).toEqual(['aaaaaaaa-2222-4222-8222-222222222222']);
    expect(await listUploadQueueItems('user-b', backend)).toHaveLength(1);
  });

  it('reconcileVerifiedRecordingAccount aborts stale cleanup if Tab B re-logs in as A during verifySession', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round4-reconcile-relogin', fake.factory);

    await claimRecordingAccountAtomic('user-a', backend, 1_000);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-3333-4333-8333-333333333333'), backend);

    // Account B temporarily became active (rev 2)
    await ensureRecordingAccountIsolation('user-b', backend);

    const res = await reconcileVerifiedRecordingAccount({
      accountId: 'user-a',
      verifySession: async () => {
        // B logs out, then Tab B re-logs in as user-a (rev 3) and writes new draft + new upload
        await clearAccountRecordingData('user-b', backend);
        const reclaim = await claimRecordingAccountAtomic('user-a', backend, 3_000);
        expect(reclaim.claimRevision).toBe(3);
        await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-relogin' }, backend);
        await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-4444-4444-8444-444444444444'), backend);
        // Stale verifySession response still saw user-b
        return { id: 'user-b' };
      },
      backend,
    });

    expect(res).toEqual({ status: 'preempted', activeAccountId: 'user-a' });
    expect((await getActiveRecordingAccountSnapshot(backend)).claimRevision).toBe(3);
    expect((await readActiveRecordingDraft('user-a', backend))?.sessionId).toBe('sess-a-relogin');
    const items = await listUploadQueueItems('user-a', backend);
    expect(items.map((i) => i.idempotencyKey)).toEqual(['aaaaaaaa-4444-4444-8444-444444444444']);
  });

  it('maintains monotonic claim epoch across logout and re-login so stale cleanup cannot wipe re-claimed A', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round4-logout-relogin-epoch', fake.factory);

    const claim1 = await claimRecordingAccountAtomic('user-a', backend, 1_000);
    expect(claim1.claimEpoch).toBe(1);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-5555-4555-8555-555555555555'), backend);

    // Simulate logout clearing ACTIVE_ACCOUNT_KEY while CLAIM_EPOCH_KEY remains monotonic
    await backend.delete('meta:recording_active_account');
    const snapAtLogout = await getActiveRecordingAccountSnapshot(backend);
    expect(snapAtLogout.activeAccountId).toBeNull();
    expect(snapAtLogout.claimEpoch).toBe(1);

    // Tab B re-logs in as user-a -> epoch advances to 2 (> 1)
    const claim2 = await claimRecordingAccountAtomic('user-a', backend, 2_000);
    expect(claim2.claimRevision).toBe(2);
    expect(claim2.claimEpoch).toBe(2);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-after-logout' }, backend);

    const cleanup = await clearStaleAccountGenerationAtomic(
      'user-a',
      {
        expectedActiveAccountId: snapAtLogout.activeAccountId,
        expectedSavedAt: snapAtLogout.savedAt,
        expectedClaimRevision: snapAtLogout.claimRevision,
        maxStaleClaimRevision: snapAtLogout.claimEpoch,
      },
      backend,
    );
    expect(cleanup.status).toBe('aborted');
    expect(cleanup.removedCount).toBe(1);
    expect((await readActiveRecordingDraft('user-a', backend))?.sessionId).toBe('sess-a-after-logout');
    expect(await listUploadQueueItems('user-a', backend)).toEqual([]);
    expect((await getActiveRecordingAccountSnapshot(backend)).claimRevision).toBe(2);
  });

  it('handles concurrent same-account re-login / re-claim alongside stale-generation cleanup without losing new data', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round4-same-account-concurrency', fake.factory);

    await claimRecordingAccountAtomic('user-a', backend, 1_000);
    await putUploadQueueItem(sampleUpload('user-a', 'aaaaaaaa-6666-4666-8666-666666666666'), backend);
    const staleSnap = await getActiveRecordingAccountSnapshot(backend);

    // Hold first re-claim tx mid-flight while second re-claim and stale cleanup queue behind it
    const gate = fake.holdNextReadwrite();
    const claimA1 = claimRecordingAccountAtomic('user-a', backend, 2_000);
    await gate.started;
    const claimA2 = claimRecordingAccountAtomic('user-a', backend, 3_000);
    const staleCleanup = clearStaleAccountGenerationAtomic(
      'user-a',
      {
        expectedActiveAccountId: staleSnap.activeAccountId,
        expectedSavedAt: staleSnap.savedAt,
        expectedClaimRevision: staleSnap.claimRevision,
        maxStaleClaimRevision: staleSnap.claimRevision ?? staleSnap.claimEpoch,
      },
      backend,
    );
    gate.release();

    const [r1, r2, cleanup] = await Promise.all([claimA1, claimA2, staleCleanup]);
    expect(r1.status).toBe('claimed');
    expect(r2.status).toBe('claimed');
    expect(r1.claimRevision).toBe(2);
    expect(r2.claimRevision).toBe(3);
    expect(cleanup).toEqual({
      status: 'aborted',
      removedCount: 1,
      activeAccountId: 'user-a',
      activeClaimRevision: 3,
    });
    expect(await listUploadQueueItems('user-a', backend)).toEqual([]);

    // New draft saved under rev 3 remains intact
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-concurrent' }, backend);
    expect((await readActiveRecordingDraft('user-a', backend))?.sessionId).toBe('sess-a-concurrent');
    expect((await getActiveRecordingAccountSnapshot(backend)).claimRevision).toBe(3);
  });
});

describe('recording-store Round 5 caller claim-epoch guarded draft writes and deletes', () => {
  it('rejects late GPS write from epoch 1 without overwriting or mis-stamping epoch 2 draft and preserves legitimate writes', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round5-late-gps-write', fake.factory);

    // Tab 1 claims epoch 1 and writes old draft
    const claim1 = await claimRecordingAccountAtomic('user-a', backend, 1_000);
    expect(claim1.claimRevision).toBe(1);
    await saveActiveRecordingDraft(
      { ...sampleDraft('user-a'), sessionId: 'sess-tab1-old', title: 'Tab1 旧草稿' },
      backend,
      {
        expectedClaimRevision: 1,
      },
    );

    // Tab 2 clears/re-claims epoch 2 and writes new draft
    await backend.delete('meta:recording_active_account');
    const claim2 = await claimRecordingAccountAtomic('user-a', backend, 2_000);
    expect(claim2.claimRevision).toBe(2);
    await saveActiveRecordingDraft(
      { ...sampleDraft('user-a'), sessionId: 'sess-tab2-new', title: 'Tab2 新草稿' },
      backend,
      {
        expectedClaimRevision: 2,
      },
    );

    // Tab 1 late GPS write arrives carrying epoch 1 -> rejected in 1 single readwrite tx with ZERO puts
    const txBefore = fake.txLogs.length;
    await expect(
      saveActiveRecordingDraft(
        { ...sampleDraft('user-a'), sessionId: 'sess-tab1-old', title: 'Tab1 迟到GPS覆盖' },
        backend,
        {
          expectedClaimRevision: 1,
        },
      ),
    ).rejects.toMatchObject({ name: 'RecordingPersistenceError', code: 'STORAGE_CLAIM_STALE' });
    const lateTxs = fake.txLogs.slice(txBefore);
    expect(lateTxs).toHaveLength(1);
    expect(lateTxs[0].mode).toBe('readwrite');
    expect(lateTxs[0].ops.some((o) => o.op === 'put' || o.op === 'delete')).toBe(false);

    // Tab 2's new draft remains intact at claimRevision 2 (never overwritten or mis-stamped)
    const afterLate = await readActiveRecordingDraftWithMeta('user-a', backend);
    expect(afterLate?.claimRevision).toBe(2);
    expect(afterLate?.draft.sessionId).toBe('sess-tab2-new');
    expect(afterLate?.draft.title).toBe('Tab2 新草稿');

    // Legitimate same-account write within current claim (epoch 2) succeeds and stays at rev 2
    await saveActiveRecordingDraft(
      {
        ...sampleDraft('user-a'),
        sessionId: 'sess-tab2-new',
        title: 'Tab2 新草稿续写',
        previewDistanceM: 880,
      },
      backend,
      { expectedClaimRevision: 2 },
    );
    const afterValid = await readActiveRecordingDraftWithMeta('user-a', backend);
    expect(afterValid?.claimRevision).toBe(2);
    expect(afterValid?.draft.title).toBe('Tab2 新草稿续写');
    expect(afterValid?.draft.previewDistanceM).toBe(880);
  });

  it('rejects stale delete from epoch 1 without deleting epoch 2 draft and allows matching delete', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round5-stale-delete', fake.factory);

    await claimRecordingAccountAtomic('user-a', backend, 1_000);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-tab1-old' }, backend, {
      expectedClaimRevision: 1,
    });

    await claimRecordingAccountAtomic('user-a', backend, 2_000);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-tab2-new' }, backend, {
      expectedClaimRevision: 2,
    });

    const txBefore = fake.txLogs.length;
    await expect(
      deleteActiveRecordingDraft('user-a', backend, {
        expectedClaimRevision: 1,
        expectedSessionId: 'sess-tab1-old',
      }),
    ).rejects.toMatchObject({ name: 'RecordingPersistenceError', code: 'STORAGE_CLAIM_STALE' });
    const staleDelTxs = fake.txLogs.slice(txBefore);
    expect(staleDelTxs).toHaveLength(1);
    expect(staleDelTxs[0].ops.some((o) => o.op === 'delete' || o.op === 'put')).toBe(false);

    // Wrong sessionId even with epoch 2 also rejects without deleting
    await expect(
      deleteActiveRecordingDraft('user-a', backend, {
        expectedClaimRevision: 2,
        expectedSessionId: 'sess-tab1-old',
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CLAIM_STALE' });

    const preserved = await readActiveRecordingDraftWithMeta('user-a', backend);
    expect(preserved?.claimRevision).toBe(2);
    expect(preserved?.draft.sessionId).toBe('sess-tab2-new');

    // Legitimate delete at epoch 2 with matching sessionId removes draft cleanly
    await deleteActiveRecordingDraft('user-a', backend, {
      expectedClaimRevision: 2,
      expectedSessionId: 'sess-tab2-new',
    });
    expect(await readActiveRecordingDraft('user-a', backend)).toBeNull();
  });

  it('handles concurrent claim preemption against draft write/delete and supports retry after rejection', async () => {
    const fake = createSerializedFakeIdbFactory();
    const backend = createIndexedDbRecordingBackend('round5-concurrent-claim-retry', fake.factory);

    await claimRecordingAccountAtomic('user-a', backend, 1_000);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a1' }, backend, {
      expectedClaimRevision: 1,
    });

    // Hold Tab 2's re-claim (rev 2) mid-flight while Tab 1's stale write (rev 1) queues behind it
    const gate = fake.holdNextReadwrite();
    const claim2Promise = claimRecordingAccountAtomic('user-a', backend, 2_000);
    await gate.started;
    const staleWritePromise = saveActiveRecordingDraft(
      { ...sampleDraft('user-a'), sessionId: 'sess-a1-late' },
      backend,
      {
        expectedClaimRevision: 1,
      },
    );
    gate.release();

    const [claim2Result, writeOutcome] = await Promise.allSettled([claim2Promise, staleWritePromise]);
    expect(claim2Result.status).toBe('fulfilled');
    expect(writeOutcome.status).toBe('rejected');
    expect((writeOutcome as PromiseRejectedResult).reason).toMatchObject({ code: 'STORAGE_CLAIM_STALE' });

    // Caller refreshes active snapshot and retries with current epoch (rev 2) -> succeeds
    const refreshed = await getActiveRecordingAccountSnapshot(backend);
    expect(refreshed.claimRevision).toBe(2);
    await saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-retried' }, backend, {
      expectedClaimRevision: refreshed.claimRevision,
    });
    expect((await readActiveRecordingDraftWithMeta('user-a', backend))?.draft.sessionId).toBe('sess-a-retried');
    expect((await readActiveRecordingDraftWithMeta('user-a', backend))?.claimRevision).toBe(2);

    // Cross-account preemption (user-b claims rev 3) causes user-a write & delete with rev 2 to reject
    await ensureRecordingAccountIsolation('user-b', backend);
    await saveActiveRecordingDraft({ ...sampleDraft('user-b'), sessionId: 'sess-b3' }, backend, {
      expectedClaimRevision: 3,
    });
    await expect(
      saveActiveRecordingDraft({ ...sampleDraft('user-a'), sessionId: 'sess-a-stale' }, backend, {
        expectedClaimRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CLAIM_STALE' });
    await expect(
      deleteActiveRecordingDraft('user-b', backend, {
        expectedClaimRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CLAIM_STALE' });
    expect((await readActiveRecordingDraftWithMeta('user-b', backend))?.draft.sessionId).toBe('sess-b3');
  });
});
