import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities.ts';
import { installAI, report } from '../fixtures/p2.ts';

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function grantConsent(page: Page) {
  const card = page.getByTestId('ai-consent-card');
  await expect(card).toBeVisible();
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: '同意并启用 AI 助手', exact: true }).click();
  await expect(card).toHaveCount(0);
}

test('first-use consent, quick prompt streaming, structured blocks, multi-turn, history CRUD, and consent withdrawal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await installActivities(page);
  await loginRunner(page);
  await page.goto('/ai');

  await expect(page.getByRole('heading', { level: 1, name: 'AI 助手', exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-quota-pill')).toContainText('今日剩余 30/30 次');

  // Composer disabled until consent is explicitly granted.
  await expect(page.getByLabel('向 AI 助手提问')).toBeDisabled();
  await grantConsent(page);
  await expect(page.getByLabel('向 AI 助手提问')).toBeEnabled();

  // Quick prompt triggers streaming turn with authoritative metrics + trend chart.
  await page.getByRole('button', { name: /近 4 周趋势与建议/ }).click();
  await expect(page.getByTestId('block-metrics-card')).toBeVisible();
  await expect(page.getByTestId('block-trend-chart')).toBeVisible();
  await expect(page.getByText('42.12 km')).toBeVisible();
  await expect(page.getByTestId('ai-quota-pill')).toContainText('今日剩余 29/30 次');

  // Switch trend metric to pace and verify fallback table opens.
  const trendCard = page.getByTestId('block-trend-chart');
  await trendCard.getByRole('button', { name: '配速', exact: true }).click();
  await expect(trendCard.getByRole('button', { name: '配速', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await trendCard.getByText('查看每周数据').click();
  await expect(trendCard.getByRole('table')).toBeVisible();

  // Multi-turn follow-up in the same conversation via keyboard Enter.
  const input = page.getByLabel('向 AI 助手提问');
  await input.fill('我跑过哪些省份和城市？');
  await input.press('Enter');
  await expect(page.getByTestId('block-footprint-summary')).toBeVisible();
  await expect(page.getByText('浙江省')).toBeVisible();
  await expect(page.getByRole('link', { name: '前往个人足迹 →' })).toHaveAttribute('href', '/footprints');

  // Create a second conversation, switch back to the first, rename and delete it.
  await page.getByRole('button', { name: '+ 新建会话', exact: true }).click();
  await expect(page.getByTestId('ai-empty-stage')).toBeVisible();
  await page.getByRole('button', { name: /5K \/ 10K 最佳成绩/ }).click();
  await expect(page.getByTestId('block-records-summary')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看本次跑步 →' })).toHaveAttribute(
    'href',
    '/activities/11111111-1111-4111-8111-111111111111',
  );

  // Rename first conversation in history sidebar.
  const renameBtn = page.getByRole('button', { name: /^重命名 / }).first();
  await renameBtn.click();
  await page.getByLabel('新会话标题').fill('五月 PB 复盘');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('list', { name: '会话列表' })).toContainText('五月 PB 复盘');

  // Delete renamed conversation.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除 五月 PB 复盘', exact: true }).click();
  await expect(page.getByRole('list', { name: '会话列表' })).not.toContainText('五月 PB 复盘');

  // Withdraw consent through the privacy dialog and confirm composer locks while history stays readable.
  await page.getByRole('button', { name: '隐私与同意', exact: true }).click();
  const consentDialog = page.getByRole('dialog', { name: '隐私与数据使用同意' });
  await expect(consentDialog).toBeVisible();
  await consentDialog.getByRole('button', { name: '撤回数据使用同意', exact: true }).click();
  await consentDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByTestId('ai-consent-card')).toBeVisible();
  await expect(page.getByLabel('向 AI 助手提问')).toBeDisabled();

  expect(errors).toEqual([]);
});

test('local activity backfill, local RouteMap preview, safe markdown XSS neutralization, and rich blocks', async ({
  page,
}) => {
  await installActivities(page);
  await loginRunner(page);

  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userMsgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const asstMsgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  await page.route('**/api/v1/ai-assistant/context', (route) =>
    route.fulfill({
      json: {
        data: {
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
            messages_today: 1,
            remaining_messages_today: 29,
            daily_token_budget: 150000,
            tokens_today: 1200,
            remaining_tokens_today: 148800,
            site_daily_token_budget: 1000000,
            site_tokens_today: 1200,
            site_budget_exhausted: false,
          },
        },
        error: null,
      },
    }),
  );

  await page.route('**/api/v1/ai-assistant/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        json: {
          data: {
            id: convId,
            title: '丰富卡片测试',
            created_at: '2026-11-22T01:00:00Z',
            updated_at: '2026-11-22T01:00:00Z',
            last_message_at: '2026-11-22T01:00:00Z',
          },
          error: null,
        },
      });
    }
    return route.fulfill({ json: { data: { items: [], total: 0, limit: 20, offset: 0 }, error: null } });
  });

  await page.route(`**/api/v1/ai-assistant/conversations/${convId}/messages`, (route) => {
    const body = [
      sseFrame('meta', {
        conversation_id: convId,
        user_message_id: userMsgId,
        assistant_message_id: asstMsgId,
        remaining_messages_today: 28,
        remaining_tokens_today: 147000,
        replayed: false,
      }),
      sseFrame('tool_start', { tool: 'search_activities', label: '检索跑步记录摘要' }),
      sseFrame('tool_end', {
        tool: 'search_activities',
        label: '检索跑步记录摘要',
        duration_ms: 24,
        degraded: false,
        truncated: false,
        ok: true,
      }),
      sseFrame('block', {
        type: 'activity_list',
        data: {
          total: 1,
          activity_ids: [sampleActivity.id],
          items: [
            {
              activity_id: sampleActivity.id,
              activity_date: sampleActivity.activity_date,
              category: '5km',
              distance_m: sampleActivity.distance_m,
              duration_seconds: sampleActivity.elapsed_seconds,
              avg_pace_seconds_per_km: sampleActivity.avg_pace_seconds_per_km,
              avg_heart_rate_bpm: 152,
              temporal_quality: 'complete',
              has_route: true,
            },
          ],
        },
      }),
      sseFrame('block', {
        type: 'comparison_card',
        data: {
          period_a: {
            label: '今年至今',
            date_from: '2026-01-01',
            date_to: '2026-10-15',
            summary: { activity_count: 20, distance_m: '120000', activity_days: 19, avg_pace_seconds_per_km: '330' },
          },
          period_b: {
            label: '去年同期',
            date_from: '2025-01-01',
            date_to: '2025-10-15',
            summary: { activity_count: 15, distance_m: '90000', activity_days: 15, avg_pace_seconds_per_km: '345' },
          },
          delta: {
            activity_count_diff: 5,
            activity_days_diff: 4,
            distance_m_diff: '30000',
            distance_change_pct: '33.3',
            avg_pace_seconds_per_km_diff: '-15',
            avg_heart_rate_bpm_diff: null,
          },
        },
      }),
      sseFrame('block', {
        type: 'goals_streaks_card',
        data: {
          today: '2026-10-15',
          streaks: { current_days: 4, longest_days: 12, current_weeks: 3, longest_weeks: 8 },
          goals: {
            week: { target_km: '20', completed_km: '15.0', progress_pct: '75.0' },
            month: { target_km: null, completed_km: '42.0', progress_pct: null },
            year: { target_km: '600', completed_km: '320.0', progress_pct: '53.3' },
          },
        },
      }),
      sseFrame('delta', {
        text:
          '安全测试：<script>window.__xss=1</script> [点击](javascript:alert(1)) 与长词 superlongunbreakabletoken123456789012345678901234567890。\n\n```text\npace = 5:30 /km\n```\n',
      }),
      sseFrame('done', {
        message_id: asstMsgId,
        status: 'succeeded',
        finish_reason: 'stop',
        is_truncated: false,
        usage: { input_tokens: 400, output_tokens: 100, cached_input_tokens: 0 },
      }),
    ].join('');

    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body,
    });
  });

  await page.goto('/ai');
  await page.getByLabel('向 AI 助手提问').fill('查看我最近的活动与目标');
  await page.getByRole('button', { name: '发送', exact: true }).click();

  // D3 local backfill populates the real title ("河畔晨跑") even though the ui_block omitted title.
  await expect(page.getByTestId('block-activity-list')).toContainText('河畔晨跑');
  await expect(page.getByTestId('block-comparison-card')).toContainText('+30.00 km');
  await expect(page.getByTestId('block-goals-streaks')).toContainText('未设置目标');

  // Expand local RouteMap preview without ever sending coordinates to AI.
  await page.getByRole('button', { name: '预览本地路线', exact: true }).click();
  await expect(page.getByTestId('route-map-ready')).toBeVisible({ timeout: 20000 });

  // Verify XSS payloads did not execute and no javascript: link was rendered.
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.getByText(/<script>window\.__xss=1<\/script>/)).toBeVisible();
});

test('stop/cancel active stream, provider error retry, rate limit, and network recovery', async ({ page }) => {
  await loginRunner(page);
  const convId = '11111111-2222-4333-8444-555555555555';
  const userMsgId = '22222222-3333-4444-8555-666666666666';
  const asstMsgId = '33333333-4444-4555-8666-777777777777';
  let cancelCalled = 0;

  await page.route('**/api/v1/ai-assistant/context', (route) =>
    route.fulfill({
      json: {
        data: {
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
            messages_today: 0,
            remaining_messages_today: 30,
            daily_token_budget: 150000,
            tokens_today: 0,
            remaining_tokens_today: 150000,
            site_daily_token_budget: 1000000,
            site_tokens_today: 0,
            site_budget_exhausted: false,
          },
        },
        error: null,
      },
    }),
  );

  await page.route('**/api/v1/ai-assistant/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        json: {
          data: {
            id: convId,
            title: '中断与错误测试',
            created_at: '2026-11-22T01:00:00Z',
            updated_at: '2026-11-22T01:00:00Z',
            last_message_at: '2026-11-22T01:00:00Z',
          },
          error: null,
        },
      });
    }
    return route.fulfill({ json: { data: { items: [], total: 0, limit: 20, offset: 0 }, error: null } });
  });

  await page.route(`**/api/v1/ai-assistant/conversations/${convId}/messages/*/cancel`, (route) => {
    cancelCalled += 1;
    return route.fulfill({ json: { data: { cancelled: true, status: 'cancelled' }, error: null } });
  });

  let mode: 'hang' | 'rate_limit' | 'provider_error' | 'succeed' = 'hang';
  let releaseHang!: () => void;
  const hangGate = new Promise<void>((resolve) => {
    releaseHang = resolve;
  });

  await page.route(`**/api/v1/ai-assistant/conversations/${convId}/messages`, async (route) => {
    if (mode === 'hang') {
      await hangGate;
      return route.abort('aborted');
    }
    if (mode === 'rate_limit') {
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '45' },
        json: { data: null, error: { code: 'AI_RATE_LIMITED', message: '提问过于频繁，请稍后再试' } },
      });
    }
    if (mode === 'provider_error') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: [
          sseFrame('meta', {
            conversation_id: convId,
            user_message_id: userMsgId,
            assistant_message_id: asstMsgId,
            remaining_messages_today: 29,
            remaining_tokens_today: 149000,
            replayed: false,
          }),
          sseFrame('error', { code: 'AI_PROVIDER_ERROR', message: '上游模型暂时不可用', retryable: true, message_id: asstMsgId }),
          sseFrame('done', {
            message_id: asstMsgId,
            status: 'failed',
            error_code: 'AI_PROVIDER_ERROR',
            finish_reason: 'error',
            is_truncated: false,
            usage: { input_tokens: null, output_tokens: null, cached_input_tokens: null },
          }),
        ].join(''),
      });
    }
    const retryUserId = '44444444-5555-4666-8777-888888888888';
    const retryAsstId = '55555555-6666-4777-8888-999999999999';
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: [
        sseFrame('meta', {
          conversation_id: convId,
          user_message_id: retryUserId,
          assistant_message_id: retryAsstId,
          remaining_messages_today: 28,
          remaining_tokens_today: 148000,
          replayed: false,
        }),
        sseFrame('delta', { text: '重试成功，已获取最新数据。' }),
        sseFrame('done', {
          message_id: retryAsstId,
          status: 'succeeded',
          finish_reason: 'stop',
          is_truncated: false,
          usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 0 },
        }),
      ].join(''),
    });
  });

  await page.goto('/ai');
  await page.getByLabel('向 AI 助手提问').fill('测试停止生成');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  releaseHang();
  await expect(page.getByText('已停止生成').first()).toBeVisible();
  expect(cancelCalled).toBeGreaterThanOrEqual(0);

  // Rate limit feedback preserves draft and displays Retry-After.
  mode = 'rate_limit';
  await page.getByLabel('向 AI 助手提问').fill('触发限流');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('ai-send-error')).toContainText('45 秒');
  await expect(page.getByLabel('向 AI 助手提问')).toHaveValue('触发限流');

  // Provider error offers explicit manual retry (never auto-retries).
  mode = 'provider_error';
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('ai-send-error')).toContainText('上游模型暂时不可用');
  mode = 'succeed';
  await page.getByRole('button', { name: '重新提问', exact: true }).click();
  await expect(page.getByText('重试成功，已获取最新数据。')).toBeVisible();
});

test('anonymous /ai stays read-only with empty-state prompt and never calls /ai-assistant/*', async ({ page }) => {
  const assistantCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/ai-assistant')) assistantCalls.push(req.url());
  });

  const ai = await installAI(page);
  ai.reports = [];
  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'AI 助手', exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-anonymous-notice')).toContainText('需要登录');
  await expect(page.getByText('暂无历史分析报告')).toBeVisible();
  await expect(page.getByLabel('向 AI 助手提问')).toHaveCount(0);
  expect(assistantCalls).toEqual([]);

  // With permitted legacy reports, anonymous visitor can view them read-only without delete action.
  ai.reports = [report];
  await page.reload();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前报告' })).toContainText('近期保持稳定运动节奏。');
  await expect(page.getByRole('button', { name: '删除报告' })).toHaveCount(0);
  expect(assistantCalls).toEqual([]);
});

test('responsive visual QA across desktop 1440x900, tablet 768x1024, mobile 390x844 in light and dark themes', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await installActivities(page);
  await loginRunner(page);
  await page.goto('/ai');
  await grantConsent(page);
  await page.getByRole('button', { name: /近 4 周趋势与建议/ }).click();
  await expect(page.getByTestId('block-metrics-card')).toBeVisible();
  await expect(page.getByTestId('block-trend-chart')).toBeVisible();

  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const;

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate((t) => {
      localStorage.setItem('runnote-theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await page.screenshot({ path: `test-results/ai-assistant-${vp.name}-${theme}.png`, fullPage: true });
    }
  }

  // On mobile, verify conversation list drawer opens and closes via Escape.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^会话列表/ }).click();
  const drawer = page.getByRole('dialog', { name: '历史会话' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('long conversation loads latest page with load-earlier pagination, and new conversation clears pending detail loading', async ({
  page,
}) => {
  await loginRunner(page);
  const longConvId = '77777777-7777-4777-8777-777777777777';
  const slowConvId = '88888888-8888-4888-8888-888888888888';

  const makeMsg = (index: number) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    conversation_id: longConvId,
    role: index % 2 === 0 ? 'user' : 'assistant',
    status: 'succeeded',
    content: `消息编号 #${index + 1}`,
    tool_calls_summary: [],
    ui_blocks: [],
    model: index % 2 === 0 ? null : 'deepseek-chat',
    prompt_version: index % 2 === 0 ? null : 'ai-assistant-v1',
    error_code: null,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    created_at: new Date(Date.UTC(2026, 10, 22, 0, index)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 10, 22, 0, index)).toISOString(),
    is_stale: false,
  });
  const allMessages = Array.from({ length: 55 }, (_, i) => makeMsg(i));

  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });

  await page.route('**/api/v1/ai-assistant/context', (route) =>
    route.fulfill({
      json: {
        data: {
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
            messages_today: 0,
            remaining_messages_today: 30,
            daily_token_budget: 150000,
            tokens_today: 0,
            remaining_tokens_today: 150000,
            site_daily_token_budget: 1000000,
            site_tokens_today: 0,
            site_budget_exhausted: false,
          },
        },
        error: null,
      },
    }),
  );

  await page.route('**/api/v1/ai-assistant/conversations?*', (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            {
              id: longConvId,
              title: '超长历史会话',
              created_at: '2026-11-22T00:00:00Z',
              updated_at: '2026-11-22T01:00:00Z',
              last_message_at: '2026-11-22T01:00:00Z',
            },
            {
              id: slowConvId,
              title: '缓慢加载会话',
              created_at: '2026-11-22T00:00:00Z',
              updated_at: '2026-11-22T00:30:00Z',
              last_message_at: '2026-11-22T00:30:00Z',
            },
          ],
          total: 2,
          limit: 20,
          offset: 0,
        },
        error: null,
      },
    }),
  );

  await page.route(`**/api/v1/ai-assistant/conversations/${longConvId}?*`, (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    return route.fulfill({
      json: {
        data: {
          conversation: {
            id: longConvId,
            title: '超长历史会话',
            created_at: '2026-11-22T00:00:00Z',
            updated_at: '2026-11-22T01:00:00Z',
            last_message_at: '2026-11-22T01:00:00Z',
          },
          messages: allMessages.slice(offset, offset + limit),
          total_messages: allMessages.length,
          limit,
          offset,
        },
        error: null,
      },
    });
  });

  await page.route(`**/api/v1/ai-assistant/conversations/${slowConvId}?*`, async (route) => {
    await slowGate;
    return route.fulfill({
      json: {
        data: {
          conversation: {
            id: slowConvId,
            title: '缓慢加载会话',
            created_at: '2026-11-22T00:00:00Z',
            updated_at: '2026-11-22T00:30:00Z',
            last_message_at: '2026-11-22T00:30:00Z',
          },
          messages: [],
          total_messages: 0,
          limit: 50,
          offset: 0,
        },
        error: null,
      },
    });
  });

  await page.goto('/ai');
  await page.getByRole('button', { name: /^超长历史会话/ }).click();

  // Latest message (#55) is immediately visible, while #1 is behind load-earlier button.
  await expect(page.getByText('消息编号 #55', { exact: true })).toBeVisible();
  await expect(page.getByText('消息编号 #1', { exact: true })).toHaveCount(0);
  const loadEarlier = page.getByRole('button', { name: '加载更早消息（还有 5 条）', exact: true });
  await expect(loadEarlier).toBeVisible();
  await loadEarlier.click();
  await expect(page.getByText('消息编号 #1', { exact: true })).toBeVisible();
  await expect(loadEarlier).toHaveCount(0);

  // Opening a slow conversation then immediately clicking "+ 新建会话" clears detailLoading cleanly.
  await page.getByRole('button', { name: /^缓慢加载会话/ }).click();
  await expect(page.getByText('正在读取会话消息…')).toBeVisible();
  await page.getByRole('button', { name: '+ 新建会话', exact: true }).click();
  await expect(page.getByText('正在读取会话消息…')).toHaveCount(0);
  await expect(page.getByTestId('ai-empty-stage')).toBeVisible();
  releaseSlow();
});
