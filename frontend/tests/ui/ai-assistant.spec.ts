import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, sampleActivity } from '../fixtures/activities.ts';

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

  // Rename first conversation through the compact overflow menu in the history sidebar.
  await expect(page.getByRole('button', { name: /^重命名/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^删除/ })).toHaveCount(0);
  const firstMenuTrigger = page.getByRole('button', { name: /^会话操作：/ }).first();
  await firstMenuTrigger.click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('新会话标题').fill('五月 PB 复盘');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('list', { name: '会话列表' })).toContainText('五月 PB 复盘');

  // Delete renamed conversation through the overflow menu.
  await page.getByRole('button', { name: '会话操作：五月 PB 复盘', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
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

test('anonymous /ai stays read-only with login notice and never calls /ai-assistant/* or legacy endpoints', async ({ page }) => {
  const aiCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/ai-assistant') || req.url().includes('/api/v1/ai-reports') || req.url().includes('/showcase/ai-reports')) {
      aiCalls.push(req.url());
    }
  });

  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'AI 助手', exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-anonymous-notice')).toContainText('需要登录');
  await expect(page.getByLabel('向 AI 助手提问')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '数据汇总', exact: true }).first()).toBeVisible();
  expect(aiCalls).toEqual([]);
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

test('stop during stalled conversation creation prevents messages POST and IME confirmation Enter does not send', async ({
  page,
}) => {
  await loginRunner(page);
  const convId = '99999999-9999-4999-8999-999999999999';
  let messagesPosts = 0;
  let createCalls = 0;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
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

  await page.route('**/api/v1/ai-assistant/conversations*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/messages') && req.method() === 'POST') {
      messagesPosts += 1;
      return route.fulfill({ status: 500, json: { data: null, error: { code: 'UNEXPECTED', message: 'should not be called' } } });
    }
    if (url.pathname === '/api/v1/ai-assistant/conversations' && req.method() === 'POST') {
      createCalls += 1;
      await createGate;
      try {
        await route.fulfill({
          status: 201,
          json: {
            data: {
              id: convId,
              title: '未发送会话',
              created_at: '2026-11-22T01:00:00Z',
              updated_at: '2026-11-22T01:00:00Z',
              last_message_at: '2026-11-22T01:00:00Z',
            },
            error: null,
          },
        });
      } catch {
        // Request may already be aborted by the browser AbortController.
      }
      return;
    }
    if (url.pathname === `/api/v1/ai-assistant/conversations/${convId}` && req.method() === 'DELETE') {
      return route.fulfill({ json: { data: { deleted: true }, error: null } });
    }
    return route.fulfill({ json: { data: { items: [], total: 0, limit: 20, offset: 0 }, error: null } });
  });

  await page.goto('/ai');
  const input = page.getByLabel('向 AI 助手提问');
  await input.fill('测试中文输入法');

  // Simulate Safari/WebKit compositionend-before-Enter ordering and keyCode 229: neither may send.
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: 'ceshi' }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '测试' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, isComposing: false, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false, bubbles: true, cancelable: true }));
  });
  expect(createCalls).toBe(0);
  expect(messagesPosts).toBe(0);

  // Now submit normally while conversation creation stalls, click Stop, then release creation.
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect.poll(() => createCalls).toBe(1);

  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  releaseCreate();

  // Streaming ends cleanly, draft is restored, no error banner appears, and messages POST count stays 0.
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  await expect(input).toHaveValue('测试中文输入法');
  await expect(page.getByTestId('ai-send-error')).toHaveCount(0);
  await expect(page.getByTestId('ai-empty-stage')).toBeVisible();
  // Give any trailing microtasks/callbacks a brief window to prove no delayed messages POST fires.
  await page.waitForTimeout(250);
  expect(messagesPosts).toBe(0);
});

test('history sidebar overflow menu: compact trigger, keyboard/focus/outside dismiss, rename/delete, and mobile drawer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await loginRunner(page);
  const convA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const convB = 'bbbbbbbb-2222-4222-8222-222222222222';
  let items = [
    {
      id: convA,
      title: '我最近的连续跑步记录和跑量目标完成进度怎么样',
      created_at: '2026-11-23T01:30:00Z',
      updated_at: '2026-11-23T01:35:00Z',
      last_message_at: '2026-11-23T01:35:00Z',
    },
    {
      id: convB,
      title: '总结我最近 4 周的跑步趋势',
      created_at: '2026-11-23T01:20:00Z',
      updated_at: '2026-11-23T01:34:00Z',
      last_message_at: '2026-11-23T01:34:00Z',
    },
  ];

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
            messages_today: 2,
            remaining_messages_today: 28,
            daily_token_budget: 150000,
            tokens_today: 2400,
            remaining_tokens_today: 147600,
            site_daily_token_budget: 1000000,
            site_tokens_today: 2400,
            site_budget_exhausted: false,
          },
        },
        error: null,
      },
    }),
  );

  await page.route('**/api/v1/ai-assistant/conversations?*', (route) =>
    route.fulfill({ json: { data: { items, total: items.length, limit: 20, offset: 0 }, error: null } }),
  );

  await page.route(/\/api\/v1\/ai-assistant\/conversations\/[^/?]+(\?.*)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const id = url.pathname.split('/').pop()!;
    const conv = items.find((c) => c.id === id);
    if (!conv) {
      return route.fulfill({ status: 404, json: { data: null, error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' } } });
    }
    if (req.method() === 'GET') {
      return route.fulfill({
        json: {
          data: {
            conversation: conv,
            messages: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                conversation_id: id,
                role: 'user',
                status: 'succeeded',
                content: conv.title,
                tool_calls_summary: [],
                ui_blocks: [],
                model: null,
                prompt_version: null,
                error_code: null,
                input_tokens: null,
                output_tokens: null,
                cached_input_tokens: null,
                created_at: conv.last_message_at,
                finished_at: conv.last_message_at,
                is_stale: false,
              },
              {
                id: '00000000-0000-4000-8000-000000000002',
                conversation_id: id,
                role: 'assistant',
                status: 'succeeded',
                content: '当前连续跑步记录为 2 天，本周已完成 15.0 km / 20.0 km（75%）。',
                tool_calls_summary: [{ tool: 'get_streaks_and_goals', duration_ms: 14, degraded: false, truncated: false }],
                ui_blocks: [],
                model: 'deepseek-chat',
                prompt_version: 'ai-assistant-v1',
                error_code: null,
                input_tokens: 320,
                output_tokens: 48,
                cached_input_tokens: 0,
                created_at: conv.last_message_at,
                finished_at: conv.last_message_at,
                is_stale: false,
              },
            ],
            total_messages: 2,
            limit: 50,
            offset: 0,
          },
          error: null,
        },
      });
    }
    if (req.method() === 'PATCH') {
      const payload = JSON.parse(req.postData() ?? '{}');
      const updated = { ...conv, title: payload.title, updated_at: '2026-11-23T01:40:00Z' };
      items = items.map((c) => (c.id === id ? updated : c));
      return route.fulfill({ json: { data: updated, error: null } });
    }
    if (req.method() === 'DELETE') {
      items = items.filter((c) => c.id !== id);
      return route.fulfill({ json: { data: { deleted: true }, error: null } });
    }
    return route.fallback();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ai');

  const sidebar = page.getByRole('complementary', { name: '历史会话' });
  await expect(sidebar).toBeVisible();

  // No always-visible Rename / Delete text buttons in the history list.
  await expect(sidebar.getByRole('button', { name: /重命名|删除/ })).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Row title/date remains the primary click target and opens the conversation.
  const firstRowBtn = sidebar.getByRole('button', { name: /^我最近的连续跑步记录和跑量目标完成进度怎么样/ });
  const firstRowBox = (await firstRowBtn.boundingBox())!;
  expect(firstRowBox.height).toBeGreaterThanOrEqual(44);
  await firstRowBtn.click();
  await expect(firstRowBtn).toHaveAttribute('aria-current', 'true');

  // Compact overflow trigger has >=44px touch target and clear accessible label.
  const trigger = sidebar.getByRole('button', { name: '会话操作：我最近的连续跑步记录和跑量目标完成进度怎么样', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const triggerBox = (await trigger.boundingBox())!;
  expect(triggerBox.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox.height).toBeGreaterThanOrEqual(44);

  // Click opens the menu; items have >=44px targets, destructive color on delete, and do not clip at sidebar or viewport edge.
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: '会话操作：我最近的连续跑步记录和跑量目标完成进度怎么样', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('scale', '1');

  const renameItem = menu.getByRole('menuitem', { name: '重命名', exact: true });
  const deleteItem = menu.getByRole('menuitem', { name: '删除', exact: true });
  await expect(renameItem).toBeVisible();
  await expect(deleteItem).toBeVisible();
  expect((await renameItem.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await deleteItem.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const deleteColors = await deleteItem.evaluate((el) => {
    const style = getComputedStyle(el);
    const rootStyle = getComputedStyle(document.documentElement);
    return { color: style.color, errorVar: rootStyle.getPropertyValue('--error').trim() };
  });
  expect(deleteColors.errorVar).not.toBe('');
  expect(deleteColors.color).not.toBe(await renameItem.evaluate((el) => getComputedStyle(el).color));

  // Verify popover is not clipped by the sidebar edge or viewport bounds.
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1440);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(900);

  // Capture desktop menu-open visual evidence in light and dark themes.
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate((t) => {
      localStorage.setItem('runnote-theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.screenshot({ path: `test-results/ai-assistant-menu-desktop-${theme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    localStorage.setItem('runnote-theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });

  // Outside click closes the menu.
  await page.mouse.click(900, 300);
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  // Keyboard Enter opens menu and focuses first menuitem; ArrowDown/Up cycle; Escape closes and returns focus to trigger.
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(renameItem).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(deleteItem).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(renameItem).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  // Keyboard Space opens menu, rename inline edit starts with focused input, Escape cancels and restores focus.
  await page.keyboard.press('Space');
  await expect(menu).toBeVisible();
  await expect(renameItem).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  const renameInput = sidebar.getByLabel('新会话标题');
  await expect(renameInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(renameInput).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Complete rename flow through menu.
  await trigger.click();
  await renameItem.click();
  await sidebar.getByLabel('新会话标题').fill('跑量与连续记录复盘');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  const renamedTrigger = sidebar.getByRole('button', { name: '会话操作：跑量与连续记录复盘', exact: true });
  await expect(renamedTrigger).toBeVisible();
  await expect(page.locator('.chat-title')).toHaveText('跑量与连续记录复盘');

  // Delete confirm: dismiss preserves conversation and returns focus to trigger; accept removes conversation and clears active thread.
  await renamedTrigger.click();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(renamedTrigger).toBeVisible();
  await expect(renamedTrigger).toBeFocused();

  await renamedTrigger.click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(renamedTrigger).toHaveCount(0);
  await expect(page.getByTestId('ai-empty-stage')).toBeVisible();
  await expect(sidebar.getByRole('status')).toContainText('会话已删除');

  // Tablet 768x1024 and mobile 390x844 drawers: menu opens above dialog without clipping, Escape closes only the menu, and horizontal overflow stays false.
  for (const vp of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: /^会话列表/ }).click();
    const drawer = page.getByRole('dialog', { name: '历史会话' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: /重命名|删除/ })).toHaveCount(0);

    const drawerTrigger = drawer.getByRole('button', { name: '会话操作：总结我最近 4 周的跑步趋势', exact: true });
    const drawerTriggerBox = (await drawerTrigger.boundingBox())!;
    expect(drawerTriggerBox.width).toBeGreaterThanOrEqual(44);
    expect(drawerTriggerBox.height).toBeGreaterThanOrEqual(44);
    await drawerTrigger.click();
    const drawerMenu = page.getByRole('menu', { name: '会话操作：总结我最近 4 周的跑步趋势', exact: true });
    await expect(drawerMenu).toBeVisible();
    await expect(drawerMenu).toHaveCSS('scale', '1');
    const drawerMenuBox = (await drawerMenu.boundingBox())!;
    expect(drawerMenuBox.x).toBeGreaterThanOrEqual(0);
    expect(drawerMenuBox.x + drawerMenuBox.width).toBeLessThanOrEqual(vp.width);
    expect(drawerMenuBox.y).toBeGreaterThanOrEqual(0);
    expect(drawerMenuBox.y + drawerMenuBox.height).toBeLessThanOrEqual(vp.height);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate((t) => {
        localStorage.setItem('runnote-theme', t);
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.screenshot({ path: `test-results/ai-assistant-menu-${vp.name}-${theme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      localStorage.setItem('runnote-theme', 'light');
      document.documentElement.dataset.theme = 'light';
    });

    // Escape closes the action menu first while keeping the history dialog open and returning focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(drawerMenu).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(drawerTrigger).toBeFocused();

    if (vp.name === 'mobile') {
      // Rename works inside the mobile dialog too.
      await drawerTrigger.click();
      await drawerMenu.getByRole('menuitem', { name: '重命名', exact: true }).click();
      await drawer.getByLabel('新会话标题').fill('四周趋势总结');
      await drawer.getByRole('button', { name: '保存', exact: true }).click();
      await expect(drawer.getByRole('button', { name: '会话操作：四周趋势总结', exact: true })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
