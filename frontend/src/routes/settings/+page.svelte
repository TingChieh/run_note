<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;

  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ImageUpload from '#lib/components/ImageUpload.svelte';
  import SaveBar from '#lib/components/SaveBar.svelte';
  import WellbeingDialog from '#lib/components/WellbeingDialog.svelte';
  import { SiteError, removeAvatar, uploadAvatar } from '#lib/api/site.ts';
  import { sharingWrite } from '#lib/api/sharing.ts';
  import { AuthError, changePassword, changeUsername, parseUser, usernameAvailableAt } from '#lib/api/auth.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { listShoes, ShoeError } from '#lib/api/shoes.ts';
  import { readOwnGoals, type RunningGoals } from '#lib/api/running-goal.ts';
  import { useSettingsHeader } from '#lib/settings-header.svelte.ts';
  import { unfoldBar } from '#lib/styles/reveal-from-left.ts';
  import { clearPrivateOfflineCache } from '#lib/offline-cache.ts';
  import { clearHealthGrantHistory } from '#lib/capacitor-health.ts';

  const COMMON_TIMEZONES = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Taipei',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Australia/Sydney',
    'UTC',
  ];

  const header = useSettingsHeader();
  let name = $state(page.data.user?.display_name ?? '');
  let bio = $state(page.data.user?.bio ?? '');
  let timezone = $state(page.data.user?.timezone ?? 'Asia/Shanghai');
  let baseline = $state({
    name: page.data.user?.display_name ?? '',
    bio: page.data.user?.bio ?? '',
    timezone: page.data.user?.timezone ?? 'Asia/Shanghai',
  });
  let busy = $state(false);
  let message = $state('');
  let error = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let passwordBusy = $state(false);
  let passwordError = $state('');
  let passwordReady = $state(false);
  let passwordOpen = $state(false);
  let avatarUrl = $state<string | null>(page.data.user?.avatar_url ?? null);
  let avatarBusy = $state(false);
  let avatarError = $state('');
  let username = $state(page.data.user?.username ?? '');
  let usernameOpen = $state(false);
  let usernameBusy = $state(false);
  let usernameError = $state('');
  let usernameMessage = $state('');
  let usernameChangedAt = $state(page.data.user?.username_changed_at ?? null);
  let currentUsername = $state(page.data.user?.username ?? '');
  let clock = $state(Date.now());
  let disposed = false;
  let usernameToken = 0;
  let shoesToken = 0;
  let goalsToken = 0;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  // Independent personal-management summary state (failures never block profile editing).
  let shoesLoading = $state(true);
  let shoesError = $state('');
  let shoesSummary = $state<{ total: number; due: number; near: number } | null>(null);
  let goalsLoading = $state(true);
  let goalsError = $state('');
  let goalsSummary = $state<RunningGoals | null>(null);

  const timezoneOptions = $derived(
    COMMON_TIMEZONES.includes(timezone) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES],
  );
  const availableAt = $derived(usernameAvailableAt(usernameChangedAt));
  const remaining = $derived(availableAt === null ? 0 : Math.max(0, availableAt - clock));
  const dirty = $derived(name !== baseline.name || bio !== baseline.bio || timezone !== baseline.timezone);
  const initial = (displayName: string): string => Array.from(displayName || '跑者')[0];
  const kmText = (value: number) => `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} km`;

  const privacySummary = $derived.by(() => {
    const u = page.data.user;
    if (!u) return { headline: '—', detail: '' };
    const enabledCount = [u.profile_is_public, u.together_enabled, u.wellbeing_allowed && u.wellbeing_enabled].filter(
      Boolean,
    ).length;
    const parts = [
      u.together_enabled ? '一起跑步已开' : '一起跑步已关',
      !u.wellbeing_allowed ? '身心健康已停用' : u.wellbeing_enabled ? '身心健康已开' : '身心健康已关',
      u.profile_is_public ? '旧主页已开' : '旧主页已关',
    ];
    return { headline: `${enabledCount} 项已开启`, detail: parts.join(' · ') };
  });

  const goalsHeadline = $derived.by(() => {
    if (!goalsSummary) return '—';
    if (goalsSummary.week !== null) return `周 ${kmText(goalsSummary.week)}`;
    if (goalsSummary.month !== null) return `月 ${kmText(goalsSummary.month)}`;
    if (goalsSummary.year !== null) return `年 ${kmText(goalsSummary.year)}`;
    return '尚未设置';
  });

  const goalsDetail = $derived.by(() => {
    if (!goalsSummary) return '';
    const parts = [
      goalsSummary.week !== null ? `周 ${kmText(goalsSummary.week)}` : null,
      goalsSummary.month !== null ? `月 ${kmText(goalsSummary.month)}` : null,
      goalsSummary.year !== null ? `年 ${kmText(goalsSummary.year)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '点击集中设置每周、每月或年度跑量目标';
  });

  $effect(() => {
    if (dirty) message = '';
  });

  function expire() {
    username = '';
    currentUsername = '';
    currentPassword = '';
    newPassword = '';
    shoesSummary = null;
    goalsSummary = null;
    void clearPrivateOfflineCache();
    clearHealthGrantHistory();
    window.location.replace('/admin?reason=expired');
  }

  async function loadShoesSummary() {
    if (!view.manage || !page.data.user) return;
    const token = ++shoesToken;
    shoesLoading = true;
    shoesError = '';
    try {
      const list = await listShoes('active', 0, 'reminder', 20);
      if (disposed || token !== shoesToken) return;
      const due = list.items.filter((item) => item.reminder === 'due').length;
      const near = list.items.filter((item) => item.reminder === 'near').length;
      shoesSummary = { total: list.total, due, near };
      header.shoeReminderCount = due + near;
    } catch (cause) {
      if (disposed || token !== shoesToken) return;
      if (cause instanceof ShoeError && cause.status === 401) {
        expire();
        return;
      }
      shoesError = '跑鞋摘要暂时无法读取';
    } finally {
      if (!disposed && token === shoesToken) shoesLoading = false;
    }
  }

  async function loadGoalsSummary() {
    if (!view.manage || !page.data.user) return;
    const token = ++goalsToken;
    goalsLoading = true;
    goalsError = '';
    try {
      const data = await readOwnGoals(fetch);
      if (disposed || token !== goalsToken) return;
      goalsSummary = data;
    } catch (cause) {
      if (disposed || token !== goalsToken) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        expire();
        return;
      }
      goalsError = '跑量目标暂时无法读取';
    } finally {
      if (!disposed && token === goalsToken) goalsLoading = false;
    }
  }

  async function submitUsername() {
    if (usernameBusy) return;
    const token = ++usernameToken;
    usernameBusy = true;
    usernameError = '';
    usernameMessage = '';
    try {
      const saved = await changeUsername(username, fetch);
      if (disposed || token !== usernameToken) return;
      currentUsername = saved.username;
      username = saved.username;
      usernameChangedAt = saved.username_changed_at ?? null;
      clock = Date.now();
      usernameOpen = false;
      await invalidateAll();
      if (!disposed && token === usernameToken) usernameMessage = '用户名已更新。';
    } catch (cause) {
      if (disposed || token !== usernameToken) return;
      if (cause instanceof AuthError && cause.status === 401) {
        expire();
        return;
      }
      usernameOpen = false;
      usernameError = cause instanceof Error ? cause.message : '用户名修改失败';
    } finally {
      if (!disposed && token === usernameToken) usernameBusy = false;
    }
  }

  async function changeAvatar(file: File) {
    if (avatarBusy) return;
    avatarBusy = true;
    avatarError = '';
    try {
      const url = await uploadAvatar(file, fetch);
      if (disposed) return;
      avatarUrl = url;
      await invalidateAll();
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof SiteError && cause.status === 401) {
        expire();
        return;
      }
      avatarError = cause instanceof Error ? cause.message : '头像上传失败，请重试';
    } finally {
      if (!disposed) avatarBusy = false;
    }
  }

  async function clearAvatar() {
    if (avatarBusy) return;
    avatarBusy = true;
    avatarError = '';
    try {
      await removeAvatar(fetch);
      if (disposed) return;
      avatarUrl = null;
      await invalidateAll();
    } catch (cause) {
      if (disposed) return;
      if (cause instanceof SiteError && cause.status === 401) {
        expire();
        return;
      }
      avatarError = cause instanceof Error ? cause.message : '移除失败，请重试';
    } finally {
      if (!disposed) avatarBusy = false;
    }
  }

  async function updatePassword(event: SubmitEvent) {
    event.preventDefault();
    if (passwordBusy || !passwordReady) return;
    passwordBusy = true;
    passwordError = '';
    try {
      await changePassword(currentPassword, newPassword, fetch);
      await clearPrivateOfflineCache();
      clearHealthGrantHistory();
      if (!disposed) {
        currentPassword = '';
        newPassword = '';
        window.location.assign('/admin?reason=changed');
      }
    } catch (cause) {
      if (!disposed) {
        currentPassword = '';
        newPassword = '';
        passwordError = cause instanceof Error ? cause.message : '密码修改失败';
      }
    } finally {
      if (!disposed) passwordBusy = false;
    }
  }

  function discard() {
    name = baseline.name;
    bio = baseline.bio;
    timezone = baseline.timezone;
    error = '';
  }

  async function save() {
    if (busy || !dirty) return;
    busy = true;
    message = '';
    error = '';
    clearTimeout(messageTimer);
    try {
      const changes = {
        ...(name !== baseline.name && { display_name: name }),
        ...(bio !== baseline.bio && { bio }),
        ...(timezone !== baseline.timezone && { timezone }),
      };
      const saved = parseUser(await sharingWrite<unknown>('/api/v1/me', 'PATCH', changes));
      if (disposed) return;
      name = saved.display_name;
      bio = saved.bio;
      timezone = saved.timezone;
      baseline = { name, bio, timezone };
      await invalidateAll();
      message = '资料已保存。';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '保存失败，请重试';
      if (cause instanceof ActivityError && cause.status === 401) expire();
    } finally {
      busy = false;
      if (message)
        messageTimer = setTimeout(() => {
          message = '';
        }, 6000);
    }
  }

  onMount(() => {
    passwordReady = true;
    void loadShoesSummary();
    void loadGoalsSummary();
    const timer = setInterval(() => {
      clock = Date.now();
    }, 60000);
    const onGoalsChanged = () => void loadGoalsSummary();
    const onShoesChanged = () => void loadShoesSummary();
    window.addEventListener('runnote-goals-changed', onGoalsChanged);
    window.addEventListener('runnote-shoes-changed', onShoesChanged);
    return () => {
      disposed = true;
      usernameToken++;
      shoesToken++;
      goalsToken++;
      clearInterval(timer);
      clearTimeout(messageTimer);
      currentPassword = '';
      newPassword = '';
      window.removeEventListener('runnote-goals-changed', onGoalsChanged);
      window.removeEventListener('runnote-shoes-changed', onShoesChanged);
    };
  });
</script>

<svelte:head><title>{pageTitle('设置', page.data.site)}</title></svelte:head>
{#if view.manage && page.data.user}
  <div class="editorial-page settings-page">
    <section class="settings-identity section-rule" aria-labelledby="avatar-title">
      <h2 id="avatar-title" class="sr-only">头像与账户信息</h2>
      <ImageUpload
        label="头像"
        shape="circle"
        size="lg"
        src={avatarUrl}
        fallback={initial(page.data.user.display_name)}
        busy={avatarBusy}
        error={avatarError}
        onselect={(file) => void changeAvatar(file)}
        onremove={() => void clearAvatar()}
      />
      <div class="identity-meta">
        <div class="identity-heading">
          <p class="identity-name">{page.data.user.display_name}</p>
          <p class="identity-handle">@{currentUsername}</p>
        </div>
        <ul class="identity-chips" aria-label="账户信息">
          <li><span>邮箱</span>{page.data.user.email}</li>
          <li><span>时区</span>{baseline.timezone}</li>
        </ul>
        <p class="identity-hint">
          头像支持 PNG、JPEG、WebP，不超过 5 MiB，自动裁成正方形并移除位置信息。
        </p>
      </div>
    </section>

    <section class="hub-strip" aria-label="个人管理概览" data-testid="settings-hub-strip">
      <a class="hub-cell" href={view.href('/settings/shoes')} data-testid="hub-shoes">
        <span class="hub-kicker">装备 · 跑鞋</span>
        {#if shoesError}
          <p class="hub-stat">—</p>
          <p class="hub-detail" role="status">{shoesError}</p>
        {:else if shoesLoading && !shoesSummary}
          <p class="hub-stat">—</p>
          <p class="hub-detail">正在读取跑鞋…</p>
        {:else if shoesSummary}
          <p class="hub-stat">{shoesSummary.total ? `${shoesSummary.total} 双使用中` : '尚未添加'}</p>
          <p class="hub-detail">
            {#if !shoesSummary.total}
              添加跑鞋后可在跑步详情绑定累计里程
            {:else if shoesSummary.due || shoesSummary.near}
              {[
                shoesSummary.due ? `${shoesSummary.due} 双已达替换里程` : '',
                shoesSummary.near ? `${shoesSummary.near} 双接近阈值` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            {:else}
              使用中跑鞋状态正常
            {/if}
          </p>
        {/if}
        <span class="hub-action">管理跑鞋 →</span>
      </a>

      <a class="hub-cell" href={view.href('/settings/preferences#goals')} data-testid="hub-goals">
        <span class="hub-kicker">训练 · 跑量目标</span>
        {#if goalsError}
          <p class="hub-stat">—</p>
          <p class="hub-detail" role="status">{goalsError}</p>
        {:else if goalsLoading && !goalsSummary}
          <p class="hub-stat">—</p>
          <p class="hub-detail">正在读取目标…</p>
        {:else}
          <p class="hub-stat">{goalsHeadline}</p>
          <p class="hub-detail">{goalsDetail}</p>
        {/if}
        <span class="hub-action">调整目标 →</span>
      </a>

      <a class="hub-cell" href={view.href('/settings/preferences#privacy')} data-testid="hub-privacy">
        <span class="hub-kicker">可见性与模块</span>
        <p class="hub-stat">{privacySummary.headline}</p>
        <p class="hub-detail">{privacySummary.detail}</p>
        <span class="hub-action">隐私与数据 →</span>
      </a>
    </section>

    <form
      id="profile-form"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      class="settings-editorial-group"
      aria-labelledby="profile-title"
      aria-busy={busy}
    >
      <div class="settings-editorial-lead">
        <h2 id="profile-title">个人资料</h2>
        <p class="block-hint">昵称与简介会出现在个人展示页；时区决定活动日期与目标统计范围。</p>
      </div>
      <div class="settings-editorial-body">
        <label class="block-field" for="profile-name">
          昵称
          <input class="text-field" id="profile-name" required maxlength="80" bind:value={name} disabled={busy} />
        </label>
        <label class="block-field" for="profile-bio">
          个人简介
          <textarea class="text-field" id="profile-bio" maxlength="500" bind:value={bio} disabled={busy} rows="4"
          ></textarea>
        </label>
        <div class="block-field">
          <label for="profile-timezone">时区</label>
          <select class="text-field" id="profile-timezone" bind:value={timezone} disabled={busy}>
            {#each timezoneOptions as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </div>
      </div>
    </form>

    <section class="settings-editorial-group" aria-labelledby="username-title">
      <div class="settings-editorial-lead">
        <h2 id="username-title">修改用户名</h2>
        <p class="block-hint">用户名由 3–30 位小写字母、数字或下划线组成，每次修改后需等待 30 天。</p>
        {#if remaining > 0 && availableAt}
          <p class="block-hint">
            剩余约 {Math.ceil(remaining / 86400000)} 天，可于 {new Date(availableAt).toLocaleString()} 后再次修改。
          </p>
        {:else}
          <p class="block-hint">现在可以修改用户名。</p>
        {/if}
      </div>
      <div class="settings-editorial-body">
        <form
          class="inline-form"
          onsubmit={(event) => {
            event.preventDefault();
            usernameOpen = true;
          }}
        >
          <label class="block-field" for="username">
            新用户名
            <input
              class="text-field username-input"
              id="username"
              required
              minlength="3"
              maxlength="30"
              pattern="[a-z0-9_]+"
              bind:value={username}
              disabled={usernameBusy}
            />
          </label>
          <div>
            <button class="button-secondary" disabled={usernameBusy || remaining > 0 || username === currentUsername}>
              修改用户名
            </button>
          </div>
        </form>
        {#if usernameError}<FeedbackState kind="error" title={usernameError} />{/if}
        {#if usernameMessage}<p class="status-note" role="status">{usernameMessage}</p>{/if}
      </div>
    </section>

    <section class="settings-editorial-group" aria-labelledby="password-title">
      <div class="settings-editorial-lead">
        <h2 id="password-title">账户安全</h2>
        <p class="block-hint">修改成功后全部会话失效，请使用新密码重新登录。</p>
      </div>
      <div class="settings-editorial-body">
        <div>
          <button
            type="button"
            class="button-secondary"
            aria-expanded={passwordOpen}
            aria-controls="password-form"
            disabled={!passwordReady}
            onclick={() => (passwordOpen = !passwordOpen)}
          >
            {passwordOpen ? '收起' : '修改密码'}
          </button>
        </div>
        {#if passwordOpen}
          <div transition:unfoldBar id="password-form">
            <form onsubmit={updatePassword} class="inline-form" aria-busy={passwordBusy}>
              <label class="block-field" for="current-password">
                当前密码
                <input
                  class="text-field"
                  id="current-password"
                  type="password"
                  autocomplete="current-password"
                  required
                  minlength="12"
                  maxlength="128"
                  bind:value={currentPassword}
                  disabled={passwordBusy}
                />
              </label>
              <label class="block-field" for="new-password">
                新密码（至少 12 位）
                <input
                  class="text-field"
                  id="new-password"
                  type="password"
                  autocomplete="new-password"
                  required
                  minlength="12"
                  maxlength="128"
                  bind:value={newPassword}
                  disabled={passwordBusy}
                />
              </label>
              <div>
                <button class="button-primary" disabled={passwordBusy || !passwordReady}>
                  {passwordBusy ? '修改中…' : '修改密码并重新登录'}
                </button>
              </div>
              {#if passwordError}<FeedbackState kind="error" title={passwordError} />{/if}
            </form>
          </div>
        {/if}
      </div>
    </section>

    <WellbeingDialog
      open={usernameOpen}
      labelledby="username-confirm-title"
      busy={usernameBusy}
      onclose={() => {
        if (!usernameBusy) usernameOpen = false;
      }}
    >
      <h2 id="username-confirm-title" class="dialog-title">确认修改用户名</h2>
      <p class="dialog-copy">
        将 @{currentUsername} 改为 @{username}。旧的 /p/{currentUsername} 链接将失效，修改后 30 天内不能再次修改。
      </p>
      <div class="dialog-actions">
        <button type="button" class="button-secondary" disabled={usernameBusy} onclick={() => (usernameOpen = false)}>
          取消
        </button>
        <button type="button" class="button-primary" disabled={usernameBusy} onclick={() => void submitUsername()}>
          {usernameBusy ? '修改中…' : '确认修改'}
        </button>
      </div>
    </WellbeingDialog>

    <SaveBar
      form="profile-form"
      {dirty}
      {busy}
      {message}
      {error}
      label="保存个人资料"
      busyLabel="正在保存个人资料…"
      ondiscard={discard}
    />
  </div>
{/if}

<style>
  .settings-page {
    display: grid;
    margin-top: var(--space-6);
    min-width: 0;
  }
  .settings-identity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-8);
    padding-block: var(--space-6);
  }
  .identity-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }
  .identity-handle {
    font-family: var(--font-mono);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .settings-identity .identity-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }
  .settings-identity .identity-chips li {
    padding: 0;
    border-radius: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--text-small);
    color: var(--foreground);
  }
  .settings-identity .identity-chips li > span {
    font-family: var(--font-body);
    color: var(--muted-foreground);
    margin-right: var(--space-2);
  }
  .identity-hint {
    margin-top: var(--space-1);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .hub-strip {
    display: grid;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  @media (min-width: 900px) {
    .hub-strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .hub-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-4) 0;
    text-align: left;
    transition: background-color var(--transition-control);
  }
  .hub-cell + .hub-cell {
    border-top: 1px solid var(--border);
  }
  @media (min-width: 900px) {
    .hub-cell {
      padding: var(--space-4) var(--space-6);
    }
    .hub-cell:first-child {
      padding-left: 0;
    }
    .hub-cell:last-child {
      padding-right: 0;
    }
    .hub-cell + .hub-cell {
      border-top: 0;
      border-left: 1px solid var(--border);
    }
  }
  @media (hover: hover) {
    .hub-cell:hover .hub-action {
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  .hub-kicker {
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
  }
  .hub-stat {
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    font-variant-numeric: tabular-nums;
  }
  .hub-detail {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .hub-action {
    margin-top: auto;
    padding-top: var(--space-2);
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--primary);
  }
  .inline-form {
    display: grid;
    gap: var(--space-4);
    max-width: 28rem;
  }
  .username-input {
    font-family: var(--font-mono);
  }
  .status-note {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .dialog-title {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .dialog-copy {
    margin-top: var(--space-3);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }
</style>
