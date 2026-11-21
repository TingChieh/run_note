<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import SaveBar from '#lib/components/SaveBar.svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { parseUser } from '#lib/api/auth.ts';
  import { sharingWrite } from '#lib/api/sharing.ts';
  import { readOwnGoals, saveGoal, validGoal, type GoalPeriod, type RunningGoals } from '#lib/api/running-goal.ts';

  const view = useViewContext();
  const fetch = view.fetch;

  const GOAL_PERIODS: { key: GoalPeriod; label: string }[] = [
    { key: 'week', label: '每周目标' },
    { key: 'month', label: '每月目标' },
    { key: 'year', label: '年度目标' },
  ];

  // Running goals state (independent from privacy switches so one failure never blocks the other).
  let goalsLoading = $state(true);
  let goalsLoadError = $state('');
  let goalsSaving = $state(false);
  let goalsMessage = $state('');
  let goalsError = $state('');
  let goalsInvalidField = $state<GoalPeriod | null>(null);
  let savedGoals = $state<RunningGoals>({ week: null, month: null, year: null });
  let goalInputs = $state<Record<GoalPeriod, string>>({ week: '', month: '', year: '' });

  // Privacy & personal module switches state.
  let enabled = $state(page.data.user?.profile_is_public ?? false);
  let together = $state(page.data.user?.together_enabled ?? false);
  let wellbeing = $state(page.data.user?.wellbeing_enabled ?? false);
  let baseline = $state({
    enabled: page.data.user?.profile_is_public ?? false,
    together: page.data.user?.together_enabled ?? false,
    wellbeing: page.data.user?.wellbeing_enabled ?? false,
  });
  let privacyBusy = $state(false);
  let privacyReady = $state(false);
  let privacyMessage = $state('');
  let privacyError = $state('');

  let disposed = false;
  let goalsToken = 0;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const goalsDirty = $derived(
    GOAL_PERIODS.some(({ key }) => goalInputs[key].trim() !== (savedGoals[key]?.toString() ?? '')),
  );
  const privacyDirty = $derived(
    enabled !== baseline.enabled || together !== baseline.together || wellbeing !== baseline.wellbeing,
  );

  $effect(() => {
    if (privacyDirty) privacyMessage = '';
  });
  $effect(() => {
    if (goalsDirty) goalsMessage = '';
  });

  function expired(cause: unknown): boolean {
    if (!(cause instanceof ActivityError) || cause.status !== 401) return false;
    window.location.replace('/admin?reason=expired');
    return true;
  }

  async function loadGoals() {
    if (!view.manage || !page.data.user) return;
    const token = ++goalsToken;
    goalsLoading = true;
    goalsLoadError = '';
    try {
      const data = await readOwnGoals(fetch);
      if (disposed || token !== goalsToken) return;
      savedGoals = data;
      goalInputs = {
        week: data.week?.toString() ?? '',
        month: data.month?.toString() ?? '',
        year: data.year?.toString() ?? '',
      };
    } catch (cause) {
      if (disposed || token !== goalsToken || expired(cause)) return;
      goalsLoadError = cause instanceof Error ? cause.message : '暂时无法读取跑量目标';
    } finally {
      if (!disposed && token === goalsToken) goalsLoading = false;
    }
  }

  async function submitGoals(event: SubmitEvent) {
    event.preventDefault();
    if (goalsSaving || goalsLoading || !goalsDirty) return;
    goalsError = '';
    goalsMessage = '';
    goalsInvalidField = null;

    const updates: { period: GoalPeriod; label: string; value: number }[] = [];
    for (const { key, label } of GOAL_PERIODS) {
      const raw = goalInputs[key].trim();
      const previous = savedGoals[key]?.toString() ?? '';
      if (raw === previous) continue;
      if (raw === '') {
        goalsInvalidField = key;
        goalsError = `${label}暂不支持清空，请输入大于 0、最多 1 位小数的公里数（上限 100000）。`;
        document.getElementById(`pref-goal-${key}`)?.focus();
        return;
      }
      const parsed = validGoal(raw);
      if (parsed === null) {
        goalsInvalidField = key;
        goalsError = `${label}请输入大于 0、最多 1 位小数的公里数（上限 100000）。`;
        document.getElementById(`pref-goal-${key}`)?.focus();
        return;
      }
      updates.push({ period: key, label, value: parsed });
    }
    if (!updates.length) return;

    goalsSaving = true;
    ++goalsToken;
    const succeeded: { period: GoalPeriod; label: string }[] = [];
    const failed: { period: GoalPeriod; label: string; reason: string }[] = [];
    try {
      for (const { period, label, value } of updates) {
        try {
          const persisted = await saveGoal(period, value, fetch);
          if (disposed) return;
          savedGoals = { ...savedGoals, [period]: persisted };
          goalInputs[period] = persisted.toString();
          succeeded.push({ period, label });
        } catch (cause) {
          if (disposed || expired(cause)) return;
          failed.push({
            period,
            label,
            reason: cause instanceof Error ? cause.message : '保存失败，请重试',
          });
        }
      }
      if (succeeded.length > 0) {
        window.dispatchEvent(new CustomEvent('runnote-goals-changed'));
      }
      if (failed.length === 0) {
        goalsMessage = '跑量目标已保存并同步。';
      } else if (succeeded.length > 0) {
        goalsInvalidField = failed[0].period;
        goalsError = `${succeeded.map((item) => item.label).join('、')}已保存；${failed.map((item) => item.label).join('、')}保存失败（${failed[0].reason}），未保存项已保留输入，请重试。`;
      } else {
        goalsInvalidField = failed[0].period;
        goalsError = `${failed.map((item) => item.label).join('、')}保存失败：${failed[0].reason}`;
      }
    } finally {
      if (!disposed) goalsSaving = false;
    }
  }

  function discardPrivacy() {
    enabled = baseline.enabled;
    together = baseline.together;
    wellbeing = baseline.wellbeing;
    privacyError = '';
  }

  async function savePrivacy(event: SubmitEvent) {
    event.preventDefault();
    if (privacyBusy || !privacyDirty) return;
    privacyBusy = true;
    privacyMessage = '';
    privacyError = '';
    clearTimeout(messageTimer);
    try {
      const publicChanged = enabled !== baseline.enabled;
      const changes = {
        ...(enabled !== baseline.enabled && { profile_is_public: enabled }),
        ...(together !== baseline.together && { together_enabled: together }),
        ...(wellbeing !== baseline.wellbeing && { wellbeing_enabled: wellbeing }),
      };
      const saved = parseUser(await sharingWrite<unknown>('/api/v1/me', 'PATCH', changes));
      if (disposed) return;
      enabled = saved.profile_is_public;
      together = saved.together_enabled;
      wellbeing = saved.wellbeing_enabled;
      baseline = { enabled, together, wellbeing };
      await invalidateAll();
      privacyMessage = publicChanged
        ? saved.profile_is_public
          ? '隐私与功能设置已保存，主页已开启。仅公开记录进入主页。'
          : '隐私与功能设置已保存，主页已关闭。独立记录分享仍需单独撤销。'
        : '隐私与功能设置已保存。';
    } catch (cause) {
      if (disposed || expired(cause)) return;
      privacyError = cause instanceof Error ? cause.message : '保存失败，请重试';
    } finally {
      if (!disposed) {
        privacyBusy = false;
        if (privacyMessage)
          messageTimer = setTimeout(() => {
            privacyMessage = '';
          }, 6000);
      }
    }
  }

  onMount(() => {
    privacyReady = true;
    void loadGoals();
    const syncGoals = () => {
      if (!goalsSaving) void loadGoals();
    };
    window.addEventListener('runnote-goals-changed', syncGoals);
    return () => {
      disposed = true;
      goalsToken++;
      clearTimeout(messageTimer);
      window.removeEventListener('runnote-goals-changed', syncGoals);
    };
  });
</script>

<svelte:head><title>{pageTitle('目标与隐私', page.data.site)}</title></svelte:head>
{#if view.manage && page.data.user}
  <div class="settings-stack">
    <section
      id="goals"
      class="aux-panel settings-block"
      aria-labelledby="goals-title"
      aria-busy={goalsLoading || goalsSaving}
    >
      <h2 id="goals-title">跑量目标</h2>
      <p class="block-hint">统一调整每周、每月与年度目标，数据汇总页与顶栏进度环同步更新。</p>
      {#if goalsLoadError}
        <FeedbackState kind="error" title={goalsLoadError}>
          <button type="button" class="button-secondary mt-3" onclick={() => void loadGoals()}>重试读取目标</button>
        </FeedbackState>
      {:else}
        <form onsubmit={submitGoals} class="goal-form-grid" novalidate>
          {#each GOAL_PERIODS as item (item.key)}
            <div class="goal-input-card">
              <label class="block-field" for={`pref-goal-${item.key}`}>
                {item.label}
                <div class="goal-input-row">
                  <input
                    id={`pref-goal-${item.key}`}
                    class="text-field"
                    inputmode="decimal"
                    placeholder="未设置"
                    bind:value={goalInputs[item.key]}
                    disabled={goalsLoading || goalsSaving}
                    aria-invalid={goalsInvalidField === item.key ? 'true' : undefined}
                    aria-describedby={goalsInvalidField === item.key ? 'pref-goals-error' : undefined}
                  />
                  <span class="goal-input-unit">km</span>
                </div>
              </label>
              <p class="block-hint">
                已保存：{savedGoals[item.key] === null ? '未设置' : `${savedGoals[item.key]} km`}
              </p>
            </div>
          {/each}
          <div class="goal-submit-row">
            <button type="submit" class="button-primary" disabled={goalsLoading || goalsSaving || !goalsDirty}>
              {goalsSaving ? '正在保存目标…' : '保存跑量目标'}
            </button>
            {#if goalsMessage}<p role="status" class="text-sm text-muted-foreground">{goalsMessage}</p>{/if}
          </div>
          {#if goalsError}
            <div id="pref-goals-error" class="goal-error-row">
              <FeedbackState kind="error" title={goalsError} />
            </div>
          {/if}
        </form>
      {/if}
    </section>

    <form
      id="privacy-form"
      onsubmit={savePrivacy}
      class="aux-panel settings-block"
      aria-labelledby="privacy-title"
      aria-busy={privacyBusy}
    >
      <h2 id="privacy-title">展示、隐私与个人模块</h2>

      <div id="privacy" class="switch-row">
        <div class="block-title-row">
          <div>
            <h3>个人完整展示</h3>
            <p class="block-hint">
              由站主在用户管理中控制。开启后访客可浏览个人展示页的全部记录与完整轨迹；跑鞋、私人备注与身心健康永不公开。
            </p>
          </div>
          <span class="status-badge" class:on={page.data.user.showcase_enabled}>
            {page.data.user.showcase_enabled ? '已开启' : '未开启'}
          </span>
        </div>
        {#if page.data.user.showcase_enabled}
          <div>
            <a class="text-sm text-primary underline" href={`/p/${encodeURIComponent(page.data.user.username)}`}>
              查看我的个人展示（/p/{page.data.user.username}） →
            </a>
          </div>
        {/if}
      </div>

      <div class="switch-row">
        <div class="block-title-row">
          <div>
            <h3 id="public-profile-label">公开个人主页</h3>
            <p class="block-hint">仅展示主动设为公开的记录、统计和日历，不会公开历史私人记录。</p>
          </div>
          <button
            type="button"
            role="switch"
            class="rn-switch"
            aria-checked={enabled}
            aria-labelledby="public-profile-label"
            disabled={privacyBusy || !privacyReady}
            onclick={() => (enabled = !enabled)}
          >
            <span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span>
          </button>
        </div>
        <p class="status-badge" class:on={baseline.enabled}>已保存：{baseline.enabled ? '已开启' : '已关闭'}</p>
        <details class="block-details">
          <summary>展示与隐私说明</summary>
          <p>
            开启完整展示后，个人展示页将展示全部记录和完整路线；这里的公开主页设置仅影响旧版摘要主页。私人备注和原始文件不公开。
          </p>
          <p>
            关闭主页会立即关闭主页及其资料、统计、日历和列表接口。关闭主页不会撤销独立分享链接或单条公开记录；独立记录需到详情单独撤销链接或设为私人，已被他人保存的摘要无法收回。
          </p>
        </details>
      </div>

      <div class="switch-row">
        <div class="block-title-row">
          <div>
            <h3 id="wellbeing-label">身心健康</h3>
            <p class="block-hint">关闭后隐藏入口，记录会保留。</p>
            {#if !page.data.user.wellbeing_allowed}<p class="block-hint">已被管理员关闭。</p>{/if}
          </div>
          <button
            type="button"
            role="switch"
            class="rn-switch"
            aria-checked={wellbeing}
            aria-labelledby="wellbeing-label"
            disabled={privacyBusy || !privacyReady || !page.data.user.wellbeing_allowed}
            onclick={() => (wellbeing = !wellbeing)}
          >
            <span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span>
          </button>
        </div>
      </div>

      <div class="switch-row">
        <div class="block-title-row">
          <div>
            <h3 id="together-label">加入一起跑步</h3>
            <p class="block-hint">开启后，你的全部运动记录（含私人记录）和对应精确路线都会公开汇入一起跑步。</p>
          </div>
          <button
            type="button"
            role="switch"
            class="rn-switch"
            aria-checked={together}
            aria-labelledby="together-label"
            disabled={privacyBusy || !privacyReady}
            onclick={() => (together = !together)}
          >
            <span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span>
          </button>
        </div>
      </div>
    </form>

    <section id="data" class="aux-panel settings-block" aria-labelledby="data-title">
      <h2 id="data-title">数据与记录入口</h2>
      <div class="data-links-grid">
        <div class="data-link-card">
          <div>
            <strong>导入与管理跑步记录</strong>
            <p class="block-hint">导入 GPX、TCX 或小米运动健康记录，并管理旧版单条分享链接。</p>
          </div>
          <a class="button-secondary button-compact" href={view.href('/activities')}>前往跑步记录 →</a>
        </div>
        {#if page.data.user.wellbeing_allowed && baseline.wellbeing}
          <div class="data-link-card">
            <div>
              <strong>身心健康就诊报告</strong>
              <p class="block-hint">在身心健康页查看汇总并导出 CSV 报告。</p>
            </div>
            <a class="button-secondary button-compact" href={view.href('/wellbeing')}>前往身心健康 →</a>
          </div>
        {/if}
      </div>
    </section>

    <SaveBar
      glass
      form="privacy-form"
      dirty={privacyDirty}
      busy={privacyBusy}
      message={privacyMessage}
      error={privacyError}
      label="保存隐私与功能设置"
      busyLabel="正在保存隐私与功能设置…"
      ondiscard={discardPrivacy}
    />
  </div>
{/if}

<style>
  .switch-row h3 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .goal-submit-row {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .goal-error-row {
    grid-column: 1 / -1;
  }
</style>
