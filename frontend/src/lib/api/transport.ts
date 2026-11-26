import {
  isCapacitorNative,
  type CapacitorRunNoteTransportPlugin,
  type CapacitorWindowRuntime,
  type MobileSessionLifecycleState,
} from '#lib/capacitor-env.ts';
import { AuthError, parseUser, type User } from '#lib/api/auth.ts';

export interface ClientCapabilities {
  server_version: string;
  mobile_api_version: number;
  min_mobile_app_version: string;
  features: string[];
}

export interface MobileSessionState {
  state: MobileSessionLifecycleState;
  serverUrl: string | null;
  serverOriginHash: string | null;
  accountId: string | null;
  user: User | null;
}

export interface MobileServerConfig {
  serverUrl: string | null;
  defaultServerUrl: string | null;
  valid: boolean;
  reason: string | null;
}

export class TransportError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = 'TRANSPORT_ERROR',
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

type SessionInvalidationListener = (state: MobileSessionLifecycleState) => void;
const invalidationListeners = new Set<SessionInvalidationListener>();

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SAFE_API_PATH = /^\/api\/[^\s\u0000-\u001f\u007f]*$/;
const STRIPPED_NATIVE_HEADERS = new Set(['authorization', 'cookie', 'x-csrf-token']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function onMobileSessionInvalidated(listener: SessionInvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

function notifySessionInvalidated(state: MobileSessionLifecycleState): void {
  for (const listener of invalidationListeners) {
    try {
      listener(state);
    } catch {
      /* Keep transport resilient even if a UI subscriber throws. */
    }
  }
}

export function getNativeTransportPlugin(
  win: (Window & { Capacitor?: CapacitorWindowRuntime }) | undefined = typeof window !== 'undefined'
    ? (window as Window & { Capacitor?: CapacitorWindowRuntime })
    : undefined,
): CapacitorRunNoteTransportPlugin | null {
  if (!win || !isCapacitorNative(win)) return null;
  const plugin = win.Capacitor?.Plugins?.RunNoteTransport;
  return plugin && typeof plugin.request === 'function' ? plugin : null;
}

export function isNativeTransportAvailable(
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): boolean {
  return getNativeTransportPlugin(win) !== null;
}

export function assertSafeApiPath(path: string): string {
  if (typeof path !== 'string' || !SAFE_API_PATH.test(path) || path.includes('..') || path.startsWith('//')) {
    throw new TransportError('仅允许请求本站 /api/ 路径', 400, 'INVALID_API_PATH');
  }
  return path;
}

export function compareSemver(left: string, right: string): number {
  const a = SEMVER.exec(left);
  const b = SEMVER.exec(right);
  if (!a || !b) {
    throw new TransportError('版本号格式无效', 502, 'INVALID_RESPONSE');
  }
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(a[i]) - Number(b[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function parseClientCapabilities(value: unknown): ClientCapabilities {
  if (!isObject(value)) {
    throw new TransportError('服务端能力响应无效', 502, 'INVALID_RESPONSE');
  }
  const { server_version, mobile_api_version, min_mobile_app_version, features } = value;
  if (
    typeof server_version !== 'string' ||
    !SEMVER.test(server_version) ||
    typeof mobile_api_version !== 'number' ||
    !Number.isInteger(mobile_api_version) ||
    mobile_api_version < 1 ||
    typeof min_mobile_app_version !== 'string' ||
    !SEMVER.test(min_mobile_app_version) ||
    !Array.isArray(features) ||
    features.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new TransportError('服务端能力响应无效', 502, 'INVALID_RESPONSE');
  }
  return {
    server_version,
    mobile_api_version,
    min_mobile_app_version,
    features: [...features],
  };
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const entries =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key || STRIPPED_NATIVE_HEADERS.has(key.toLowerCase())) continue;
    result[key] = String(rawValue);
  }
  return result;
}

/**
 * Unified API fetch abstraction:
 * - Standard Web/browser uses the provided `fetch` implementation untouched.
 * - Native Capacitor routes API paths through `RunNoteTransportPlugin` so Bearer tokens
 *   stay inside Android Keystore and never enter WebView JS, cookies, or browser storage.
 */
export async function transportFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<Response> {
  const plugin = getNativeTransportPlugin(win);
  if (!plugin || typeof plugin.request !== 'function') {
    return fetcher(input, init);
  }

  const rawPath =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? `${input.pathname}${input.search}`
        : input.url;
  const path = assertSafeApiPath(rawPath);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = normalizeHeaders(init.headers ?? (input instanceof Request ? input.headers : undefined));
  let body: string | null = null;
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body !== 'string') {
      throw new TransportError('原生传输仅支持文本请求体', 400, 'UNSUPPORTED_BODY');
    }
    body = init.body;
  }

  let nativeResult;
  try {
    nativeResult = await plugin.request({
      method,
      path,
      headers,
      body,
      timeoutMs: 12000,
    });
  } catch {
    throw new TransportError('无法连接 RunNote 服务，请检查网络后重试', 503, 'NETWORK_ERROR');
  }

  if (nativeResult.sessionState === 'reauth_required' || nativeResult.status === 401) {
    notifySessionInvalidated(nativeResult.sessionState ?? 'reauth_required');
  }

  const responseHeaders = new Headers();
  if (nativeResult.headers && isObject(nativeResult.headers)) {
    for (const [k, v] of Object.entries(nativeResult.headers)) {
      if (typeof v === 'string' && k.toLowerCase() !== 'set-cookie') {
        responseHeaders.set(k, v);
      }
    }
  }
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'application/json');
  }
  const status =
    typeof nativeResult.status === 'number' && nativeResult.status >= 100 && nativeResult.status <= 599
      ? nativeResult.status
      : 502;
  const responseBody = typeof nativeResult.body === 'string' ? nativeResult.body : '';
  return new Response(status === 204 || status === 304 ? null : responseBody, {
    status,
    headers: responseHeaders,
  });
}

export async function readClientCapabilities(
  fetcher: typeof fetch = fetch,
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<ClientCapabilities> {
  let response: Response;
  try {
    response = await transportFetch(
      '/api/v1/client/capabilities',
      { method: 'GET', cache: 'no-store' },
      fetcher,
      win,
    );
  } catch (cause) {
    if (cause instanceof TransportError) throw cause;
    throw new TransportError('无法连接 RunNote 服务，请检查网络后重试', 503, 'NETWORK_ERROR');
  }
  if (response.status === 404) {
    throw new TransportError('该服务器版本过旧，请升级 RunNote 服务端后再试', 404, 'SERVER_TOO_OLD');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TransportError('服务端能力响应无效', 502, 'INVALID_RESPONSE');
  }
  if (!response.ok || !isObject(body) || body.error) {
    const err = isObject(body) && isObject(body.error) ? body.error : {};
    const message = typeof err.message === 'string' ? err.message : '无法读取服务端能力';
    const code = typeof err.code === 'string' ? err.code : 'REQUEST_FAILED';
    throw new TransportError(message, response.status, code);
  }
  return parseClientCapabilities(body.data);
}

export async function getMobileSessionState(
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<MobileSessionState> {
  const plugin = getNativeTransportPlugin(win);
  if (!plugin || typeof plugin.getSessionState !== 'function') {
    return {
      state: 'signed_out',
      serverUrl: null,
      serverOriginHash: null,
      accountId: null,
      user: null,
    };
  }
  const raw = await plugin.getSessionState();
  const state: MobileSessionLifecycleState =
    raw.state === 'active' || raw.state === 'reauth_required' || raw.state === 'signed_out'
      ? raw.state
      : 'signed_out';
  let user: User | null = null;
  if (raw.user != null) {
    try {
      user = parseUser(raw.user);
    } catch {
      user = null;
    }
  }
  return {
    state,
    serverUrl: typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : null,
    serverOriginHash:
      typeof raw.serverOriginHash === 'string' && raw.serverOriginHash ? raw.serverOriginHash : null,
    accountId: typeof raw.accountId === 'string' && raw.accountId ? raw.accountId : null,
    user,
  };
}

export async function getMobileServerConfig(
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<MobileServerConfig> {
  const plugin = getNativeTransportPlugin(win);
  if (!plugin || typeof plugin.getServerConfig !== 'function') {
    return { serverUrl: null, defaultServerUrl: null, valid: false, reason: 'native_transport_unavailable' };
  }
  const raw = await plugin.getServerConfig();
  return {
    serverUrl: typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : null,
    defaultServerUrl:
      typeof raw.defaultServerUrl === 'string' && raw.defaultServerUrl ? raw.defaultServerUrl : null,
    valid: raw.valid === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  };
}

export async function mobileLogin(
  credentials: { email: string; password: string; deviceLabel?: string; clientVersion?: string },
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<User> {
  const plugin = getNativeTransportPlugin(win);
  if (!plugin || typeof plugin.login !== 'function') {
    throw new TransportError('移动端登录需在原生 App 传输通道中执行', 503, 'NATIVE_TRANSPORT_REQUIRED');
  }
  let result;
  try {
    result = await plugin.login(credentials);
  } catch {
    throw new TransportError('无法连接 RunNote 服务，请检查网络后重试', 503, 'NETWORK_ERROR');
  }
  if (!result.ok) {
    let message = result.errorMessage || '登录失败，请检查邮箱与密码';
    if (result.status === 429 && typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0) {
      message = `${message}，请在 ${result.retryAfterSeconds} 秒后重试`;
    }
    throw new TransportError(
      message,
      result.status || 502,
      result.errorCode || 'LOGIN_FAILED',
      result.retryAfterSeconds ?? null,
    );
  }
  try {
    return parseUser(result.user);
  } catch (cause) {
    if (cause instanceof AuthError) {
      throw new TransportError(cause.message, cause.status, cause.code);
    }
    throw new TransportError('登录响应中的用户信息无效', 502, 'INVALID_RESPONSE');
  }
}

export async function mobileLogout(
  options: { revokeAllDevices?: boolean } = {},
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<void> {
  const plugin = getNativeTransportPlugin(win);
  if (!plugin || typeof plugin.logout !== 'function') return;
  await plugin.logout(options);
  notifySessionInvalidated('signed_out');
}

export async function readMobileProfile(
  fetcher: typeof fetch = fetch,
  win?: Window & { Capacitor?: CapacitorWindowRuntime },
): Promise<User> {
  const response = await transportFetch('/api/v1/me', { method: 'GET', cache: 'no-store' }, fetcher, win);
  if (response.status === 401) {
    throw new TransportError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TransportError('个人资料响应无效', 502, 'INVALID_RESPONSE');
  }
  if (!response.ok || !isObject(body) || body.error) {
    const err = isObject(body) && isObject(body.error) ? body.error : {};
    throw new TransportError(
      typeof err.message === 'string' ? err.message : '无法读取个人资料',
      response.status,
      typeof err.code === 'string' ? err.code : 'REQUEST_FAILED',
    );
  }
  try {
    return parseUser(body.data);
  } catch (cause) {
    if (cause instanceof AuthError) {
      throw new TransportError(cause.message, cause.status, cause.code);
    }
    throw new TransportError('个人资料响应无效', 502, 'INVALID_RESPONSE');
  }
}
