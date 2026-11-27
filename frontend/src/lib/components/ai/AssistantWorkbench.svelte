<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import {
    AssistantError,
    cancelAssistantMessage,
    createConversation,
    deleteConversation,
    listConversations,
    readAssistantContext,
    readConversation,
    renameConversation,
    streamAssistantMessage,
    updateAssistantConsent,
    type AssistantContext,
    type ConversationList,
    type ConversationView,
    type MessageView,
    type StreamEvent,
  } from '#lib/api/ai-assistant.ts';
  import { QUICK_PROMPTS } from '#lib/ai/quick-prompts.ts';
  import { createComposerImeGuard } from '#lib/ai/composer-ime.ts';
  import FeedbackState from '../FeedbackState.svelte';
  import PageSkeleton from '../PageSkeleton.svelte';
  import AssistantConsentCard from './AssistantConsentCard.svelte';
  import AssistantMarkdown from './AssistantMarkdown.svelte';
  import AssistantBlocks from './AssistantBlocks.svelte';
  import ConversationActionMenu from './ConversationActionMenu.svelte';

  const view = useViewContext();
  const fetcher = view.fetch;

  const TOOL_LABELS: Record<string, string> = {
    get_running_summary: '查询跑步汇总数据',
    get_running_trends: '分析跑量与配速趋势',
    get_period_report: '读取周期统计报告',
    compare_periods: '对比两个时期的跑步数据',
    get_personal_records: '查询个人最佳与历史总览',
    get_streaks_and_goals: '查询连续记录与跑量目标',
    search_activities: '检索跑步记录摘要',
    get_activity_detail: '查看单次跑步权威指标',
    get_footprint_summary: '汇总省市与全球跑步足迹',
    get_frequent_routes: '查询常跑路线统计',
  };

  interface LiveToolStep {
    tool: string;
    label: string;
    done: boolean;
    durationMs?: number;
    degraded?: boolean;
    truncated?: boolean;
    ok?: boolean;
  }

  let context = $state<AssistantContext | null>(null);
  let contextLoading = $state(true);
  let contextError = $state('');

  let conversations = $state<ConversationList | null>(null);
  let listLoading = $state(false);
  let listError = $state('');

  let activeId = $state<string | null>(null);
  let activeConversation = $state<ConversationView | null>(null);
  let messages = $state<MessageView[]>([]);
  let messagesOffset = $state(0);
  let totalMessages = $state(0);
  let detailLoading = $state(false);
  let earlierLoading = $state(false);
  let detailError = $state('');

  let streaming = $state(false);
  let activeStreamConvId = $state<string | null>(null);
  let activeStreamMsgId = $state<string | null>(null);
  let streamStatus = $state('');
  let liveTools = $state<LiveToolStep[]>([]);
  let truncatedMsgIds = $state<Record<string, boolean>>({});
  let streamAbort: AbortController | null = null;
  let stopRequested = false;

  let draft = $state('');
  const imeGuard = createComposerImeGuard();
  let sendError = $state('');
  let sendErrorCode = $state('');
  let pendingRetry = $state<{ conversationId: string; content: string; key: string } | null>(null);
  let lastFailedPrompt = $state<string | null>(null);

  let consentBusy = $state(false);
  let consentError = $state('');
  let consentNotice = $state('');
  let consentDialogOpen = $state(false);
  let historyDialogOpen = $state(false);

  let sidebarCollapsed = $state(false);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let convBusy = $state(false);
  let convNotice = $state('');
  let convError = $state('');

  let sidebarEl = $state<HTMLElement | undefined>();
  let historyDialog = $state<HTMLDialogElement | undefined>();
  let consentDialog = $state<HTMLDialogElement | undefined>();
  let composerInput = $state<HTMLTextAreaElement | undefined>();
  let threadBottom = $state<HTMLDivElement | undefined>();

  let disposed = false;
  let contextToken = 0;
  let listToken = 0;
  let detailToken = 0;

  const canSend = $derived(
    !!context &&
      context.configured &&
      context.enabled &&
      context.consent.consented &&
      !context.quota.site_budget_exhausted &&
      context.quota.remaining_messages_today > 0 &&
      context.quota.remaining_tokens_today > 0 &&
      !streaming,
  );

  const unavailableReason = $derived.by(() => {
    if (!context) return '';
    if (!context.configured) return 'AI 助手尚未配置，历史会话仍可只读查看；运动记录和统计不受影响。';
    if (!context.enabled) return 'AI 助手暂未开启，历史会话仍可只读查看。';
    if (context.quota.site_budget_exhausted) return '今日站点 AI 额度已达上限，将于明日恢复。';
    if (context.quota.remaining_messages_today <= 0) return '今日个人提问次数已达上限（按 UTC 日期重置）。';
    if (context.quota.remaining_tokens_today <= 0) return '今日个人 AI 额度已用完（按 UTC 日期重置）。';
    return '';
  });

  function handleAuthExpired() {
    disposed = true;
    streamAbort?.abort();
    streamAbort = null;
    context = null;
    conversations = null;
    messages = [];
    activeConversation = null;
    const next = encodeURIComponent(window.location.pathname);
    window.location.replace(`/admin?reason=expired&next=${next}`);
  }

  function errorMessage(cause: unknown, fallback = '操作失败，请稍后重试'): string {
    if (cause instanceof AssistantError && cause.status === 401) {
      handleAuthExpired();
      return '';
    }
    return cause instanceof Error ? cause.message : fallback;
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function formatTokens(n: number): string {
    if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function scrollThreadToBottom() {
    void tick().then(() => {
      if (disposed) return;
      threadBottom?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }

  async function loadContext(silent = false) {
    const token = ++contextToken;
    if (!silent) {
      contextLoading = true;
      contextError = '';
    }
    try {
      const value = await readAssistantContext(fetcher);
      if (!disposed && token === contextToken) context = value;
    } catch (cause) {
      if (!disposed && token === contextToken && !silent) contextError = errorMessage(cause, '暂时无法读取 AI 助手状态');
    } finally {
      if (!disposed && token === contextToken && !silent) contextLoading = false;
    }
  }

  async function loadConversations(offset = 0, append = false) {
    const token = ++listToken;
    listLoading = true;
    listError = '';
    try {
      const result = await listConversations(offset, 20, fetcher);
      if (!disposed && token === listToken) {
        if (append && conversations) {
          const seen = new Set(conversations.items.map((c) => c.id));
          const merged = [...conversations.items, ...result.items.filter((c) => !seen.has(c.id))];
          conversations = { ...result, items: merged };
        } else {
          conversations = result;
        }
      }
    } catch (cause) {
      if (!disposed && token === listToken) listError = errorMessage(cause, '暂时无法读取会话列表');
    } finally {
      if (!disposed && token === listToken) listLoading = false;
    }
  }

  const MESSAGE_PAGE_SIZE = 50;

  async function openConversation(id: string) {
    if (streaming) return;
    const token = ++detailToken;
    activeId = id;
    detailLoading = true;
    earlierLoading = false;
    detailError = '';
    sendError = '';
    sendErrorCode = '';
    pendingRetry = null;
    lastFailedPrompt = null;
    convError = '';
    historyDialog?.close();
    try {
      let detail = await readConversation(id, 0, MESSAGE_PAGE_SIZE, fetcher);
      if (disposed || token !== detailToken) return;
      // Backend orders messages oldest-first; jump to the latest page when history exceeds one page.
      if (detail.total_messages > detail.messages.length) {
        const latestOffset = Math.max(0, detail.total_messages - MESSAGE_PAGE_SIZE);
        detail = await readConversation(id, latestOffset, MESSAGE_PAGE_SIZE, fetcher);
        if (disposed || token !== detailToken) return;
      }
      activeConversation = detail.conversation;
      messages = detail.messages;
      messagesOffset = detail.offset;
      totalMessages = detail.total_messages;
      scrollThreadToBottom();
    } catch (cause) {
      if (!disposed && token === detailToken) detailError = errorMessage(cause, '暂时无法读取该会话');
    } finally {
      if (!disposed && token === detailToken) detailLoading = false;
    }
  }

  async function loadEarlierMessages() {
    if (!activeId || earlierLoading || detailLoading || streaming || messagesOffset <= 0) return;
    const token = detailToken;
    const targetId = activeId;
    const nextOffset = Math.max(0, messagesOffset - MESSAGE_PAGE_SIZE);
    const nextLimit = messagesOffset - nextOffset;
    earlierLoading = true;
    detailError = '';
    try {
      const earlier = await readConversation(targetId, nextOffset, nextLimit, fetcher);
      if (disposed || token !== detailToken) return;
      const existingIds = new Set(messages.map((m) => m.id));
      const prepended = earlier.messages.filter((m) => !existingIds.has(m.id));
      messages = [...prepended, ...messages];
      messagesOffset = earlier.offset;
      totalMessages = Math.max(totalMessages, earlier.total_messages);
    } catch (cause) {
      if (!disposed && token === detailToken) detailError = errorMessage(cause, '暂时无法加载更早的消息');
    } finally {
      if (!disposed && token === detailToken) earlierLoading = false;
    }
  }

  function startNewConversation() {
    if (streaming) return;
    ++detailToken;
    detailLoading = false;
    earlierLoading = false;
    activeId = null;
    activeConversation = null;
    messages = [];
    messagesOffset = 0;
    totalMessages = 0;
    detailError = '';
    sendError = '';
    sendErrorCode = '';
    pendingRetry = null;
    lastFailedPrompt = null;
    historyDialog?.close();
    void tick().then(() => composerInput?.focus());
  }

  async function handleConsentChange(consented: boolean) {
    if (consentBusy) return;
    consentBusy = true;
    consentError = '';
    consentNotice = '';
    try {
      const updated = await updateAssistantConsent(consented, fetcher);
      if (disposed) return;
      if (context) context = { ...context, consent: updated };
      consentNotice = consented ? '已同意数据使用说明，可以开始提问。' : '已撤回数据使用同意。历史会话仍可只读查看。';
      if (consented) {
        consentDialog?.close();
        void tick().then(() => composerInput?.focus());
      }
    } catch (cause) {
      if (!disposed) consentError = errorMessage(cause, '更新同意状态失败，请重试');
    } finally {
      if (!disposed) consentBusy = false;
    }
  }

  function activeHistoryContainer(): HTMLElement | undefined {
    return historyDialog?.open ? historyDialog : sidebarEl;
  }

  function beginRename(conv: ConversationView) {
    renamingId = conv.id;
    renameDraft = conv.title || '新会话';
    convError = '';
    void tick().then(() => {
      if (disposed || renamingId !== conv.id) return;
      const input = activeHistoryContainer()?.querySelector<HTMLInputElement>('input.rename-input');
      input?.focus();
      input?.select();
    });
  }

  function cancelRename(convId?: string) {
    renamingId = null;
    convError = '';
    if (!convId) return;
    void tick().then(() => {
      if (disposed) return;
      const row = activeHistoryContainer()?.querySelector<HTMLElement>(`.conv-item[data-conv-id="${convId}"]`);
      row?.querySelector<HTMLButtonElement>('.conv-menu-trigger')?.focus();
    });
  }

  async function submitRename(convId: string) {
    if (convBusy) return;
    const cleaned = renameDraft.trim();
    if (!cleaned) {
      convError = '会话标题不能为空';
      return;
    }
    convBusy = true;
    convError = '';
    try {
      const updated = await renameConversation(convId, cleaned, fetcher);
      if (disposed) return;
      renamingId = null;
      if (conversations) {
        conversations = {
          ...conversations,
          items: conversations.items.map((item) => (item.id === convId ? updated : item)),
        };
      }
      if (activeConversation?.id === convId) activeConversation = updated;
    } catch (cause) {
      if (!disposed) convError = errorMessage(cause, '重命名失败');
    } finally {
      if (!disposed) convBusy = false;
    }
  }

  async function removeConversation(conv: ConversationView) {
    if (convBusy || streaming) return;
    if (!window.confirm(`删除会话“${conv.title || '未命名会话'}”？消息内容将立即清空，当日已用额度不返还。`)) return;
    convBusy = true;
    convError = '';
    convNotice = '';
    try {
      await deleteConversation(conv.id, fetcher);
      if (disposed) return;
      if (conversations) {
        conversations = {
          ...conversations,
          items: conversations.items.filter((item) => item.id !== conv.id),
          total: Math.max(0, conversations.total - 1),
        };
      }
      if (activeId === conv.id) {
        activeId = null;
        activeConversation = null;
        messages = [];
        messagesOffset = 0;
        totalMessages = 0;
      }
      convNotice = '会话已删除，已使用的当日额度不返还。';
    } catch (cause) {
      if (!disposed) convError = errorMessage(cause, '删除会话失败');
    } finally {
      if (!disposed) convBusy = false;
    }
  }

  async function sendMessage(rawText?: string, replay?: { conversationId: string; content: string; key: string }) {
    const text = (replay?.content ?? rawText ?? draft).trim();
    if (!text || !context || streaming) return;
    if (!context.consent.consented) {
      draft = text;
      return;
    }
    if (!canSend) return;

    sendError = '';
    sendErrorCode = '';
    convNotice = '';
    consentNotice = '';
    lastFailedPrompt = null;
    if (!replay) {
      pendingRetry = null;
      draft = '';
    }

    streaming = true;
    streamStatus = '正在连接助手…';
    liveTools = [];
    stopRequested = false;
    const controller = new AbortController();
    streamAbort = controller;

    const cleanupOrphanConversation = (orphanId: string) => {
      void deleteConversation(orphanId, fetcher).catch(() => {
        /* Best-effort cleanup so stopped or unmounted creation does not leave an orphan empty conversation. */
      });
    };

    let convId = replay?.conversationId ?? activeId;
    let createdConvId: string | null = null;
    try {
      if (!convId) {
        const created = await createConversation(text.slice(0, 40), fetcher, controller.signal);
        if (disposed || stopRequested || controller.signal.aborted) {
          cleanupOrphanConversation(created.id);
          if (!disposed) {
            streaming = false;
            streamAbort = null;
            stopRequested = false;
            streamStatus = '';
            if (!replay) draft = text;
          }
          return;
        }
        createdConvId = created.id;
        convId = created.id;
        activeId = created.id;
        activeConversation = created;
        if (conversations) {
          conversations = {
            ...conversations,
            items: [created, ...conversations.items.filter((c) => c.id !== created.id)],
            total: conversations.total + 1,
          };
        } else {
          conversations = { items: [created], total: 1, limit: 20, offset: 0 };
        }
      }
    } catch (cause) {
      if (!disposed) {
        streaming = false;
        streamAbort = null;
        stopRequested = false;
        streamStatus = '';
        if (!replay) draft = text;
        if (!(cause instanceof AssistantError && cause.code === 'ABORTED')) {
          sendError = errorMessage(cause, '无法创建会话，请稍后重试');
        }
      }
      return;
    }

    if (disposed || stopRequested || controller.signal.aborted) {
      if (createdConvId) cleanupOrphanConversation(createdConvId);
      if (!disposed) {
        streaming = false;
        streamAbort = null;
        stopRequested = false;
        streamStatus = '';
        if (!replay) draft = text;
      }
      return;
    }

    const requestKey = replay?.key ?? crypto.randomUUID();
    const nowIso = new Date().toISOString();
    let userMsgId = `local-user-${requestKey}`;
    let assistantMsgId = `local-asst-${requestKey}`;

    activeStreamConvId = convId;
    activeStreamMsgId = null;

    if (!replay) {
      messages = [
        ...messages,
        {
          id: userMsgId,
          conversation_id: convId,
          role: 'user',
          status: 'succeeded',
          content: text,
          tool_calls_summary: [],
          ui_blocks: [],
          model: null,
          prompt_version: null,
          error_code: null,
          input_tokens: null,
          output_tokens: null,
          cached_input_tokens: null,
          created_at: nowIso,
          finished_at: nowIso,
          is_stale: false,
        },
        {
          id: assistantMsgId,
          conversation_id: convId,
          role: 'assistant',
          status: 'streaming',
          content: '',
          tool_calls_summary: [],
          ui_blocks: [],
          model: context.model,
          prompt_version: null,
          error_code: null,
          input_tokens: null,
          output_tokens: null,
          cached_input_tokens: null,
          created_at: nowIso,
          finished_at: null,
          is_stale: false,
        },
      ];
    } else {
      // Replay reuses the last assistant placeholder or appends one if cleared.
      const last = messages.at(-1);
      if (last && last.role === 'assistant' && last.status !== 'succeeded') {
        assistantMsgId = last.id;
        messages = messages.map((m) =>
          m.id === assistantMsgId ? { ...m, status: 'streaming', content: '', ui_blocks: [], error_code: null } : m,
        );
      } else {
        messages = [
          ...messages,
          {
            id: assistantMsgId,
            conversation_id: convId,
            role: 'assistant',
            status: 'streaming',
            content: '',
            tool_calls_summary: [],
            ui_blocks: [],
            model: context.model,
            prompt_version: null,
            error_code: null,
            input_tokens: null,
            output_tokens: null,
            cached_input_tokens: null,
            created_at: nowIso,
            finished_at: null,
            is_stale: false,
          },
        ];
      }
    }
    scrollThreadToBottom();

    const updateAssistant = (patcher: (msg: MessageView) => MessageView) => {
      messages = messages.map((msg) => (msg.id === assistantMsgId ? patcher(msg) : msg));
    };

    const handleEvent = (event: StreamEvent) => {
      if (disposed) return;
      switch (event.event) {
        case 'meta': {
          const oldUserId = userMsgId;
          const oldAsstId = assistantMsgId;
          userMsgId = event.data.user_message_id;
          assistantMsgId = event.data.assistant_message_id;
          activeStreamMsgId = assistantMsgId;
          const nextMessages: MessageView[] = [];
          const seen = new Set<string>();
          for (const msg of messages) {
            const next =
              msg.id === oldUserId
                ? { ...msg, id: userMsgId }
                : msg.id === oldAsstId
                  ? { ...msg, id: assistantMsgId }
                  : msg;
            if (!seen.has(next.id)) {
              seen.add(next.id);
              nextMessages.push(next);
            }
          }
          messages = nextMessages;
          if (context) {
            context = {
              ...context,
              quota: {
                ...context.quota,
                remaining_messages_today: event.data.remaining_messages_today,
                remaining_tokens_today: event.data.remaining_tokens_today,
              },
            };
          }
          break;
        }
        case 'status': {
          streamStatus = event.data.message;
          break;
        }
        case 'tool_start': {
          streamStatus = `${event.data.label}…`;
          liveTools = [...liveTools, { tool: event.data.tool, label: event.data.label, done: false }];
          break;
        }
        case 'tool_end': {
          let matched = false;
          liveTools = liveTools.map((step) => {
            if (!matched && step.tool === event.data.tool && !step.done) {
              matched = true;
              return {
                ...step,
                done: true,
                durationMs: event.data.duration_ms,
                degraded: event.data.degraded,
                truncated: event.data.truncated,
                ok: event.data.ok,
              };
            }
            return step;
          });
          if (!matched) {
            liveTools = [
              ...liveTools,
              {
                tool: event.data.tool,
                label: event.data.label,
                done: true,
                durationMs: event.data.duration_ms,
                degraded: event.data.degraded,
                truncated: event.data.truncated,
                ok: event.data.ok,
              },
            ];
          }
          streamStatus = '正在整理回答…';
          break;
        }
        case 'block': {
          updateAssistant((msg) => ({ ...msg, ui_blocks: [...msg.ui_blocks, event.data] }));
          scrollThreadToBottom();
          break;
        }
        case 'delta': {
          streamStatus = '';
          updateAssistant((msg) => ({ ...msg, content: (msg.content ?? '') + event.data.text }));
          scrollThreadToBottom();
          break;
        }
        case 'error': {
          sendError = event.data.message;
          sendErrorCode = event.data.code;
          if (event.data.retryable) lastFailedPrompt = text;
          updateAssistant((msg) => ({ ...msg, status: 'failed', error_code: event.data.code }));
          break;
        }
        case 'done': {
          const finalTools = liveTools.map((step) => ({
            tool: step.tool,
            duration_ms: step.durationMs ?? 0,
            degraded: step.degraded ?? false,
            truncated: step.truncated ?? false,
          }));
          if (event.data.is_truncated) {
            truncatedMsgIds = { ...truncatedMsgIds, [event.data.message_id]: true };
          }
          updateAssistant((msg) => ({
            ...msg,
            id: event.data.message_id,
            status: event.data.status,
            error_code: event.data.error_code ?? msg.error_code,
            tool_calls_summary: finalTools.length ? finalTools : msg.tool_calls_summary,
            input_tokens: event.data.usage.input_tokens,
            output_tokens: event.data.usage.output_tokens,
            cached_input_tokens: event.data.usage.cached_input_tokens,
            finished_at: new Date().toISOString(),
          }));
          if (event.data.status === 'failed') lastFailedPrompt = text;
          pendingRetry = null;
          break;
        }
        case 'ping':
          break;
      }
    };

    try {
      const { receivedDone } = await streamAssistantMessage(
        convId,
        text,
        requestKey,
        handleEvent,
        controller.signal,
        fetcher,
      );
      if (disposed) return;
      if (!receivedDone) {
        pendingRetry = { conversationId: convId, content: text, key: requestKey };
        sendError = '流式响应意外提前结束，结果尚未确认。可同步最新会话记录，或按原请求标识重试。';
        sendErrorCode = 'STREAM_INTERRUPTED';
        updateAssistant((msg) => (msg.status === 'streaming' ? { ...msg, status: 'failed', error_code: 'STREAM_INTERRUPTED' } : msg));
      } else {
        void loadConversations(0);
      }
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof AssistantError && cause.code === 'ABORTED') {
        updateAssistant((msg) => (msg.status === 'streaming' ? { ...msg, status: 'cancelled' } : msg));
      } else if (cause instanceof AssistantError && cause.status === 401) {
        handleAuthExpired();
        return;
      } else {
        const msgText = errorMessage(cause, '请求失败，请稍后重试');
        const code = cause instanceof AssistantError ? cause.code : 'REQUEST_FAILED';
        sendError = msgText;
        sendErrorCode = code;
        if (code === 'NETWORK_ERROR' || code === 'STREAM_INTERRUPTED') {
          pendingRetry = { conversationId: convId, content: text, key: requestKey };
        } else if (code === 'AI_PROVIDER_ERROR' || code === 'AI_TIMEOUT' || code === 'AI_OUTPUT_INVALID') {
          lastFailedPrompt = text;
        } else if (code === 'AI_IN_PROGRESS' || code === 'AI_RATE_LIMITED' || code === 'AI_QUOTA_EXCEEDED' || code === 'AI_BUDGET_EXHAUSTED') {
          // Preserve unsent draft when rejected before running.
          if (!replay && !messages.some((m) => m.id === assistantMsgId && m.content)) {
            draft = text;
            messages = messages.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId);
          }
        }
        updateAssistant((m) => (m.status === 'streaming' ? { ...m, status: 'failed', error_code: code } : m));
      }
    } finally {
      if (!disposed) {
        streaming = false;
        streamAbort = null;
        stopRequested = false;
        activeStreamConvId = null;
        activeStreamMsgId = null;
        streamStatus = '';
        liveTools = [];
        void loadContext(true);
      }
    }
  }

  async function stopStreaming() {
    if (!streaming) return;
    stopRequested = true;
    const convId = activeStreamConvId;
    const msgId = activeStreamMsgId;
    streamStatus = '正在停止生成…';
    if (convId && msgId) {
      // Tell backend explicitly before aborting so upstream stream terminates immediately.
      void cancelAssistantMessage(convId, msgId, fetcher).catch(() => {
        /* Abort below still cancels the stream and backend disconnect handler persists cancelled. */
      });
    }
    streamAbort?.abort();
  }

  function handleQuickPrompt(prompt: string) {
    if (streaming) return;
    if (!context?.consent.consented) {
      draft = prompt;
      return;
    }
    if (!canSend) return;
    void sendMessage(prompt);
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (imeGuard.shouldSubmitOnKeydown(event)) {
      event.preventDefault();
      if (canSend && draft.trim()) void sendMessage();
    }
  }

  function toolDisplayLabel(entry: Record<string, unknown>): string {
    const name = typeof entry.tool === 'string' ? entry.tool : '';
    const base = TOOL_LABELS[name] ?? '查询运动数据';
    const ms = typeof entry.duration_ms === 'number' ? ` ${entry.duration_ms}ms` : '';
    const suffix = entry.degraded === true ? '（降级）' : entry.truncated === true ? '（已截断）' : '';
    return `${base}${ms}${suffix}`;
  }

  onMount(() => {
    void Promise.allSettled([loadContext(false), loadConversations(0)]);
    return () => {
      disposed = true;
      contextToken++;
      listToken++;
      detailToken++;
      stopRequested = true;
      streamAbort?.abort();
      streamAbort = null;
      imeGuard.reset();
      context = null;
      conversations = null;
      messages = [];
      activeConversation = null;
    };
  });
</script>

{#snippet historyPanelContent(scope: 'sidebar' | 'dialog')}
  <div class="history-top">
    <button type="button" class="button-primary new-chat-btn" disabled={streaming} onclick={startNewConversation}>
      + 新建会话
    </button>
  </div>
  {#if convError}
    <FeedbackState kind="error" title={convError} />
  {/if}
  {#if convNotice}
    <p role="status" class="sidebar-notice">{convNotice}</p>
  {/if}
  {#if listLoading && !conversations}
    <FeedbackState kind="loading" title="正在读取会话…" />
  {:else if listError}
    <FeedbackState kind="error" title={listError}>
      <button type="button" class="button-secondary button-compact" onclick={() => void loadConversations(0)}>重试</button>
    </FeedbackState>
  {:else if conversations && conversations.items.length === 0}
    <p class="sidebar-empty">暂无历史会话，点击快捷提问或下方输入框即可开始。</p>
  {:else if conversations}
    <ul class="conv-list" aria-label="会话列表">
      {#each conversations.items as conv (conv.id)}
        <li class="conv-item" class:active={conv.id === activeId} data-conv-id={conv.id}>
          {#if renamingId === conv.id}
            <form
              class="rename-form"
              onsubmit={(event) => {
                event.preventDefault();
                void submitRename(conv.id);
              }}
            >
              <label class="sr-only" for={`rename-${scope}-${conv.id}`}>新会话标题</label>
              <input
                id={`rename-${scope}-${conv.id}`}
                class="text-field rename-input"
                bind:value={renameDraft}
                maxlength="120"
                disabled={convBusy}
                required
                onkeydown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRename(conv.id);
                  }
                }}
              />
              <div class="rename-actions">
                <button type="submit" class="button-secondary button-compact" disabled={convBusy}>保存</button>
                <button type="button" class="button-secondary button-compact" disabled={convBusy} onclick={() => cancelRename(conv.id)}>取消</button>
              </div>
            </form>
          {:else}
            <button
              type="button"
              class="conv-open"
              aria-current={conv.id === activeId ? 'true' : undefined}
              disabled={streaming}
              onclick={() => void openConversation(conv.id)}
            >
              <span class="conv-title">{conv.title || '未命名会话'}</span>
              <span class="conv-time">{formatTime(conv.last_message_at)}</span>
            </button>
            <ConversationActionMenu
              title={conv.title || '未命名会话'}
              disabled={streaming || convBusy}
              onrename={() => beginRename(conv)}
              ondelete={() => void removeConversation(conv)}
            />
          {/if}
        </li>
      {/each}
    </ul>
    {#if conversations.items.length < conversations.total}
      <button
        type="button"
        class="button-secondary button-compact load-more"
        disabled={listLoading}
        onclick={() => void loadConversations(conversations!.items.length, true)}
      >
        {listLoading ? '加载中…' : `加载更多（共 ${conversations.total} 个）`}
      </button>
    {/if}
  {/if}
{/snippet}

{#if contextLoading}
  <div class="section-rule"><PageSkeleton title="正在加载 AI 助手…" /></div>
{:else if contextError && !context}
  <div class="section-rule">
    <FeedbackState kind="error" title={contextError}>
      <button type="button" class="button-secondary" onclick={() => void loadContext(false)}>重试读取</button>
    </FeedbackState>
  </div>
{:else if context}
  <div class="section-rule assistant-layout" class:sidebar-collapsed={sidebarCollapsed} data-testid="ai-assistant-workbench">
    <aside bind:this={sidebarEl} class="history-sidebar" aria-label="历史会话">
      <div class="sidebar-header">
        <h2>历史会话</h2>
        <button
          type="button"
          class="button-secondary button-compact"
          aria-expanded={!sidebarCollapsed}
          onclick={() => { sidebarCollapsed = true; }}
        >
          收起
        </button>
      </div>
      {@render historyPanelContent('sidebar')}
    </aside>

    <section class="chat-shell" aria-label="AI 跑步助手对话">
      <div class="chat-toolbar">
        <div class="toolbar-left">
          <button
            type="button"
            class="button-secondary button-compact mobile-history-btn"
            onclick={() => {
              historyDialogOpen = true;
              historyDialog?.showModal();
            }}
          >
            会话列表{#if conversations && conversations.total > 0}（{conversations.total}）{/if}
          </button>
          {#if sidebarCollapsed}
            <button
              type="button"
              class="button-secondary button-compact desktop-expand-btn"
              onclick={() => { sidebarCollapsed = false; }}
            >
              展开历史
            </button>
          {/if}
          <button type="button" class="button-secondary button-compact mobile-new-btn" disabled={streaming} onclick={startNewConversation}>
            新建会话
          </button>
          <span class="chat-title">{activeConversation?.title || '新会话'}</span>
        </div>

        <div class="toolbar-right">
          <span class="quota-pill" data-testid="ai-quota-pill">
            今日剩余 {context.quota.remaining_messages_today}/{context.quota.daily_message_limit} 次
            · 额度 {formatTokens(context.quota.remaining_tokens_today)}
          </span>
          <button
            type="button"
            class="button-secondary button-compact"
            onclick={() => {
              consentDialogOpen = true;
              consentDialog?.showModal();
            }}
          >
            隐私与同意
          </button>
        </div>
      </div>

      {#if consentNotice}
        <FeedbackState kind="success" title={consentNotice} />
      {/if}

      {#if unavailableReason}
        <div class="status-strip unavailable-banner" data-tone="warning" role="note" data-testid="ai-unavailable-banner">
          <p>{unavailableReason}</p>
          <div class="unavailable-links">
            <a class="button-secondary button-compact" href={view.href('/dashboard')}>数据汇总</a>
            <a class="button-secondary button-compact" href={view.href('/records')}>个人记录</a>
          </div>
        </div>
      {/if}

      {#if detailLoading}
        <FeedbackState kind="loading" title="正在读取会话消息…" />
      {:else if detailError}
        <FeedbackState kind="error" title={detailError}>
          <button
            type="button"
            class="button-secondary"
            onclick={() => {
              if (activeId) void openConversation(activeId);
            }}
          >
            重试读取会话
          </button>
        </FeedbackState>
      {:else}
        <div class="thread" role="log" aria-live="polite" aria-relevant="additions" aria-label="对话消息记录">
          {#if messages.length === 0}
            <div class="empty-stage" data-testid="ai-empty-stage">
              <h2>问问你的跑步数据</h2>
              <div class="prompt-grid" role="group" aria-label="快捷提问">
                {#each QUICK_PROMPTS as item (item.id)}
                  <button
                    type="button"
                    class="prompt-pill"
                    disabled={streaming || !context.configured || !context.enabled || context.quota.site_budget_exhausted}
                    onclick={() => handleQuickPrompt(item.prompt)}
                  >
                    <span class="prompt-label">{item.label}</span>
                    <span class="prompt-text">{item.prompt}</span>
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            {#if messagesOffset > 0}
              <div class="earlier-bar">
                <button
                  type="button"
                  class="button-secondary button-compact"
                  disabled={earlierLoading || streaming}
                  onclick={() => void loadEarlierMessages()}
                >
                  {earlierLoading ? '正在加载更早消息…' : `加载更早消息（还有 ${messagesOffset} 条）`}
                </button>
              </div>
            {/if}
            {#each messages as msg (msg.id)}
              <article class="msg" class:msg-user={msg.role === 'user'} class:msg-assistant={msg.role === 'assistant'} data-role={msg.role} data-status={msg.status}>
                {#if msg.role === 'user'}
                  <div class="user-bubble">
                    <p>{msg.content ?? ''}</p>
                  </div>
                {:else}
                  <div class="assistant-body">
                    {#if msg.status === 'streaming' && (streamStatus || liveTools.length > 0)}
                      <div class="progress-strip" role="status" data-testid="ai-tool-progress">
                        {#if streamStatus}
                          <span class="progress-stage">{streamStatus}</span>
                        {/if}
                        {#if liveTools.length > 0}
                          <ul class="tool-chips">
                            {#each liveTools as step, sIdx (`${step.tool}-${sIdx}`)}
                              <li class:done={step.done} class:degraded={step.degraded || step.ok === false}>
                                {step.done ? (step.ok === false ? '×' : '✓') : '…'} {step.label}
                                {#if step.done && step.durationMs !== undefined} {step.durationMs}ms{/if}
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    {:else if msg.tool_calls_summary.length > 0}
                      <details class="tool-summary">
                        <summary>已查询 {msg.tool_calls_summary.length} 项权威数据</summary>
                        <ul>
                          {#each msg.tool_calls_summary as entry}
                            <li>{toolDisplayLabel(entry)}</li>
                          {/each}
                        </ul>
                      </details>
                    {/if}

                    {#if msg.ui_blocks.length > 0}
                      <AssistantBlocks blocks={msg.ui_blocks} onauthrequired={handleAuthExpired} />
                    {/if}

                    {#if msg.content}
                      <AssistantMarkdown content={msg.content} />
                    {:else if msg.status === 'streaming'}
                      <p class="streaming-placeholder" role="status">正在生成回答…</p>
                    {:else if msg.status === 'cancelled'}
                      <p class="msg-meta-note">已停止生成，本次未产生文本内容。</p>
                    {/if}

                    <div class="msg-badges">
                      {#if msg.status === 'cancelled'}
                        <span class="msg-tag warn">已停止生成</span>
                      {/if}
                      {#if msg.status === 'failed'}
                        <span class="msg-tag err">生成未完成{msg.error_code ? `（${msg.error_code}）` : ''}</span>
                      {/if}
                      {#if truncatedMsgIds[msg.id]}
                        <span class="msg-tag warn">内容较长，已按上限截断</span>
                      {/if}
                      {#if msg.is_stale}
                        <span class="msg-tag muted">此后运动数据有更新</span>
                      {/if}
                      {#if msg.finished_at && msg.status === 'succeeded'}
                        <span class="msg-time">{formatTime(msg.finished_at)}</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          {/if}
          <div bind:this={threadBottom}></div>
        </div>
      {/if}

      {#if !context.consent.consented}
        <AssistantConsentCard
          consent={context.consent}
          model={context.model}
          busy={consentBusy}
          error={consentError}
          compact
          ongrant={() => void handleConsentChange(true)}
          onrevoke={() => void handleConsentChange(false)}
        />
      {/if}

      {#if sendError}
        <div class="error-strip" data-testid="ai-send-error">
          <FeedbackState kind="error" title={sendError}>
            <div class="error-actions">
              {#if pendingRetry}
                <button
                  type="button"
                  class="button-secondary button-compact"
                  disabled={streaming}
                  onclick={() => void openConversation(pendingRetry!.conversationId)}
                >
                  同步最新记录
                </button>
                <button
                  type="button"
                  class="button-secondary button-compact"
                  disabled={!canSend}
                  onclick={() => void sendMessage(undefined, pendingRetry!)}
                >
                  按原请求重试（防重复）
                </button>
              {:else if lastFailedPrompt && canSend}
                <button
                  type="button"
                  class="button-secondary button-compact"
                  onclick={() => {
                    const retryText = lastFailedPrompt;
                    if (retryText) void sendMessage(retryText);
                  }}
                >
                  重新提问
                </button>
              {/if}
            </div>
          </FeedbackState>
        </div>
      {/if}

      <form
        class="composer"
        onsubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <label class="sr-only" for="ai-composer-input">向 AI 助手提问</label>
        <textarea
          bind:this={composerInput}
          id="ai-composer-input"
          class="text-field composer-input"
          rows="2"
          maxlength="4000"
          placeholder={context.consent.consented
            ? '输入关于你的跑步数据的问题，Enter 发送，Shift+Enter 换行…'
            : '请先同意上方数据使用说明后即可提问…'}
          bind:value={draft}
          disabled={!canSend && !streaming}
          oncompositionstart={() => imeGuard.onCompositionStart()}
          oncompositionend={() => imeGuard.onCompositionEnd()}
          onkeydown={handleComposerKeydown}
        ></textarea>
        <div class="composer-bar">
          <span class="composer-hint">
            {#if draft.length > 3200}
              {draft.length} / 4000 字
            {:else if context.model}
              模型：{context.model} · 仅发送脱敏汇总，不含标题、备注、轨迹与健康数据
            {:else}
              仅发送脱敏汇总，不含标题、备注、轨迹与健康数据
            {/if}
          </span>
          <div class="composer-actions">
            {#if streaming}
              <button type="button" class="button-secondary stop-btn" onclick={() => void stopStreaming()}>
                停止生成
              </button>
            {:else}
              <button
                type="submit"
                class="button-primary bg-primary text-primary-foreground"
                disabled={!canSend || !draft.trim()}
              >
                发送
              </button>
            {/if}
          </div>
        </div>
      </form>
    </section>
  </div>

  <dialog
    bind:this={historyDialog}
    class="sheet-dialog"
    data-glass-overlay
    aria-labelledby="mobile-history-title"
    onclose={() => { historyDialogOpen = false; }}
  >
    <div class="dialog-head">
      <h2 id="mobile-history-title">历史会话</h2>
      <button type="button" class="button-secondary button-compact" onclick={() => historyDialog?.close()}>关闭</button>
    </div>
    <div class="dialog-body">
      {#if historyDialogOpen}
        {@render historyPanelContent('dialog')}
      {/if}
    </div>
  </dialog>

  <dialog
    bind:this={consentDialog}
    class="sheet-dialog consent-dialog"
    data-glass-overlay
    aria-labelledby="consent-dialog-title"
    onclose={() => { consentDialogOpen = false; }}
  >
    <div class="dialog-head">
      <h2 id="consent-dialog-title">隐私与数据使用同意</h2>
      <button
        type="button"
        class="button-secondary button-compact"
        onclick={() => {
          consentDialogOpen = false;
          consentDialog?.close();
        }}
      >关闭</button>
    </div>
    <div class="dialog-body">
      {#if consentDialogOpen}
        <AssistantConsentCard
          consent={context.consent}
          model={context.model}
          busy={consentBusy}
          error={consentError}
          compact
          ongrant={() => void handleConsentChange(true)}
          onrevoke={() => void handleConsentChange(false)}
        />
      {/if}
      {#if page.data.user}
        <p class="dialog-foot-note">
          当前对话与会话历史仅归属当前登录账号，不会对外展示。
        </p>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .assistant-layout {
    display: grid;
    grid-template-columns: 18rem minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
    min-width: 0;
  }
  .assistant-layout.sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
  .assistant-layout.sidebar-collapsed .history-sidebar {
    display: none;
  }
  .history-sidebar {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    padding-right: var(--space-5);
    border-right: 1px solid var(--border);
    max-height: calc(100dvh - 8rem);
    overflow-y: auto;
    position: sticky;
    top: calc(var(--top-navigation-height) + var(--top-navigation-offset) + var(--space-3));
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .sidebar-header h2 {
    margin: 0;
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .history-top {
    display: grid;
  }
  .new-chat-btn {
    width: 100%;
    justify-content: center;
  }
  .sidebar-empty,
  .sidebar-notice {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .sidebar-notice {
    color: var(--success);
  }
  .conv-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0;
    border-top: 1px solid var(--border);
  }
  .conv-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    border-radius: 0;
    background: transparent;
    min-width: 0;
    transition:
      border-color var(--transition-control),
      background-color var(--transition-control);
  }
  .conv-item:has(.rename-form) {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--space-2);
  }
  @media (hover: hover) {
    .conv-item:not(.active):not(:has(.rename-form)):hover {
      background: var(--recap-well);
    }
  }
  .conv-item.active {
    border-left-color: var(--primary);
    background: var(--recap-well);
  }
  .conv-open {
    display: grid;
    gap: 0.125rem;
    align-content: center;
    min-height: 2.75rem;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: var(--space-1);
    color: var(--foreground);
    cursor: pointer;
    min-width: 0;
  }
  :global(.sport-theme) .conv-open.conv-open.conv-open.conv-open {
    background-color: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  .conv-open > :global(.rn-glass-surface) {
    display: none !important;
  }
  .conv-open:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .conv-title {
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-item.active .conv-title {
    font-weight: var(--weight-semibold);
  }
  .conv-time {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }
  .rename-form {
    display: grid;
    gap: var(--space-2);
  }
  .rename-actions {
    display: flex;
    gap: var(--space-2);
  }
  .load-more {
    justify-self: stretch;
  }
  .earlier-bar {
    display: flex;
    justify-content: center;
  }

  .chat-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .chat-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .toolbar-left,
  .toolbar-right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    max-width: 100%;
  }
  .mobile-history-btn,
  .mobile-new-btn {
    display: none;
  }
  .chat-title {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: min(24rem, 100%);
  }
  .quota-pill {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }
  .unavailable-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .unavailable-banner p {
    margin: 0;
  }
  .unavailable-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .thread {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
    min-height: 16rem;
  }
  .empty-stage {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-2) 0;
  }
  .empty-stage h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .prompt-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .prompt-pill {
    display: grid;
    gap: var(--space-1);
    text-align: left;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--control-border);
    border-radius: var(--radius-control);
    background: var(--paper);
    color: var(--foreground);
    cursor: pointer;
    transition: border-color var(--transition-control), background-color var(--transition-control);
  }
  .prompt-pill:hover:enabled {
    border-color: var(--primary);
    background: var(--recap-well);
  }
  .prompt-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .prompt-label {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--primary);
  }
  .prompt-text {
    font-size: var(--text-small);
    color: var(--muted-foreground);
    line-height: var(--line-height-body);
  }

  .msg {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  .msg-user {
    justify-items: end;
  }
  .user-bubble {
    max-width: min(44rem, 100%);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sheet);
    background: var(--recap-well);
    border: 1px solid var(--border);
    border-left: 3px solid var(--primary);
    color: var(--foreground);
    font-size: var(--text-body);
    line-height: var(--line-height-body);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .user-bubble p {
    margin: 0;
  }
  .assistant-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .progress-strip {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--primary);
    border-radius: 0;
    background: var(--recap-well);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .progress-stage {
    font-weight: var(--weight-medium);
    color: var(--foreground);
  }
  .tool-chips {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tool-chips li {
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sheet);
    border: 1px solid var(--border);
    background: var(--background);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }
  .tool-chips li.done {
    border-color: var(--success-border);
    color: var(--success);
  }
  .tool-chips li.degraded {
    border-color: var(--warning-border);
    color: var(--warning);
  }
  .tool-summary {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .tool-summary summary {
    cursor: pointer;
    font-weight: var(--weight-medium);
  }
  .tool-summary ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    list-style: disc;
    display: grid;
    gap: 0.15rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .streaming-placeholder,
  .msg-meta-note {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .msg-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .msg-tag {
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-sheet);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
  }
  .msg-tag.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .msg-tag.err {
    background: var(--error-soft);
    color: var(--error);
  }
  .msg-tag.muted {
    background: var(--recap-well);
    color: var(--muted-foreground);
  }
  .msg-time {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  .error-strip {
    min-width: 0;
  }
  .error-actions {
    margin-top: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .composer {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .composer-input {
    width: 100%;
    min-height: 4.5rem;
    max-height: 14rem;
    resize: vertical;
    padding: var(--space-3);
    font-size: var(--text-body);
    line-height: var(--line-height-body);
  }
  .composer-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .composer-hint {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
  }
  .composer-actions {
    display: flex;
    gap: var(--space-2);
  }
  .stop-btn {
    border-color: var(--error-border);
    color: var(--error);
  }

  .sheet-dialog {
    width: min(32rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 3rem);
    margin: auto;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--foreground);
  }
  .sheet-dialog::backdrop {
    background: var(--surface-backdrop);
  }
  .consent-dialog {
    width: min(46rem, calc(100vw - 2rem));
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }
  .dialog-head h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .dialog-body {
    display: grid;
    gap: var(--space-3);
  }
  .dialog-foot-note {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-caption);
  }

  @media (max-width: 1023px) {
    .assistant-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .history-sidebar {
      display: none;
    }
    .mobile-history-btn,
    .mobile-new-btn {
      display: inline-flex;
    }
    .desktop-expand-btn {
      display: none;
    }
  }
  @media (max-width: 639px) {
    .prompt-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .chat-title {
      max-width: 100%;
    }
    .assistant-body {
      padding: var(--space-3);
    }
  }
</style>
