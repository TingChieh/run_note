import { randomUUID } from 'node:crypto';

const CONSENT_VERSION = 'ai-assistant-v1';

/**
 * In-memory synthetic AI assistant backend mirroring Phase 2 SSE + CRUD contract.
 * Scoped per user ID so cross-user conversation access always returns 404.
 */
export function createAIAssistant() {
  /** @type {Map<string, any>} */
  const byUser = new Map();

  /** @param {string} userId */
  function stateFor(userId) {
    let state = byUser.get(userId);
    if (!state) {
      state = {
        consented: false,
        consented_at: null,
        revoked_at: null,
        messages_today: 0,
        tokens_today: 0,
        conversations: /** @type {any[]} */ ([]),
        messages: /** @type {Map<string, any[]>} */ (new Map()),
        byRequestKey: /** @type {Map<string, any>} */ (new Map()),
      };
      byUser.set(userId, state);
    }
    return state;
  }

  /** @param {string} [userId] */
  function reset(userId) {
    if (userId) byUser.delete(userId);
    else byUser.clear();
  }

  /** @param {any} state */
  function consentView(state) {
    return {
      consented: state.consented,
      consent_version: state.consented || state.revoked_at ? CONSENT_VERSION : null,
      required_version: CONSENT_VERSION,
      consented_at: state.consented_at,
      revoked_at: state.revoked_at,
    };
  }

  /** @param {any} state */
  function quotaView(state) {
    const daily_message_limit = 30;
    const daily_token_budget = 150000;
    const site_daily_token_budget = 1000000;
    return {
      daily_message_limit,
      messages_today: state.messages_today,
      remaining_messages_today: Math.max(0, daily_message_limit - state.messages_today),
      daily_token_budget,
      tokens_today: state.tokens_today,
      remaining_tokens_today: Math.max(0, daily_token_budget - state.tokens_today),
      site_daily_token_budget,
      site_tokens_today: state.tokens_today,
      site_budget_exhausted: false,
    };
  }

  /**
   * @param {string} event
   * @param {unknown} data
   */
  function sse(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /** @param {string} prompt */
  function sampleBlocks(prompt) {
    if (/足迹|省|城市/.test(prompt)) {
      return [
        {
          type: 'footprint_summary_card',
          data: {
            scope: 'china',
            year: null,
            total_provinces: 34,
            visited_province_count: 2,
            activity_count: 8,
            located_activity_count: 7,
            cached_only: false,
            provinces: [
              { code: 330000, name: '浙江省', activity_count: 5 },
              { code: 110000, name: '北京市', activity_count: 2 },
            ],
          },
        },
      ];
    }
    if (/最佳|PB|5K|10K/i.test(prompt)) {
      return [
        {
          type: 'records_summary',
          data: {
            personal_bests: [
              {
                category: '5km',
                best: {
                  activity_id: '11111111-1111-4111-8111-111111111111',
                  activity_date: '2026-03-05',
                  distance_m: '5000.000',
                  duration_seconds: '1650.000',
                  avg_pace_seconds_per_km: '330.000',
                  qualifying_count: 4,
                },
                first: {
                  activity_id: '22222222-2222-4222-8222-222222222222',
                  activity_date: '2025-01-12',
                  distance_m: '5000.000',
                  duration_seconds: '1860.000',
                  avg_pace_seconds_per_km: '372.000',
                },
                pace_gain_seconds_per_km: '42.000',
              },
              { category: '10km', best: null, first: null, pace_gain_seconds_per_km: null },
            ],
            totals: {
              activity_count: 44,
              distance_m: '245000.000',
              activity_days: 42,
              avg_pace_seconds_per_km: '347.000',
              first_activity_date: '2025-01-12',
            },
          },
        },
      ];
    }
    return [
      {
        type: 'metrics_card',
        data: {
          scope: 'range',
          date_from: '2026-09-14',
          date_to: '2026-10-12',
          summary: {
            activity_count: 8,
            distance_m: '42123.456',
            duration_sum_seconds: '14400',
            known_duration_count: 8,
            missing_duration_count: 0,
            activity_days: 8,
            pace_eligible_count: 8,
            pace_eligible_distance_m: '42123.456',
            avg_pace_seconds_per_km: '341.8',
            quality_warning_count: 0,
            date_assignment: 'activity_local_date',
          },
          device_metrics: {
            heart_rate_record_count: 6,
            heart_rate_weighted_count: 6,
            heart_rate_weighted_duration_seconds: '10800',
            avg_heart_rate_bpm: '146.5',
            calories_record_count: 6,
            calories_kcal: 2450,
            steps_record_count: 6,
            steps: 38200,
          },
        },
      },
      {
        type: 'trend_chart',
        data: {
          period: 'week',
          date_from: '2026-09-14',
          date_to: '2026-10-12',
          date_assignment: 'activity_local_date',
          week_start: 'monday',
          buckets: [
            { bucket_start: '2026-09-14', bucket_end: '2026-09-21', is_partial: false, activity_count: 2, distance_m: '10000', duration_sum_seconds: '3500', known_duration_count: 2, missing_duration_count: 0, activity_days: 2, pace_eligible_count: 2, pace_eligible_distance_m: '10000', avg_pace_seconds_per_km: '350', quality_warning_count: 0, date_assignment: 'activity_local_date' },
            { bucket_start: '2026-09-21', bucket_end: '2026-09-28', is_partial: false, activity_count: 2, distance_m: '11200', duration_sum_seconds: '3820', known_duration_count: 2, missing_duration_count: 0, activity_days: 2, pace_eligible_count: 2, pace_eligible_distance_m: '11200', avg_pace_seconds_per_km: '341', quality_warning_count: 0, date_assignment: 'activity_local_date' },
            { bucket_start: '2026-09-28', bucket_end: '2026-10-05', is_partial: false, activity_count: 2, distance_m: '9800', duration_sum_seconds: '3400', known_duration_count: 2, missing_duration_count: 0, activity_days: 2, pace_eligible_count: 2, pace_eligible_distance_m: '9800', avg_pace_seconds_per_km: '347', quality_warning_count: 0, date_assignment: 'activity_local_date' },
            { bucket_start: '2026-10-05', bucket_end: '2026-10-12', is_partial: false, activity_count: 2, distance_m: '11123.456', duration_sum_seconds: '3680', known_duration_count: 2, missing_duration_count: 0, activity_days: 2, pace_eligible_count: 2, pace_eligible_distance_m: '11123.456', avg_pace_seconds_per_km: '331', quality_warning_count: 0, date_assignment: 'activity_local_date' },
          ],
        },
      },
    ];
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {URL} url
   * @param {import('node:http').ServerResponse} res
   * @param {string} userId
   * @param {(data: unknown, status?: number, message?: string, code?: string) => void} send
   */
  async function handle(req, url, res, userId, send) {
    const state = stateFor(userId);
    const sub = url.pathname.slice('/api/v1/ai-assistant'.length);

    if (sub === '/context' && req.method === 'GET') {
      return send({
        configured: true,
        enabled: true,
        model: 'deepseek-chat',
        consent: consentView(state),
        quota: quotaView(state),
      });
    }

    if (sub === '/consent' && req.method === 'PUT') {
      if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null, 403, '请求校验失败', 'CSRF_FAILED');
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      const now = new Date().toISOString();
      if (payload.consented === true) {
        state.consented = true;
        state.consented_at = now;
        state.revoked_at = null;
      } else {
        state.consented = false;
        state.revoked_at = now;
      }
      return send(consentView(state));
    }

    if (sub === '/conversations' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const sorted = [...state.conversations].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
      return send({ items: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset });
    }

    if (sub === '/conversations' && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null, 403, '请求校验失败', 'CSRF_FAILED');
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      const now = new Date().toISOString();
      const conv = {
        id: randomUUID(),
        title: typeof payload.title === 'string' ? payload.title.trim().slice(0, 120) : '',
        created_at: now,
        updated_at: now,
        last_message_at: now,
      };
      state.conversations.unshift(conv);
      state.messages.set(conv.id, []);
      return send(conv, 201);
    }

    const cancelMatch = /^\/conversations\/([^/]+)\/messages\/([^/]+)\/cancel$/.exec(sub);
    if (cancelMatch && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null, 403, '请求校验失败', 'CSRF_FAILED');
      const [, convId, msgId] = cancelMatch;
      const list = state.messages.get(convId);
      if (!list) return send(null, 404, '会话不存在', 'RESOURCE_NOT_FOUND');
      const msg = list.find((/** @type {any} */ m) => m.id === msgId && m.role === 'assistant');
      if (!msg) return send(null, 404, '消息不存在', 'RESOURCE_NOT_FOUND');
      if (msg.status === 'pending' || msg.status === 'streaming') {
        msg.status = 'cancelled';
        msg.finished_at = new Date().toISOString();
        return send({ cancelled: true, status: 'cancelled' });
      }
      return send({ cancelled: false, status: msg.status });
    }

    const msgMatch = /^\/conversations\/([^/]+)\/messages$/.exec(sub);
    if (msgMatch && req.method === 'POST') {
      if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null, 403, '请求校验失败', 'CSRF_FAILED');
      if (!state.consented) return send(null, 403, '请先阅读并同意 AI 助手数据使用说明后再提问', 'AI_CONSENT_REQUIRED');
      const convId = msgMatch[1];
      const conv = state.conversations.find((/** @type {any} */ c) => c.id === convId);
      if (!conv) return send(null, 404, '会话不存在', 'RESOURCE_NOT_FOUND');
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      const content = typeof payload.content === 'string' ? payload.content.trim() : '';
      if (!content) return send(null, 422, '提问内容不能为空', 'VALIDATION_ERROR');
      const reqKey = String(req.headers['idempotency-key'] ?? randomUUID());
      const now = new Date().toISOString();
      const userMsg = {
        id: randomUUID(),
        conversation_id: convId,
        role: 'user',
        status: 'succeeded',
        content,
        tool_calls_summary: [],
        ui_blocks: [],
        model: null,
        prompt_version: null,
        error_code: null,
        input_tokens: null,
        output_tokens: null,
        cached_input_tokens: null,
        created_at: now,
        finished_at: now,
        is_stale: false,
      };
      const blocks = sampleBlocks(content);
      const replyText = '## 跑步数据分析\n\n基于权威汇总，你在最近四周共完成 **8 次** 跑步，累计 **42.12 km**，加权平均配速 `5:42 /km`。\n\n- 节奏稳定，周跑量保持在 10–11 km\n- 下周建议继续以轻松跑为主，避免突增跑量\n\n> 仅供参考，不构成医疗或专业训练处方。';
      const asstMsg = {
        id: randomUUID(),
        conversation_id: convId,
        role: 'assistant',
        status: 'succeeded',
        content: replyText,
        tool_calls_summary: [{ tool: 'get_running_summary', duration_ms: 18, degraded: false, truncated: false }],
        ui_blocks: blocks,
        model: 'deepseek-chat',
        prompt_version: 'ai-assistant-v1',
        error_code: null,
        input_tokens: 600,
        output_tokens: 180,
        cached_input_tokens: 200,
        created_at: now,
        finished_at: now,
        is_stale: false,
      };
      const list = state.messages.get(convId) ?? [];
      list.push(userMsg, asstMsg);
      state.messages.set(convId, list);
      if (!conv.title) conv.title = content.slice(0, 40);
      conv.last_message_at = now;
      conv.updated_at = now;
      state.messages_today += 1;
      state.tokens_today += 780;
      state.byRequestKey.set(reqKey, { convId, userMsg, asstMsg });

      const quota = quotaView(state);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.write(
        sse('meta', {
          conversation_id: convId,
          user_message_id: userMsg.id,
          assistant_message_id: asstMsg.id,
          remaining_messages_today: quota.remaining_messages_today,
          remaining_tokens_today: quota.remaining_tokens_today,
          replayed: false,
        }),
      );
      res.write(sse('status', { stage: 'thinking', message: '正在分析问题…' }));
      res.write(sse('tool_start', { tool: 'get_running_summary', label: '查询跑步汇总数据' }));
      res.write(sse('tool_end', { tool: 'get_running_summary', label: '查询跑步汇总数据', duration_ms: 18, degraded: false, truncated: false, ok: true }));
      for (const b of blocks) res.write(sse('block', b));
      res.write(sse('delta', { text: replyText.slice(0, 40) }));
      res.write(sse('delta', { text: replyText.slice(40) }));
      res.write(
        sse('done', {
          message_id: asstMsg.id,
          status: 'succeeded',
          finish_reason: 'stop',
          is_truncated: false,
          usage: { input_tokens: 600, output_tokens: 180, cached_input_tokens: 200 },
        }),
      );
      res.end();
      return;
    }

    const convMatch = /^\/conversations\/([^/]+)$/.exec(sub);
    if (convMatch) {
      const convId = convMatch[1];
      const conv = state.conversations.find((/** @type {any} */ c) => c.id === convId);
      if (!conv) return send(null, 404, '会话不存在', 'RESOURCE_NOT_FOUND');
      if (req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const all = state.messages.get(convId) ?? [];
        return send({
          conversation: conv,
          messages: all.slice(offset, offset + limit),
          total_messages: all.length,
          limit,
          offset,
        });
      }
      if (req.headers['x-csrf-token'] !== 'ui-csrf') return send(null, 403, '请求校验失败', 'CSRF_FAILED');
      if (req.method === 'PATCH') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || '{}');
        const cleaned = typeof payload.title === 'string' ? payload.title.trim().slice(0, 120) : '';
        if (!cleaned) return send(null, 422, '会话标题不能为空', 'VALIDATION_ERROR');
        conv.title = cleaned;
        conv.updated_at = new Date().toISOString();
        return send(conv);
      }
      if (req.method === 'DELETE') {
        state.conversations = state.conversations.filter((/** @type {any} */ c) => c.id !== convId);
        state.messages.delete(convId);
        return send({ deleted: true });
      }
    }

    return send(null, 404, '未找到 AI 助手接口', 'RESOURCE_NOT_FOUND');
  }

  return { handle, reset };
}
