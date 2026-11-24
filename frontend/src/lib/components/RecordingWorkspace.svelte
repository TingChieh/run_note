<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { useViewContext } from '#lib/view-context.ts';
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
    RecordingPersistenceError,
    claimRecordingAccountAtomic,
    deleteActiveRecordingDraft,
    getActiveRecordingAccountSnapshot,
    listUploadQueueItems,
    readActiveRecordingDraftWithMeta,
    saveActiveRecordingDraft,
    type LocalRecordingDraft,
    type RecordingLifecycleStatus,
    type UploadQueueItem,
  } from '#lib/recording-store.ts';
  import {
    discardUploadQueueItem,
    enqueueFinalizedRecording,
    flushRecordingUploadQueue,
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
  let pendingHandoffSession = $state<RecorderSessionSnapshot | null>(null);

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

  let disposed = false;
  let stoppingInFlight = false;
  let failedHandoffSessionId: string | null = null;
  let webWatchId: number | null = null;
  let webLastFixMs: number | null = null;
  let sessionAccountId = '';
  let sessionClaimRevision: number | null = null;

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

  const statusBadgeText = $derived.by(() => {
    if (pendingHandoffSession) return '待入队恢复';
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
    if (interruptedReason === 'foreground_service_denied') {
      return '前台定位服务启动受限，已保留会话状态。请确认精确位置权限后继续或保存。';
    }
    return '检测到上次未完成的跑步记录（可能因进程被系统终止、设备重启或页面关闭）。';
  });

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
    try {
      const capturedPoints = await getNativeRecorderPoints(0, accountId);
      if (disposed) return;
      if (capturedPoints.length === 0) {
        if (snapshot.pointCount > 0) {
          throw new Error('未能读取到原生已保存的轨迹点，已保留原生数据，请重试保存。');
        }
        await acknowledgeNativeHandoff(snapshot.sessionId);
        if (!disposed) {
          pendingHandoffSession = null;
          failedHandoffSessionId = null;
          resetLocalSessionState();
        }
        return;
      }
      await enqueueFinalizedRecording({
        accountId,
        sessionId: snapshot.sessionId,
        idempotencyKey: snapshot.idempotencyKey,
        title: snapshot.title || runTitle.trim(),
        timezone,
        startedAtMs: snapshot.startedAtMs || capturedPoints[0].recordedAtMs,
        endedAtMs: snapshot.endedAtMs ?? Date.now(),
        activeDurationMs: snapshot.activeDurationMs,
        points: capturedPoints,
      });
      await acknowledgeNativeHandoff(snapshot.sessionId);
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

  async function captureActiveSessionClaim(
    targetAccountId: string,
    options?: { bumpGeneration?: boolean },
  ): Promise<number> {
    if (options?.bumpGeneration) {
      const claimed = await claimRecordingAccountAtomic(targetAccountId);
      if (claimed.status !== 'claimed' || typeof claimed.claimRevision !== 'number') {
        throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '当前记录会话已被其他标签页接管，请刷新后重试。');
      }
      return claimed.claimRevision;
    }
    const snap = await getActiveRecordingAccountSnapshot();
    if (snap.activeAccountId === targetAccountId && typeof snap.claimRevision === 'number') {
      return snap.claimRevision;
    }
    if (snap.activeAccountId && snap.activeAccountId !== targetAccountId) {
      throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '检测到当前登录账号已切换，请刷新页面后再开始记录。');
    }
    const claimed = await claimRecordingAccountAtomic(targetAccountId, undefined, undefined, {
      reuseExistingClaim: true,
    });
    if (claimed.status !== 'claimed' || typeof claimed.claimRevision !== 'number') {
      throw new RecordingPersistenceError('STORAGE_CLAIM_STALE', '当前记录会话已被其他标签页接管，请刷新后重试。');
    }
    return claimed.claimRevision;
  }

  function handleStaleSessionWrite(boundAccountId: string, boundClaimRev: number, message: string) {
    stopWebGeolocationWatch();
    if (!disposed && sessionAccountId === boundAccountId && sessionClaimRevision === boundClaimRev) {
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

  function startWebGeolocationWatch(boundAccountId: string, boundClaimRevision: number) {
    stopWebGeolocationWatch();
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      permissions = { ...permissions, location: 'denied', locationServicesEnabled: false, canRecord: false };
      gpsStatus = 'disabled';
      return;
    }
    gpsStatus = 'acquiring';
    webLastFixMs = null;
    webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (
          disposed ||
          status !== 'recording' ||
          sessionAccountId !== boundAccountId ||
          sessionClaimRevision !== boundClaimRevision
        ) {
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
          }).catch((cause) => {
            if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
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
            }).catch((cause) => {
              if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
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
    if (pendingHandoffSession) {
      errorMessage = '请先完成上一条已结束记录的保存入队或安全丢弃，再开始新的记录。';
      return;
    }
    actionBusy = true;
    errorMessage = '';
    statusNotice = '';
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
        await startNativeRecording({
          sessionId: sid,
          accountId,
          idempotencyKey: ikey,
          title: runTitle.trim(),
          resumeInterrupted,
        });
        const nextState = await getNativeRecorderState(accountId);
        if (!disposed && nextState) applyNativeState(nextState);
        return;
      }

      if (!capabilities.locationServicesEnabled) {
        errorMessage = '当前浏览器不支持地理定位。';
        return;
      }
      const nowMs = Date.now();
      const boundAccountId = resumeInterrupted && sessionAccountId ? sessionAccountId : accountId;
      const boundClaimRev =
        resumeInterrupted && sessionId && sessionClaimRevision !== null
          ? sessionClaimRevision
          : await captureActiveSessionClaim(boundAccountId, { bumpGeneration: !resumeInterrupted });
      if (disposed) return;
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
      try {
        await saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
          expectedClaimRevision: boundClaimRev,
        });
      } catch (saveCause) {
        if (!resumeInterrupted) resetLocalSessionState();
        else
          handleStaleSessionWrite(boundAccountId, boundClaimRev, saveCause instanceof Error ? saveCause.message : '');
        throw saveCause;
      }
      startWebGeolocationWatch(boundAccountId, boundClaimRev);
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
          });
        } catch (cause) {
          if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
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
        segmentIndex += 1;
        lastSegmentStartMs = Date.now();
        status = 'recording';
        try {
          await saveActiveRecordingDraft(buildWebDraft(boundAccountId), undefined, {
            expectedClaimRevision: boundClaimRev,
          });
        } catch (cause) {
          if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
            handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
            return;
          }
          throw cause;
        }
        startWebGeolocationWatch(boundAccountId, boundClaimRev);
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
    const boundAccountId = sessionAccountId || accountId;
    const boundClaimRev = sessionClaimRevision;
    try {
      let capturedPoints: RecordedTrackPoint[] = [];
      let finalStartedAt = startedAtMs;
      let finalEndedAt = Date.now();
      let finalActiveMs = displayedDurationMs;
      let finalSessionId = sessionId;
      let finalIdempotencyKey = idempotencyKey;
      let finalTitle = runTitle.trim();

      if (capabilities.native) {
        const stopped = await stopNativeRecording();
        if (disposed) return;
        capturedPoints = stopped?.points ?? [];
        if (stopped?.session) {
          stoppedSession = stopped.session;
          finalSessionId = stopped.session.sessionId;
          finalIdempotencyKey = stopped.session.idempotencyKey;
          finalStartedAt = stopped.session.startedAtMs;
          finalEndedAt = stopped.session.endedAtMs ?? Date.now();
          finalActiveMs = stopped.session.activeDurationMs;
          if (!finalTitle && stopped.session.title) finalTitle = stopped.session.title;
        }
      } else {
        stopWebGeolocationWatch();
        capturedPoints = [...webPoints];
      }

      if (capturedPoints.length === 0) {
        errorMessage = '本次记录未捕获到有效 GPS 轨迹点，无法生成轨迹文件。请移至空旷处或直接安全丢弃本次会话。';
        if (capabilities.native) {
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
              });
            } catch (cause) {
              if (cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE') {
                handleStaleSessionWrite(boundAccountId, boundClaimRev, cause.message);
                return;
              }
              throw cause;
            }
          }
        }
        return;
      }

      // Persist to IndexedDB upload queue FIRST (waits for transaction complete + read-back verification);
      // only acknowledge/delete native session AFTER durable commit succeeds.
      await enqueueFinalizedRecording({
        accountId: boundAccountId,
        sessionId: finalSessionId || generateUuidV4(),
        idempotencyKey: finalIdempotencyKey || generateUuidV4(),
        title: finalTitle,
        timezone,
        startedAtMs: finalStartedAt || capturedPoints[0].recordedAtMs,
        endedAtMs: finalEndedAt,
        activeDurationMs: finalActiveMs,
        points: capturedPoints,
      });

      if (capabilities.native) {
        await acknowledgeNativeHandoff(finalSessionId);
      } else if (boundClaimRev !== null) {
        try {
          await deleteActiveRecordingDraft(boundAccountId, undefined, {
            expectedClaimRevision: boundClaimRev,
            expectedSessionId: finalSessionId || undefined,
          });
        } catch (cause) {
          if (!(cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE')) {
            throw cause;
          }
        }
      }

      pendingHandoffSession = null;
      failedHandoffSessionId = null;
      resetLocalSessionState();
      runTitle = '';
      await refreshUploadQueue();
      if (offline) {
        statusNotice = '轨迹已安全保存到本地上传队列，恢复网络后将自动上传一次。';
      } else {
        await runUploadFlush(true);
      }
    } catch (cause) {
      if (!disposed) {
        if (capabilities.native && stoppedSession) {
          pendingHandoffSession = stoppedSession;
          failedHandoffSessionId = stoppedSession.sessionId;
          status = 'stopped';
          lastSegmentStartMs = null;
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

    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    window.addEventListener('runnote-recording-queue-updated', onQueueUpdated);

    let unsubscribeNative: (() => void) | null = null;

    void (async () => {
      const caps = await getRecorderCapabilities();
      if (disposed) return;
      capabilities = caps;

      const perms = await checkRecorderPermissions();
      if (disposed) return;
      permissions = perms;

      if (caps.native && isNativeLocationRecorderAvailable()) {
        const nativeState = await getNativeRecorderState(accountId);
        if (!disposed && nativeState) applyNativeState(nativeState);
        unsubscribeNative = subscribeNativeRecorderUpdates((event) => {
          if (!disposed) applyNativeState(event);
        });
      } else if (accountId) {
        try {
          const draftMeta = await readActiveRecordingDraftWithMeta(accountId);
          if (!disposed && draftMeta) {
            const draft = draftMeta.draft;
            const claimedRev = await captureActiveSessionClaim(accountId);
            if (disposed) return;
            if (typeof draftMeta.claimRevision === 'number' && draftMeta.claimRevision > claimedRev) {
              // Newer generation already owns the draft; never overwrite or adopt it as stale.
            } else if (draft.status === 'stopped' && draft.points.length > 0) {
              await enqueueFinalizedRecording({
                accountId,
                sessionId: draft.sessionId,
                idempotencyKey: draft.idempotencyKey,
                title: draft.title,
                timezone,
                startedAtMs: draft.startedAtMs || draft.points[0].recordedAtMs,
                endedAtMs: draft.endedAtMs ?? Date.now(),
                activeDurationMs: draft.activeDurationMs,
                points: draft.points,
              });
              try {
                await deleteActiveRecordingDraft(accountId, undefined, {
                  expectedClaimRevision: claimedRev,
                  expectedSessionId: draft.sessionId,
                });
              } catch (cause) {
                if (!(cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE')) {
                  throw cause;
                }
              }
            } else if (draft.status === 'recording' || draft.status === 'paused' || draft.status === 'interrupted') {
              sessionAccountId = accountId;
              sessionClaimRevision = claimedRev;
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
            }
          }
        } catch (cause) {
          if (!disposed && !(cause instanceof RecordingPersistenceError && cause.code === 'STORAGE_CLAIM_STALE')) {
            errorMessage =
              cause instanceof Error
                ? `读取或提交本地记录失败：${cause.message}`
                : '本地持久化存储不可用，无法恢复或入队本地记录。';
          }
        }
      }

      await refreshUploadQueue();
      if (!disposed && !offline) {
        void runUploadFlush(false);
      }
    })();

    const tickTimer = window.setInterval(() => {
      clockNowMs = Date.now();
      if (!capabilities.native && status === 'recording' && webLastFixMs !== null) {
        if (clockNowMs - webLastFixMs > 15000 && gpsStatus !== 'lost') {
          gpsStatus = 'lost';
        }
      }
    }, 1000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && capabilities.native) {
        void getNativeRecorderState(accountId).then((next) => {
          if (!disposed && next) applyNativeState(next);
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(tickTimer);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
      window.removeEventListener('runnote-recording-queue-updated', onQueueUpdated);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribeNative?.();
      stopWebGeolocationWatch();
    };
  });
</script>

<PageHeader title="实时记录">
  {#snippet actions()}
    <a class="button-secondary" href={view.href('/activities')}>跑步记录</a>
  {/snippet}
</PageHeader>

<div class="aux-stack">
  {#if pendingHandoffSession}
    <section
      class="aux-panel recording-recovery"
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
      class="aux-panel recording-recovery"
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

  <section class="aux-panel recording-panel" aria-labelledby="recording-heading" data-testid="recording-panel">
    <div class="recording-header-row">
      <h2 id="recording-heading">当前会话</h2>
      <div class="recording-badges">
        <span class="status-badge" class:on={status === 'recording'} data-testid="recording-status-badge">
          {statusBadgeText}
        </span>
        <span class="status-badge" class:on={gpsStatus === 'good'} data-testid="recording-gps-badge">
          {gpsBadgeText}
        </span>
        <span
          class="status-badge"
          class:on={pendingUploadCount === 0 && uploadItems.length > 0}
          data-testid="recording-upload-badge"
        >
          {uploadBadgeText}
        </span>
      </div>
    </div>

    <dl class="recording-metrics-grid" aria-label="实时运动数据预览">
      <div class="metric-cell">
        <dt>距离（预览）</dt>
        <dd class="metric-primary" data-testid="recording-distance">{formatPreviewDistanceKm(previewDistanceM)}</dd>
      </div>
      <div class="metric-cell">
        <dt>用时（运动段）</dt>
        <dd class="metric-primary" data-testid="recording-duration">{formatClockDuration(displayedDurationMs)}</dd>
      </div>
      <div class="metric-cell">
        <dt>配速（预览）</dt>
        <dd data-testid="recording-pace">{formatPreviewPace(displayedDurationMs, previewDistanceM)}</dd>
      </div>
      <div class="metric-cell">
        <dt>已记录轨迹</dt>
        <dd data-testid="recording-points-count">{pointCount} 点 · {segmentIndex + 1} 段</dd>
      </div>
    </dl>

    {#if gpsStatus === 'lost' && status === 'recording'}
      <div class="mt-3" data-testid="recording-gps-lost">
        <FeedbackState kind="error" title="GPS 信号暂时丢失">
          <p>请移至室外空旷处等待信号恢复；此前已记录的轨迹点已安全保存。</p>
        </FeedbackState>
      </div>
    {/if}

    {#if status === 'paused'}
      <p class="block-hint mt-3" role="status" data-testid="recording-pause-note">
        已暂停采集；继续后将开启新轨迹段（PostGIS 里程不连接暂停间隔，但服务端 GPX
        总用时按首尾轨迹点计算，长时间暂停会影响服务端平均配速）。
      </p>
    {/if}

    {#if offline}
      <p class="block-hint mt-3" role="status" data-testid="recording-offline-note">
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
      {#if status === 'idle' || status === 'stopped'}
        <button
          type="button"
          class="button-primary recording-main-btn"
          disabled={actionBusy || handoffBusy || !mounted || !!pendingHandoffSession || startBlockedByPermissions}
          onclick={() => void handleStart(false)}
          data-testid="recording-start-btn"
        >
          {actionBusy ? '正在启动…' : '开始跑步'}
        </button>
      {:else if status === 'recording'}
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
          onclick={() => void handleStopAndSave()}
          data-testid="recording-stop-btn"
        >
          {actionBusy ? '正在保存…' : '结束并保存'}
        </button>
      {:else if status === 'paused'}
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
          onclick={() => void handleStopAndSave()}
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
    </div>

    {#if errorMessage}
      <div class="mt-4" data-testid="recording-error">
        <FeedbackState kind="error" title={errorMessage} />
      </div>
    {/if}

    {#if statusNotice}
      <p class="block-hint mt-3" role="status" data-testid="recording-status-notice">{statusNotice}</p>
    {/if}
  </section>

  <section class="aux-panel settings-block" aria-labelledby="upload-queue-heading" data-testid="recording-upload-queue">
    <div class="block-title-row">
      <h2 id="upload-queue-heading">本地上传队列</h2>
      {#if pendingUploadCount > 0}
        <button
          type="button"
          class="button-secondary button-compact"
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
      <ul class="upload-list" data-testid="upload-queue-list">
        {#each uploadItems as item (item.idempotencyKey)}
          <li class="upload-item" data-testid="upload-queue-item" data-status={item.status}>
            <div class="upload-item-main">
              <div class="upload-item-head">
                <strong class="upload-item-title">{item.title}</strong>
                <span class="status-badge" class:on={item.status === 'uploaded'}>
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
                <a class="button-secondary button-compact" href={view.href(`/activities/${item.uploadedActivityId}`)}>
                  查看活动
                </a>
                <button
                  type="button"
                  class="button-secondary button-compact"
                  onclick={() =>
                    void discardUploadQueueItem(accountId, item.idempotencyKey).then(() => refreshUploadQueue())}
                >
                  清除记录
                </button>
              {:else}
                {#if !item.permanentError}
                  <button
                    type="button"
                    class="button-secondary button-compact"
                    disabled={uploadBusy || offline}
                    onclick={() => void runUploadFlush(true)}
                  >
                    重试
                  </button>
                {/if}
                <button
                  type="button"
                  class="button-secondary button-compact danger-outline"
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
</div>

<dialog
  bind:this={discardDialog}
  class="recording-dialog"
  aria-labelledby="discard-dialog-title"
  data-testid="recording-discard-dialog"
>
  <h3 id="discard-dialog-title">确认安全丢弃</h3>
  <p class="mt-2 text-sm text-muted-foreground">
    {#if pendingDiscardTarget?.kind === 'upload'}
      确定要从本地队列丢弃“{pendingDiscardTarget.title}”吗？丢弃后该条未上传轨迹将无法恢复。
    {:else}
      确定要放弃当前未保存的跑步记录吗？已捕获的 {pendingHandoffSession?.pointCount ?? pointCount} 个轨迹点将被永久清除。
    {/if}
  </p>
  <div class="dialog-actions mt-4">
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
  aria-labelledby="leave-dialog-title"
  data-testid="recording-leave-dialog"
>
  <h3 id="leave-dialog-title">当前有进行中的跑步记录</h3>
  <p class="mt-2 text-sm text-muted-foreground">
    {#if capabilities.native}
      离开此页面后，Android 前台定位服务仍会在后台继续记录；你可随时通过状态栏通知或返回“实时记录”页查看。
    {:else}
      浏览器模式下离开当前页面将暂停实时定位采集（已捕获轨迹会保留待恢复）。确定离开吗？
    {/if}
  </p>
  <div class="dialog-actions mt-4">
    <button type="button" class="button-secondary" onclick={cancelLeavePage}>留在记录页</button>
    <button type="button" class="button-primary" onclick={confirmLeavePage} data-testid="recording-leave-confirm-btn">
      确认离开
    </button>
  </div>
</dialog>

<style>
  .recording-panel {
    display: flex;
    flex-direction: column;
  }
  .recording-header-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .recording-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .recording-metrics-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    padding: var(--space-4) 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .metric-cell {
    min-width: 0;
  }
  .metric-cell dt {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .metric-cell dd {
    margin-top: var(--space-1);
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
    line-height: var(--line-height-tight);
    white-space: nowrap;
    color: var(--foreground);
  }
  .metric-cell dd.metric-primary {
    font-size: var(--text-stat);
    color: var(--primary);
  }
  .recording-title-field {
    display: grid;
    gap: var(--space-2);
  }
  .recording-title-field label {
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    color: var(--foreground);
  }
  .recording-controls,
  .recording-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .recording-main-btn {
    min-height: 2.75rem;
    min-width: 7.5rem;
    flex: 1 1 8.5rem;
  }
  .danger-outline {
    color: var(--error);
  }
  .recovery-stats {
    margin-top: var(--space-2);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-medium);
  }
  .upload-list {
    display: grid;
    gap: var(--space-3);
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
  }
  .upload-item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--background);
  }
  .upload-item-main {
    min-width: 0;
    flex: 1 1 14rem;
  }
  .upload-item-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .upload-item-title {
    font-size: var(--text-small);
    color: var(--foreground);
  }
  .upload-item-meta {
    margin-top: var(--space-1);
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
  .recording-dialog {
    max-width: min(26rem, calc(100vw - 2rem));
    width: 100%;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    color: var(--foreground);
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
  @media (min-width: 768px) {
    .recording-metrics-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .recording-main-btn {
      flex: 0 1 auto;
    }
  }
  @media (max-width: 479px) {
    .metric-cell dd.metric-primary {
      font-size: var(--text-section);
    }
    .metric-cell dd {
      font-size: var(--text-body);
    }
  }
</style>
