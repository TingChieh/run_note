<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import { formatDistance } from '#lib/api/activities.ts';
  import {
    createHealthClient,
    formatSleepMinutes,
    HEALTH_METRIC_LABELS,
    HEALTH_METRICS,
    type HealthAvailability,
    type HealthPermissionSnapshot,
    type HealthProviderAdapter,
    type HealthSummaryResult,
  } from '#lib/capacitor-health.ts';

  let {
    accountKey = 'default',
    clientFactory,
  }: {
    accountKey?: string;
    clientFactory?: () => HealthProviderAdapter;
  } = $props();

  let loading = $state(true);
  let busy = $state(false);
  let availability = $state<HealthAvailability | null>(null);
  let permissions = $state<HealthPermissionSnapshot | null>(null);
  let summary = $state<HealthSummaryResult | null>(null);
  let errorMessage = $state('');
  let actionNotice = $state('');

  let disposed = false;
  let requestToken = 0;

  function resolveClient(): HealthProviderAdapter {
    return clientFactory ? clientFactory() : createHealthClient({ accountKey });
  }

  const metricItems = $derived.by(() => {
    if (!summary || summary.status !== 'ok') return [];
    const m = summary.metrics;
    const items: {
      label: string;
      value: string;
      icon?: 'distance' | 'duration' | 'pace' | 'heart' | 'calories' | 'steps';
      testId?: string;
    }[] = [];
    if (m.steps !== null) {
      items.push({
        label: '近 7 天步数',
        value: `${m.steps.toLocaleString('zh-CN')} 步`,
        icon: 'steps',
        testId: 'health-steps',
      });
    }
    if (m.distanceMeters !== null) {
      items.push({
        label: '近 7 天距离',
        value: formatDistance(m.distanceMeters),
        icon: 'distance',
        testId: 'health-distance',
      });
    }
    if (m.activeCaloriesKcal !== null) {
      items.push({
        label: '活动热量',
        value: `${m.activeCaloriesKcal.toLocaleString('zh-CN')} kcal`,
        icon: 'calories',
        testId: 'health-calories',
      });
    }
    if (m.heartRate && m.heartRate.avgBpm !== null) {
      items.push({
        label: '平均心率',
        value: `${m.heartRate.avgBpm} bpm`,
        icon: 'heart',
        testId: 'health-heart-rate',
      });
    }
    if (m.restingHeartRateBpm !== null) {
      items.push({
        label: '静息心率',
        value: `${m.restingHeartRateBpm} bpm`,
        icon: 'heart',
        testId: 'health-resting-hr',
      });
    }
    if (m.sleepMinutes !== null) {
      items.push({
        label: '睡眠时长',
        value: formatSleepMinutes(m.sleepMinutes),
        icon: 'duration',
        testId: 'health-sleep',
      });
    }
    return items;
  });

  const statusBadge = $derived.by(() => {
    if (loading) return { label: '检测中…', on: false };
    if (!availability) return { label: '不可用', on: false };
    if (availability.status === 'web_unavailable') return { label: '仅移动端可用', on: false };
    if (availability.status === 'provider_update_required') return { label: '需更新 Health Connect', on: false };
    if (availability.status === 'unsupported') return { label: '设备不支持', on: false };
    if (permissions?.status === 'granted') return { label: '已授权', on: true };
    if (permissions?.status === 'partial') return { label: '部分授权', on: true };
    if (permissions?.status === 'revoked') return { label: '权限已撤销', on: false };
    if (permissions?.status === 'denied') return { label: '未授权', on: false };
    return { label: '未连接', on: false };
  });

  const platformLabel = $derived(
    availability?.platform === 'ios'
      ? 'Apple HealthKit'
      : availability?.platform === 'android'
        ? 'Android Health Connect'
        : 'Health Connect / HealthKit',
  );

  async function refreshAll() {
    const token = ++requestToken;
    loading = true;
    errorMessage = '';
    actionNotice = '';
    try {
      const client = resolveClient();
      const nextAvailability = await client.getAvailability();
      if (disposed || token !== requestToken) return;
      availability = nextAvailability;
      if (!nextAvailability.available) {
        permissions = null;
        summary = null;
        return;
      }
      const nextPerms = await client.checkPermissions();
      if (disposed || token !== requestToken) return;
      permissions = nextPerms;
      if (nextPerms.granted.length > 0) {
        const nextSummary = await client.readSummary({ metrics: nextPerms.granted });
        if (disposed || token !== requestToken) return;
        summary = nextSummary;
        if (nextSummary.status === 'revoked') {
          permissions = { ...nextPerms, status: 'revoked', granted: [], revoked: nextPerms.granted };
        }
      } else {
        summary = null;
      }
    } catch {
      if (!disposed && token === requestToken) {
        errorMessage = '检测设备健康数据状态失败，请稍后重试。';
      }
    } finally {
      if (!disposed && token === requestToken) loading = false;
    }
  }

  async function authorize() {
    if (busy || !availability?.available) return;
    const token = ++requestToken;
    busy = true;
    errorMessage = '';
    actionNotice = '';
    try {
      const client = resolveClient();
      const nextPerms = await client.requestPermissions();
      if (disposed || token !== requestToken) return;
      permissions = nextPerms;
      if (nextPerms.granted.length > 0) {
        const nextSummary = await client.readSummary({ metrics: nextPerms.granted });
        if (disposed || token !== requestToken) return;
        summary = nextSummary;
        actionNotice =
          nextPerms.status === 'partial'
            ? `已授权 ${nextPerms.granted.length} / ${HEALTH_METRICS.length} 项只读指标。`
            : '只读健康数据已授权。';
      } else {
        summary = null;
      }
    } catch {
      if (!disposed && token === requestToken) {
        errorMessage = '发起健康数据授权失败，请在系统 Health Connect 设置中检查权限。';
      }
    } finally {
      if (!disposed && token === requestToken) busy = false;
    }
  }

  async function readLatest() {
    if (busy || !availability?.available) return;
    const token = ++requestToken;
    busy = true;
    errorMessage = '';
    actionNotice = '';
    try {
      const client = resolveClient();
      const nextPerms = await client.checkPermissions();
      if (disposed || token !== requestToken) return;
      permissions = nextPerms;
      if (nextPerms.granted.length === 0) {
        summary = null;
        return;
      }
      const nextSummary = await client.readSummary({ metrics: nextPerms.granted });
      if (disposed || token !== requestToken) return;
      summary = nextSummary;
      if (nextSummary.status === 'revoked') {
        permissions = { ...nextPerms, status: 'revoked', granted: [], revoked: nextPerms.granted };
      } else if (nextSummary.status === 'ok') {
        actionNotice = '已刷新最近 7 天设备健康摘要。';
      }
    } catch {
      if (!disposed && token === requestToken) {
        errorMessage = '读取设备健康数据失败，请稍后重试。';
      }
    } finally {
      if (!disposed && token === requestToken) busy = false;
    }
  }

  async function openHealthSettings() {
    actionNotice = '';
    const opened = await resolveClient().openSettings();
    if (!disposed && !opened) {
      actionNotice = '无法直接打开系统健康设置，请在系统设置中搜索 Health Connect 手动管理权限。';
    }
  }

  onMount(() => {
    void refreshAll();
    return () => {
      disposed = true;
      requestToken++;
    };
  });
</script>

<section
  id="device-health"
  class="aux-panel settings-block"
  aria-labelledby="device-health-title"
  data-testid="companion-health-panel"
>
  <div class="block-title-row">
    <div>
      <h2 id="device-health-title">设备健康数据（只读）</h2>
      <p class="block-hint">通过 {platformLabel} 仅以只读方式读取最近 7 天基础运动与恢复摘要，不写入设备数据。</p>
    </div>
    <span class="status-badge" class:on={statusBadge.on} data-testid="health-status-badge">
      {statusBadge.label}
    </span>
  </div>

  {#if loading}
    <FeedbackState kind="loading" title="正在检测设备健康数据支持状态…" />
  {:else if errorMessage}
    <FeedbackState kind="error" title={errorMessage}>
      <button type="button" class="button-secondary mt-3" onclick={() => void refreshAll()}>重新检测</button>
    </FeedbackState>
  {:else if availability?.status === 'web_unavailable'}
    <div data-testid="health-web-unavailable">
      <FeedbackState kind="empty" title="请在 RunNote 移动客户端连接设备健康数据">
        <p>Android 端使用 Health Connect 只读读取，后续 iOS 端通过同一接口对接 HealthKit；网页端不访问本机健康库。</p>
      </FeedbackState>
    </div>
  {:else if availability?.status === 'provider_update_required'}
    <div data-testid="health-provider-update">
      <FeedbackState kind="error" title={availability.reason ?? 'Health Connect 需要安装或更新'}>
        <div class="health-actions mt-3">
          <button type="button" class="button-primary" onclick={() => void openHealthSettings()}>
            安装或更新 Health Connect
          </button>
          <button type="button" class="button-secondary" onclick={() => void refreshAll()}>重新检测</button>
        </div>
      </FeedbackState>
    </div>
  {:else if availability?.status === 'unsupported'}
    <div data-testid="health-unsupported">
      <FeedbackState kind="empty" title={availability.reason ?? '当前设备不支持 Health Connect'}>
        <p>升级系统或安装受支持的 Health Connect 服务后即可使用只读读取。</p>
      </FeedbackState>
    </div>
  {:else if availability?.available}
    {#if permissions?.status === 'revoked'}
      <div data-testid="health-revoked">
        <FeedbackState kind="error" title="设备健康数据权限已被撤销">
          <p>你之前授权的只读权限已在系统设置中关闭，RunNote 已停止读取。如需恢复，请重新授权或前往系统设置开启。</p>
          <div class="health-actions mt-3">
            <button type="button" class="button-primary" disabled={busy} onclick={() => void authorize()}>
              {busy ? '申请中…' : '重新授权'}
            </button>
            <button type="button" class="button-secondary" disabled={busy} onclick={() => void openHealthSettings()}>
              打开系统权限设置
            </button>
          </div>
        </FeedbackState>
      </div>
    {:else if permissions?.status === 'denied'}
      <div data-testid="health-denied">
        <FeedbackState kind="error" title="未授予设备健康数据只读权限">
          <p>未授权不影响使用 RunNote 其余功能。如需查看设备健康摘要，可重新申请或前往系统设置开启。</p>
          <div class="health-actions mt-3">
            <button type="button" class="button-primary" disabled={busy} onclick={() => void authorize()}>
              {busy ? '申请中…' : '重新申请授权'}
            </button>
            <button type="button" class="button-secondary" disabled={busy} onclick={() => void openHealthSettings()}>
              打开系统权限设置
            </button>
          </div>
        </FeedbackState>
      </div>
    {:else if permissions?.status === 'not_requested'}
      <div class="health-intro" data-testid="health-not-requested">
        <p class="block-hint">
          最小权限范围：{HEALTH_METRICS.map((id) => HEALTH_METRIC_LABELS[id]).join(
            '、',
          )}（仅只读，不申请写入或后台读取）。
        </p>
        <div class="health-actions">
          <button type="button" class="button-primary" disabled={busy} onclick={() => void authorize()}>
            {busy ? '正在请求授权…' : '授权只读健康数据'}
          </button>
        </div>
      </div>
    {:else}
      {#if permissions?.status === 'partial'}
        <p class="block-hint" data-testid="health-partial-note">
          当前已授权：{permissions.granted.map((id) => HEALTH_METRIC_LABELS[id]).join('、')}；未授权项已跳过。
        </p>
      {/if}
      {#if summary?.status === 'ok' && metricItems.length > 0}
        <div data-testid="health-summary-metrics">
          <MetricSummary items={metricItems} appearance="sport" />
        </div>
      {:else if summary?.status === 'empty'}
        <div data-testid="health-empty">
          <FeedbackState kind="empty" title="最近 7 天暂无可读健康数据">
            <p>已获得只读权限，但设备健康库在当前时间窗口内没有相应记录。</p>
          </FeedbackState>
        </div>
      {:else if summary?.status === 'error'}
        <FeedbackState kind="error" title={summary.message ?? '读取健康数据失败'} />
      {/if}
      <div class="health-actions">
        <button type="button" class="button-secondary" disabled={busy} onclick={() => void readLatest()}>
          {busy ? '刷新中…' : '刷新健康数据'}
        </button>
        {#if permissions?.status === 'partial'}
          <button type="button" class="button-secondary" disabled={busy} onclick={() => void authorize()}>
            补充授权
          </button>
        {/if}
        <button type="button" class="button-secondary" disabled={busy} onclick={() => void openHealthSettings()}>
          系统权限设置
        </button>
      </div>
    {/if}
  {/if}

  {#if actionNotice}
    <p class="block-hint" role="status" data-testid="health-action-notice">{actionNotice}</p>
  {/if}

  <details class="block-details">
    <summary>隐私与数据最小化说明</summary>
    <p>
      RunNote 仅读取上述 6 项基础指标的汇总结果用于本机展示，绝不向 Health Connect / HealthKit 写入数据，也不读取 GPS
      运动轨迹、营养饮食或血糖等无关记录。
    </p>
    <p>健康数据原文不会发送给任何第三方，也不会写入日志。你可以在系统健康设置中随时撤销权限。</p>
  </details>
  <p class="block-hint health-privacy-links" data-testid="health-privacy-links">
    <a class="text-primary underline" href="/privacy">隐私政策</a>
    <span aria-hidden="true">·</span>
    <a class="text-primary underline" href="/privacy#data-deletion" data-testid="health-data-deletion-link">
      账号与数据删除申请
    </a>
  </p>
</section>

<style>
  .health-intro {
    display: grid;
    gap: var(--space-3);
  }
  .health-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }
  .status-badge {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .health-privacy-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
</style>
