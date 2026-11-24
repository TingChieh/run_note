import {
  isCapacitorNative,
  type CapacitorLocationRecorderPlugin,
  type CapacitorWindowRuntime,
} from '#lib/capacitor-env.ts';
import type { RecordedTrackPoint } from '#lib/gpx-serializer.ts';
import type { RecordingLifecycleStatus } from '#lib/recording-store.ts';

/**
 * Platform-neutral bridge for active GPS run recording.
 *
 * - Inside native Capacitor (Android now, iOS Core Location in future): delegates directly to
 *   `window.Capacitor.Plugins.LocationRecorder`, keeping background GPS alive via Foreground Service.
 * - Inside standard web browsers: cleanly exposes capability flags (`native: false`,
 *   `backgroundSupported: false`) and provides a foreground `navigator.geolocation` watch adapter.
 * - During SSR: strictly no-op, never touches `window` or `navigator` at module load time.
 * - Never logs GPS coordinates, tokens, cookies, or health data.
 */

export type LocationPermissionStatus = 'granted' | 'approximate' | 'denied' | 'prompt';
export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'not_required';
export type GpsSignalStatus = 'inactive' | 'acquiring' | 'good' | 'weak' | 'lost' | 'disabled' | 'permission_denied';

export interface RecorderCapabilities {
  platform: 'android' | 'ios' | 'web';
  native: boolean;
  backgroundSupported: boolean;
  requiresNotificationPermission: boolean;
  locationServicesEnabled: boolean;
}

export interface RecorderPermissions {
  location: LocationPermissionStatus;
  notification: NotificationPermissionStatus;
  locationServicesEnabled: boolean;
  preciseLocation: boolean;
  canRecord: boolean;
}

export interface RecorderSessionSnapshot {
  sessionId: string;
  accountId: string;
  idempotencyKey: string;
  title: string;
  status: RecordingLifecycleStatus;
  startedAtMs: number;
  endedAtMs: number | null;
  activeDurationMs: number;
  segmentIndex: number;
  pointCount: number;
  previewDistanceM: number;
  lastPointTimeMs: number | null;
  lastAccuracyM: number | null;
  interruptedReason: string | null;
}

export interface RecorderStateEvent {
  serviceRunning: boolean;
  status: RecordingLifecycleStatus;
  gpsStatus: GpsSignalStatus;
  permissions: RecorderPermissions;
  session: RecorderSessionSnapshot | null;
}

export interface RecorderStopResult extends RecorderStateEvent {
  points: RecordedTrackPoint[];
}

type WinWithCap = Window & { Capacitor?: CapacitorWindowRuntime };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function getNativePlugin(win?: WinWithCap): CapacitorLocationRecorderPlugin | null {
  const target = win ?? (typeof window !== 'undefined' ? (window as WinWithCap) : undefined);
  if (!isCapacitorNative(target)) return null;
  const plugin = target?.Capacitor?.Plugins?.LocationRecorder;
  return plugin && typeof plugin === 'object' ? plugin : null;
}

export function isNativeLocationRecorderAvailable(win?: WinWithCap): boolean {
  return getNativePlugin(win) !== null;
}

function parsePermissionStatus(raw: unknown): LocationPermissionStatus {
  if (raw === 'granted' || raw === 'approximate' || raw === 'denied' || raw === 'prompt') return raw;
  return 'denied';
}

function parseNotificationStatus(raw: unknown): NotificationPermissionStatus {
  if (raw === 'granted' || raw === 'denied' || raw === 'prompt' || raw === 'not_required') return raw;
  return 'not_required';
}

function parseGpsStatus(raw: unknown): GpsSignalStatus {
  if (
    raw === 'inactive' ||
    raw === 'acquiring' ||
    raw === 'good' ||
    raw === 'weak' ||
    raw === 'lost' ||
    raw === 'disabled' ||
    raw === 'permission_denied'
  ) {
    return raw;
  }
  return 'inactive';
}

function parseLifecycleStatus(raw: unknown): RecordingLifecycleStatus {
  if (raw === 'idle' || raw === 'recording' || raw === 'paused' || raw === 'interrupted' || raw === 'stopped') {
    return raw;
  }
  return 'idle';
}

export function parsePermissionsPayload(raw: unknown): RecorderPermissions {
  if (!isRecord(raw)) {
    return {
      location: 'denied',
      notification: 'not_required',
      locationServicesEnabled: false,
      preciseLocation: false,
      canRecord: false,
    };
  }
  const location = parsePermissionStatus(raw.location);
  const notification = parseNotificationStatus(raw.notification);
  const locationServicesEnabled = raw.locationServicesEnabled === true;
  const preciseLocation = raw.preciseLocation === true && location === 'granted';
  const canRecord = raw.canRecord === true && location === 'granted' && locationServicesEnabled;
  return { location, notification, locationServicesEnabled, preciseLocation, canRecord };
}

export function parsePointsPayload(raw: unknown): RecordedTrackPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: RecordedTrackPoint[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const recordedAtMs = Number(item.recordedAtMs);
    const segmentIndex = Number.isInteger(item.segmentIndex) ? Number(item.segmentIndex) : 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (!Number.isFinite(recordedAtMs) || recordedAtMs <= 0) continue;
    const elevationM =
      item.elevationM !== undefined && item.elevationM !== null && Number.isFinite(Number(item.elevationM))
        ? Number(item.elevationM)
        : null;
    const accuracyM =
      item.accuracyM !== undefined && item.accuracyM !== null && Number.isFinite(Number(item.accuracyM))
        ? Number(item.accuracyM)
        : null;
    out.push({ lat, lon, elevationM, accuracyM, recordedAtMs, segmentIndex });
  }
  return out;
}

export function parseSessionPayload(raw: unknown): RecorderSessionSnapshot | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.sessionId !== 'string' ||
    typeof raw.accountId !== 'string' ||
    typeof raw.idempotencyKey !== 'string'
  ) {
    return null;
  }
  return {
    sessionId: raw.sessionId,
    accountId: raw.accountId,
    idempotencyKey: raw.idempotencyKey,
    title: typeof raw.title === 'string' ? raw.title : '',
    status: parseLifecycleStatus(raw.status),
    startedAtMs: Number.isFinite(Number(raw.startedAtMs)) ? Number(raw.startedAtMs) : 0,
    endedAtMs:
      raw.endedAtMs !== undefined && raw.endedAtMs !== null && Number.isFinite(Number(raw.endedAtMs))
        ? Number(raw.endedAtMs)
        : null,
    activeDurationMs: Number.isFinite(Number(raw.activeDurationMs)) ? Math.max(0, Number(raw.activeDurationMs)) : 0,
    segmentIndex: Number.isInteger(raw.segmentIndex) ? Math.max(0, Number(raw.segmentIndex)) : 0,
    pointCount: Number.isInteger(raw.pointCount) ? Math.max(0, Number(raw.pointCount)) : 0,
    previewDistanceM: Number.isFinite(Number(raw.previewDistanceM)) ? Math.max(0, Number(raw.previewDistanceM)) : 0,
    lastPointTimeMs:
      raw.lastPointTimeMs !== undefined && raw.lastPointTimeMs !== null && Number.isFinite(Number(raw.lastPointTimeMs))
        ? Number(raw.lastPointTimeMs)
        : null,
    lastAccuracyM:
      raw.lastAccuracyM !== undefined && raw.lastAccuracyM !== null && Number.isFinite(Number(raw.lastAccuracyM))
        ? Number(raw.lastAccuracyM)
        : null,
    interruptedReason:
      typeof raw.interruptedReason === 'string' && raw.interruptedReason ? raw.interruptedReason : null,
  };
}

export function parseStateEventPayload(raw: unknown): RecorderStateEvent {
  if (!isRecord(raw)) {
    return {
      serviceRunning: false,
      status: 'idle',
      gpsStatus: 'inactive',
      permissions: parsePermissionsPayload(null),
      session: null,
    };
  }
  return {
    serviceRunning: raw.serviceRunning === true,
    status: parseLifecycleStatus(raw.status),
    gpsStatus: parseGpsStatus(raw.gpsStatus),
    permissions: parsePermissionsPayload(raw.permissions),
    session: parseSessionPayload(raw.session),
  };
}

export async function getRecorderCapabilities(win?: WinWithCap): Promise<RecorderCapabilities> {
  const plugin = getNativePlugin(win);
  if (plugin?.getCapabilities) {
    try {
      const raw = await plugin.getCapabilities();
      if (isRecord(raw)) {
        const platform = raw.platform === 'ios' ? 'ios' : 'android';
        return {
          platform,
          native: true,
          backgroundSupported: raw.backgroundSupported !== false,
          requiresNotificationPermission: raw.requiresNotificationPermission === true,
          locationServicesEnabled: raw.locationServicesEnabled !== false,
        };
      }
    } catch {
      // Fall through to safe native default
    }
    return {
      platform: 'android',
      native: true,
      backgroundSupported: true,
      requiresNotificationPermission: false,
      locationServicesEnabled: true,
    };
  }
  const hasGeo = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  return {
    platform: 'web',
    native: false,
    backgroundSupported: false,
    requiresNotificationPermission: false,
    locationServicesEnabled: hasGeo,
  };
}

export async function checkRecorderPermissions(win?: WinWithCap): Promise<RecorderPermissions> {
  const plugin = getNativePlugin(win);
  if (plugin?.checkPermissions) {
    const raw = await plugin.checkPermissions();
    return parsePermissionsPayload(raw);
  }
  const hasGeo = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  if (!hasGeo) {
    return {
      location: 'denied',
      notification: 'not_required',
      locationServicesEnabled: false,
      preciseLocation: false,
      canRecord: false,
    };
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (status.state === 'granted') {
        return {
          location: 'granted',
          notification: 'not_required',
          locationServicesEnabled: true,
          preciseLocation: true,
          canRecord: true,
        };
      }
      if (status.state === 'denied') {
        return {
          location: 'denied',
          notification: 'not_required',
          locationServicesEnabled: true,
          preciseLocation: false,
          canRecord: false,
        };
      }
    }
  } catch {
    // Permissions API not supported for geolocation in some browsers; default to prompt.
  }
  return {
    location: 'prompt',
    notification: 'not_required',
    locationServicesEnabled: true,
    preciseLocation: true,
    canRecord: true,
  };
}

export async function requestRecorderPermissions(win?: WinWithCap): Promise<RecorderPermissions> {
  const plugin = getNativePlugin(win);
  if (plugin?.requestPermissions) {
    const raw = await plugin.requestPermissions();
    return parsePermissionsPayload(raw);
  }
  return checkRecorderPermissions(win);
}

export async function openRecorderAppSettings(win?: WinWithCap): Promise<boolean> {
  const plugin = getNativePlugin(win);
  if (!plugin?.openAppSettings) return false;
  try {
    const raw = await plugin.openAppSettings();
    return isRecord(raw) && raw.opened === true;
  } catch {
    return false;
  }
}

export async function openRecorderLocationSettings(win?: WinWithCap): Promise<boolean> {
  const plugin = getNativePlugin(win);
  if (!plugin?.openLocationSettings) return false;
  try {
    const raw = await plugin.openLocationSettings();
    return isRecord(raw) && raw.opened === true;
  } catch {
    return false;
  }
}

export async function getNativeRecorderState(accountId?: string, win?: WinWithCap): Promise<RecorderStateEvent | null> {
  const plugin = getNativePlugin(win);
  if (!plugin?.getSessionState) return null;
  const raw = await plugin.getSessionState(accountId ? { accountId } : undefined);
  if (!isRecord(raw)) return null;
  return parseStateEventPayload(raw);
}

export async function getNativeRecorderPoints(
  afterIndex = 0,
  accountId?: string,
  win?: WinWithCap,
): Promise<RecordedTrackPoint[]> {
  const plugin = getNativePlugin(win);
  if (!plugin?.getSessionPoints) return [];
  const raw = await plugin.getSessionPoints({ afterIndex, ...(accountId ? { accountId } : {}) });
  return isRecord(raw) ? parsePointsPayload(raw.points) : [];
}

export async function acknowledgeNativeHandoff(sessionId: string, win?: WinWithCap): Promise<boolean> {
  const plugin = getNativePlugin(win);
  if (plugin?.acknowledgeHandoff) {
    const raw = await plugin.acknowledgeHandoff({ sessionId });
    return isRecord(raw) && raw.acknowledged === true;
  }
  if (plugin?.discardSession) {
    await plugin.discardSession();
    return true;
  }
  return false;
}

export async function startNativeRecording(
  options: {
    sessionId: string;
    accountId: string;
    idempotencyKey: string;
    title?: string;
    resumeInterrupted?: boolean;
  },
  win?: WinWithCap,
): Promise<void> {
  const plugin = getNativePlugin(win);
  if (!plugin?.startSession) throw new Error('原生定位服务不可用');
  await plugin.startSession(options);
}

export async function pauseNativeRecording(win?: WinWithCap): Promise<void> {
  const plugin = getNativePlugin(win);
  if (plugin?.pauseSession) await plugin.pauseSession();
}

export async function resumeNativeRecording(win?: WinWithCap): Promise<void> {
  const plugin = getNativePlugin(win);
  if (plugin?.resumeSession) await plugin.resumeSession();
}

export async function stopNativeRecording(win?: WinWithCap): Promise<RecorderStopResult | null> {
  const plugin = getNativePlugin(win);
  if (!plugin?.stopSession) return null;
  const raw = await plugin.stopSession();
  const base = parseStateEventPayload(raw);
  const points = isRecord(raw) ? parsePointsPayload(raw.points) : [];
  return { ...base, points };
}

export async function discardNativeRecording(win?: WinWithCap): Promise<void> {
  const plugin = getNativePlugin(win);
  if (plugin?.discardSession) await plugin.discardSession();
}

export async function clearNativeAccountSessions(keepAccountId: string | null, win?: WinWithCap): Promise<void> {
  const plugin = getNativePlugin(win);
  if (!plugin?.clearAccountSessions) return;
  try {
    await plugin.clearAccountSessions({ keepAccountId });
  } catch {
    // Non-fatal cleanup when native bridge is unavailable.
  }
}

export function subscribeNativeRecorderUpdates(
  listener: (event: RecorderStateEvent) => void,
  win?: WinWithCap,
): () => void {
  const plugin = getNativePlugin(win);
  if (!plugin?.addListener) return () => {};
  let disposed = false;
  let handle: { remove: () => Promise<void> | void } | undefined;
  void Promise.resolve(
    plugin.addListener('sessionUpdate', (raw) => {
      if (!disposed) listener(parseStateEventPayload(raw));
    }),
  )
    .then((registered) => {
      if (disposed) void registered?.remove?.();
      else handle = registered;
    })
    .catch(() => {
      /* Ignore listener registration failure on unsupported bridge versions. */
    });
  return () => {
    disposed = true;
    void handle?.remove?.();
  };
}
