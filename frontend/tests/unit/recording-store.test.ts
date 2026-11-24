import { describe, expect, it } from 'vitest';
import {
  RecordingPersistenceError,
  claimRecordingAccountAtomic,
  claimRecordingAccountIfUnsetOrMatch,
  clearAccountIfPreemptedAtomic,
  clearAccountRecordingData,
  clearPrivateRecordingData,
  clearStaleRecordingAccountAtomic,
  createIndexedDbRecordingBackend,
  createMemoryRecordingBackend,
  ensureRecordingAccountIsolation,
  getActiveRecordingAccount,
  listUploadQueueItems,
  putUploadQueueItem,
  readActiveRecordingDraft,
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
