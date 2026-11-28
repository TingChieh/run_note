<script lang="ts">
  import type { ConsentView } from '#lib/api/ai-assistant.ts';
  import FeedbackState from '../FeedbackState.svelte';

  let {
    consent,
    model = null,
    busy = false,
    error = '',
    compact = false,
    ongrant,
    onrevoke,
  }: {
    consent: ConsentView;
    model?: string | null;
    busy?: boolean;
    error?: string;
    compact?: boolean;
    ongrant: () => void;
    onrevoke: () => void;
  } = $props();

  const headingId = $props.id();
  let checked = $state(false);
  $effect(() => {
    if (consent.consented) checked = false;
  });

  function formatTime(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN');
  }
</script>

<section class="consent-card" class:compact aria-labelledby={headingId} data-testid="ai-consent-card">
  <div class="consent-head">
    <h2 id={headingId}>{consent.consented ? '数据使用与隐私授权' : '启用前请确认数据使用说明'}</h2>
    <span class="consent-badge" class:active={consent.consented}>
      {consent.consented ? '已同意' : '待同意'}
    </span>
  </div>

  <div class="consent-grid">
    <div class="consent-box">
      <h3>会发送至已配置的 AI 服务{model ? `（${model}）` : ''}</h3>
      <ul>
        <li>你输入的当前提问与同一会话内的最近对话内容</li>
        <li>按问题查询到的运动统计摘要（里程、次数、有效时长、加权配速、汇总心率/热量/步数与覆盖率）</li>
        <li>脱敏单次跑步指标（日期、分类、距离、用时、配速、心率等，每次限 20 条内）</li>
        <li>省/市级足迹聚合计数与常跑路线组汇总指标</li>
      </ul>
    </div>
    <div class="consent-box consent-never">
      <h3>永不发送给 AI 模型</h3>
      <ul>
        <li>身心健康日记全部数据（用药、症状、评分与备注）</li>
        <li>活动标题、自定义标签、自由文本备注（标题与标签仅在浏览器本地按记录 ID 回填）</li>
        <li>精确 GPS 轨迹点位、起终点坐标与街道地址</li>
        <li>照片、原始 GPX/TCX 文件与文件名、邮箱/账号凭据及他人数据</li>
      </ul>
    </div>
  </div>

  {#if error}
    <FeedbackState kind="error" title={error} />
  {/if}

  {#if consent.consented}
    <div class="consent-footer">
      <p class="consent-meta">
        协议版本：{consent.consent_version ?? consent.required_version} · 同意时间：{formatTime(consent.consented_at)}。撤回后历史会话仍可只读查看，新提问将暂停直至重新同意。
      </p>
      <button type="button" class="button-secondary consent-revoke" disabled={busy} onclick={onrevoke}>
        {busy ? '正在撤回…' : '撤回数据使用同意'}
      </button>
    </div>
  {:else}
    <label class="consent-check">
      <input type="checkbox" bind:checked disabled={busy} />
      <span>我已阅读并同意将上述最小脱敏运动汇总发送至已配置的 DeepSeek 服务，并可随时撤回同意。</span>
    </label>
    <div class="consent-actions">
      <button type="button" class="button-primary" disabled={busy || !checked} onclick={ongrant}>
        {busy ? '正在保存…' : '同意并启用 AI 助手'}
      </button>
    </div>
  {/if}
</section>

<style>
  .consent-card {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-top: 2px solid var(--rule);
    border-radius: var(--radius-sheet);
    background: var(--paper);
  }
  .consent-card.compact {
    padding: var(--space-4);
  }
  .consent-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h2 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  h3 {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    color: var(--foreground);
    margin-bottom: var(--space-2);
  }
  .consent-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--warning);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .consent-badge::before {
    content: '';
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .consent-badge.active {
    color: var(--success);
  }
  .consent-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  @media (max-width: 767px) {
    .consent-card {
      padding: var(--space-4);
    }
    .consent-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .consent-box {
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--background);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .consent-never {
    background: var(--recap-well);
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
    list-style: disc;
    display: grid;
    gap: var(--space-1);
    color: var(--muted-foreground);
  }
  .consent-check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--control-border);
    border-radius: var(--radius-control);
    background: var(--background);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    cursor: pointer;
  }
  .consent-check input {
    margin-top: 0.25rem;
    width: 1.125rem;
    height: 1.125rem;
    flex-shrink: 0;
    accent-color: var(--primary);
  }
  .consent-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .consent-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .consent-meta {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    font-variant-numeric: tabular-nums;
    flex: 1 1 18rem;
  }
  .consent-revoke {
    color: var(--error);
    border-color: var(--error-border);
  }
</style>
