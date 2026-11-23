import { describe, expect, it } from 'vitest';
import {
  AssistantError,
  createConversation,
  createSseParser,
  formatRetryAfter,
  parseContext,
  parseConversationDetail,
  streamAssistantMessage,
  type StreamEvent,
} from '../../src/lib/api/ai-assistant.ts';

const CONV_ID = '11111111-1111-4111-8111-111111111111';
const USER_MSG_ID = '22222222-2222-4222-8222-222222222222';
const ASST_MSG_ID = '33333333-3333-4333-8333-333333333333';
const REQ_KEY = '44444444-4444-4444-8444-444444444444';

describe('SSE parser', () => {
  it('handles chunked frames, CRLF, comments, heartbeats, and malformed JSON safely', () => {
    const events: StreamEvent[] = [];
    const parser = createSseParser((event) => events.push(event));

    const payload = [
      `: keepalive\r\n`,
      `event: meta\r\ndata: {"conversation_id":"${CONV_ID}","user_message_id":"${USER_MSG_ID}","assistant_message_id":"${ASST_MSG_ID}","remaining_messages_today":29,"remaining_tokens_today":150000,"replayed":false}\r\n\r\n`,
      `event: status\ndata: {"stage":"thinking","message":"正在分析问题…"}\n\n`,
      `event: tool_start\ndata: {"tool":"get_running_summary","label":"查询跑步汇总数据"}\n\n`,
      `event: block\ndata: {"type":"metrics_card","data":{"summary":{"activity_count":4}}}\n\n`,
      `event: delta\ndata: {"text":"近四周共跑了 "}\n\n`,
      `event: delta\ndata: {"text":"42.2 公里。"}\n\n`,
      `event: malformed\ndata: {not-json}\n\n`,
      `event: ping\ndata: {"ts":1700000000}\n\n`,
      `event: done\ndata: {"message_id":"${ASST_MSG_ID}","status":"succeeded","finish_reason":"stop","is_truncated":false,"usage":{"input_tokens":100,"output_tokens":50,"cached_input_tokens":20}}\n\n`,
    ].join('');

    // Feed in tiny 7-char chunks to simulate arbitrary network boundaries.
    for (let i = 0; i < payload.length; i += 7) {
      parser.feed(payload.slice(i, i + 7));
    }
    parser.finish();

    expect(events.map((e) => e.event)).toEqual(['meta', 'status', 'tool_start', 'block', 'delta', 'delta', 'ping', 'done']);
    expect(events[4]).toEqual({ event: 'delta', data: { text: '近四周共跑了 ' } });
    expect(events[5]).toEqual({ event: 'delta', data: { text: '42.2 公里。' } });
  });
});

describe('streamAssistantMessage', () => {
  it('decodes multibyte UTF-8 split across stream chunks and reports done', async () => {
    const encoder = new TextEncoder();
    const raw = encoder.encode(
      `event: meta\ndata: {"conversation_id":"${CONV_ID}","user_message_id":"${USER_MSG_ID}","assistant_message_id":"${ASST_MSG_ID}","remaining_messages_today":28,"remaining_tokens_today":140000,"replayed":false}\n\n` +
        `event: delta\ndata: {"text":"跑步配速提升明显🏃"}\n\n` +
        `event: done\ndata: {"message_id":"${ASST_MSG_ID}","status":"succeeded","finish_reason":"stop","is_truncated":false,"usage":{"input_tokens":120,"output_tokens":30,"cached_input_tokens":0}}\n\n`,
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split every 5 bytes so Chinese UTF-8 characters and emoji are split mid-character.
        for (let i = 0; i < raw.length; i += 5) {
          controller.enqueue(raw.slice(i, i + 5));
        }
        controller.close();
      },
    });

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === '/api/v1/auth/csrf') {
        return new Response(JSON.stringify({ data: { csrf_token: 'tok-123' }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const events: StreamEvent[] = [];
    const result = await streamAssistantMessage(CONV_ID, '总结跑步', REQ_KEY, (e) => events.push(e), undefined, fetcher);
    expect(result.receivedDone).toBe(true);
    expect(events.find((e) => e.event === 'delta')).toEqual({ event: 'delta', data: { text: '跑步配速提升明显🏃' } });
  });

  it('surfaces 429 rate-limit Retry-After and 401 session expiry', async () => {
    const rateLimitedFetch: typeof fetch = async (input) => {
      if (String(input) === '/api/v1/auth/csrf') {
        return new Response(JSON.stringify({ data: { csrf_token: 'tok' }, error: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: null, error: { code: 'AI_RATE_LIMITED', message: '提问过于频繁' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '45' },
      });
    };

    await expect(
      streamAssistantMessage(CONV_ID, 'hello', REQ_KEY, () => {}, undefined, rateLimitedFetch),
    ).rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMITED', retryAfter: 45 });

    const unauthorizedFetch: typeof fetch = async () => new Response('', { status: 401 });
    await expect(
      streamAssistantMessage(CONV_ID, 'hello', REQ_KEY, () => {}, undefined, unauthorizedFetch),
    ).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });

  it('detects premature EOF without done event', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"半句"}\n\n'));
        controller.close();
      },
    });
    const fetcher: typeof fetch = async (input) => {
      if (String(input) === '/api/v1/auth/csrf') {
        return new Response(JSON.stringify({ data: { csrf_token: 'tok' }, error: null }), { status: 200 });
      }
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const result = await streamAssistantMessage(CONV_ID, 'hello', REQ_KEY, () => {}, undefined, fetcher);
    expect(result.receivedDone).toBe(false);
  });
});

describe('runtime validators and helpers', () => {
  it('validates context and rejects invalid shapes', () => {
    const valid = parseContext({
      configured: true,
      enabled: true,
      model: 'deepseek-chat',
      consent: {
        consented: true,
        consent_version: 'ai-assistant-v1',
        required_version: 'ai-assistant-v1',
        consented_at: '2026-11-22T01:00:00Z',
        revoked_at: null,
      },
      quota: {
        daily_message_limit: 30,
        messages_today: 2,
        remaining_messages_today: 28,
        daily_token_budget: 150000,
        tokens_today: 4000,
        remaining_tokens_today: 146000,
        site_daily_token_budget: 1000000,
        site_tokens_today: 12000,
        site_budget_exhausted: false,
      },
    });
    expect(valid.quota.remaining_messages_today).toBe(28);
    expect(() => parseContext({ configured: 'yes' })).toThrow(AssistantError);
  });

  it('ignores unknown ui_block types when reading persisted messages', () => {
    const detail = parseConversationDetail({
      conversation: {
        id: CONV_ID,
        title: '近四周趋势',
        created_at: '2026-11-22T01:00:00Z',
        updated_at: '2026-11-22T01:00:00Z',
        last_message_at: '2026-11-22T01:00:00Z',
      },
      messages: [
        {
          id: ASST_MSG_ID,
          conversation_id: CONV_ID,
          role: 'assistant',
          status: 'succeeded',
          content: '总结如下',
          tool_calls_summary: [{ tool: 'get_running_summary', duration_ms: 15 }],
          ui_blocks: [
            { type: 'metrics_card', data: { summary: { activity_count: 2 } } },
            { type: 'unknown_future_block', data: {} },
          ],
          model: 'deepseek-chat',
          prompt_version: 'ai-assistant-v1',
          error_code: null,
          input_tokens: 100,
          output_tokens: 40,
          cached_input_tokens: 0,
          created_at: '2026-11-22T01:00:00Z',
          finished_at: '2026-11-22T01:00:02Z',
          is_stale: false,
        },
      ],
      total_messages: 1,
      limit: 50,
      offset: 0,
    });
    expect(detail.messages[0].ui_blocks).toHaveLength(1);
    expect(detail.messages[0].ui_blocks[0].type).toBe('metrics_card');
  });

  it('formats retry-after durations cleanly', () => {
    expect(formatRetryAfter(30)).toBe('30 秒');
    expect(formatRetryAfter(120)).toBe('2 分钟');
    expect(formatRetryAfter(3660)).toBe('1 小时 1 分钟');
  });

  it('aborts createConversation with ABORTED when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher: typeof fetch = async () => {
      throw new Error('should not be called after abort');
    };
    await expect(createConversation('测试', fetcher, controller.signal)).rejects.toMatchObject({
      code: 'ABORTED',
      status: 0,
    });
  });
});
