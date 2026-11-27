<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import {
    buildCacheNamespace,
    clearPrivateOfflineCache,
    inspectNamespaceCacheStats,
    type ActivitySyncMetadata,
  } from '#lib/offline-cache.ts';
  import { syncCompanionActivities, type SyncStatus } from '#lib/companion-sync.ts';

  let {
    userId,
    timezone = 'Asia/Shanghai',
    fetcher = fetch,
    onauthrequired,
  }: {
    userId: string;
    timezone?: string;
    fetcher?: typeof fetch;
    onauthrequired?: () => void;
  } = $props();

  let ready = $state(false);
  let syncStatus = $state<SyncStatus>('idle');
  let syncing = $state(false);
  let clearing = $state(false);
  let cachedActivities = $state(0);
  let hasSummary = $state(false);
  let hasFootprintMeta = $state(false);
  let syncMeta = $state<ActivitySyncMetadata | null>(null);
  let statusMessage = $state('');
  let errorMessage = $state('');
  let disposed = false;

  const namespace = $derived(buildCacheNamespace(userId, 'owner'));

  const lastSyncedLabel = $derived.by(() => {
    if (!syncMeta?.lastSyncedAt) return '尚未同步';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(syncMeta.lastSyncedAt));
    } catch {
      return syncMeta.lastSyncedAt;
    }
  });

  const cachedSectionsLabel = $derived.by(() => {
    const parts: string[] = [];
    if (hasSummary) parts.push('数据汇总');
    if (cachedActivities > 0) parts.push(`跑步记录（${cachedActivities} 条）`);
    if (hasFootprintMeta) parts.push('足迹元数据');
    return parts.length ? parts.join(' · ') : '暂无本地缓存';
  });

  async function refreshStats() {
    const stats = await inspectNamespaceCacheStats(namespace);
    if (disposed) return;
    cachedActivities = stats.cachedActivities;
    hasSummary = stats.hasSummary;
    hasFootprintMeta = stats.hasFootprintMeta;
    syncMeta = stats.syncMeta;
  }

  async function triggerSync() {
    if (syncing || clearing) return;
    syncing = true;
    syncStatus = 'syncing';
    errorMessage = '';
    statusMessage = '';
    try {
      const outcome = await syncCompanionActivities({ namespace, fetcher });
      if (disposed) return;
      syncStatus = outcome.status;
      if (outcome.status === 'auth_expired') {
        onauthrequired?.();
        return;
      }
      if (outcome.status === 'offline') {
        statusMessage = outcome.message ?? '当前离线，将在恢复网络后自动同步。';
      } else if (outcome.status === 'error') {
        errorMessage = outcome.message ?? '增量同步失败，请稍后重试。';
      } else if (outcome.status === 'partial') {
        statusMessage = outcome.message ?? '已同步部分记录，请再次点击继续同步剩余数据。';
      } else if (outcome.unchanged) {
        statusMessage = '本地缓存已是最新（服务端版本无变更）。';
      } else {
        statusMessage = `同步完成：更新 ${outcome.upsertedCount} 条${outcome.removedCount > 0 ? `，清理 ${outcome.removedCount} 条已删除记录` : ''}。`;
      }
      await refreshStats();
    } finally {
      if (!disposed) syncing = false;
    }
  }

  async function clearCache() {
    if (syncing || clearing) return;
    clearing = true;
    errorMessage = '';
    statusMessage = '';
    try {
      await clearPrivateOfflineCache();
      if (disposed) return;
      syncStatus = 'idle';
      statusMessage = '已清除本账号的本地离线缓存。';
      await refreshStats();
    } finally {
      if (!disposed) clearing = false;
    }
  }

  onMount(() => {
    ready = true;
    void refreshStats();
    const onSynced = () => void refreshStats();
    window.addEventListener('runnote-cache-updated', onSynced);
    return () => {
      disposed = true;
      window.removeEventListener('runnote-cache-updated', onSynced);
    };
  });
</script>

<section
  id="offline-cache"
  class="settings-editorial-group wide-body"
  aria-labelledby="offline-cache-title"
  data-testid="companion-cache-panel"
>
  <div class="settings-editorial-lead">
    <h2 id="offline-cache-title">离线缓存与增量同步</h2>
    <p class="block-hint">使用本机 IndexedDB 按账号隔离缓存汇总、跑步记录与足迹元数据，服务端始终为数据权威。</p>
    <span
      class="settings-status-label cache-status"
      class:on={syncStatus === 'synced' || cachedActivities > 0}
      data-testid="cache-sync-badge"
    >
      {syncing
        ? '同步中…'
        : syncStatus === 'offline'
          ? '离线模式'
          : syncStatus === 'partial' || syncMeta?.pendingCursor
            ? '待继续同步'
            : syncMeta?.lastSyncedAt
              ? '已缓存'
              : '未同步'}
    </span>
  </div>

  <div class="settings-editorial-body">
    <dl class="cache-meta-grid" data-testid="cache-meta-grid">
      <div>
        <dt>最近同步</dt>
        <dd data-testid="cache-last-synced">{lastSyncedLabel}</dd>
      </div>
      <div>
        <dt>服务端数据版本</dt>
        <dd class="mono-val" data-testid="cache-data-version">
          {syncMeta?.dataVersion !== null && syncMeta?.dataVersion !== undefined ? `v${syncMeta.dataVersion}` : '—'}
        </dd>
      </div>
      <div>
        <dt>已缓存内容</dt>
        <dd data-testid="cache-sections">{cachedSectionsLabel}</dd>
      </div>
    </dl>

    <div class="cache-actions">
      <button
        type="button"
        class="button-secondary"
        disabled={!ready || syncing || clearing}
        onclick={() => void triggerSync()}
        data-testid="cache-sync-button"
      >
        {syncing ? '正在增量同步…' : '立即增量同步'}
      </button>
      <button
        type="button"
        class="button-secondary"
        disabled={!ready || syncing || clearing}
        onclick={() => void clearCache()}
        data-testid="cache-clear-button"
      >
        {clearing ? '清理中…' : '清除本地缓存'}
      </button>
    </div>

    {#if errorMessage}
      <FeedbackState kind="error" title={errorMessage} />
    {/if}
    {#if statusMessage}
      <p class="block-hint" role="status" data-testid="cache-status-message">{statusMessage}</p>
    {/if}

    <details class="block-details">
      <summary>缓存安全与隔离说明</summary>
      <p>
        离线缓存仅保存只读展示所需的汇总、活动记录与足迹元数据；不会缓存明文令牌、Cookie、原始 GPX/TCX
        文件、离线底图瓦片或私人身心健康日记。
      </p>
      <p>退出登录、会话失效（401）或切换账号时，系统会自动清空上一个账号的全部私有离线缓存。</p>
    </details>
  </div>
</section>

<style>
  .cache-status {
    margin-top: var(--space-2);
  }
  .cache-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .cache-meta-grid dt {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .cache-meta-grid dd {
    margin-top: var(--space-1);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .cache-meta-grid .mono-val {
    font-family: var(--font-mono);
  }
  .cache-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  @media (max-width: 639px) {
    .cache-meta-grid {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
  }
</style>
