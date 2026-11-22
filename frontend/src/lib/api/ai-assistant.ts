import { ActivityError } from './activities.ts';

export type UIBlockType =
  | 'metrics_card'
  | 'trend_chart'
  | 'period_card'
  | 'comparison_card'
  | 'records_summary'
  | 'records_chart'
  | 'goals_streaks_card'
  | 'activity_list'
  | 'activity_detail_card'
  | 'footprint_summary_card'
  | 'route_group_list';

export const UI_BLOCK_TYPES: ReadonlySet<string> = new Set<UIBlockType>([
  'metrics_card',
  'trend_chart',
  'period_card',
  'comparison_card',
  'records_summary',
  'records_chart',
  'goals_streaks_card',
  'activity_list',
  'activity_detail_card',
  'footprint_summary_card',
  'route_group_list',
]);

export interface UIBlock {
  type: UIBlockType;
  data: Record<string, unknown>;
}

export interface ConsentView {
  consented: boolean;
  consent_version: string | null;
  required_version: string;
  consented_at: string | null;
  revoked_at: string | null;
}

export interface QuotaStatusView {
  daily_message_limit: number;
  messages_today: number;
  remaining_messages_today: number;
  daily_token_budget: number;
  tokens_today: number;
  remaining_tokens_today: number;
  site_daily_token_budget: number;
  site_tokens_today: number;
  site_budget_exhausted: boolean;
}

export interface AssistantContext {
  configured: boolean;
  enabled: boolean;
  model: string | null;
  consent: ConsentView;
  quota: QuotaStatusView;
}

export interface ConversationView {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface ConversationList {
  items: ConversationView[];
  total: number;
  limit: number;
  offset: number;
}

export type MessageStatus = 'pending' | 'streaming' | 'succeeded' | 'failed' | 'cancelled';

export interface ToolCallSummary {
  tool: string;
  duration_ms?: number;
  degraded?: boolean;
  truncated?: boolean;
  error_code?: string;
}

export interface MessageView {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  status: MessageStatus;
  content: string | null;
  tool_calls_summary: Record<string, unknown>[];
  ui_blocks: UIBlock[];
  model: string | null;
  prompt_version: string | null;
  error_code: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  created_at: string;
  finished_at: string | null;
  is_stale: boolean;
}

export interface ConversationDetail {
  conversation: ConversationView;
  messages: MessageView[];
  total_messages: number;
  limit: number;
  offset: number;
}

export interface MessageCancelled {
  cancelled: boolean;
  status: MessageStatus;
}

export interface ConsentUpdate {
  consented: boolean;
}

export interface ConversationCreate {
  title?: string;
}

export interface ConversationUpdate {
  title?: string | null;
}

export interface MessageCreate {
  content: string;
}

export interface UsageSummary {
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
}

export type StreamEvent =
  | {
      event: 'meta';
      data: {
        conversation_id: string;
        user_message_id: string;
        assistant_message_id: string;
        remaining_messages_today: number;
        remaining_tokens_today: number;
        replayed: boolean;
      };
    }
  | { event: 'status'; data: { stage: string; message: string } }
  | { event: 'tool_start'; data: { tool: string; label: string } }
  | {
      event: 'tool_end';
      data: {
        tool: string;
        label: string;
        duration_ms: number;
        degraded: boolean;
        truncated: boolean;
        ok: boolean;
      };
    }
  | { event: 'block'; data: UIBlock }
  | { event: 'delta'; data: { text: string } }
  | { event: 'ping'; data: { ts: number } }
  | { event: 'error'; data: { code: string; message: string; retryable: boolean; message_id?: string } }
  | {
      event: 'done';
      data: {
        message_id: string;
        status: MessageStatus;
        error_code?: string;
        finish_reason: string;
        is_truncated: boolean;
        usage: UsageSummary;
      };
    };

export class AssistantError extends ActivityError {
  constructor(
    message: string,
    status: number,
    code = 'REQUEST_FAILED',
    public retryAfter: number | null = null,
    public messageId: string | null = null,
  ) {
    super(message, status, code);
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES: ReadonlySet<string> = new Set(['pending', 'streaming', 'succeeded', 'failed', 'cancelled']);

function invalid(detail = 'AI 助手服务返回了无效响应'): never {
  throw new AssistantError(detail, 502, 'INVALID_RESPONSE');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));

export function parseUIBlock(value: unknown): UIBlock {
  if (!isRecord(value) || typeof value.type !== 'string' || !UI_BLOCK_TYPES.has(value.type) || !isRecord(value.data)) {
    invalid();
  }
  return { type: value.type as UIBlockType, data: value.data };
}

export function parseConsent(value: unknown): ConsentView {
  if (
    !isRecord(value) ||
    typeof value.consented !== 'boolean' ||
    (value.consent_version !== null && typeof value.consent_version !== 'string') ||
    typeof value.required_version !== 'string' ||
    (value.consented_at !== null && !isIsoTimestamp(value.consented_at)) ||
    (value.revoked_at !== null && !isIsoTimestamp(value.revoked_at))
  ) {
    invalid();
  }
  return {
    consented: value.consented,
    consent_version: value.consent_version,
    required_version: value.required_version,
    consented_at: value.consented_at,
    revoked_at: value.revoked_at,
  };
}

export function parseQuota(value: unknown): QuotaStatusView {
  if (
    !isRecord(value) ||
    !isNonNegInt(value.daily_message_limit) ||
    !isNonNegInt(value.messages_today) ||
    !isNonNegInt(value.remaining_messages_today) ||
    !isNonNegInt(value.daily_token_budget) ||
    !isNonNegInt(value.tokens_today) ||
    !isNonNegInt(value.remaining_tokens_today) ||
    !isNonNegInt(value.site_daily_token_budget) ||
    !isNonNegInt(value.site_tokens_today) ||
    typeof value.site_budget_exhausted !== 'boolean'
  ) {
    invalid();
  }
  return {
    daily_message_limit: value.daily_message_limit,
    messages_today: value.messages_today,
    remaining_messages_today: value.remaining_messages_today,
    daily_token_budget: value.daily_token_budget,
    tokens_today: value.tokens_today,
    remaining_tokens_today: value.remaining_tokens_today,
    site_daily_token_budget: value.site_daily_token_budget,
    site_tokens_today: value.site_tokens_today,
    site_budget_exhausted: value.site_budget_exhausted,
  };
}

export function parseContext(value: unknown): AssistantContext {
  if (
    !isRecord(value) ||
    typeof value.configured !== 'boolean' ||
    typeof value.enabled !== 'boolean' ||
    (value.model !== null && typeof value.model !== 'string')
  ) {
    invalid();
  }
  return {
    configured: value.configured,
    enabled: value.enabled,
    model: value.model,
    consent: parseConsent(value.consent),
    quota: parseQuota(value.quota),
  };
}

export function parseConversation(value: unknown): ConversationView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.title !== 'string' ||
    !isIsoTimestamp(value.created_at) ||
    !isIsoTimestamp(value.updated_at) ||
    !isIsoTimestamp(value.last_message_at)
  ) {
    invalid();
  }
  return {
    id: value.id,
    title: value.title,
    created_at: value.created_at,
    updated_at: value.updated_at,
    last_message_at: value.last_message_at,
  };
}

export function parseConversationList(value: unknown): ConversationList {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonNegInt(value.total) ||
    !isNonNegInt(value.limit) ||
    !isNonNegInt(value.offset)
  ) {
    invalid();
  }
  return {
    items: value.items.map(parseConversation),
    total: value.total,
    limit: value.limit,
    offset: value.offset,
  };
}

export function parseMessage(value: unknown): MessageView {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.conversation_id !== 'string' ||
    !UUID_PATTERN.test(value.conversation_id) ||
    (value.role !== 'user' && value.role !== 'assistant') ||
    typeof value.status !== 'string' ||
    !VALID_STATUSES.has(value.status) ||
    (value.content !== null && typeof value.content !== 'string') ||
    !Array.isArray(value.tool_calls_summary) ||
    !Array.isArray(value.ui_blocks) ||
    (value.model !== null && typeof value.model !== 'string') ||
    (value.prompt_version !== null && typeof value.prompt_version !== 'string') ||
    (value.error_code !== null && typeof value.error_code !== 'string') ||
    (value.input_tokens !== null && !isNonNegInt(value.input_tokens)) ||
    (value.output_tokens !== null && !isNonNegInt(value.output_tokens)) ||
    (value.cached_input_tokens !== null && !isNonNegInt(value.cached_input_tokens)) ||
    !isIsoTimestamp(value.created_at) ||
    (value.finished_at !== null && !isIsoTimestamp(value.finished_at)) ||
    typeof value.is_stale !== 'boolean'
  ) {
    invalid();
  }
  const safeTools = value.tool_calls_summary.filter(isRecord);
  const safeBlocks: UIBlock[] = [];
  for (const rawBlock of value.ui_blocks) {
    if (isRecord(rawBlock) && typeof rawBlock.type === 'string' && UI_BLOCK_TYPES.has(rawBlock.type) && isRecord(rawBlock.data)) {
      safeBlocks.push({ type: rawBlock.type as UIBlockType, data: rawBlock.data });
    }
  }
  return {
    id: value.id,
    conversation_id: value.conversation_id,
    role: value.role,
    status: value.status as MessageStatus,
    content: value.content,
    tool_calls_summary: safeTools,
    ui_blocks: safeBlocks,
    model: value.model,
    prompt_version: value.prompt_version,
    error_code: value.error_code,
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cached_input_tokens: value.cached_input_tokens,
    created_at: value.created_at,
    finished_at: value.finished_at,
    is_stale: value.is_stale,
  };
}

export function parseConversationDetail(value: unknown): ConversationDetail {
  if (
    !isRecord(value) ||
    !Array.isArray(value.messages) ||
    !isNonNegInt(value.total_messages) ||
    !isNonNegInt(value.limit) ||
    !isNonNegInt(value.offset)
  ) {
    invalid();
  }
  return {
    conversation: parseConversation(value.conversation),
    messages: value.messages.map(parseMessage),
    total_messages: value.total_messages,
    limit: value.limit,
    offset: value.offset,
  };
}

export function parseCancelResult(value: unknown): MessageCancelled {
  if (
    !isRecord(value) ||
    typeof value.cancelled !== 'boolean' ||
    typeof value.status !== 'string' ||
    !VALID_STATUSES.has(value.status)
  ) {
    invalid();
  }
  return { cancelled: value.cancelled, status: value.status as MessageStatus };
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
}

async function parseErrorResponse(response: Response): Promise<AssistantError> {
  if (response.status === 401) {
    return new AssistantError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED');
  }
  const retryHeader = response.headers.get('Retry-After');
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    return new AssistantError(`请求失败（${response.status}），请稍后重试`, response.status, 'REQUEST_FAILED', retryAfter);
  }
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = err && typeof err.code === 'string' ? err.code : 'REQUEST_FAILED';
  let message = err && typeof err.message === 'string' ? err.message : `请求失败（${response.status}），请稍后重试`;
  if ((response.status === 429 || response.status === 503) && retryAfter !== null && !message.includes('秒') && !message.includes('分钟')) {
    message += `，约 ${formatRetryAfter(retryAfter)} 后可重试`;
  }
  let messageId: string | null = null;
  if (err && Array.isArray(err.details)) {
    for (const item of err.details) {
      if (isRecord(item) && typeof item.message_id === 'string' && UUID_PATTERN.test(item.message_id)) {
        messageId = item.message_id;
        break;
      }
    }
  }
  return new AssistantError(message, response.status, code, retryAfter, messageId);
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  timeout = 10000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(timeout),
    });
  } catch {
    throw new AssistantError('网络连接失败，请检查网络后重试', 503, 'NETWORK_ERROR');
  }
  if (!response.ok) throw await parseErrorResponse(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    invalid();
  }
  if (!isRecord(body)) invalid();
  if (body.error) throw await parseErrorResponse(new Response(JSON.stringify(body), { status: response.status, headers: response.headers }));
  return body.data;
}

async function fetchCsrf(fetcher: typeof fetch): Promise<string> {
  const data = await requestJson('/api/v1/auth/csrf', {}, fetcher);
  if (!isRecord(data) || typeof data.csrf_token !== 'string' || !data.csrf_token) {
    invalid('无法获取安全令牌');
  }
  return data.csrf_token;
}

export async function readAssistantContext(fetcher: typeof fetch = fetch): Promise<AssistantContext> {
  return parseContext(await requestJson('/api/v1/ai-assistant/context', {}, fetcher));
}

export async function updateAssistantConsent(consented: boolean, fetcher: typeof fetch = fetch): Promise<ConsentView> {
  const token = await fetchCsrf(fetcher);
  const payload: ConsentUpdate = { consented };
  return parseConsent(
    await requestJson(
      '/api/v1/ai-assistant/consent',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(payload),
      },
      fetcher,
    ),
  );
}

export async function listConversations(
  offset = 0,
  limit = 20,
  fetcher: typeof fetch = fetch,
): Promise<ConversationList> {
  if (!isNonNegInt(offset) || !Number.isInteger(limit) || limit < 1 || limit > 50) invalid('会话分页参数不合法');
  return parseConversationList(
    await requestJson(`/api/v1/ai-assistant/conversations?limit=${limit}&offset=${offset}`, {}, fetcher),
  );
}

export async function createConversation(title = '', fetcher: typeof fetch = fetch): Promise<ConversationView> {
  const token = await fetchCsrf(fetcher);
  const payload: ConversationCreate = { title: title.trim().slice(0, 120) };
  return parseConversation(
    await requestJson(
      '/api/v1/ai-assistant/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(payload),
      },
      fetcher,
    ),
  );
}

export async function readConversation(
  conversationId: string,
  offset = 0,
  limit = 50,
  fetcher: typeof fetch = fetch,
): Promise<ConversationDetail> {
  if (!UUID_PATTERN.test(conversationId)) invalid('会话标识不合法');
  if (!isNonNegInt(offset) || !Number.isInteger(limit) || limit < 1 || limit > 100) invalid('消息分页参数不合法');
  return parseConversationDetail(
    await requestJson(`/api/v1/ai-assistant/conversations/${conversationId}?limit=${limit}&offset=${offset}`, {}, fetcher),
  );
}

export async function renameConversation(
  conversationId: string,
  title: string,
  fetcher: typeof fetch = fetch,
): Promise<ConversationView> {
  if (!UUID_PATTERN.test(conversationId)) invalid('会话标识不合法');
  const cleaned = title.trim().slice(0, 120);
  if (!cleaned) throw new AssistantError('会话标题不能为空', 422, 'VALIDATION_ERROR');
  const token = await fetchCsrf(fetcher);
  const payload: ConversationUpdate = { title: cleaned };
  return parseConversation(
    await requestJson(
      `/api/v1/ai-assistant/conversations/${conversationId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(payload),
      },
      fetcher,
    ),
  );
}

export async function deleteConversation(conversationId: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!UUID_PATTERN.test(conversationId)) invalid('会话标识不合法');
  const token = await fetchCsrf(fetcher);
  const data = await requestJson(
    `/api/v1/ai-assistant/conversations/${conversationId}`,
    {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': token },
    },
    fetcher,
  );
  if (!isRecord(data) || data.deleted !== true) invalid();
}

export async function cancelAssistantMessage(
  conversationId: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
): Promise<MessageCancelled> {
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) invalid('消息标识不合法');
  const token = await fetchCsrf(fetcher);
  return parseCancelResult(
    await requestJson(
      `/api/v1/ai-assistant/conversations/${conversationId}/messages/${messageId}/cancel`,
      {
        method: 'POST',
        headers: { 'X-CSRF-Token': token },
      },
      fetcher,
    ),
  );
}

export function parseSseEvent(eventName: string, rawData: string): StreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (eventName) {
    case 'meta': {
      if (
        typeof parsed.conversation_id !== 'string' ||
        !UUID_PATTERN.test(parsed.conversation_id) ||
        typeof parsed.user_message_id !== 'string' ||
        !UUID_PATTERN.test(parsed.user_message_id) ||
        typeof parsed.assistant_message_id !== 'string' ||
        !UUID_PATTERN.test(parsed.assistant_message_id) ||
        !isNonNegInt(parsed.remaining_messages_today) ||
        !isNonNegInt(parsed.remaining_tokens_today)
      ) {
        return null;
      }
      return {
        event: 'meta',
        data: {
          conversation_id: parsed.conversation_id,
          user_message_id: parsed.user_message_id,
          assistant_message_id: parsed.assistant_message_id,
          remaining_messages_today: parsed.remaining_messages_today,
          remaining_tokens_today: parsed.remaining_tokens_today,
          replayed: parsed.replayed === true,
        },
      };
    }
    case 'status': {
      if (typeof parsed.stage !== 'string' || typeof parsed.message !== 'string') return null;
      return { event: 'status', data: { stage: parsed.stage, message: parsed.message } };
    }
    case 'tool_start': {
      if (typeof parsed.tool !== 'string' || typeof parsed.label !== 'string') return null;
      return { event: 'tool_start', data: { tool: parsed.tool, label: parsed.label } };
    }
    case 'tool_end': {
      if (typeof parsed.tool !== 'string' || typeof parsed.label !== 'string') return null;
      return {
        event: 'tool_end',
        data: {
          tool: parsed.tool,
          label: parsed.label,
          duration_ms: isNonNegInt(parsed.duration_ms) ? parsed.duration_ms : 0,
          degraded: parsed.degraded === true,
          truncated: parsed.truncated === true,
          ok: parsed.ok !== false,
        },
      };
    }
    case 'block': {
      if (typeof parsed.type !== 'string' || !UI_BLOCK_TYPES.has(parsed.type) || !isRecord(parsed.data)) return null;
      return { event: 'block', data: { type: parsed.type as UIBlockType, data: parsed.data } };
    }
    case 'delta': {
      if (typeof parsed.text !== 'string') return null;
      return { event: 'delta', data: { text: parsed.text } };
    }
    case 'ping': {
      return { event: 'ping', data: { ts: typeof parsed.ts === 'number' ? parsed.ts : 0 } };
    }
    case 'error': {
      if (typeof parsed.code !== 'string' || typeof parsed.message !== 'string') return null;
      return {
        event: 'error',
        data: {
          code: parsed.code,
          message: parsed.message,
          retryable: parsed.retryable !== false,
          message_id: typeof parsed.message_id === 'string' && UUID_PATTERN.test(parsed.message_id) ? parsed.message_id : undefined,
        },
      };
    }
    case 'done': {
      if (
        typeof parsed.message_id !== 'string' ||
        !UUID_PATTERN.test(parsed.message_id) ||
        typeof parsed.status !== 'string' ||
        !VALID_STATUSES.has(parsed.status)
      ) {
        return null;
      }
      const usageRaw = isRecord(parsed.usage) ? parsed.usage : {};
      return {
        event: 'done',
        data: {
          message_id: parsed.message_id,
          status: parsed.status as MessageStatus,
          error_code: typeof parsed.error_code === 'string' ? parsed.error_code : undefined,
          finish_reason: typeof parsed.finish_reason === 'string' ? parsed.finish_reason : 'stop',
          is_truncated: parsed.is_truncated === true,
          usage: {
            input_tokens: isNonNegInt(usageRaw.input_tokens) ? usageRaw.input_tokens : null,
            output_tokens: isNonNegInt(usageRaw.output_tokens) ? usageRaw.output_tokens : null,
            cached_input_tokens: isNonNegInt(usageRaw.cached_input_tokens) ? usageRaw.cached_input_tokens : null,
          },
        },
      };
    }
    default:
      return null;
  }
}

/** Incremental SSE frame parser handling arbitrary chunk splits, CRLF/LF, and multi-line data. */
export function createSseParser(onEvent: (event: StreamEvent) => void) {
  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      currentEvent = 'message';
      return;
    }
    const rawData = dataLines.join('\n');
    const eventName = currentEvent || 'message';
    currentEvent = 'message';
    dataLines = [];
    const parsed = parseSseEvent(eventName, rawData);
    if (parsed) onEvent(parsed);
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') currentEvent = value;
    else if (field === 'data') dataLines.push(value);
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && i + 1 === buffer.length) {
            // Wait for potential '\n' in next chunk.
            break;
          }
          processLine(buffer.slice(start, i));
          if (ch === '\r' && buffer[i + 1] === '\n') i++;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
    },
    finish() {
      if (buffer.length > 0) {
        processLine(buffer.replace(/\r$/, ''));
        buffer = '';
      }
      dispatch();
    },
  };
}

export async function streamAssistantMessage(
  conversationId: string,
  content: string,
  idempotencyKey: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<{ receivedDone: boolean }> {
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(idempotencyKey)) {
    invalid('请求标识不合法');
  }
  const cleaned = content.trim();
  if (!cleaned || cleaned.length > 4000) {
    throw new AssistantError('提问内容需在 1–4000 字之间', 422, 'VALIDATION_ERROR');
  }
  const token = await fetchCsrf(fetcher);
  const payload: MessageCreate = { content: cleaned };
  let response: Response;
  try {
    response = await fetcher(`/api/v1/ai-assistant/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-CSRF-Token': token,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (cause) {
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
      throw new AssistantError('已停止生成', 0, 'ABORTED');
    }
    throw new AssistantError('连接中断，结果尚未确认。请同步最新记录或按原请求重试。', 503, 'NETWORK_ERROR');
  }

  if (!response.ok) throw await parseErrorResponse(response);

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    invalid('服务端未返回流式响应');
  }

  let receivedDone = false;
  const parser = createSseParser((event) => {
    if (event.event === 'done') receivedDone = true;
    onEvent(event);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.feed(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) parser.feed(tail);
    parser.finish();
  } catch (cause) {
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
      throw new AssistantError('已停止生成', 0, 'ABORTED');
    }
    throw new AssistantError('流式连接意外中断，请同步会话记录以确认最终结果。', 503, 'STREAM_INTERRUPTED');
  } finally {
    reader.releaseLock();
  }
  return { receivedDone };
}
