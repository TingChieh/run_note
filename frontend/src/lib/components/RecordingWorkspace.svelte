<script lang="ts">
  import { getContext, onMount, tick } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { readSession } from '#lib/api/auth.ts';
  import { formatReceiptDate, formatReceiptTimeRange, splitFigure } from '#lib/api/activity-splits.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { brandInitial } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import {
    extractRecordedSplits,
    findFastestFullSplit,
    summarizeLiveSplit,
    type RecordedKmSplit,
  } from '#lib/recording-splits.ts';
  import {
    acknowledgeNativeHandoff,
    checkRecorderPermissions,
    discardNativeRecording,
    getNativeRecorderPoints,
    getNativeRecorderState,
    getRecorderCapabilities,
    isNativeLocationRecorderAvailable,
    openRecorderAppSettings,
    openRecorderLocationSettings,
    pauseNativeRecording,
    requestRecorderPermissions,
    resumeNativeRecording,
    startNativeRecording,
    stopNativeRecording,
    subscribeNativeRecorderUpdates,
    syncNativeAccountClaim,
    type GpsSignalStatus,
    type RecorderCapabilities,
    type RecorderPermissions,
    type RecorderSessionSnapshot,
    type RecorderStateEvent,
  } from '#lib/capacitor-recorder.ts';
  import {
    evaluateTrackPoint,
    formatClockDuration,
    formatPreviewDistanceKm,
    formatPreviewPace,
    generateUuidV4,
    type RecordedTrackPoint,
  } from '#lib/gpx-serializer.ts';
  import {
    RECORDING_CLAIM_CONTEXT,
    RecordingPersistenceError,
    acquireRecordingSessionLock,
    deleteActiveRecordingDraft,
    executeUnderUploadQueueClaim,
    executeUnderWebDraftOwnership,
    getActiveRecordingAccountSnapshot,
    getRecordingTabOwnerId,
    listUploadQueueItems,
    readActiveRecordingDraftWithMeta,
    renewActiveRecordingDraftLease,
    runUnderRecordingClaimLock,
    saveActiveRecordingDraft,
    subscribeRecordingClaimChanges,
    takeOverActiveRecordingDraft,
    verifyRecordingClaimCurrent,
    verifyWebDraftOwnershipUnderClaim,
    type DraftOwnerGuard,
    type LocalRecordingDraft,
    type RecordingClaimContext,
    type RecordingSessionLock,
    type RecordingLifecycleStatus,
    type UploadQueueItem,
  } from '#lib/recording-store.ts';
  import {
    discardUploadQueueItem,
    enqueueFinalizedRecording,
    enqueueStoppedWebDraft,
    flushRecordingUploadQueue,
    isAccountChangeAuthBroadcast,
  } from '#lib/recording-uploader.ts';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';

  const view = useViewContext();
  const accountId = $derived(page.data.user?.id ?? '');
  const timezone = $derived(page.data.user?.timezone || 'Asia/Shanghai');
  const fullShowcaseAutoPublishes = $derived(
    page.data.user?.is_admin === true || page.data.user?.showcase_enabled === true,
  );

  let mounted = $state(false);
  let offline = $state(false);
  let capabilities = $state<RecorderCapabilities>({
    platform: 'web',
    native: false,
    backgroundSupported: false,
    requiresNotificationPermission: false,
    locationServicesEnabled: true,
  });
  let permissions = $state<RecorderPermissions>({
    location: 'prompt',
    notification: 'not_required',
    locationServicesEnabled: true,
    preciseLocation: true,
    canRecord: true,
  });

  let status = $state<RecordingLifecycleStatus>('idle');
  let gpsStatus = $state<GpsSignalStatus>('inactive');
  let sessionId = $state('');
  let idempotencyKey = $state('');
  let runTitle = $state('');
  let startedAtMs = $state(0);
  let activeDurationMs = $state(0);
  let lastSegmentStartMs = $state<number | null>(null);
  let segmentIndex = $state(0);
  let pointCount = $state(0);
  let previewDistanceM = $state(0);
  let lastPointTimeMs = $state<number | null>(null);
  let lastAccuracyM = $state<number | null>(null);
  let interruptedReason = $state<string | null>(null);
  let webPoints = $state<RecordedTrackPoint[]>([]);
  let nativePoints = $state<RecordedTrackPoint[]>([]);
  let pendingHandoffSession = $state<RecorderSessionSnapshot | null>(null);

  interface CompletedReceipt {
    idempotencyKey: string;
    title: string;
    startedAtMs: number;
    endedAtMs: number;
    activeDurationMs: number;
    pointCount: number;
    segmentCount: number;
    previewDistanceM: number;
    splits: RecordedKmSplit[];
  }
  let completedReceipt = $state<CompletedReceipt | null>(null);
  let isMobileViewport = $state(false);
  let screenLocked = $state(false);
  let finishDialog = $state<HTMLDialogElement>(null!);
  let finishHoldActive = $state(false);
  let finishHoldProgress = $state(0);
  let finishHoldRafId: number | null = null;
  let finishHoldStartMs = 0;
  let finishHoldTriggered = false;
  const HOLD_FINISH_DURATION_MS = 1_500;
  const MAX_NATIVE_LIVE_POINTS_FAILURES = 2;
  let nativePointsSessionId = '';
  let nativePointsInFlight = false;
  let nativePointsAttemptedCount = 0;
  let nativePointsFailureCount = 0;
  let nativePointsCompletedKms = 0;

  let clockNowMs = $state(Date.now());
  let actionBusy = $state(false);
  let handoffBusy = $state(false);
  let uploadBusy = $state(false);
  let errorMessage = $state('');
  let statusNotice = $state('');
  let uploadItems = $state<UploadQueueItem[]>([]);

  let discardDialog = $state<HTMLDialogElement>(null!);
  let pendingDiscardTarget = $state<
    { kind: 'session' } | { kind: 'upload'; idempotencyKey: string; title: string } | null
  >(null);
  let leaveDialog = $state<HTMLDialogElement>(null!);
  let pendingLeaveUrl = $state<string | null>(null);
  let allowNextLeave = false;

  const NATIVE_RECOVERY_TIMEOUT_MS = 8_000;
  const DRAFT_LEASE_RENEW_INTERVAL_MS = 5_000;
  const SESSION_LIVE_ELSEWHERE_MESSAGE =
    '这条未完成的跑步草稿正在其他标签页中使用，请在该标签页继续、保存或丢弃；关闭该标签页后可在此重试恢复。';
  const SESSION_TAKEN_OVER_MESSAGE = '这条跑步记录已被其他标签页接管，已停止在本页写入，避免覆盖最新轨迹。';
  type SessionRecoveryState = 'pending' | 'ready' | 'failed';

  const layoutClaimContext = getContext<RecordingClaimContext | undefined>(RECORDING_CLAIM_CONTEXT);

  let disposed = false;
  let stoppingInFlight = false;
  let failedHandoffSessionId: string | null = null;
  let webWatchId: number | null = null;
  let webLastFixMs: number | null = null;
  let pageClaimAccountId = '';
  let pageClaimRevision: number | null = null;
  let pageClaimToken: string | undefined = undefined;
  let pageClaimRevoked = false;
  let initialClaimPromise: Promise<void> | null = null;
  let sessionAccountId = '';
  let sessionClaimRevision: number | null = null;
  let sessionClaimToken: string | undefined = undefined;
  type PinnedNativeClaim = { claimRevision: number; claimToken?: string };
  // Web draft ownership: only the tab holding the current owner generation may write the draft row.
  const tabOwnerId = getRecordingTabOwnerId();
  let sessionOwnerGeneration: number | null = null;
  let sessionLock: RecordingSessionLock | null = null;
  let lockReacquireAbort: AbortController | null = null;
  let sessionOwnershipLost = false;
  let leaseRenewInFlight = false;
  let lastLeaseRenewMs = 0;
  let sessionRecoveryState = $state<SessionRecoveryState>('pending');
  let recoveryFailureMessage = $state('');
  let recoveryRequestToken = 0;
  let activeRecoveryTimeoutId: number | null = null;
  let unsubscribeNative: (() => void) | null = null;

  const displayedDurationMs = $derived.by(() => {
    if (status === 'recording' && lastSegmentStartMs !== null && clockNowMs > lastSegmentStartMs) {
      return activeDurationMs + (clockNowMs - lastSegmentStartMs);
    }
    return activeDurationMs;
  });

  const pendingUploadCount = $derived(uploadItems.filter((item) => item.status !== 'uploaded').length);
  const failedUploadCount = $derived(uploadItems.filter((item) => item.status === 'failed').length);
  const startBlockedByPermissions = $derived(
    capabilities.native && (permissions.location !== 'granted' || !permissions.locationServicesEnabled),
  );
  const startBlockedByRecovery = $derived(sessionRecoveryState !== 'ready');

  const statusBadgeText = $derived.by(() => {
    if (pendingHandoffSession) return '待入队恢复';
    if (sessionRecoveryState === 'pending') return '正在恢复…';
    if (sessionRecoveryState === 'failed') return '恢复失败';
    switch (status) {
      case 'recording':
        return '记录中';
      case 'paused':
        return '已暂停';
      case 'interrupted':
        return '待恢复';
      case 'stopped':
        return '已结束';
      default:
        return '就绪';
    }
  });

  const gpsBadgeText = $derived.by(() => {
    switch (gpsStatus) {
      case 'good':
        return lastAccuracyM !== null ? `GPS 良好（±${Math.round(lastAccuracyM)}m）` : 'GPS 良好';
      case 'weak':
        return lastAccuracyM !== null ? `GPS 较弱（±${Math.round(lastAccuracyM)}m）` : 'GPS 较弱';
      case 'acquiring':
        return 'GPS 搜星中…';
      case 'lost':
        return 'GPS 信号丢失';
      case 'disabled':
        return '定位服务已关闭';
      case 'permission_denied':
        return '未授予定位权限';
      default:
        return 'GPS 未开启';
    }
  });

  const uploadBadgeText = $derived.by(() => {
    if (uploadBusy) return '正在上传…';
    if (offline && pendingUploadCount > 0) return `${pendingUploadCount} 条等待联网`;
    if (failedUploadCount > 0) return `${failedUploadCount} 条上传失败`;
    if (pendingUploadCount > 0) return `${pendingUploadCount} 条待上传`;
    if (uploadItems.some((item) => item.status === 'uploaded')) return '已同步';
    return '无待上传';
  });

  const interruptedReasonLabel = $derived.by(() => {
    if (interruptedReason === 'permission_revoked') {
      return '记录期间精确位置权限被撤销、降级或“仅本次允许”已失效，已安全保留此前捕获的轨迹点。';
    }
    if (interruptedReason === 'enqueue_failed') {
      return '结束记录时未能写入本地上传队列，定位已停止，已保留此前捕获的轨迹点。';
    }
    if (interruptedReason === 'foreground_service_denied') {
      return '前台定位服务启动受限，已保留会话状态。请确认精确位置权限后继续或保存。';
    }
    return '检测到上次未完成的跑步记录（可能因进程被系统终止、设备重启或页面关闭）。';
  });

  const activeTrackPoints = $derived(capabilities.native ? nativePoints : webPoints);
  const liveSplit = $derived(summarizeLiveSplit(activeTrackPoints, previewDistanceM));
  const distanceParts = $derived(splitFigure(formatPreviewDistanceKm(previewDistanceM)));
  const distanceSizeClass = $derived(
    previewDistanceM >= 1_000_000 ? 'is-xlong' : previewDistanceM >= 100_000 ? 'is-long' : '',
  );
  const durationDisplay = $derived(formatClockDuration(displayedDurationMs));
  const durationCompact = $derived(durationDisplay.length > 5);
  const paceParts = $derived(splitFigure(formatPreviewPace(displayedDurationMs, previewDistanceM)));
  const isImmersiveRecording = $derived(status === 'recording' || status === 'paused');
  const isDoneView = $derived(completedReceipt !== null && status === 'idle' && !pendingHandoffSession);
  const receiptQueueItem = $derived(
    completedReceipt ? uploadItems.find((item) => item.idempotencyKey === completedReceipt!.idempotencyKey) ?? null : null,
  );
  const receiptFastestSplit = $derived(completedReceipt ? findFastestFullSplit(completedReceipt.splits) : null);
  const receiptDistanceParts = $derived.by(() => {
    if (!completedReceipt) return { number: '—', unit: '' };
    const dist =
      receiptQueueItem?.status === 'uploaded' && receiptQueueItem.serverDistanceM !== null
        ? formatDistance(receiptQueueItem.serverDistanceM)
        : formatPreviewDistanceKm(completedReceipt.previewDistanceM);
    return splitFigure(dist);
  });
  const receiptDateText = $derived.by(() => {
    if (!completedReceipt) return '—';
    const localDate = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(completedReceipt.startedAtMs));
    return formatReceiptDate(localDate);
  });
  const receiptTimeRangeText = $derived.by(() => {
    if (!completedReceipt) return '';
    return formatReceiptTimeRange(
      new Date(completedReceipt.startedAtMs).toISOString(),
      new Date(completedReceipt.endedAtMs).toISOString(),
      timezone,
    );
  });
  const mobileGpsText = $derived.by(() => {
    if (gpsStatus === 'good') return lastAccuracyM !== null ? `GPS ±${Math.round(lastAccuracyM)} m` : 'GPS 良好';
    if (gpsStatus === 'weak') return lastAccuracyM !== null ? `GPS ±${Math.round(lastAccuracyM)} m` : 'GPS 较弱';
    if (gpsStatus === 'acquiring') return 'GPS 搜星中…';
    if (gpsStatus === 'lost') return 'GPS 丢失';
    if (gpsStatus === 'disabled') return '定位已关闭';
    if (gpsStatus === 'permission_denied') return '无定位权限';
    return 'GPS 未开启';
  });
  const preRunGpsReadout = $derived.by(() => {
    if (lastAccuracyM !== null && (gpsStatus === 'good' || gpsStatus === 'weak')) {
      return {
        value: `±${Math.round(lastAccuracyM)}`,
        unit: 'm',
        tone: gpsStatus === 'good' ? 'ok' : 'warn',
        caption: gpsStatus === 'good' ? 'GPS 良好 · 精确位置' : 'GPS 较弱 · 建议移至开阔处',
      };
    }
    if (permissions.location === 'denied') {
      return { value: '未授权', unit: '', tone: 'err', caption: '请先授予精确位置权限' };
    }
    if (permissions.location === 'approximate') {
      return { value: '需精确', unit: '', tone: 'err', caption: '仅大致位置，无法记录可靠轨迹' };
    }
    if (!permissions.locationServicesEnabled) {
      return { value: '已关闭', unit: '', tone: 'err', caption: '系统定位服务未开启' };
    }
    if (sessionRecoveryState === 'pending') {
      return { value: '检查中', unit: '', tone: 'muted', caption: '正在检查未完成的记录会话…' };
    }
    if (sessionRecoveryState === 'failed') {
      return { value: '待恢复', unit: '', tone: 'err', caption: '请先重试恢复状态后再开始' };
    }
    return {
      value: '已就绪',
      unit: '',
      tone: 'ok',
      caption: capabilities.native ? '精确位置已授权 · 后台前台服务就绪' : '浏览器前台定位就绪',
    };
  });

  function resetNativeLivePoints() {
    nativePoints = [];
    nativePointsSessionId = '';
    nativePointsInFlight = false;
    nativePointsAttemptedCount = 0;
    nativePointsFailureCount = 0;
    nativePointsCompletedKms = 0;
  }

  /**
   * Incrementally fetches native track points during live recording/pause so `summarizeLiveSplit`
   * can display real previous-kilometre pace on Android.
   *
   * - Only marks a kilometre complete once the fetched 7-decimal point set actually computes it
   *   (`nativePointsCompletedKms`), so a 999.98 m rounded batch automatically fetches the next point.
   * - Records the attempted batch before awaiting and caps consecutive failures at 2 so bridge
   *   errors never spin-loop.
   */
  async function syncNativeLivePoints(snapshot: RecorderSessionSnapshot) {
    if (disposed || !capabilities.native) return;
    if (snapshot.status !== 'recording' && snapshot.status !== 'paused') return;
    if (!snapshot.sessionId || (accountId && snapshot.accountId !== accountId)) return;

    if (snapshot.sessionId !== nativePointsSessionId) {
      nativePoints = [];
      nativePointsSessionId = snapshot.sessionId;
      nativePointsInFlight = false;
      nativePointsAttemptedCount = 0;
      nativePointsFailureCount = 0;
      nativePointsCompletedKms = 0;
    }

    const targetKm = Math.floor(Math.max(0, snapshot.previewDistanceM) / 1000);
    if (targetKm <= nativePointsCompletedKms) return;
    if (snapshot.pointCount <= nativePoints.length) return;
    if (nativePointsInFlight) return;
    if (nativePointsFailureCount >= MAX_NATIVE_LIVE_POINTS_FAILURES) return;
    if (nativePointsFailureCount === 0 && snapshot.pointCount <= nativePointsAttemptedCount) return;

    const boundSessionId = snapshot.sessionId;
    const boundAccountId = snapshot.accountId;
    const afterIndex = nativePoints.length;
    const batchPointCount = snapshot.pointCount;
    nativePointsInFlight = true;
    nativePointsAttemptedCount = batchPointCount;

    try {
      const incoming = await getNativeRecorderPoints(afterIndex, boundAccountId);
      if (disposed || nativePointsSessionId !== boundSessionId || sessionId !== boundSessionId) return;
      nativePointsFailureCount = 0;
      if (incoming.length > 0) {
        const merged = [...nativePoints, ...incoming];
        nativePoints = merged;
        nativePointsCompletedKms = extractRecordedSplits(merged).filter((row) => row.isFullKm).length;
      }
    } catch {
      if (!disposed && nativePointsSessionId === boundSessionId) {
        nativePointsFailureCount += 1;
      }
    } finally {
      if (nativePointsSessionId === boundSessionId || disposed) {
        nativePointsInFlight = false;
      }
    }
  }

  function cancelFinishHold() {
    if (finishHoldRafId !== null) {
      window.cancelAnimationFrame(finishHoldRafId);
      finishHoldRafId = null;
    }
    finishHoldActive = false;
    finishHoldProgress = 0;
  }

  function startFinishHold(event: PointerEvent) {
    if (actionBusy || !isMobileViewport || status !== 'paused') return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    cancelFinishHold();
    finishHoldTriggered = false;
    finishHoldActive = true;
    finishHoldStartMs = performance.now();
    const step = (now: number) => {
      if (!finishHoldActive || disposed || status !== 'paused' || actionBusy) {
        cancelFinishHold();
        return;
      }
      const progress = Math.min(1, (now - finishHoldStartMs) / HOLD_FINISH_DURATION_MS);
      finishHoldProgress = progress;
      if (progress >= 1) {
        cancelFinishHold();
        finishHoldTriggered = true;
        void handleStopAndSave();
        return;
      }
      finishHoldRafId = window.requestAnimationFrame(step);
    };
    finishHoldRafId = window.requestAnimationFrame(step);
  }

  function handleStopButtonClick() {
    if (actionBusy) return;
    if (finishHoldTriggered) {
      finishHoldTriggered = false;
      return;
    }
    if (isMobileViewport && status === 'paused') {
      // WCAG 2.5.1 single-pointer / keyboard accessible alternative to 1.5s hold.
      finishDialog?.showModal();
      return;
    }
    void handleStopAndSave();
  }

  function cancelFinishDialog() {
    finishDialog?.close();
  }

  function confirmFinishDialog() {
    finishDialog?.close();
    void handleStopAndSave();
  }

  function scrollToUploadQueue() {
    document.getElementById('upload-queue-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function dismissCompletedReceipt() {
    completedReceipt = null;
  }

  function applyNativeState(event: RecorderStateEvent) {
    permissions = event.permissions;
    gpsStatus = event.gpsStatus;
    if (!event.session || (accountId && event.session.accountId !== accountId)) {
      if (status !== 'idle' && !event.serviceRunning && capabilities.native && !pendingHandoffSession) {
        resetLocalSessionState();
      }
      return;
    }
    const s = event.session;
    if (s.status === 'stopped' && s.pointCount > 0) {
      pendingHandoffSession = s;
      if (!stoppingInFlight && !handoffBusy && failedHandoffSessionId !== s.sessionId) {
        void recoverPendingStoppedHandoff(s);
      }
      return;
    }
    pendingHandoffSession = null;
    failedHandoffSessionId = null;
    sessionAccountId = s.accountId;
    sessionId = s.sessionId;
    idempotencyKey = s.idempotencyKey;
    if (s.title) runTitle = s.title;
    status = s.status;
    startedAtMs = s.startedAtMs;
    activeDurationMs = s.activeDurationMs;
    lastSegmentStartMs = s.status === 'recording' ? Date.now() : null;
    segmentIndex = s.segmentIndex;
    pointCount = s.pointCount;
    previewDistanceM = s.previewDistanceM;
    lastPointTimeMs = s.lastPointTimeMs;
    lastAccuracyM = s.lastAccuracyM;
    interruptedReason = s.interruptedReason;
    if (s.status !== 'recording') screenLocked = false;
    if (s.status === 'recording' || s.status === 'paused') {
      completedReceipt = null;
      void syncNativeLivePoints(s);
    }
  }

  /**
   * Atomically hands off an unacknowledged native `stopped` session (e.g. after a crash between
   * `stopSession()` and IndexedDB commit) into the local upload queue BEFORE clearing native disk.
   */
  async function recoverPendingStoppedHandoff(snapshot: RecorderSessionSnapshot, manual = false) {
    if (handoffBusy || !accountId || snapshot.accountId !== accountId) return;
    if (manual) failedHandoffSessionId = null;
    handoffBusy = true;
    errorMessage = '';
    const boundAccountId = accountId;
    try {
      // Pin against this page's confirmed account generation before reading the native track; never
      // recreate a revoked/deleted claim from a stale component accountId.
      const pinnedClaim = await pinNativeHandoffClaim(boundAccountId, { allowConfirmedRelogin: manual });
      if (disposed || pageClaimRevoked || accountId !== boundAccountId) return;
      const capturedPoints = await getNativeRecorderPoints(0, boundAccountId);
      if (disposed || pageClaimRevoked || accountId !== boundAccountId) return;
      await assertNativeClaimCurrent(boundAccountId, pinnedClaim);
      if (disposed || pageClaimRevoked || accountId !== boundAccountId) return;
      if (capturedPoints.length === 0) {
        if (snapshot.pointCount > 0) {
          throw new Error('未能读取到原生已保存的轨迹点，已保留原生数据，请重试保存。');
        }
        await acknowledgeEmptyNativeHandoff(boundAccountId, snapshot.sessionId, pinnedClaim);
        if (!disposed) {
          pendingHandoffSession = null;
          failedHandoffSessionId = null;
          resetLocalSessionState();
        }
        return;
      }
      await enqueueFinalizedRecording(
        {
          accountId: boundAccountId,
          sessionId: snapshot.sessionId,
          idempotencyKey: snapshot.idempotencyKey,
          title: snapshot.title || runTitle.trim(),
          timezone,
          startedAtMs: snapshot.startedAtMs || capturedPoints[0].recordedAtMs,
          endedAtMs: snapshot.endedAtMs ?? Date.now(),
          activeDurationMs: snapshot.activeDurationMs,
          points: capturedPoints,
        },
        { expectedClaimRevision: pinnedClaim.claimRevision, expectedClaimToken: pinnedClaim.claimToken },
      );
      if (disposed || pageClaimRevoked || accountId !== boundAccountId) return;
      await acknowledgeEnqueuedNativeHandoff(boundAccountId, snapshot.sessionId, snapshot.idempotencyKey, pinnedClaim);
      if (disposed) return;
      pendingHandoffSession = null;
      failedHandoffSessionId = null;
      resetLocalSessionState();
      await refreshUploadQueue();
      if (offline) {
        statusNotice = '已自动找回并暂存上次已结束的跑步轨迹，恢复联网后将自动上传一次。';
      } else {
        statusNotice = '已自动找回上次已结束的跑步轨迹，正在上传…';
        void runUploadFlush(false);
      }
    } catch (cause) {
      if (!disposed) {
        pendingHandoffSession = snapshot;
        failedHandoffSessionId = snapshot.sessionId;
        errorMessage =
          cause instanceof Error
            ? `未能将已结束记录写入本地上传队列：${cause.message}`
            : '未能将已结束记录写入本地上传队列，请点击重试保存。';
      }
    } finally {
      if (!disposed) handoffBusy = false;
    }
  }

  function resetLocalSessionState() {
    status = 'idle';
    gpsStatus = 'inactive';
    sessionId = '';
    idempotencyKey = '';
    sessionAccountId = '';
    sessionClaimRevision = null;
    sessionClaimToken = undefined;
    sessionOwnerGeneration = null;
    sessionOwnershipLost = false;
    releaseSessionLock();
    startedAtMs = 0;
    activeDurationMs = 0;
    lastSegmentStartMs = null;
    segmentIndex = 0;
    pointCount = 0;
    previewDistanceM = 0;
    lastPointTimeMs = null;
    lastAccuracyM = null;
    interruptedReason = null;
    webPoints = [];
    webLastFixMs = null;
    screenLocked = false;
    cancelFinishHold();
    resetNativeLivePoints();
  }

  function buildWebDraft(boundAccountId = sessionAccountId || accountId): LocalRecordingDraft {
    return {
      sessionId,
      accountId: boundAccountId,
      idempotencyKey,
      title: runTitle,
      status,
      startedAtMs,
      endedAtMs: null,
      activeDurationMs: displayedDurationMs,
      lastSegmentStartMs,
      segmentIndex,
      previewDistanceM,
      lastPointTimeMs,
      lastAccuracyM,
      interruptedReason,
      points: webPoints.map((pt) => ({ ...pt })),
    };
  }

  function ownerGuard(): DraftOwnerGuard {
    // Generation 0 never matches a stored owner, so a tab without ownership cannot write.
    return { ownerId: tabOwnerId, expectedOwnerGeneration: sessionOwnerGeneration ?? 0 };
  }

  function releaseSessionLock() {
    lockReacquireAbort?.abort();
    lockReacquireAbort = null;
    const lock = sessionLock;
    sessionLock = null;
    lock?.release();
  }

  function isSessionWriteRejection(cause: unknown): cause is RecordingPersistenceError {
    return (
      cause instanceof RecordingPersistenceError &&
      (cause.code === 'STORAGE_CLAIM_STALE' ||
        cause.code === 'STORAGE_DRAFT_EXISTS' ||
        cause.code === 'STORAGE_SESSION_GONE')
    );
  }

  /** Holds the account's Web Lock for this claim generation while this tab owns a session. */
  async function acquireSessionLock(targetAccountId: string, claimRevision: number, signal?: AbortSignal) {
    const result: Awaited<ReturnType<typeof acquireRecordingSessionLock>> = await acquireRecordingSessionLock(
      targetAccountId,
      claimRevision,
      {
        wait: signal !== undefined,
        signal,
        onLost: () => {
          if (result.status === 'acquired' && sessionLock === result.lock) {
            sessionLock = null;
            void verifyOwnershipAfterLockLoss();
          }
        },
      },
    );
    return result;
  }

  /**
   * Losing the lock alone never ends a session: only the draft row says who owns it. While this tab
   * is still the recorded owner under the current claim it keeps recording and queues to get the
   * lock back; otherwise it stops writing.
   */
  async function verifyOwnershipAfterLockLoss() {
    const boundAccountId = sessionAccountId;
    const boundClaimRev = sessionClaimRevision;
    const boundSessionId = sessionId;
    const boundGeneration = sessionOwnerGeneration;
    if (boundClaimRev === null || boundGeneration === null || !boundSessionId || sessionOwnershipLost) return;
    let stillOwner = false;
    try {
      const [meta, snap] = await Promise.all([
        readActiveRecordingDraftWithMeta(boundAccountId),
        getActiveRecordingAccountSnapshot(),
      ]);
      stillOwner =
        meta?.draft.sessionId === boundSessionId &&
        meta.ownerId === tabOwnerId &&
        meta.ownerGeneration === boundGeneration &&
        meta.claimRevision === boundClaimRev &&
        snap.activeAccountId === boundAccountId &&
        snap.claimRevision === boundClaimRev;
    } catch {
      stillOwner = false;
    }
    const unchanged =
      !disposed &&
      !sessionOwnershipLost &&
      sessionAccountId === boundAccountId &&
      sessionClaimRevision === boundClaimRev &&
      sessionId === boundSessionId &&
      sessionOwnerGeneration === boundGeneration;
    if (!unchanged || sessionLock) return;
    if (!stillOwner) {
      handleStaleSessionWrite(boundAccountId, boundClaimRev, SESSION_TAKEN_OVER_MESSAGE);
      return;
    }
    const abort = new AbortController();
    lockReacquireAbort?.abort();
    lockReacquireAbort = abort;
    const regained = await acquireSessionLock(boundAccountId, boundClaimRev, abort.signal);
    if (lockReacquireAbort === abort) lockReacquireAbort = null;
    if (regained.status !== 'acquired') return;
    if (
      abort.signal.aborted ||
      disposed ||
      sessionOwnershipLost ||
      sessionLock ||
      sessionClaimRevision !== boundClaimRev ||
      sessionId !== boundSessionId
    ) {
      regained.lock.release();
      return;
    }
    sessionLock = regained.lock;
  }

  async function renewDraftLease() {
    if (
      leaseRenewInFlight ||
      capabilities.native ||
      sessionOwnershipLost ||
      sessionOwnerGeneration === null ||
      sessionClaimRevision === null ||
      !sessionId
    ) {
      return;
    }
    const boundAccountId = sessionAccountId;
    const boundClaimRev = sessionClaimRevision;
    leaseRenewInFlight = true;
    try {
      const result = await renewActiveRecordingDraftLease(boundAccountId, {
        expectedClaimRevision: boundClaimRev,
        expectedSessionId: sessionId,
        owner: ownerGuard(),
      });
      if (result !== 'renewed') {
        handleStaleSessionWrite(
          boundAccountId,
          boundClaimRev,
          result === 'missing'
            ? '这条跑步草稿已在其他标签页中保存或丢弃，已停止在本页写入。'
            : SESSION_TAKEN_OVER_MESSAGE,
        );
      }
    } catch {
      // Transient storage errors: the next tick retries; the lease only matters without Web Locks.
    } finally {
      leaseRenewInFlight = false;
    }
  }

  function isPageIdentityRevoked(targetAccountId: string): boolean {
    return (
      disposed ||
      pageClaimRevoked ||
      !targetAccountId ||
      accountId !== targetAccountId ||
      layoutClaimContext?.isRevoked(targetAccountId) === true
    );
  }

  async function bindInitialPageClaim(): Promise<void> {
    const targetAccountId = accountId;
    if (isPageIdentityRevoked(targetAccountId)) {
      pageClaimRevoked = true;
      return;
    }
    let rev: number | null = null;
    let token: string | undefined = undefined;
    if (layoutClaimContext) {
      rev = await layoutClaimContext.waitForInitialClaim(targetAccountId);
      if (typeof rev === 'number') {
        const snap = await getActiveRecordingAccountSnapshot().catch(() => null);
        if (snap && snap.activeAccountId === targetAccountId && snap.claimRevision === rev) {
          token = snap.claimToken;
        }
      }
    } else {
      const snap = await getActiveRecordingAccountSnapshot().catch(() => null);
      if (
        snap &&
        snap.activeAccountId === targetAccountId &&
        typeof snap.claimRevision === 'number' &&
        snap.claimEpoch <= snap.claimRevision
      ) {
        rev = snap.claimRevision;
        token = snap.claimToken;
      }
    }
    if (isPageIdentityRevoked(targetAccountId)) return;
    if (typeof rev === 'number') {
      pageClaimAccountId = targetAccountId;
      pageClaimRevision = rev;
      pageClaimToken = token;
    }
  }

  async function assertNativeClaimCurrent(targetAccountId: string, pinnedClaim: PinnedNativeClaim): Promise<void> {
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    const stillCurrent = await verifyRecordingClaimCurrent(
      targetAccountId,
      pinnedClaim.claimRevision,
      undefined,
      pinnedClaim.claimToken,
    );
    if (!stillCurrent || isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '本地记录数据已被退出登录或账号切换清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
  }

  async function acknowledgeEmptyNativeHandoff(
    targetAccountId: string,
    targetSessionId: string,
    pinnedClaim: PinnedNativeClaim,
  ): Promise<void> {
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前登录状态已变更或本地记录数据已清理，未清理原生轨迹数据。',
      );
    }
    await runUnderRecordingClaimLock(async () => {
      await assertNativeClaimCurrent(targetAccountId, pinnedClaim);
      const acked = await acknowledgeNativeHandoff({
        sessionId: targetSessionId,
        accountId: targetAccountId,
        claimRevision: pinnedClaim.claimRevision,
        claimToken: pinnedClaim.claimToken,
      });
      if (!acked) {
        throw new RecordingPersistenceError(
          'STORAGE_CLAIM_STALE',
          '本地记录数据已被退出登录或账号切换清理，原生轨迹数据已保留。',
        );
      }
    });
  }

  async function acknowledgeEnqueuedNativeHandoff(
    targetAccountId: string,
    targetSessionId: string,
    itemIdempotencyKey: string,
    pinnedClaim: PinnedNativeClaim,
  ): Promise<void> {
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    const outcome = await executeUnderUploadQueueClaim(
      targetAccountId,
      itemIdempotencyKey,
      { expectedClaimRevision: pinnedClaim.claimRevision, expectedClaimToken: pinnedClaim.claimToken },
      async () => {
        if (isPageIdentityRevoked(targetAccountId)) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
          );
        }
        const acked = await acknowledgeNativeHandoff({
          sessionId: targetSessionId,
          accountId: targetAccountId,
          claimRevision: pinnedClaim.claimRevision,
          claimToken: pinnedClaim.claimToken,
        });
        if (!acked) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '本地记录数据已被退出登录或账号切换清理，未写入上传队列，原生轨迹数据已保留。',
          );
        }
      },
    );
    if (outcome.status === 'stale' || isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '本地记录数据已被退出登录或账号切换清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    if (outcome.status !== 'valid') {
      throw new RecordingPersistenceError(
        'STORAGE_VERIFY_FAILED',
        '本地上传队列持久化校验失败，已保留原生轨迹数据，请重试保存。',
      );
    }
  }

  async function pinNativeHandoffClaim(
    targetAccountId: string,
    options?: { allowConfirmedRelogin?: boolean },
  ): Promise<PinnedNativeClaim> {
    if (initialClaimPromise) await initialClaimPromise;
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    const snap = await getActiveRecordingAccountSnapshot();
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    // Never recreate a missing/cleaned active marker from a stale component accountId.
    if (!snap.activeAccountId || typeof snap.claimRevision !== 'number') {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '本地记录数据已被退出登录或账号切换清理，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    if (snap.activeAccountId !== targetAccountId) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '检测到当前登录账号已切换，未写入上传队列，原生轨迹数据已保留。',
      );
    }
    if (pageClaimRevision === null || pageClaimAccountId !== targetAccountId) {
      const layoutConfirmed = layoutClaimContext?.getConfirmedClaimRevision(targetAccountId) ?? null;
      if (typeof layoutConfirmed === 'number') {
        pageClaimAccountId = targetAccountId;
        pageClaimRevision = layoutConfirmed;
        if (snap.claimRevision === layoutConfirmed) {
          pageClaimToken = snap.claimToken;
        }
      }
    }
    if (
      pageClaimAccountId === targetAccountId &&
      pageClaimRevision !== null &&
      snap.claimRevision === pageClaimRevision &&
      snap.claimEpoch <= pageClaimRevision &&
      (pageClaimToken === undefined || snap.claimToken === pageClaimToken)
    ) {
      pageClaimToken = snap.claimToken;
      return { claimRevision: pageClaimRevision, claimToken: snap.claimToken };
    }
    // Auto-recovery and manual stop on an old page never silently adopt a newer generation or an
    // unbound claim. Only an explicit manual retry after live server session confirmation may pin
    // an already-established claim for the same authenticated account.
    if (options?.allowConfirmedRelogin) {
      const confirmed = await readSession(view.fetch).catch(() => null);
      if (isPageIdentityRevoked(targetAccountId) || confirmed?.id !== targetAccountId) {
        throw new RecordingPersistenceError(
          'STORAGE_CLAIM_STALE',
          '当前登录状态已变更或已退出，未写入上传队列，原生轨迹数据已保留。',
        );
      }
      const rechecked = await getActiveRecordingAccountSnapshot();
      if (
        isPageIdentityRevoked(targetAccountId) ||
        rechecked.activeAccountId !== targetAccountId ||
        typeof rechecked.claimRevision !== 'number' ||
        rechecked.claimEpoch > rechecked.claimRevision
      ) {
        throw new RecordingPersistenceError(
          'STORAGE_CLAIM_STALE',
          '本地记录数据已被退出登录或账号切换清理，未写入上传队列，原生轨迹数据已保留。',
        );
      }
      pageClaimAccountId = targetAccountId;
      pageClaimRevision = rechecked.claimRevision;
      pageClaimToken = rechecked.claimToken;
      await syncNativeAccountClaim(targetAccountId, rechecked.claimRevision, rechecked.claimToken);
      return { claimRevision: rechecked.claimRevision, claimToken: rechecked.claimToken };
    }
    throw new RecordingPersistenceError(
      'STORAGE_CLAIM_STALE',
      '当前记录会话已被新登录或退出登录清理接管，未写入上传队列，原生轨迹数据已保留。',
    );
  }

  async function captureActiveSessionClaim(targetAccountId: string): Promise<PinnedNativeClaim> {
    if (initialClaimPromise) await initialClaimPromise;
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '检测到当前登录状态已变更，请刷新页面后再开始记录。');
    }
    const snap = await getActiveRecordingAccountSnapshot();
    if (isPageIdentityRevoked(targetAccountId)) {
      throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '检测到当前登录状态已变更，请刷新页面后再开始记录。');
    }
    if (!snap.activeAccountId || typeof snap.claimRevision !== 'number') {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '本地记录会话已被退出登录或账号切换清理，请刷新页面后再试。',
      );
    }
    if (snap.activeAccountId !== targetAccountId) {
      throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '检测到当前登录账号已切换，请刷新页面后再开始记录。');
    }
    if (snap.claimEpoch > snap.claimRevision) {
      throw new RecordingPersistenceError(
        'STORAGE_CLAIM_STALE',
        '当前记录会话已被其他标签页或新登录接管，请刷新后重试。',
      );
    }
    return { claimRevision: snap.claimRevision, claimToken: snap.claimToken };
  }

  function handleStaleSessionWrite(boundAccountId: string, boundClaimRev: number, message: string) {
    stopWebGeolocationWatch();
    if (!disposed && sessionAccountId === boundAccountId && sessionClaimRevision === boundClaimRev) {
      sessionOwnershipLost = true;
      releaseSessionLock();
      activeDurationMs = displayedDurationMs;
      lastSegmentStartMs = null;
      status = 'interrupted';
      gpsStatus = 'inactive';
      errorMessage = message;
    }
  }

  async function refreshUploadQueue() {
    if (!accountId) return;
    try {
      const list = await listUploadQueueItems(accountId);
      if (!disposed) uploadItems = list;
    } catch {
      // Persistent storage may be temporarily unavailable; preserve any pending native handoff UI.
    }
  }

  async function runUploadFlush(forceRetry = false) {
    if (!accountId || uploadBusy) return;
    uploadBusy = true;
    try {
      const outcome = await flushRecordingUploadQueue({
        accountId,
        fetcher: view.fetch,
        forceRetry,
      });
      if (disposed) return;
      await refreshUploadQueue();
      if (outcome.status === 'account_mismatch') {
        errorMessage = outcome.message ?? '当前登录账号已变更，已中止上传并清理原账号待传记录。';
      } else if (outcome.status === 'auth_expired') {
        errorMessage = outcome.message ?? '登录状态已过期，请重新登录后继续上传。';
      } else if (outcome.uploadedCount > 0) {
        statusNotice = `已成功上传 ${outcome.uploadedCount} 条跑步记录，里程与配速已按服务端计算结果更新。`;
        errorMessage = '';
      } else if (outcome.status === 'offline' && outcome.pendingCount > 0) {
        statusNotice = outcome.message ?? '当前离线，恢复网络后将自动上传。';
      } else if (outcome.status === 'failed' && outcome.message) {
        errorMessage = outcome.message;
      }
    } finally {
      if (!disposed) uploadBusy = false;
    }
  }

  function stopWebGeolocationWatch() {
    if (webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(webWatchId);
    }
    webWatchId = null;
  }

  /**
   * Called only after the awaited draft write that starts/resumes a segment: the page may have been
   * left (unmount cleanup already ran) or account cleanup/takeover may have committed before this
   * continuation resumed. Re-confirm BOTH in-memory state and the persisted claim/draft ownership
   * inside the same atomic IndexedDB transaction & claim lock used to call `watchPosition`, and
   * verify again on completion so an external cleanup cannot leave an active watcher behind.
   */
  async function startWebGeolocationWatch(
    boundAccountId: string,
    boundClaimRevision: number,
    boundClaimToken: string | undefined,
    boundSessionId: string,
    boundOwnerGeneration: number,
    resumeMode: boolean,
  ) {
    stopWebGeolocationWatch();
    const stillBoundInMemory = () =>
      !isPageIdentityRevoked(boundAccountId) &&
      !sessionOwnershipLost &&
      status === 'recording' &&
      sessionAccountId === boundAccountId &&
      sessionClaimRevision === boundClaimRevision &&
      sessionId === boundSessionId &&
      sessionOwnerGeneration === boundOwnerGeneration;
    if (!stillBoundInMemory()) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      permissions = { ...permissions, location: 'denied', locationServicesEnabled: false, canRecord: false };
      gpsStatus = 'disabled';
      return;
    }

    const applyInvalidWatchVerdict = (invalidVerdict: 'claim_stale' | 'missing' | 'owner_stale') => {
      stopWebGeolocationWatch();
      if (invalidVerdict === 'claim_stale' || !resumeMode) {
        resetLocalSessionState();
        errorMessage =
          invalidVerdict === 'claim_stale'
            ? '当前登录账号或本地记录数据已变更，已停止启动定位。'
            : invalidVerdict === 'missing'
              ? '本地跑步草稿已被清理或在其他标签页结束，已停止启动定位。'
              : SESSION_TAKEN_OVER_MESSAGE;
      } else {
        handleStaleSessionWrite(
          boundAccountId,
          boundClaimRevision,
          invalidVerdict === 'missing'
            ? '这条跑步草稿已在其他标签页中保存或丢弃，已停止启动定位。'
            : SESSION_TAKEN_OVER_MESSAGE,
        );
      }
    };

    const registerWatchNow = (): number | null => {
      if (!stillBoundInMemory() || typeof navigator === 'undefined' || !navigator.geolocation) {
        return null;
      }
      gpsStatus = 'acquiring';
      webLastFixMs = null;
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (
            disposed ||
            pageClaimRevoked ||
            status !== 'recording' ||
            sessionAccountId !== boundAccountId ||
            sessionClaimRevision !== boundClaimRevision
          ) {
            stopWebGeolocationWatch();
            return;
          }
          const nowMs = Date.now();
          webLastFixMs = nowMs;
          const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;
          const candidate: RecordedTrackPoint = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            elevationM: Number.isFinite(pos.coords.altitude ?? NaN) ? pos.coords.altitude : null,
            accuracyM: accuracy,
            recordedAtMs: pos.timestamp > 0 ? pos.timestamp : nowMs,
            segmentIndex,
          };
          const previous = webPoints.at(-1) ?? null;
          const decision = evaluateTrackPoint(candidate, previous);
          lastAccuracyM = accuracy;
          permissions = {
            ...permissions,
            location: 'granted',
            preciseLocation: true,
            locationServicesEnabled: true,
            canRecord: true,
          };
          if (decision.accepted) {
            webPoints = [...webPoints, candidate];
            pointCount = webPoints.length;
            previewDistanceM += decision.distanceDeltaM;
            lastPointTimeMs = candidate.recordedAtMs;
            void saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
              expectedClaimRevision: boundClaimRevision,
              expectedSessionId: sessionId,
              owner: ownerGuard(),
            }).catch((cause) => {
              if (isSessionWriteRejection(cause)) {
                handleStaleSessionWrite(boundAccountId, boundClaimRevision, cause.message);
              }
            });
          }
          gpsStatus = accuracy !== null && accuracy <= 15 ? 'good' : 'weak';
        },
        (err) => {
          if (disposed) return;
          if (err.code === err.PERMISSION_DENIED) {
            permissions = { ...permissions, location: 'denied', preciseLocation: false, canRecord: false };
            gpsStatus = 'permission_denied';
            errorMessage = '定位权限已被拒绝，请在浏览器或系统设置中允许 RunNote 访问精确位置。';
            stopWebGeolocationWatch();
            if (
              status === 'recording' &&
              sessionAccountId === boundAccountId &&
              sessionClaimRevision === boundClaimRevision
            ) {
              activeDurationMs = displayedDurationMs;
              lastSegmentStartMs = null;
              status = 'interrupted';
              interruptedReason = 'permission_revoked';
              void saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
                expectedClaimRevision: boundClaimRevision,
                expectedSessionId: sessionId,
                owner: ownerGuard(),
              }).catch((cause) => {
                if (isSessionWriteRejection(cause)) {
                  handleStaleSessionWrite(boundAccountId, boundClaimRevision, cause.message);
                }
              });
            }
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            gpsStatus = 'lost';
          } else if (err.code === err.TIMEOUT) {
            gpsStatus = 'acquiring';
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
      webWatchId = watchId;
      return watchId;
    };

    const guard = {
      expectedClaimRevision: boundClaimRevision,
      expectedClaimToken: boundClaimToken,
      expectedSessionId: boundSessionId,
      owner: { ownerId: tabOwnerId, expectedOwnerGeneration: boundOwnerGeneration },
    };

    let verdict: Awaited<ReturnType<typeof verifyWebDraftOwnershipUnderClaim>>;
    try {
      const result = await executeUnderWebDraftOwnership(boundAccountId, guard, registerWatchNow, (watchId) => {
        if (watchId !== null) {
          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId);
          }
          if (webWatchId === watchId) webWatchId = null;
        }
      });
      verdict = result.verdict;
    } catch {
      stopWebGeolocationWatch();
      verdict = 'claim_stale';
    }
    if (!stillBoundInMemory()) {
      stopWebGeolocationWatch();
      return;
    }
    if (verdict !== 'valid') {
      applyInvalidWatchVerdict(verdict);
      return;
    }
    // Re-confirm after the registration transaction settles so even an external cleanup that
    // committed immediately on `tx.complete` cannot leave an active watcher running.
    let postVerdict: Awaited<ReturnType<typeof verifyWebDraftOwnershipUnderClaim>>;
    try {
      postVerdict = await verifyWebDraftOwnershipUnderClaim(boundAccountId, guard);
    } catch {
      postVerdict = 'claim_stale';
    }
    if (!stillBoundInMemory()) {
      stopWebGeolocationWatch();
      return;
    }
    if (postVerdict !== 'valid') {
      applyInvalidWatchVerdict(postVerdict);
    }
  }

  async function recoverNativeSessionState() {
    const token = ++recoveryRequestToken;
    if (activeRecoveryTimeoutId !== null) {
      window.clearTimeout(activeRecoveryTimeoutId);
      activeRecoveryTimeoutId = null;
    }
    sessionRecoveryState = 'pending';
    recoveryFailureMessage = '';
    let localTimerId: number | null = null;
    try {
      const nativeState = await new Promise<RecorderStateEvent | null>((resolve, reject) => {
        localTimerId = window.setTimeout(() => {
          reject(new Error('读取原生记录状态超时，为避免覆盖未保存轨迹已暂停开始记录，请重试恢复。'));
        }, NATIVE_RECOVERY_TIMEOUT_MS);
        activeRecoveryTimeoutId = localTimerId;
        void getNativeRecorderState(accountId).then(resolve, reject);
      });
      if (disposed || token !== recoveryRequestToken) return;
      if (!nativeState) {
        sessionRecoveryState = 'failed';
        recoveryFailureMessage = '未能读取原生记录会话状态（返回为空），为避免覆盖未保存轨迹已暂停开始记录。';
        return;
      }
      applyNativeState(nativeState);
      sessionRecoveryState = 'ready';
      recoveryFailureMessage = '';
      if (!unsubscribeNative) {
        unsubscribeNative = subscribeNativeRecorderUpdates((event) => {
          if (!disposed) applyNativeState(event);
        });
      }
    } catch (cause) {
      if (disposed || token !== recoveryRequestToken) return;
      sessionRecoveryState = 'failed';
      recoveryFailureMessage =
        cause instanceof Error && cause.message
          ? cause.message
          : '读取原生记录会话状态失败，为避免覆盖未保存轨迹已暂停开始记录。';
    } finally {
      if (localTimerId !== null) {
        window.clearTimeout(localTimerId);
        if (activeRecoveryTimeoutId === localTimerId) {
          activeRecoveryTimeoutId = null;
        }
      }
    }
  }

  async function recoverWebDraftState() {
    const token = ++recoveryRequestToken;
    sessionRecoveryState = 'pending';
    recoveryFailureMessage = '';
    errorMessage = '';
    if (!sessionId) {
      // A failed earlier attempt may have taken ownership without loading a session.
      sessionOwnerGeneration = null;
      releaseSessionLock();
    }
    if (!accountId) {
      sessionRecoveryState = 'ready';
      return;
    }
    try {
      const draftMeta = await readActiveRecordingDraftWithMeta(accountId);
      if (disposed || token !== recoveryRequestToken) return;
      if (draftMeta) {
        const claimed = await captureActiveSessionClaim(accountId);
        const claimedRev = claimed.claimRevision;
        if (disposed || token !== recoveryRequestToken) return;
        if (typeof draftMeta.claimRevision === 'number' && draftMeta.claimRevision > claimedRev) {
          sessionRecoveryState = 'failed';
          recoveryFailureMessage = '检测到其他标签页正在写入新记录草稿，请重试恢复以确认最新状态。';
          return;
        }
        // Take ownership before showing or acting on the draft. A free lock for the current claim
        // proves no live tab owns it (an owner at an older claim is already fenced by IndexedDB);
        // a held one means a live owner, which is never robbed, however old this tab's read is.
        const lockResult = await acquireSessionLock(accountId, claimedRev);
        const ownerProvenGone = lockResult.status === 'acquired';
        const recoveryLock = lockResult.status === 'acquired' ? lockResult.lock : null;
        if (disposed || token !== recoveryRequestToken) {
          recoveryLock?.release();
          return;
        }
        if (lockResult.status === 'held') {
          sessionRecoveryState = 'failed';
          recoveryFailureMessage = SESSION_LIVE_ELSEWHERE_MESSAGE;
          return;
        }
        let takeover;
        try {
          takeover = await takeOverActiveRecordingDraft(accountId, {
            expectedClaimRevision: claimedRev,
            expectedSessionId: draftMeta.draft.sessionId,
            expectedDraftRevision: draftMeta.draftRevision,
            expectedSavedAt: draftMeta.savedAt,
            ownerId: tabOwnerId,
            ownerProvenGone,
          });
        } catch (cause) {
          recoveryLock?.release();
          throw cause;
        }
        if (disposed || token !== recoveryRequestToken || takeover.status !== 'taken') {
          recoveryLock?.release();
          if (disposed || token !== recoveryRequestToken || takeover.status === 'taken') return;
          sessionRecoveryState = 'failed';
          recoveryFailureMessage =
            takeover.status === 'live'
              ? SESSION_LIVE_ELSEWHERE_MESSAGE
              : takeover.status === 'stale'
                ? '当前记录会话已被其他标签页或新登录接管，请重试恢复以确认最新状态。'
                : '本地跑步草稿刚被其他标签页更新，已保留最新内容，请重试恢复以加载最新轨迹。';
          return;
        }
        if (recoveryLock?.lost) {
          // Stolen mid-takeover: this tab no longer holds the proof of ownership, so it must not write.
          sessionRecoveryState = 'failed';
          recoveryFailureMessage = SESSION_LIVE_ELSEWHERE_MESSAGE;
          return;
        }
        const draft = takeover.draft;
        sessionLock = recoveryLock;
        sessionOwnerGeneration = takeover.ownerGeneration;
        sessionOwnershipLost = false;
        if (draft.status === 'stopped' && draft.points.length > 0) {
          await enqueueStoppedWebDraft(
            {
              accountId,
              sessionId: draft.sessionId,
              idempotencyKey: draft.idempotencyKey,
              title: draft.title,
              timezone,
              startedAtMs: draft.startedAtMs || draft.points[0].recordedAtMs,
              endedAtMs: draft.endedAtMs ?? Date.now(),
              activeDurationMs: draft.activeDurationMs,
              points: draft.points,
            },
            { expectedClaimRevision: claimedRev, expectedSessionId: draft.sessionId, owner: ownerGuard() },
          );
          if (disposed || token !== recoveryRequestToken) return;
          sessionOwnerGeneration = null;
          releaseSessionLock();
        } else if (draft.status === 'recording' || draft.status === 'paused' || draft.status === 'interrupted') {
          sessionAccountId = accountId;
          sessionClaimRevision = claimedRev;
          sessionClaimToken = claimed.claimToken;
          sessionId = draft.sessionId;
          idempotencyKey = draft.idempotencyKey;
          runTitle = draft.title;
          startedAtMs = draft.startedAtMs;
          activeDurationMs = draft.activeDurationMs;
          lastSegmentStartMs = null;
          segmentIndex = draft.segmentIndex;
          webPoints = draft.points;
          pointCount = draft.points.length;
          previewDistanceM = draft.previewDistanceM;
          lastPointTimeMs = draft.lastPointTimeMs;
          lastAccuracyM = draft.lastAccuracyM;
          interruptedReason = draft.interruptedReason ?? 'process_terminated';
          status = 'interrupted';
          lastLeaseRenewMs = Date.now();
        } else {
          sessionOwnerGeneration = null;
          releaseSessionLock();
        }
      }
      if (disposed || token !== recoveryRequestToken) return;
      sessionRecoveryState = 'ready';
      recoveryFailureMessage = '';
    } catch (cause) {
      if (disposed || token !== recoveryRequestToken) return;
      if (!sessionId) {
        // Nothing was loaded: do not keep the lock, so this tab never blocks the session's next owner.
        sessionOwnerGeneration = null;
        releaseSessionLock();
      }
      sessionRecoveryState = 'failed';
      recoveryFailureMessage =
        cause instanceof Error && cause.message
          ? `读取或恢复本地草稿失败：${cause.message}`
          : '本地持久化存储不可用，为避免覆盖未保存草稿已暂停开始记录，请重试恢复。';
    }
  }

  async function retrySessionRecovery() {
    if (capabilities.native) {
      if (isNativeLocationRecorderAvailable()) {
        await recoverNativeSessionState();
      } else {
        sessionRecoveryState = 'failed';
        recoveryFailureMessage = '未能连接原生定位记录服务，为避免覆盖未保存轨迹已暂停开始记录。';
      }
      return;
    }
    await recoverWebDraftState();
    if (!disposed && sessionRecoveryState === 'ready') {
      await refreshUploadQueue();
      if (!disposed && !offline) {
        void runUploadFlush(false);
      }
    }
  }

  async function handleRequestPermission() {
    if (actionBusy) return;
    actionBusy = true;
    errorMessage = '';
    try {
      permissions = await requestRecorderPermissions();
      if (disposed) return;
      if (permissions.location === 'denied') {
        errorMessage = '未获得定位权限。如需记录跑步轨迹，请允许精确位置权限或在系统设置中开启。';
      } else if (permissions.location === 'approximate') {
        errorMessage = '当前仅授予了大致位置权限。跑步轨迹记录需要开启“精确位置”才能开始。';
      } else if (!permissions.locationServicesEnabled) {
        errorMessage = '系统定位服务已关闭，请先开启定位开关。';
      } else {
        statusNotice = '精确位置权限已就绪，可以开始记录。';
      }
    } catch (cause) {
      if (!disposed) errorMessage = cause instanceof Error ? cause.message : '定位权限申请失败';
    } finally {
      if (!disposed) actionBusy = false;
    }
  }

  async function handleStart(resumeInterrupted = false) {
    if (actionBusy || handoffBusy || !accountId) return;
    if (!resumeInterrupted && sessionRecoveryState !== 'ready') {
      errorMessage =
        sessionRecoveryState === 'failed'
          ? recoveryFailureMessage || '未能确认原生记录会话状态，为避免覆盖未保存轨迹已暂停开始记录，请先重试恢复。'
          : '正在检查并恢复未完成的跑步记录，请稍候…';
      return;
    }
    if (pendingHandoffSession) {
      errorMessage = '请先完成上一条已结束记录的保存入队或安全丢弃，再开始新的记录。';
      return;
    }
    actionBusy = true;
    errorMessage = '';
    statusNotice = '';
    completedReceipt = null;
    screenLocked = false;
    try {
      if (capabilities.native) {
        let perms = await checkRecorderPermissions();
        if (perms.location !== 'granted') {
          perms = await requestRecorderPermissions();
        }
        permissions = perms;
        if (perms.location === 'denied') {
          errorMessage = '尚未授予定位权限，请先允许 RunNote 访问精确位置。';
          return;
        }
        if (perms.location === 'approximate') {
          errorMessage = '跑步轨迹记录需要精确位置权限，请在系统设置中切换为“精确位置”。';
          return;
        }
        if (!perms.locationServicesEnabled) {
          errorMessage = '系统定位服务未开启，请先打开手机定位开关。';
          return;
        }
        const sid = resumeInterrupted && sessionId ? sessionId : generateUuidV4();
        const ikey = resumeInterrupted && idempotencyKey ? idempotencyKey : generateUuidV4();
        if (isPageIdentityRevoked(accountId)) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '检测到当前登录状态已变更，请刷新页面后再开始记录。',
          );
        }
        const nativeStartClaim: PinnedNativeClaim | null =
          pageClaimAccountId === accountId && pageClaimRevision !== null
            ? { claimRevision: pageClaimRevision, claimToken: pageClaimToken }
            : await pinNativeHandoffClaim(accountId).catch((cause: unknown) => {
                if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_UNAVAILABLE') {
                  return null;
                }
                throw cause;
              });
        if (disposed) return;
        try {
          await startNativeRecording({
            sessionId: sid,
            accountId,
            idempotencyKey: ikey,
            title: runTitle.trim(),
            resumeInterrupted,
            ...(nativeStartClaim
              ? { claimRevision: nativeStartClaim.claimRevision, claimToken: nativeStartClaim.claimToken }
              : {}),
          });
        } catch (nativeStartCause) {
          await getNativeRecorderState(accountId)
            .then((next) => {
              if (!disposed && next) applyNativeState(next);
            })
            .catch(() => {});
          throw nativeStartCause;
        }
        const nextState = await getNativeRecorderState(accountId);
        if (!disposed && nextState) applyNativeState(nextState);
        return;
      }

      if (!capabilities.locationServicesEnabled) {
        errorMessage = '当前浏览器不支持地理定位。';
        return;
      }
      if (resumeInterrupted && sessionOwnershipLost) {
        throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', SESSION_TAKEN_OVER_MESSAGE);
      }
      const nowMs = Date.now();
      const boundAccountId = resumeInterrupted && sessionAccountId ? sessionAccountId : accountId;
      const capturedClaim =
        resumeInterrupted && sessionId && sessionClaimRevision !== null
          ? { claimRevision: sessionClaimRevision, claimToken: sessionClaimToken }
          : await captureActiveSessionClaim(boundAccountId);
      const boundClaimRev = capturedClaim.claimRevision;
      const boundClaimToken = capturedClaim.claimToken;
      if (disposed) return;
      if (!resumeInterrupted) {
        releaseSessionLock();
        const lockResult = await acquireSessionLock(boundAccountId, boundClaimRev);
        if (disposed) {
          if (lockResult.status === 'acquired') lockResult.lock.release();
          return;
        }
        if (lockResult.status === 'held') {
          resetLocalSessionState();
          await recoverWebDraftState();
          throw new RecordingPersistenceError('STORAGE_SESSION_LIVE', SESSION_LIVE_ELSEWHERE_MESSAGE);
        }
        sessionLock = lockResult.status === 'acquired' ? lockResult.lock : null;
      }
      if (resumeInterrupted && sessionId) {
        segmentIndex += 1;
        status = 'recording';
        lastSegmentStartMs = nowMs;
        interruptedReason = null;
      } else {
        sessionId = generateUuidV4();
        idempotencyKey = generateUuidV4();
        startedAtMs = nowMs;
        activeDurationMs = 0;
        lastSegmentStartMs = nowMs;
        segmentIndex = 0;
        pointCount = 0;
        previewDistanceM = 0;
        lastPointTimeMs = null;
        lastAccuracyM = null;
        interruptedReason = null;
        webPoints = [];
        status = 'recording';
      }
      sessionAccountId = boundAccountId;
      sessionClaimRevision = boundClaimRev;
      sessionClaimToken = boundClaimToken;
      const boundSessionId = sessionId;
      try {
        await saveActiveRecordingDraft(
          buildWebDraft(boundAccountId),
          undefined,
          resumeInterrupted
            ? { expectedClaimRevision: boundClaimRev, expectedSessionId: sessionId, owner: ownerGuard() }
            : {
                expectedClaimRevision: boundClaimRev,
                rejectIfExistingDraft: true,
                owner: { ownerId: tabOwnerId },
              },
        );
        if (!resumeInterrupted) {
          sessionOwnerGeneration = 1;
          sessionOwnershipLost = false;
        }
        lastLeaseRenewMs = Date.now();
      } catch (saveCause) {
        if (!resumeInterrupted) {
          resetLocalSessionState();
          if (saveCause instanceof RecordingPersistenceError && saveCause.code === 'STORAGE_DRAFT_EXISTS') {
            await recoverWebDraftState();
          }
        } else {
          handleStaleSessionWrite(boundAccountId, boundClaimRev, saveCause instanceof Error ? saveCause.message : '');
        }
        throw saveCause;
      }
      const boundOwnerGeneration = resumeInterrupted ? (sessionOwnerGeneration ?? 0) : 1;
      await startWebGeolocationWatch(
        boundAccountId,
        boundClaimRev,
        boundClaimToken,
        boundSessionId,
        boundOwnerGeneration,
        resumeInterrupted,
      );
    } catch (cause) {
      if (!disposed) errorMessage = cause instanceof Error ? cause.message : '无法开始记录，请重试';
    } finally {
      if (!disposed) actionBusy = false;
    }
  }

  async function handlePause() {
    if (actionBusy || status !== 'recording') return;
    actionBusy = true;
    errorMessage = '';
    try {
      if (capabilities.native) {
        await pauseNativeRecording();
        const nextState = await getNativeRecorderState(accountId);
        if (!disposed && nextState) applyNativeState(nextState);
      } else {
        stopWebGeolocationWatch();
        activeDurationMs = displayedDurationMs;
        lastSegmentStartMs = null;
        status = 'paused';
        gpsStatus = 'inactive';
        const boundAccountId = sessionAccountId || accountId;
        const boundClaimRev = sessionClaimRevision;
        if (boundClaimRev === null) {
          throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '当前记录会话已失效，请重新开始记录。');
        }
        try {
          await saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
            expectedClaimRevision: boundClaimRev,
            expectedSessionId: sessionId,
            owner: ownerGuard(),
          });
        } catch (cause) {
          if (isSessionWriteRejection(cause)) {
            handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
            return;
          }
          throw cause;
        }
      }
    } catch (cause) {
      if (!disposed) errorMessage = cause instanceof Error ? cause.message : '暂停失败';
    } finally {
      if (!disposed) actionBusy = false;
    }
  }

  async function handleResume() {
    if (actionBusy || (status !== 'paused' && status !== 'interrupted')) return;
    if (status === 'interrupted') {
      await handleStart(true);
      return;
    }
    actionBusy = true;
    errorMessage = '';
    try {
      if (capabilities.native) {
        await resumeNativeRecording();
        const nextState = await getNativeRecorderState(accountId);
        if (!disposed && nextState) applyNativeState(nextState);
      } else {
        const boundAccountId = sessionAccountId || accountId;
        const boundClaimRev = sessionClaimRevision;
        if (boundClaimRev === null) {
          throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '当前记录会话已失效，请重新开始记录。');
        }
        const boundSessionId = sessionId;
        segmentIndex += 1;
        lastSegmentStartMs = Date.now();
        status = 'recording';
        try {
          await saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
            expectedClaimRevision: boundClaimRev,
            expectedSessionId: sessionId,
            owner: ownerGuard(),
          });
        } catch (cause) {
          if (isSessionWriteRejection(cause)) {
            handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
            return;
          }
          throw cause;
        }
        const boundOwnerGeneration = sessionOwnerGeneration ?? 0;
        await startWebGeolocationWatch(
          boundAccountId,
          boundClaimRev,
          sessionClaimToken,
          boundSessionId,
          boundOwnerGeneration,
          true,
        );
      }
    } catch (cause) {
      if (!disposed) errorMessage = cause instanceof Error ? cause.message : '继续记录失败';
    } finally {
      if (!disposed) actionBusy = false;
    }
  }

  async function handleStopAndSave() {
    if (actionBusy || !accountId) return;
    actionBusy = true;
    stoppingInFlight = true;
    errorMessage = '';
    statusNotice = '';
    let stoppedSession: RecorderSessionSnapshot | null = null;
    // Set once the Web GPS watch is cleared, so a failure below can never leave the UI "recording".
    let webStopActiveMs: number | null = null;
    const boundAccountId = sessionAccountId || accountId;
    const boundClaimRev = sessionClaimRevision;
    const boundSessionId = sessionId;
    let nativeClaim: PinnedNativeClaim | null = null;
    try {
      let capturedPoints: RecordedTrackPoint[] = [];
      let finalStartedAt = startedAtMs;
      let finalEndedAt = Date.now();
      let finalActiveMs = displayedDurationMs;
      let finalSessionId = boundSessionId;
      let finalIdempotencyKey = idempotencyKey;
      let finalTitle = runTitle.trim();

      if (capabilities.native) {
        // Bind manual Stop strictly to this page's confirmed account claim and session ID BEFORE
        // calling native stop: if pinning fails or ownership cannot be confirmed, never stop the
        // native recording and never display another account's session stats.
        if (!boundSessionId || isPageIdentityRevoked(boundAccountId)) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '当前登录状态已变更或无法确认记录归属，已阻止停止原生记录，未写入上传队列。',
          );
        }
        nativeClaim = await pinNativeHandoffClaim(boundAccountId);
        if (disposed || isPageIdentityRevoked(boundAccountId)) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '当前登录状态已变更或本地记录数据已清理，已阻止停止原生记录，未写入上传队列。',
          );
        }
        const stopped = await stopNativeRecording({
          accountId: boundAccountId,
          sessionId: boundSessionId,
          claimRevision: nativeClaim.claimRevision,
          claimToken: nativeClaim.claimToken,
        });
        if (disposed) return;
        if (
          !stopped?.session ||
          stopped.session.accountId !== boundAccountId ||
          stopped.session.sessionId !== boundSessionId
        ) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '检测到原生记录归属不匹配，已阻止停止或显示其他账号的数据。',
          );
        }
        stoppedSession = stopped.session;
        capturedPoints = stopped.points ?? [];
        finalSessionId = stopped.session.sessionId;
        finalIdempotencyKey = stopped.session.idempotencyKey;
        finalStartedAt = stopped.session.startedAtMs;
        finalEndedAt = stopped.session.endedAtMs ?? Date.now();
        finalActiveMs = stopped.session.activeDurationMs;
        if (!finalTitle && stopped.session.title) finalTitle = stopped.session.title;
        await assertNativeClaimCurrent(boundAccountId, nativeClaim);
        if (disposed) return;
      } else {
        stopWebGeolocationWatch();
        webStopActiveMs = finalActiveMs;
        capturedPoints = [...webPoints];
      }

      if (capturedPoints.length === 0) {
        errorMessage = '本次记录未捕获到有效 GPS 轨迹点，无法生成轨迹文件。请移至空旷处或直接安全丢弃本次会话。';
        if (capabilities.native) {
          if (
            nativeClaim !== null &&
            !isPageIdentityRevoked(boundAccountId) &&
            stoppedSession &&
            stoppedSession.status === 'stopped' &&
            stoppedSession.pointCount === 0
          ) {
            await acknowledgeEmptyNativeHandoff(boundAccountId, stoppedSession.sessionId, nativeClaim).catch(() => {});
          }
          const nextState = await getNativeRecorderState(accountId);
          if (!disposed && nextState) applyNativeState(nextState);
        } else {
          status = 'paused';
          lastSegmentStartMs = null;
          activeDurationMs = finalActiveMs;
          if (boundClaimRev !== null) {
            try {
              await saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
                expectedClaimRevision: boundClaimRev,
                expectedSessionId: sessionId,
                owner: ownerGuard(),
              });
            } catch (cause) {
              if (isSessionWriteRejection(cause)) {
                handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
                return;
              }
              throw cause;
            }
          }
        }
        return;
      }

      if (!capabilities.native) {
        // Mark the draft stopped under this tab's ownership first: a tab that lost the session
        // (taken over, saved or discarded elsewhere) must not enqueue its own stale copy.
        if (boundClaimRev === null || sessionOwnershipLost) {
          throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', SESSION_TAKEN_OVER_MESSAGE);
        }
        try {
          await saveActiveRecordingDraft(
            {
              ...buildWebDraft(boundAccountId),
              status: 'stopped',
              endedAtMs: finalEndedAt,
              activeDurationMs: finalActiveMs,
              lastSegmentStartMs: null,
              points: capturedPoints.map((pt) => ({ ...pt })),
            },
            undefined,
            { expectedClaimRevision: boundClaimRev, expectedSessionId: finalSessionId, owner: ownerGuard() },
          );
        } catch (cause) {
          if (isSessionWriteRejection(cause)) {
            handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
          }
          throw cause;
        }
      }

      const finalizeInput = {
        accountId: boundAccountId,
        sessionId: finalSessionId || generateUuidV4(),
        idempotencyKey: finalIdempotencyKey || generateUuidV4(),
        title: finalTitle,
        timezone,
        startedAtMs: finalStartedAt || capturedPoints[0].recordedAtMs,
        endedAtMs: finalEndedAt,
        activeDurationMs: finalActiveMs,
        points: capturedPoints,
      };
      if (capabilities.native) {
        // Persist to IndexedDB upload queue FIRST, then run the final claim-locked read-back and
        // claim-bound native ack atomically so cleanup cannot commit between read-back and ack.
        if (nativeClaim === null || isPageIdentityRevoked(boundAccountId)) {
          throw new RecordingPersistenceError(
            'STORAGE_CLAIM_STALE',
            '当前登录状态已变更或本地记录数据已清理，未写入上传队列，原生轨迹数据已保留。',
          );
        }
        await enqueueFinalizedRecording(finalizeInput, {
          expectedClaimRevision: nativeClaim.claimRevision,
          expectedClaimToken: nativeClaim.claimToken,
        });
        if (isPageIdentityRevoked(boundAccountId)) return;
        await acknowledgeEnqueuedNativeHandoff(
          boundAccountId,
          finalSessionId,
          finalizeInput.idempotencyKey,
          nativeClaim,
        );
      } else if (boundClaimRev !== null) {
        // Queue row + draft removal commit together, and only while this tab still owns the stopped
        // draft: a logout/cleanup that ran since the stop leaves nothing to recreate.
        try {
          await enqueueStoppedWebDraft(finalizeInput, {
            expectedClaimRevision: boundClaimRev,
            expectedSessionId: finalSessionId,
            owner: ownerGuard(),
          });
        } catch (cause) {
          if (isSessionWriteRejection(cause)) {
            handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
          }
          throw cause;
        }
      }

      pendingHandoffSession = null;
      failedHandoffSessionId = null;
      const receiptSplits = extractRecordedSplits(capturedPoints);
      const distinctSegments = new Set(capturedPoints.map((pt) => pt.segmentIndex)).size;
      const savedReceipt: CompletedReceipt = {
        idempotencyKey: finalizeInput.idempotencyKey,
        title: finalizeInput.title || '跑步记录',
        startedAtMs: finalizeInput.startedAtMs,
        endedAtMs: finalizeInput.endedAtMs,
        activeDurationMs: finalizeInput.activeDurationMs,
        pointCount: capturedPoints.length,
        segmentCount: Math.max(1, distinctSegments),
        previewDistanceM:
          capabilities.native && stoppedSession
            ? stoppedSession.previewDistanceM
            : previewDistanceM > 0
              ? previewDistanceM
              : (receiptSplits[receiptSplits.length - 1]?.cumulativeDistanceM ?? 0),
        splits: receiptSplits,
      };
      resetLocalSessionState();
      runTitle = '';
      completedReceipt = savedReceipt;
      await refreshUploadQueue();
      await tick();
      if (!disposed && typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
      if (offline) {
        statusNotice = '轨迹已安全保存到本地上传队列，恢复网络后将自动上传一次。';
      } else {
        await runUploadFlush(true);
      }
    } catch (cause) {
      if (!disposed) {
        if (
          capabilities.native &&
          stoppedSession &&
          stoppedSession.accountId === boundAccountId &&
          stoppedSession.sessionId === boundSessionId
        ) {
          pendingHandoffSession = stoppedSession;
          failedHandoffSessionId = stoppedSession.sessionId;
          status = 'stopped';
          lastSegmentStartMs = null;
        } else if (
          webStopActiveMs !== null &&
          !sessionOwnershipLost &&
          (status === 'recording' || status === 'interrupted')
        ) {
          // GPS is already off and the stopped draft (if it was written) stays recoverable: show the
          // recovery panel so the user can retry saving, resume or discard.
          if (status === 'recording') activeDurationMs = webStopActiveMs;
          lastSegmentStartMs = null;
          status = 'interrupted';
          gpsStatus = 'inactive';
          interruptedReason = 'enqueue_failed';
        }
        errorMessage =
          cause instanceof Error
            ? `未能将已结束记录写入本地上传队列：${cause.message}`
            : '结束并保存记录失败，请重试保存';
      }
    } finally {
      stoppingInFlight = false;
      if (!disposed) actionBusy = false;
    }
  }

  function requestDiscardConfirmation(
    target: { kind: 'session' } | { kind: 'upload'; idempotencyKey: string; title: string },
  ) {
    pendingDiscardTarget = target;
    discardDialog?.showModal();
  }

  async function confirmDiscard() {
    const target = pendingDiscardTarget;
    pendingDiscardTarget = null;
    discardDialog?.close();
    if (!target || !accountId) return;

    actionBusy = true;
    errorMessage = '';
    try {
      if (target.kind === 'session') {
        if (capabilities.native) {
          await discardNativeRecording();
        } else {
          stopWebGeolocationWatch();
          if (sessionClaimRevision !== null) {
            try {
              await deleteActiveRecordingDraft(sessionAccountId || accountId, undefined, {
                expectedClaimRevision: sessionClaimRevision,
                expectedSessionId: sessionId || undefined,
                owner: ownerGuard(),
              });
            } catch (cause) {
              if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
                pendingHandoffSession = null;
                resetLocalSessionState();
                runTitle = '';
                errorMessage = cause.message;
                return;
              }
              throw cause;
            }
          }
        }
        pendingHandoffSession = null;
        resetLocalSessionState();
        runTitle = '';
        statusNotice = '已安全丢弃未保存的记录会话。';
      } else {
        await discardUploadQueueItem(accountId, target.idempotencyKey);
        await refreshUploadQueue();
        statusNotice = '已从本地上传队列移除该记录。';
      }
    } finally {
      if (!disposed) actionBusy = false;
    }
  }

  function cancelDiscard() {
    pendingDiscardTarget = null;
    discardDialog?.close();
  }

  function confirmLeavePage() {
    const target = pendingLeaveUrl;
    pendingLeaveUrl = null;
    leaveDialog?.close();
    if (!target) return;
    allowNextLeave = true;
    void goto(target);
  }

  function cancelLeavePage() {
    pendingLeaveUrl = null;
    leaveDialog?.close();
  }

  beforeNavigate((navigation) => {
    if (allowNextLeave) {
      allowNextLeave = false;
      return;
    }
    if ((status === 'recording' || status === 'paused') && navigation.to) {
      navigation.cancel();
      pendingLeaveUrl = navigation.to.url.pathname + navigation.to.url.search;
      leaveDialog?.showModal();
    }
  });

  function formatUploadStatus(item: UploadQueueItem): string {
    if (item.status === 'uploaded') return '已上传';
    if (item.status === 'uploading') return '上传中…';
    if (offline) return '等待联网';
    if (item.permanentError) return '轨迹校验失败';
    if (item.status === 'failed') {
      if (item.nextRetryAt !== null && item.nextRetryAt > clockNowMs) {
        const secs = Math.max(1, Math.ceil((item.nextRetryAt - clockNowMs) / 1000));
        return `等待自动重试（${secs}s 后）`;
      }
      return `等待重试（第 ${item.attemptCount} 次失败）`;
    }
    return '待上传';
  }

  onMount(() => {
    mounted = true;
    offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const mobileQuery = window.matchMedia('(max-width: 799px)');
    const syncMobileViewport = () => {
      isMobileViewport = mobileQuery.matches;
      if (!isMobileViewport) {
        screenLocked = false;
        cancelFinishHold();
      }
    };
    syncMobileViewport();
    mobileQuery.addEventListener('change', syncMobileViewport);

    const onNetwork = () => {
      const nextOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const reconnected = offline && !nextOffline;
      offline = nextOffline;
      if (reconnected) {
        void runUploadFlush(false);
      }
    };
    const onQueueUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; message?: string } | undefined>).detail;
      if (detail?.reason === 'account_mismatch' && detail.message) {
        errorMessage = detail.message;
      }
      void refreshUploadQueue();
    };

    const handleIdentityRevoked = () => {
      pageClaimRevoked = true;
      stopWebGeolocationWatch();
      if (!disposed && !capabilities.native && status === 'recording') {
        resetLocalSessionState();
        errorMessage = '当前登录状态已变更，已停止记录。';
      } else {
        releaseSessionLock();
      }
    };
    const unsubscribeRevoked = layoutClaimContext?.onRevoked(handleIdentityRevoked) ?? null;
    const unsubscribeClaimChanges = subscribeRecordingClaimChanges((event) => {
      const currentAccountId = accountId;
      if (!currentAccountId) return;
      const revokedCurrent =
        event.kind === 'revoked' && (event.accountId === null || event.accountId === currentAccountId);
      const switchedAccount = event.kind === 'claimed' && event.accountId !== currentAccountId;
      if (revokedCurrent || switchedAccount) {
        handleIdentityRevoked();
        return;
      }
      const sameAccountNewerGen =
        event.kind === 'claimed' &&
        event.accountId === currentAccountId &&
        typeof event.claimRevision === 'number' &&
        ((pageClaimRevision !== null && event.claimRevision > pageClaimRevision) ||
          (sessionClaimRevision !== null && event.claimRevision > sessionClaimRevision));
      if (sameAccountNewerGen) {
        if (
          !disposed &&
          !capabilities.native &&
          status === 'recording' &&
          sessionAccountId === currentAccountId &&
          sessionClaimRevision !== null
        ) {
          handleStaleSessionWrite(
            sessionAccountId,
            sessionClaimRevision,
            '当前记录会话已被其他标签页或新登录接管，已停止在本页写入。',
          );
        } else {
          stopWebGeolocationWatch();
          releaseSessionLock();
        }
      }
    });
    const authChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('runnote-auth');
    if (authChannel) {
      authChannel.onmessage = (event) => {
        if (isAccountChangeAuthBroadcast(event.data)) {
          handleIdentityRevoked();
        }
      };
    }

    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    window.addEventListener('runnote-recording-queue-updated', onQueueUpdated);

    initialClaimPromise = bindInitialPageClaim();
    void (async () => {
      try {
        await initialClaimPromise;
        if (disposed) return;

        const caps = await getRecorderCapabilities();
        if (disposed) return;
        capabilities = caps;

        const perms = await checkRecorderPermissions();
        if (disposed) return;
        permissions = perms;

        if (caps.native) {
          if (isNativeLocationRecorderAvailable()) {
            await recoverNativeSessionState();
          } else {
            sessionRecoveryState = 'failed';
            recoveryFailureMessage = '未能连接原生定位记录服务，为避免覆盖未保存轨迹已暂停开始记录。';
          }
          if (disposed) return;
        } else {
          await recoverWebDraftState();
        }
      } catch (cause) {
        if (!disposed) {
          sessionRecoveryState = 'failed';
          recoveryFailureMessage =
            cause instanceof Error && cause.message
              ? cause.message
              : '读取记录状态失败，为避免覆盖未保存轨迹已暂停开始记录。';
        }
      }

      if (disposed) return;
      await refreshUploadQueue();
      if (!disposed && !offline) {
        void runUploadFlush(false);
      }
    })();

    const tickTimer = window.setInterval(() => {
      clockNowMs = Date.now();
      if (clockNowMs - lastLeaseRenewMs >= DRAFT_LEASE_RENEW_INTERVAL_MS) {
        lastLeaseRenewMs = clockNowMs;
        void renewDraftLease();
      }
      if (!capabilities.native && status === 'recording' && webLastFixMs !== null) {
        if (clockNowMs - webLastFixMs > 15000 && gpsStatus !== 'lost') {
          gpsStatus = 'lost';
        }
      }
    }, 1000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && capabilities.native && sessionRecoveryState === 'ready') {
        void getNativeRecorderState(accountId)
          .then((next) => {
            if (!disposed && next) applyNativeState(next);
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      cancelFinishHold();
      mobileQuery.removeEventListener('change', syncMobileViewport);
      if (activeRecoveryTimeoutId !== null) {
        window.clearTimeout(activeRecoveryTimeoutId);
        activeRecoveryTimeoutId = null;
      }
      window.clearInterval(tickTimer);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
      window.removeEventListener('runnote-recording-queue-updated', onQueueUpdated);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeRevoked?.();
      unsubscribeClaimChanges();
      authChannel?.close();
      unsubscribeNative?.();
      unsubscribeNative = null;
      stopWebGeolocationWatch();
      releaseSessionLock();
    };
  });
</script>

<div
  class="editorial-page recording-workspace"
  data-recording-immersive={isImmersiveRecording ? '' : undefined}
  data-recording-done={isDoneView ? '' : undefined}
>
  <div class="desktop-record-header" class:hidden-on-mobile={isImmersiveRecording || isDoneView}>
    <PageHeader title="实时记录">
      {#snippet actions()}
        <a class="button-secondary" href={view.href('/activities')}>跑步记录</a>
      {/snippet}
    </PageHeader>
  </div>

  <div class="recording-body" class:is-immersive={isImmersiveRecording}>
    {#if pendingHandoffSession}
      <section
        class="section-rule recording-recovery"
        aria-labelledby="handoff-title"
        data-testid="recording-pending-handoff-panel"
      >
        <FeedbackState kind="error" title="检测到已结束但尚未入队的跑步记录">
          <p>
            上次结束记录后应用在写入上传队列前中断。已安全保留 {pendingHandoffSession.pointCount} 个轨迹点（预览 {formatPreviewDistanceKm(
              pendingHandoffSession.previewDistanceM,
            )}），完成入队前不可开始新记录。
          </p>
          <div class="recording-actions mt-3">
            <button
              type="button"
              class="button-primary"
              disabled={handoffBusy || actionBusy}
              onclick={() => pendingHandoffSession && void recoverPendingStoppedHandoff(pendingHandoffSession, true)}
              data-testid="handoff-retry-btn"
            >
              {handoffBusy ? '正在保存…' : '重试保存到上传队列'}
            </button>
            <button
              type="button"
              class="button-secondary danger-outline"
              disabled={handoffBusy || actionBusy}
              onclick={() => requestDiscardConfirmation({ kind: 'session' })}
              data-testid="handoff-discard-btn"
            >
              安全丢弃
            </button>
          </div>
        </FeedbackState>
      </section>
    {:else if status === 'interrupted'}
      <section
        class="section-rule recording-recovery"
        aria-labelledby="recovery-title"
        data-testid="recording-recovery-panel"
      >
        <FeedbackState kind="error" title="检测到未完成的跑步记录">
          <p>{interruptedReasonLabel}</p>
          <p class="recovery-stats">
            已捕获 {pointCount} 个轨迹点 · 预览距离 {formatPreviewDistanceKm(previewDistanceM)} · 用时 {formatClockDuration(
              displayedDurationMs,
            )}
          </p>
          <div class="recording-actions mt-3">
            <button
              type="button"
              class="button-primary"
              disabled={actionBusy || !mounted}
              onclick={() => void handleStart(true)}
              data-testid="recovery-resume-btn"
            >
              继续记录
            </button>
            <button
              type="button"
              class="button-secondary"
              disabled={actionBusy || !mounted || pointCount === 0}
              onclick={() => void handleStopAndSave()}
              data-testid="recovery-save-btn"
            >
              结束并保存
            </button>
            <button
              type="button"
              class="button-secondary danger-outline"
              disabled={actionBusy || !mounted}
              onclick={() => requestDiscardConfirmation({ kind: 'session' })}
              data-testid="recovery-discard-btn"
            >
              安全丢弃
            </button>
          </div>
        </FeedbackState>
      </section>
    {/if}

    {#if sessionRecoveryState === 'failed'}
      <section
        class="section-rule recording-recovery"
        aria-labelledby="recovery-error-title"
        data-testid="recording-recovery-error-panel"
      >
        <FeedbackState kind="error" title={capabilities.native ? '无法确认原生记录状态' : '无法确认本地草稿状态'}>
          <p>{recoveryFailureMessage}</p>
          <div class="recording-actions mt-3">
            <button
              type="button"
              class="button-primary"
              disabled={actionBusy || !mounted}
              onclick={() => void retrySessionRecovery()}
              data-testid="recording-recovery-retry-btn"
            >
              重试恢复
            </button>
          </div>
        </FeedbackState>
      </section>
    {/if}

    {#if !isImmersiveRecording && !isDoneView}
      {#if permissions.location === 'denied'}
        <div data-testid="recording-permission-denied">
          <FeedbackState kind="error" title="未授予定位权限">
            <p>实时记录需要访问设备精确位置以生成跑步轨迹。你可以重新请求授权，或在系统应用设置中手动开启。</p>
            <div class="recording-actions mt-3">
              <button
                type="button"
                class="button-primary"
                disabled={actionBusy || !mounted}
                onclick={() => void handleRequestPermission()}
                data-testid="recording-request-permission-btn"
              >
                请求定位权限
              </button>
              {#if capabilities.native}
                <button
                  type="button"
                  class="button-secondary"
                  onclick={() => void openRecorderAppSettings()}
                  data-testid="recording-open-app-settings-btn"
                >
                  打开应用设置
                </button>
              {/if}
            </div>
          </FeedbackState>
        </div>
      {:else if permissions.location === 'approximate'}
        <div data-testid="recording-approximate-warning">
          <FeedbackState kind="error" title="需要精确位置权限">
            <p>
              当前仅授予了“大致位置”，误差通常超过 50
              米，无法生成可靠的跑步轨迹。请重新授权并选择“精确位置”，或在系统应用设置中开启。
            </p>
            <div class="recording-actions mt-3">
              <button
                type="button"
                class="button-primary"
                disabled={actionBusy || !mounted}
                onclick={() => void handleRequestPermission()}
                data-testid="recording-request-precise-btn"
              >
                重新请求精确位置
              </button>
              {#if capabilities.native}
                <button type="button" class="button-secondary" onclick={() => void openRecorderAppSettings()}>
                  打开应用设置
                </button>
              {/if}
            </div>
          </FeedbackState>
        </div>
      {:else if !permissions.locationServicesEnabled}
        <div data-testid="recording-location-disabled">
          <FeedbackState kind="error" title="系统定位服务已关闭">
            <p>请先在设备设置中开启定位服务，再开始或继续记录跑步轨迹。</p>
            <div class="recording-actions mt-3">
              {#if capabilities.native}
                <button
                  type="button"
                  class="button-primary"
                  onclick={() => void openRecorderLocationSettings()}
                  data-testid="recording-open-location-settings-btn"
                >
                  打开定位设置
                </button>
              {/if}
              <button type="button" class="button-secondary" onclick={() => void handleRequestPermission()}>
                重新检查
              </button>
            </div>
          </FeedbackState>
        </div>
      {/if}

      {#if capabilities.native && permissions.notification === 'denied'}
        <div data-testid="recording-notification-warning">
          <FeedbackState kind="empty" title="通知权限未开启">
            <p>后台定位服务仍会运行，但状态栏将不显示跑步进度常驻通知。建议在系统设置中允许通知以便查看运行状态。</p>
            <button type="button" class="button-secondary mt-3" onclick={() => void openRecorderAppSettings()}>
              打开通知设置
            </button>
          </FeedbackState>
        </div>
      {/if}
    {/if}

    {#if isImmersiveRecording}
      <section
        class="recording-panel rec-immersive"
        class:is-paused={status === 'paused'}
        aria-labelledby="recording-heading"
        data-testid="recording-panel"
      >
        <h2 id="recording-heading" class="sr-only">{status === 'paused' ? '已暂停' : '记录中'}</h2>

        <div class="rec-top" role="status" data-testid="recording-status-row">
          {#if status === 'paused' && isMobileViewport}
            <a class="rec-top-link" href={view.href('/activities')} data-testid="recording-paused-back">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
              >返回
            </a>
          {/if}
          <div class="rec-status-line">
            <span class="rec-st">
              <span class="rec-dot" class:is-live={status === 'recording'} aria-hidden="true"></span>
              <span data-testid="recording-status-badge">{statusBadgeText}</span>
            </span>
            <span class="rec-sep" aria-hidden="true">·</span>
            <span class="rec-st" data-testid="recording-gps-badge">
              {#if isMobileViewport}
                {#if gpsStatus === 'good' && lastAccuracyM !== null}<span class="sr-only">GPS 良好 </span>{/if}{mobileGpsText}
              {:else}
                {gpsBadgeText}
              {/if}
            </span>
            {#if offline}
              <span class="rec-sep" aria-hidden="true">·</span>
              <span class="rec-st rec-st-offline" data-testid="recording-top-offline">离线</span>
            {/if}
          </div>
          {#if !isMobileViewport}
            <span class="rec-desktop-upload" data-testid="recording-upload-badge">{uploadBadgeText}</span>
          {/if}
          {#if status === 'recording' && isMobileViewport}
            <button
              type="button"
              class="rec-lock-btn"
              class:is-locked={screenLocked}
              aria-pressed={screenLocked}
              aria-label={screenLocked ? '解锁屏幕' : '锁定屏幕，防误触'}
              onclick={() => {
                screenLocked = !screenLocked;
              }}
              data-testid="recording-lock-btn"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                {#if screenLocked}
                  <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                {:else}
                  <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.4-2" />
                {/if}
              </svg>
            </button>
          {:else if status === 'paused' && isMobileViewport}
            <button
              type="button"
              class="rec-discard-top"
              disabled={actionBusy}
              onclick={() => requestDiscardConfirmation({ kind: 'session' })}
              data-testid="recording-discard-btn"
            >
              放弃本次
            </button>
          {/if}
        </div>

        <div class="rec-main" aria-label="实时运动数据预览">
          <p class="rec-label">距离</p>
          <p class={`rec-dist ${distanceSizeClass}`} data-testid="recording-distance">
            {distanceParts.number}{#if distanceParts.unit}{' '}<small>{distanceParts.unit}</small>{/if}
          </p>

          <div class="rec-pair">
            <div class="rec-pair-cell">
              <p class="rec-label">用时</p>
              <b class:is-compact={durationCompact} data-testid="recording-duration">{durationDisplay}</b>
            </div>
            <div class="rec-pair-cell">
              <p class="rec-label">平均配速</p>
              <b class:is-compact={durationCompact} data-testid="recording-pace">
                {paceParts.number}{#if paceParts.unit}{' '}<small class="rec-pace-unit">{paceParts.unit}</small>{/if}
              </b>
            </div>
          </div>

          <p class="rec-split">
            <span data-testid="recording-live-split">
              第 {liveSplit.currentKm} 公里{#if liveSplit.lastCompletedPaceSecondsPerKm !== null}<span class="rec-split-sub">
                  · 上一公里 {formatDuration(liveSplit.lastCompletedPaceSecondsPerKm)}</span
                >{/if}
            </span>
            <span class="rec-split-sub" data-testid="recording-points-count">
              {pointCount} 点 · {segmentIndex + 1} 段
            </span>
          </p>

          {#if gpsStatus === 'lost' && status === 'recording'}
            <div class="rec-alert" data-testid="recording-gps-lost">
              <FeedbackState kind="error" title="GPS 信号暂时丢失">
                <p>请移至室外空旷处等待信号恢复；此前已记录的轨迹点已安全保存。</p>
              </FeedbackState>
            </div>
          {/if}

          {#if screenLocked && status === 'recording'}
            <p class="rec-note" role="status" data-testid="recording-lock-note">屏幕已锁定，点击右上角锁图标解锁后可暂停。</p>
          {/if}

          {#if status === 'paused'}
            <p class="rec-note" role="status" data-testid="recording-pause-note">
              已暂停采集；继续后开启新轨迹段（服务端按首尾轨迹点计算总用时，长时间暂停会影响平均配速）。
            </p>
          {/if}

          {#if offline}
            <p class="rec-note" role="status" data-testid="recording-offline-note">
              当前处于无网络/飞行模式：GPS 轨迹仍正常记录，结束后暂存本机，恢复联网后自动上传一次。
            </p>
          {/if}

          {#if errorMessage}
            <div class="rec-alert" data-testid="recording-error">
              <FeedbackState kind="error" title={errorMessage} />
            </div>
          {/if}

          {#if statusNotice}
            <p class="rec-note" role="status" data-testid="recording-status-notice">{statusNotice}</p>
          {/if}
        </div>

        <div class="rec-controls" role="group" aria-label="记录控制">
          {#if status === 'recording'}
            {#if isMobileViewport}
              <button
                type="button"
                class="btn-rec"
                disabled={actionBusy || screenLocked}
                onclick={() => void handlePause()}
                data-testid="recording-pause-btn"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.6"
                  stroke-linecap="round"
                  aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg
                >暂停
              </button>
            {:else}
              <button
                type="button"
                class="button-secondary recording-main-btn"
                disabled={actionBusy}
                onclick={() => void handlePause()}
                data-testid="recording-pause-btn"
              >
                暂停
              </button>
              <button
                type="button"
                class="button-primary recording-main-btn"
                disabled={actionBusy}
                onclick={handleStopButtonClick}
                data-testid="recording-stop-btn"
              >
                {actionBusy ? '正在保存…' : '结束并保存'}
              </button>
            {/if}
          {:else if status === 'paused'}
            {#if isMobileViewport}
              <button
                type="button"
                class="btn-rec"
                disabled={actionBusy}
                onclick={() => void handleResume()}
                data-testid="recording-resume-btn"
              >
                继续跑步
              </button>
              <button
                type="button"
                class="btn-rec-hold"
                class:is-holding={finishHoldActive}
                style:--hold-progress={finishHoldProgress}
                disabled={actionBusy}
                onpointerdown={startFinishHold}
                onpointerup={cancelFinishHold}
                onpointercancel={cancelFinishHold}
                onpointerleave={cancelFinishHold}
                onclick={handleStopButtonClick}
                data-testid="recording-stop-btn"
              >
                <span class="btn-rec-hold-fill" aria-hidden="true"></span>
                <span class="btn-rec-hold-label">
                  {actionBusy ? '正在保存…' : finishHoldActive ? '继续按住以结束并保存…' : '长按 1.5 秒结束并保存'}
                </span>
              </button>
            {:else}
              <button
                type="button"
                class="button-primary recording-main-btn"
                disabled={actionBusy}
                onclick={() => void handleResume()}
                data-testid="recording-resume-btn"
              >
                继续跑步
              </button>
              <button
                type="button"
                class="button-secondary recording-main-btn"
                disabled={actionBusy}
                onclick={handleStopButtonClick}
                data-testid="recording-stop-btn"
              >
                {actionBusy ? '正在保存…' : '结束并保存'}
              </button>
              <button
                type="button"
                class="button-secondary danger-outline"
                disabled={actionBusy}
                onclick={() => requestDiscardConfirmation({ kind: 'session' })}
                data-testid="recording-discard-btn"
              >
                放弃本次记录
              </button>
            {/if}
          {/if}
        </div>
      </section>
    {:else if isDoneView && completedReceipt}
      <section class="done-view" aria-labelledby="done-heading" data-testid="recording-panel">
        <div class="mobile-topnav done-topnav">
          <a class="topnav-back" href={view.href('/activities')}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
            >记录
          </a>
          <h1 id="done-heading">跑步完成</h1>
          <span class="topnav-status" data-testid="recording-status-badge">{statusBadgeText}</span>
        </div>

        <div class="done-grid">
          <article
            class="receipt-sheet receipt-serrated done-sheet"
            aria-label="本次跑步小票"
            data-testid="recording-done-receipt"
          >
            <div class="receipt-header">
              <span class="done-brand">
                <span class="done-mark" aria-hidden="true">{brandInitial(page.data.site?.title ?? 'RunNote')}</span>
                {receiptDateText}
              </span>
              {#if receiptTimeRangeText}<span>{receiptTimeRangeText}</span>{/if}
            </div>

            <h2 class="done-title">{completedReceipt.title}</h2>
            <p class="done-distance" data-testid="recording-done-distance">
              <span class="done-distance-num">{receiptDistanceParts.number}</span>{#if receiptDistanceParts.unit}{' '}<span
                  class="figure-unit done-distance-unit">{receiptDistanceParts.unit}</span
                >{/if}
            </p>

            <dl class="done-leaders">
              <div class="leader-row">
                <dt>用时</dt>
                <dd>
                  {receiptQueueItem?.status === 'uploaded' && receiptQueueItem.serverDurationS !== null
                    ? formatDuration(receiptQueueItem.serverDurationS)
                    : formatClockDuration(completedReceipt.activeDurationMs)}
                </dd>
              </div>
              <div class="leader-row">
                <dt>平均配速</dt>
                <dd>
                  {receiptQueueItem?.status === 'uploaded' && receiptQueueItem.serverPaceSPerKm !== null
                    ? formatPace(receiptQueueItem.serverPaceSPerKm)
                    : formatPreviewPace(completedReceipt.activeDurationMs, completedReceipt.previewDistanceM)}
                </dd>
              </div>
              {#if receiptFastestSplit && receiptFastestSplit.paceSecondsPerKm !== null}
                <div class="leader-row" data-testid="recording-done-fastest">
                  <dt>最快公里</dt>
                  <dd>{formatDuration(receiptFastestSplit.paceSecondsPerKm)} · 第 {receiptFastestSplit.label} km</dd>
                </div>
              {/if}
              <div class="leader-row">
                <dt>轨迹点</dt>
                <dd>{completedReceipt.pointCount.toLocaleString('zh-CN')} · {completedReceipt.segmentCount} 段</dd>
              </div>
            </dl>

            {#if completedReceipt.splits.length > 0}
              <div class="receipt-perforation" aria-hidden="true"></div>
              <p class="done-kicker">每公里配速（本机预览）</p>
              <ol class="done-splits" aria-label="每公里配速预览" data-testid="recording-done-splits">
                {#each completedReceipt.splits as row (row.index)}
                  <li class:fastest={row.fastest} data-full-km={row.isFullKm ? 'true' : 'false'}>
                    <span class="split-km">{row.label}</span>
                    <span class="split-pace">
                      {#if row.paceSecondsPerKm !== null}
                        <strong>{formatDuration(row.paceSecondsPerKm)}</strong>{#if row.fastest}<span class="split-best"
                            >最快</span
                          >{/if}
                      {:else}
                        <span class="muted">—<span class="sr-only">（缺失）</span></span>
                      {/if}
                    </span>
                    <span class="split-bar-track" aria-hidden="true">
                      {#if row.barRatio > 0}<i style:width={`${Math.round(row.barRatio * 100)}%`}></i>{/if}
                    </span>
                  </li>
                {/each}
              </ol>
            {/if}

            <div class="receipt-perforation" aria-hidden="true"></div>
            {#if receiptQueueItem?.status === 'uploaded'}
              <p class="status-strip" data-tone="success" role="status" data-testid="recording-done-sync-status">
                已同步至服务端，距离与配速已按服务端权威计算更新。
              </p>
            {:else if receiptQueueItem?.status === 'failed'}
              <p class="status-strip" data-tone="error" role="alert" data-testid="recording-done-sync-status">
                {receiptQueueItem.lastError || '上传暂未成功'}，轨迹已安全保留在本机，可稍后重试上传。
              </p>
            {:else}
              <p class="status-strip" role="status" data-testid="recording-done-sync-status">
                已保存在本机。联网后自动上传一次，距离与配速以上传后服务端计算为准。
              </p>
            {/if}
          </article>

          <div class="done-actions">
            {#if receiptQueueItem?.status === 'uploaded' && receiptQueueItem.uploadedActivityId}
              <a class="button-primary done-primary-btn" href={view.href(`/activities/${receiptQueueItem.uploadedActivityId}`)}>
                查看活动详情
              </a>
            {:else if !offline && pendingUploadCount > 0}
              <button
                type="button"
                class="button-primary done-primary-btn"
                disabled={uploadBusy}
                onclick={() => void runUploadFlush(true)}
              >
                {uploadBusy ? '上传中…' : '立即上传'}
              </button>
            {/if}
            <button
              type="button"
              class="button-secondary done-secondary-btn"
              onclick={dismissCompletedReceipt}
              data-testid="recording-new-run-btn"
            >
              再跑一次
            </button>
            <a class="button-secondary done-secondary-btn" href={view.href('/activities')}>返回跑步记录</a>
          </div>
        </div>

        {#if errorMessage}
          <div class="mt-4" data-testid="recording-error">
            <FeedbackState kind="error" title={errorMessage} />
          </div>
        {/if}
        {#if statusNotice}
          <p class="status-strip mt-3" role="status" data-testid="recording-status-notice">{statusNotice}</p>
        {/if}
      </section>
    {:else}
      <section class="recording-panel prerun-panel" aria-labelledby="recording-heading" data-testid="recording-panel">
        <div class="mobile-topnav">
          <a class="topnav-back" href={view.href('/activities')}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg
            >跑步记录
          </a>
          <h1 class="mobile-topnav-title">准备开跑</h1>
          <div class="topnav-right">
            {#if pendingUploadCount > 0}
              <button
                type="button"
                class="topnav-queue"
                aria-label={`待上传队列：${pendingUploadCount} 条`}
                onclick={scrollToUploadQueue}
                data-testid="prerun-queue-jump"
              >
                队列 {pendingUploadCount}
              </button>
            {/if}
          </div>
        </div>

        <div class="recording-header-row">
          <h2 id="recording-heading">当前会话</h2>
          <div class="recording-badges">
            <span class="rec-status-item" class:on={status === 'recording'} data-testid="recording-status-badge">
              {statusBadgeText}
            </span>
            <span class="rec-status-item" class:on={gpsStatus === 'good'} data-testid="recording-gps-badge">
              {gpsBadgeText}
            </span>
            <span
              class="rec-status-item"
              class:on={pendingUploadCount === 0 && uploadItems.length > 0}
              data-testid="recording-upload-badge"
            >
              {uploadBadgeText}
            </span>
            {#if status === 'interrupted'}
              <span class="rec-status-item" data-testid="recording-points-count">{pointCount} 点</span>
            {/if}
          </div>
        </div>

        <div class="prerun-gps" aria-label="定位状态">
          <p class="prerun-gps-label">定位状态</p>
          <p class="prerun-gps-figure" data-tone={preRunGpsReadout.tone} data-testid="prerun-gps-readout">
            {preRunGpsReadout.value}{#if preRunGpsReadout.unit}{' '}<span class="figure-unit prerun-gps-unit"
                >{preRunGpsReadout.unit}</span
              >{/if}
          </p>
          <p class="prerun-gps-caption" data-tone={preRunGpsReadout.tone}>{preRunGpsReadout.caption}</p>
        </div>

        <ul class="prerun-checklist" aria-label="开跑前检查">
          <li>
            <span>定位方式</span>
            <span class:check-ok={capabilities.native}>
              {capabilities.native ? '后台前台服务 · 已就绪' : '浏览器前台定位'}
            </span>
          </li>
          <li>
            <span>网络与同步</span>
            <span class:check-warn={offline || pendingUploadCount > 0} class:check-ok={!offline && pendingUploadCount === 0}>
              {offline
                ? '离线 · 结束后本机暂存'
                : pendingUploadCount > 0
                  ? `${pendingUploadCount} 条待上传`
                  : '在线 · 结束后自动上传'}
            </span>
          </li>
          {#if fullShowcaseAutoPublishes}
            <li>
              <span>可见性</span>
              <span>完整展示 · 自动公开</span>
            </li>
          {/if}
        </ul>

        {#if offline}
          <p class="status-strip mt-3" role="status" data-testid="recording-offline-note">
            当前处于无网络/飞行模式：GPS 轨迹仍正常记录，结束后将保存在本机，恢复联网后自动上传一次。
          </p>
        {/if}

        {#if fullShowcaseAutoPublishes}
          <p class="block-hint mt-3" data-testid="recording-showcase-privacy-note">
            提示：当前账号已开启完整展示模式，结束保存并上传后的运动记录与完整轨迹将按展示规则自动可见。
          </p>
        {/if}

        {#if !capabilities.native}
          <p class="block-hint mt-3" data-testid="recording-web-notice">
            当前为浏览器前台定位模式，切后台或锁屏可能暂停定位；需要后台持续记录请使用 RunNote Android 客户端。
          </p>
        {/if}

        <div class="recording-title-field mt-4">
          <label for="recording-title-input">跑步标题（可选）</label>
          <input
            id="recording-title-input"
            type="text"
            class="text-field"
            maxlength="120"
            placeholder="留空则按日期与地点自动命名"
            bind:value={runTitle}
            disabled={actionBusy}
          />
        </div>

        <div class="recording-controls mt-4" role="group" aria-label="记录控制">
          <button
            type="button"
            class="button-primary recording-main-btn prerun-start-btn"
            disabled={actionBusy ||
              handoffBusy ||
              !mounted ||
              !!pendingHandoffSession ||
              startBlockedByPermissions ||
              startBlockedByRecovery}
            onclick={() => void handleStart(false)}
            data-testid="recording-start-btn"
          >
            {actionBusy
              ? '正在启动…'
              : sessionRecoveryState === 'pending'
                ? '正在恢复会话…'
                : sessionRecoveryState === 'failed'
                  ? '会话状态未就绪'
                  : '开始跑步'}
          </button>
        </div>

        {#if errorMessage}
          <div class="mt-4" data-testid="recording-error">
            <FeedbackState kind="error" title={errorMessage} />
          </div>
        {/if}

        {#if statusNotice}
          <p class="status-strip mt-3" role="status" data-testid="recording-status-notice">{statusNotice}</p>
        {/if}
      </section>
    {/if}

    {#if !(isImmersiveRecording && isMobileViewport)}
      <section class="section-rule upload-queue-section" aria-labelledby="upload-queue-heading" data-testid="recording-upload-queue">
        <div class="block-title-row">
          <h2 id="upload-queue-heading">本地上传队列</h2>
          {#if pendingUploadCount > 0}
            <button
              type="button"
              class="button-secondary"
              disabled={uploadBusy || offline}
              onclick={() => void runUploadFlush(true)}
              data-testid="upload-queue-retry-all"
            >
              {uploadBusy ? '上传中…' : '立即上传'}
            </button>
          {/if}
        </div>

        {#if uploadItems.length === 0}
          <p class="block-hint" data-testid="upload-queue-empty">暂无待上传或近期保存的实时记录。</p>
        {:else}
          <ul class="upload-list hairline-rows" data-testid="upload-queue-list">
            {#each uploadItems as item (item.idempotencyKey)}
              <li class="upload-item" data-testid="upload-queue-item" data-status={item.status}>
                <div class="upload-item-main">
                  <div class="upload-item-head">
                    <strong class="upload-item-title">{item.title}</strong>
                    <span class="upload-status-text" class:is-synced={item.status === 'uploaded'} class:is-error={item.status === 'failed'}>
                      {formatUploadStatus(item)}
                    </span>
                  </div>
                  <p class="upload-item-meta">
                    {#if item.status === 'uploaded' && item.serverDistanceM !== null}
                      服务端权威指标：{formatDistance(item.serverDistanceM)} · {formatDuration(item.serverDurationS)} · {formatPace(
                        item.serverPaceSPerKm,
                      )}
                    {:else}
                      {item.pointCount} 个轨迹点 · {item.segmentCount} 段 · 预览 {formatPreviewDistanceKm(
                        item.previewDistanceM,
                      )} · {formatClockDuration(item.activeDurationMs)}
                    {/if}
                  </p>
                  {#if item.lastError && item.status !== 'uploaded'}
                    <p class="upload-item-error" role="alert">{item.lastError}</p>
                  {/if}
                </div>
                <div class="upload-item-actions">
                  {#if item.status === 'uploaded' && item.uploadedActivityId}
                    <a class="button-secondary" href={view.href(`/activities/${item.uploadedActivityId}`)}>
                      查看活动
                    </a>
                    <button
                      type="button"
                      class="button-secondary"
                      onclick={() =>
                        void discardUploadQueueItem(accountId, item.idempotencyKey).then(() => refreshUploadQueue())}
                    >
                      清除记录
                    </button>
                  {:else}
                    {#if !item.permanentError}
                      <button
                        type="button"
                        class="button-secondary"
                        disabled={uploadBusy || offline}
                        onclick={() => void runUploadFlush(true)}
                      >
                        重试
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="button-secondary danger-outline"
                      disabled={uploadBusy}
                      onclick={() =>
                        requestDiscardConfirmation({
                          kind: 'upload',
                          idempotencyKey: item.idempotencyKey,
                          title: item.title,
                        })}
                    >
                      丢弃
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <details class="block-details mt-3">
          <summary>后台定位、隐私与指标说明</summary>
          <p>
            实时显示的距离与运动段用时仅供跑步过程参考；上传后由服务端 PostGIS GPX
            管线权威计算里程、总用时（按首尾轨迹点间隔计算，包含暂停时长）与平均配速（里程不跨越暂停断点）。
          </p>
          <p>
            每次记录生成唯一幂等键（Idempotency-Key）并与当前账号绑定，断网或瞬时失败后按退避计时自动重试，服务端去重且校验账号一致，不会产生重复或错归活动。
          </p>
          <p>
            Android
            端仅在主动记录且授予精确位置权限时运行位置前台服务（锁屏通知隐藏具体里程/时长），不申请后台常驻定位权限；上传活动默认标记为
            private，若当前站点/账号启用了完整展示模式则会自动进入公开展示；退出登录或切换账号会自动中止在途上传并清理本机未上传轨迹。
          </p>
        </details>
      </section>
    {/if}
  </div>
</div>

<dialog
  bind:this={finishDialog}
  class="recording-dialog"
  data-glass-overlay
  aria-labelledby="finish-dialog-title"
  data-testid="recording-finish-dialog"
>
  <h3 id="finish-dialog-title">确认结束并保存这次跑步？</h3>
  <p class="dialog-copy">
    当前已记录 {formatPreviewDistanceKm(previewDistanceM)} · 用时 {formatClockDuration(displayedDurationMs)}（{pointCount}
    个轨迹点）。结束并保存后将写入本地上传队列{offline ? '，恢复网络后自动上传' : '并自动上传'}。
  </p>
  <div class="dialog-actions">
    <button type="button" class="button-secondary" onclick={cancelFinishDialog}>继续暂停</button>
    <button
      type="button"
      class="button-primary"
      onclick={confirmFinishDialog}
      data-testid="recording-finish-confirm-btn"
    >
      确认结束并保存
    </button>
  </div>
</dialog>

<dialog
  bind:this={discardDialog}
  class="recording-dialog"
  data-glass-overlay
  aria-labelledby="discard-dialog-title"
  data-testid="recording-discard-dialog"
>
  <h3 id="discard-dialog-title">确认安全丢弃</h3>
  <p class="dialog-copy">
    {#if pendingDiscardTarget?.kind === 'upload'}
      确定要从本地队列丢弃“{pendingDiscardTarget.title}”吗？丢弃后该条未上传轨迹将无法恢复。
    {:else}
      确定要放弃当前未保存的跑步记录吗？已捕获的 {pendingHandoffSession?.pointCount ?? pointCount} 个轨迹点将被永久清除。
    {/if}
  </p>
  <div class="dialog-actions">
    <button type="button" class="button-secondary" onclick={cancelDiscard}>取消</button>
    <button
      type="button"
      class="delete-confirm"
      onclick={() => void confirmDiscard()}
      data-testid="recording-discard-confirm-btn"
    >
      确认丢弃
    </button>
  </div>
</dialog>

<dialog
  bind:this={leaveDialog}
  class="recording-dialog"
  data-glass-overlay
  aria-labelledby="leave-dialog-title"
  data-testid="recording-leave-dialog"
>
  <h3 id="leave-dialog-title">当前有进行中的跑步记录</h3>
  <p class="dialog-copy">
    {#if capabilities.native}
      离开此页面后，Android 前台定位服务仍会在后台继续记录；你可随时通过状态栏通知或返回“实时记录”页查看。
    {:else}
      浏览器模式下离开当前页面将暂停实时定位采集（已捕获轨迹会保留待恢复）。确定离开吗？
    {/if}
  </p>
  <div class="dialog-actions">
    <button type="button" class="button-secondary" onclick={cancelLeavePage}>留在记录页</button>
    <button type="button" class="button-primary" onclick={confirmLeavePage} data-testid="recording-leave-confirm-btn">
      确认离开
    </button>
  </div>
</dialog>

<style>
  .recording-workspace {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .recording-body {
    display: grid;
    gap: var(--space-8);
    margin-top: var(--space-6);
    min-width: 0;
  }
  .mobile-topnav {
    display: none;
  }
  .recording-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .recording-header-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 2px solid var(--rule);
    margin-bottom: var(--space-4);
  }
  .recording-header-row h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .recording-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .rec-status-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
  }
  .rec-status-item::before {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--control-border);
    flex: none;
  }
  .rec-status-item.on {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .rec-status-item.on::before {
    background: var(--primary);
  }
  .prerun-gps {
    padding: var(--space-4) 0 var(--space-6);
  }
  .prerun-gps-label {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .prerun-gps-figure {
    margin-top: var(--space-1);
    font-size: var(--text-figure);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
  }
  .prerun-gps-figure[data-tone='err'] {
    color: var(--error);
  }
  .prerun-gps-unit {
    font-size: var(--text-section);
  }
  .prerun-gps-caption {
    margin-top: var(--space-2);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--success);
  }
  .prerun-gps-caption[data-tone='warn'] {
    color: var(--warning);
  }
  .prerun-gps-caption[data-tone='err'] {
    color: var(--error);
  }
  .prerun-gps-caption[data-tone='muted'] {
    color: var(--muted-foreground);
  }
  .prerun-checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--rule);
  }
  .prerun-checklist li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: center;
    min-height: 3.25rem;
    padding-block: var(--space-2);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-small);
  }
  .prerun-checklist li span:last-child {
    font-weight: var(--weight-semibold);
    text-align: right;
  }
  .check-ok {
    color: var(--success);
  }
  .check-warn {
    color: var(--warning);
  }
  .recording-title-field {
    display: grid;
    gap: var(--space-2);
  }
  .recording-title-field label {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .recording-controls,
  .recording-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .recording-main-btn {
    min-height: 3rem;
    min-width: 7.5rem;
    flex: 1 1 8.5rem;
  }
  .prerun-start-btn {
    min-height: 3.5rem;
    font-size: var(--text-card);
  }
  .danger-outline {
    color: var(--error);
  }
  .recovery-stats {
    margin-top: var(--space-2);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-medium);
  }

  /* Immersive outdoor recording & paused surface (brand.md §6.9) */
  .rec-immersive {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--rec-bg);
    color: var(--rec-ink);
  }
  .rec-top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 3.25rem;
    font-size: var(--text-small);
    font-weight: var(--weight-bold);
  }
  .rec-status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }
  .rec-st {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    white-space: nowrap;
  }
  .rec-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--warning);
    flex: none;
  }
  .rec-dot.is-live {
    background: var(--success);
  }
  .rec-sep {
    opacity: 0.5;
  }
  .rec-st-offline {
    color: var(--warning);
  }
  .rec-desktop-upload {
    margin-left: auto;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    opacity: 0.78;
  }
  .rec-top-link,
  .rec-discard-top {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.75rem;
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: inherit;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
  .rec-discard-top {
    margin-left: auto;
    color: var(--error);
  }
  .rec-lock-btn {
    margin-left: auto;
    flex: none;
    width: 3.25rem;
    height: 3.25rem;
    display: grid;
    place-items: center;
    border: 2px solid currentColor;
    border-radius: 0.875rem;
    background: transparent;
    color: inherit;
  }
  .rec-lock-btn.is-locked {
    background: var(--rec-ink);
    color: var(--rec-bg);
  }
  .rec-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .rec-label {
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    opacity: 0.72;
  }
  .rec-dist {
    margin-top: var(--space-1);
    font-size: var(--text-rec-hero);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-rec);
    letter-spacing: var(--tracking-rec);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .rec-dist.is-long {
    font-size: var(--text-rec-hero-long);
  }
  .rec-dist.is-xlong {
    font-size: var(--text-rec-hero-xlong);
  }
  .rec-dist small {
    font-family: var(--font-mono);
    font-size: var(--text-rec-unit);
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
  }
  .rec-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: var(--space-6);
    border-top: 2px solid currentColor;
  }
  .rec-pair-cell {
    min-width: 0;
    padding-top: var(--space-3);
  }
  .rec-pair-cell + .rec-pair-cell {
    padding-left: var(--space-4);
    border-left: 2px solid currentColor;
  }
  .rec-pair-cell b {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-rec-sub);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    letter-spacing: var(--tracking-rec-sub);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .rec-pair-cell b.is-compact {
    font-size: var(--text-rec-sub-narrow);
  }
  .rec-pace-unit {
    font-family: var(--font-mono);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
    opacity: 0.72;
  }
  .rec-split {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    margin-top: var(--space-4);
    font-size: var(--text-card);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .rec-split-sub {
    opacity: 0.72;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .rec-note {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid currentColor;
    border-radius: 0;
    background: color-mix(in srgb, var(--rec-ink) 8%, transparent);
    color: inherit;
    font-size: var(--text-caption);
    line-height: var(--line-height-heading);
  }
  .rec-alert {
    margin-top: var(--space-3);
  }
  .rec-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .btn-rec {
    width: 100%;
    min-height: 4.75rem;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: 1rem;
    background: var(--rec-ink);
    color: var(--rec-bg);
    font-size: var(--text-rec-action);
    font-weight: var(--weight-bold);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    transition: none;
  }
  .btn-rec-hold {
    position: relative;
    overflow: hidden;
    width: 100%;
    min-height: 3.75rem;
    padding: 0 var(--space-4);
    border: 2px solid currentColor;
    border-radius: 1rem;
    background: transparent;
    color: inherit;
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
    user-select: none;
    transition: none;
  }
  .btn-rec-hold-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--hold-progress, 0) * 100%);
    background: color-mix(in srgb, var(--rec-ink) 22%, transparent);
    pointer-events: none;
  }
  .btn-rec-hold-label {
    position: relative;
    z-index: 1;
  }

  /* Post-run completion receipt (brand.md §2, §6.8, prototypes/mobile.html done) */
  .done-view {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
  }
  .done-grid {
    display: grid;
    gap: var(--space-6);
    align-items: start;
  }
  .done-sheet {
    --perforation-ground: var(--desk);
  }
  .done-brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .done-mark {
    display: inline-grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.3125rem;
    background: var(--receipt-ink);
    color: var(--receipt);
    font-family: var(--font-body);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
  }
  :global(:root[data-theme='dark']) .done-mark {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .done-title {
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-title);
    overflow-wrap: anywhere;
  }
  .done-distance {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    margin: var(--space-3) 0 var(--space-4);
    font-variant-numeric: tabular-nums;
  }
  .done-distance-num {
    font-size: var(--text-figure);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    letter-spacing: var(--tracking-tight);
  }
  .done-distance-unit {
    font-size: var(--text-section);
  }
  .done-leaders {
    display: grid;
    margin: 0;
  }
  .done-leaders .leader-row {
    padding: 0.45rem 0;
  }
  .done-leaders dt {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .done-leaders dd {
    margin: 0;
    font-size: var(--text-small);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .done-kicker {
    margin-bottom: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    color: var(--primary);
  }
  .done-splits {
    list-style: none;
    margin: 0;
    padding: 0;
    font-variant-numeric: tabular-nums;
  }
  .done-splits li {
    display: grid;
    grid-template-columns: 2.5rem 5rem minmax(0, 1fr);
    gap: var(--space-2);
    align-items: center;
    padding: 0.3rem 0;
    font-size: var(--text-small);
  }
  .split-km {
    font-family: var(--font-mono);
    color: var(--muted-foreground);
  }
  .split-pace {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    white-space: nowrap;
  }
  .split-pace strong {
    font-weight: var(--weight-bold);
  }
  .split-best {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
  }
  .split-bar-track {
    display: block;
    min-width: 0;
  }
  .split-bar-track i {
    display: block;
    height: 0.625rem;
    background: var(--primary);
    opacity: 0.85;
  }
  .done-splits li.fastest .split-bar-track i {
    background: var(--receipt-mark);
    opacity: 1;
  }
  .done-actions {
    display: grid;
    gap: var(--space-3);
  }
  .done-primary-btn,
  .done-secondary-btn {
    width: 100%;
    min-height: 3rem;
  }

  /* Upload queue: flat hairline ledger, all controls ≥44px */
  .upload-queue-section {
    display: grid;
    gap: var(--space-3);
  }
  .upload-queue-section h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .upload-list {
    display: grid;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .upload-item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .upload-item-main {
    min-width: 0;
    flex: 1 1 14rem;
  }
  .upload-item-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  .upload-item-title {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .upload-status-text {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--warning);
  }
  .upload-status-text.is-synced {
    color: var(--success);
  }
  .upload-status-text.is-error {
    color: var(--error);
  }
  .upload-item-meta {
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .upload-item-error {
    margin-top: var(--space-1);
    font-size: var(--text-caption);
    color: var(--error);
  }
  .upload-item-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* Centered safe-area native modals */
  .recording-dialog {
    max-width: min(26rem, calc(100vw - 2rem - var(--safe-left) - var(--safe-right)));
    max-height: calc(100dvh - 2rem - var(--safe-top) - var(--safe-bottom));
    width: 100%;
    margin: auto;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--foreground);
    overflow-y: auto;
  }
  .recording-dialog::backdrop {
    background: var(--surface-backdrop);
  }
  .recording-dialog h3 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
  }
  .dialog-copy {
    margin-top: var(--space-2);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
  }
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .dialog-actions :is(button, a) {
    min-height: 2.75rem;
  }

  @media (min-width: 768px) {
    .recording-main-btn {
      flex: 0 1 auto;
    }
    .done-grid {
      grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
      gap: var(--space-8);
    }
  }

  @media (max-width: 799px) {
    .desktop-record-header {
      display: none;
    }
    .recording-body {
      margin-top: 0;
      gap: var(--space-6);
    }
    .recording-body.is-immersive {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .mobile-topnav {
      display: grid;
      grid-template-columns: minmax(4.5rem, auto) minmax(0, 1fr) minmax(4.5rem, auto);
      align-items: center;
      gap: var(--space-2);
      min-height: 3rem;
      margin-bottom: var(--space-2);
    }
    .mobile-topnav h1,
    .mobile-topnav-title {
      text-align: center;
      font-size: var(--text-card);
      font-weight: var(--weight-semibold);
      line-height: var(--line-height-heading);
    }
    .topnav-back {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      min-height: 2.75rem;
      font-size: var(--text-small);
      font-weight: var(--weight-medium);
      color: var(--muted-foreground);
      white-space: nowrap;
    }
    .topnav-right {
      display: flex;
      justify-content: flex-end;
    }
    .topnav-queue {
      min-height: 2.75rem;
      padding: 0 var(--space-2);
      border: 0;
      background: transparent;
      color: var(--warning);
      font-size: var(--text-small);
      font-weight: var(--weight-bold);
      white-space: nowrap;
    }
    .topnav-status {
      justify-self: end;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--muted-foreground);
    }
    .recording-header-row {
      padding-top: 0;
      border-top: 0;
      margin-bottom: var(--space-2);
    }
    .recording-header-row h2 {
      display: none;
    }
    .prerun-gps {
      padding: var(--space-3) 0 var(--space-4);
    }
    .prerun-panel .recording-controls {
      position: sticky;
      bottom: calc(var(--space-2) + var(--bottom-chrome));
      z-index: 2;
      margin-inline: calc(-1 * var(--space-2));
      padding: var(--space-2);
      background: color-mix(in srgb, var(--background) 92%, transparent);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
    .prerun-panel:has(input:focus) .recording-controls {
      position: static;
    }
    .rec-immersive {
      flex: 1;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      gap: var(--space-2);
    }
    .rec-main {
      flex: 1;
      justify-content: center;
    }
    .rec-immersive.is-paused .rec-main {
      justify-content: flex-start;
      padding-top: var(--space-2);
    }
    .rec-controls {
      display: grid;
      gap: var(--space-3);
      margin-top: auto;
      padding-top: var(--space-2);
    }
    .recording-dialog {
      padding: var(--space-4);
    }
  }

  @media (max-width: 799px) and (prefers-reduced-transparency: reduce), (max-width: 799px) and (forced-colors: active) {
    .prerun-panel .recording-controls {
      background: var(--background);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }

  /* 320x640 compact outdoor layout: keeps paused "继续跑步" + "长按 1.5 秒结束并保存" visible in first screen. */
  @media (max-width: 359px), (max-height: 680px) and (max-width: 799px) {
    .rec-top {
      min-height: 2.75rem;
      gap: var(--space-2);
      font-size: var(--text-caption);
    }
    .rec-label {
      font-size: var(--text-small);
    }
    .rec-pair {
      margin-top: var(--space-3);
    }
    .rec-pair-cell {
      padding-top: var(--space-2);
    }
    .rec-pair-cell + .rec-pair-cell {
      padding-left: var(--space-3);
    }
    .rec-pair-cell b {
      font-size: var(--text-rec-sub-narrow);
    }
    .rec-split {
      margin-top: var(--space-3);
      font-size: var(--text-small);
    }
    .rec-note {
      margin-top: var(--space-2);
      padding: var(--space-1) var(--space-2);
    }
    .rec-immersive.is-paused .btn-rec {
      min-height: 3.5rem;
      font-size: var(--text-card);
    }
    .rec-immersive.is-paused .btn-rec-hold {
      min-height: 3.25rem;
      font-size: var(--text-small);
    }
    .rec-controls {
      gap: var(--space-2);
    }
  }
</style>
