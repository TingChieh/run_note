<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { AdminUserError, createAdminUser, readAdminUsers, resetAdminUserPassword, updateAdminUser, type AdminUser, type AdminUserList } from '#lib/api/admin-users.ts';

  const administrator = $derived(!!page.data.user && 'is_admin' in page.data.user && page.data.user.is_admin === true);
  let users = $state<AdminUserList | null>(null), loading = $state(true), busy = $state(false);
  let search = $state(''), filterState = $state('all'), appliedSearch = '', appliedState = 'all';
  let error = $state(''), notice = $state(''), dialogError = $state('');
  let selected = $state<AdminUser | null>(null), mode = $state<'create' | 'edit'>('create');
  let email = $state(''), username = $state(''), displayName = $state(''), timezone = $state('Asia/Shanghai'), bio = $state('');
  let password = $state(''), repeatedPassword = $state(''), active = $state(true), published = $state(false);
  let action = $state<'active' | 'showcase' | 'password'>('active');
  let editor: HTMLDialogElement, confirmation: HTMLDialogElement;
  let returnFocus: HTMLElement | null = null, disposed = false, requestToken = 0;
  const publicWarning = '公开后，所有历史及未来记录、完整轨迹和精确起终点均可被访客浏览。邮箱、私人备注和源文件仍不公开。';

  function failed(cause: unknown) {
    if (cause instanceof AdminUserError && cause.status === 401) {
      users = null; selected = null; password = ''; repeatedPassword = '';
      window.location.replace('/admin?reason=expired');
    }
    return cause instanceof Error ? cause.message : '用户管理暂时不可用，请重试';
  }
  async function load(offset = 0) {
    const token = ++requestToken;
    loading = true; error = '';
    try {
      const result = await readAdminUsers({ search: appliedSearch, ...(appliedState === 'all' ? {} : { is_active: appliedState === 'active' }), offset });
      if (disposed || token !== requestToken) return;
      if (!result.items.length && result.total && offset >= result.total) { void load(Math.floor((result.total - 1) / result.limit) * result.limit); return; }
      users = result;
    } catch (cause) { if (!disposed && token === requestToken) error = failed(cause); }
    finally { if (!disposed && token === requestToken) loading = false; }
  }
  onMount(() => { if (administrator) void load(); else loading = false; return () => { disposed = true; requestToken++; password = ''; repeatedPassword = ''; }; });
  function filter(event: SubmitEvent) { event.preventDefault(); if (busy) return; appliedSearch = search.trim(); appliedState = filterState; void load(); }
  function rememberFocus() { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; }
  function restoreFocus() { password = ''; repeatedPassword = ''; dialogError = ''; selected = null; if (returnFocus?.isConnected) returnFocus.focus(); }
  async function edit(user: AdminUser | null) {
    if (busy) return;
    rememberFocus(); selected = user; mode = user ? 'edit' : 'create'; dialogError = '';
    email = user?.email ?? ''; username = user?.username ?? ''; displayName = user?.display_name ?? '';
    timezone = user?.timezone ?? 'Asia/Shanghai'; bio = user?.bio ?? ''; password = ''; repeatedPassword = ''; active = true; published = false;
    await tick(); if (!disposed) editor.showModal();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    busy = true; dialogError = ''; notice = '';
    try {
      if (mode === 'create') await createAdminUser({ email, username, display_name: displayName, timezone, password, is_active: active, showcase_enabled: active && published });
      else if (selected) await updateAdminUser(selected.id, { display_name: displayName, timezone, bio, ...(!selected.is_admin ? { email } : {}) });
      if (disposed) return;
      notice = mode === 'create' ? '用户已创建。请通过安全方式将初始密码告知本人。' : '用户资料已保存。';
      editor.close(); await load(users?.offset ?? 0);
    } catch (cause) { if (!disposed) dialogError = failed(cause); }
    finally { if (!disposed) busy = false; }
  }
  async function confirm(user: AdminUser, kind: typeof action) {
    if (busy || user.is_admin) return;
    rememberFocus(); selected = user; action = kind; dialogError = ''; password = ''; repeatedPassword = '';
    await tick(); if (!disposed) confirmation.showModal();
  }
  async function execute(event: SubmitEvent) {
    event.preventDefault(); if (busy || !selected || selected.is_admin) return;
    if (action === 'password' && password !== repeatedPassword) { dialogError = '两次输入的密码不一致'; return; }
    busy = true; dialogError = ''; notice = '';
    try {
      if (action === 'password') await resetAdminUserPassword(selected.id, password);
      else await updateAdminUser(selected.id, action === 'active' ? { is_active: !selected.is_active } : { showcase_enabled: !selected.showcase_enabled });
      if (disposed) return;
      notice = action === 'password' ? '密码已重置，该用户的全部旧登录会话已退出。' : '账号状态已更新。';
      confirmation.close(); await load(users?.offset ?? 0);
    } catch (cause) { if (!disposed) dialogError = failed(cause); }
    finally { if (!disposed) busy = false; }
  }
  async function copy(user: AdminUser) {
    error = ''; notice = '';
    try {
      await navigator.clipboard.writeText(new URL(`/p/${encodeURIComponent(user.username)}`, window.location.origin).href);
      if (!disposed) notice = `已复制 ${user.display_name} 的展示链接。`;
    } catch { if (!disposed) error = '无法自动复制，请复制该用户的“查看展示”链接地址。'; }
  }
</script>

<svelte:head><title>用户管理 · RunNote</title></svelte:head>
<PageHeader title="用户管理" description="管理账号、登录权限和独立个人展示链接。">
  {#snippet actions()}{#if administrator}<button type="button" class="button-secondary" disabled={busy} onclick={() => edit(null)}>新增用户</button>{/if}{/snippet}
</PageHeader>
{#if !administrator}
  <div class="mt-6"><FeedbackState kind="error" title="仅站主可管理用户。" /></div>
{:else}
  <div class="aux-stack">
    <section class="aux-panel" aria-label="筛选用户">
      <form onsubmit={filter} class="filter-form">
        <div><label for="user-search">邮箱或用户名</label><input id="user-search" maxlength="254" bind:value={search} class="mt-2 block w-full rounded border p-2" /></div>
        <div><label for="user-status">登录状态</label><select id="user-status" bind:value={filterState} class="mt-2 block w-full rounded border p-2"><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已禁用</option></select></div>
        <button type="submit" class="button-secondary" disabled={busy || loading}>筛选</button>
      </form>
      <p class="mt-4 text-sm text-muted-foreground">登录启用和公开展示分别控制。禁用会立即退出全部设备并关闭展示；重新启用后需另行开启展示。站主账号受保护。</p>
    </section>
    {#if notice}<FeedbackState kind="success" title={notice} />{/if}
    {#if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary mt-3" disabled={busy || loading} onclick={() => load(users?.offset ?? 0)}>重新读取用户</button></FeedbackState>{/if}
    {#if loading}<FeedbackState kind="loading" title="正在读取用户…" />{/if}
    {#if users && !users.items.length && !loading}<FeedbackState kind="empty" title="没有符合条件的用户。" />{:else if users}
      <section class="aux-panel" aria-label="用户列表" aria-busy={loading}>
        <div class="table-scroll" role="region" aria-label="用户表格，可横向滚动">
          <table><caption class="sr-only">账号资料、登录状态和公开展示状态</caption><thead><tr><th scope="col">用户</th><th scope="col">登录状态</th><th scope="col">个人展示</th><th scope="col">操作</th></tr></thead>
            <tbody>{#each users.items as user (user.id)}<tr>
              <th scope="row"><span class="block font-semibold">{user.display_name}{user.is_admin ? ' · 站主' : ''}</span><span class="block text-sm text-muted-foreground">@{user.username}</span><span class="block break-all text-sm text-muted-foreground">{user.email}</span></th>
              <td>{user.is_active ? '已启用' : '已禁用'}</td><td>{user.showcase_enabled ? '公开展示中' : '未公开'}</td>
              <td><div class="user-actions">
                <button type="button" class="button-secondary" disabled={busy || loading} onclick={() => edit(user)} aria-label={`编辑 ${user.display_name}`}>编辑</button>
                {#if user.is_admin}<span class="text-sm text-muted-foreground">受保护账号</span>{:else}
                  <button type="button" class="button-secondary" disabled={busy || loading} onclick={() => confirm(user, 'active')} aria-label={`${user.is_active ? '禁用' : '启用'} ${user.display_name}`}>{user.is_active ? '禁用' : '启用'}</button>
                  <button type="button" class="button-secondary" disabled={busy || loading || !user.is_active} onclick={() => confirm(user, 'showcase')} aria-label={`${user.showcase_enabled ? '关闭展示' : '开启展示'} ${user.display_name}`}>{user.showcase_enabled ? '关闭展示' : '开启展示'}</button>
                  <button type="button" class="button-secondary" disabled={busy || loading} onclick={() => confirm(user, 'password')} aria-label={`重置密码 ${user.display_name}`}>重置密码</button>
                {/if}
                {#if user.is_active && user.showcase_enabled}<a class="button-secondary" href={`/p/${encodeURIComponent(user.username)}`} aria-label={`查看展示 ${user.display_name}`}>查看展示</a><button type="button" class="button-secondary" disabled={busy || loading} onclick={() => copy(user)} aria-label={`复制链接 ${user.display_name}`}>复制链接</button>{/if}
              </div></td>
            </tr>{/each}</tbody>
          </table>
        </div>
        <nav aria-label="用户分页" class="mt-5 flex flex-wrap items-center gap-3"><span>共 {users.total} 位用户 · 第 {Math.floor(users.offset / users.limit) + 1} / {Math.max(1, Math.ceil(users.total / users.limit))} 页</span><button type="button" class="button-secondary" disabled={busy || loading || users.offset === 0} onclick={() => load(Math.max(0, users!.offset - users!.limit))}>上一页</button><button type="button" class="button-secondary" disabled={busy || loading || users.offset + users.limit >= users.total} onclick={() => load(users!.offset + users!.limit)}>下一页</button></nav>
      </section>
    {/if}
  </div>
{/if}

<dialog bind:this={editor} aria-labelledby="user-editor-title" onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form onsubmit={save} class="user-form" aria-busy={busy}>
    <h2 id="user-editor-title" class="text-xl font-semibold">{mode === 'create' ? '新增用户' : '编辑用户'}</h2>
    <label>邮箱<input type="email" required maxlength="254" bind:value={email} disabled={busy || !!selected?.is_admin} /></label>
    <label>用户名<input required minlength="3" maxlength="30" pattern="[a-z0-9_]+" bind:value={username} disabled={busy || mode === 'edit'} aria-describedby="account-name-help" /></label><p id="account-name-help" class="text-sm text-muted-foreground">3–30 个小写字母、数字或下划线，创建后固定，作为展示链接地址的一部分公开。</p>
    <label>昵称<input required maxlength="80" bind:value={displayName} disabled={busy} /></label>
    <label>时区<input required maxlength="64" bind:value={timezone} disabled={busy} /></label>
    {#if mode === 'create'}
      <label>初始密码<input type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={password} disabled={busy} /></label>
      <label class="checkbox-field"><input type="checkbox" bind:checked={active} disabled={busy} />启用登录</label>
      <label class="checkbox-field"><input type="checkbox" bind:checked={published} disabled={busy || !active} />公开该用户的全部内容</label>
      <p class="text-sm text-muted-foreground">{publicWarning}</p>
    {:else}<label>个人简介<textarea rows="3" maxlength="500" bind:value={bio} disabled={busy}></textarea></label>{/if}
    {#if dialogError}<FeedbackState kind="error" title={dialogError} />{/if}
    <div class="flex flex-wrap gap-3"><button type="submit" class="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={busy}>{busy ? '保存中…' : mode === 'create' ? '创建用户' : '保存资料'}</button><button type="button" class="button-secondary" disabled={busy} onclick={() => editor.close()}>取消</button></div>
  </form>
</dialog>
<dialog bind:this={confirmation} aria-labelledby="user-confirm-title" onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form onsubmit={execute} class="user-form" aria-busy={busy}>
    <h2 id="user-confirm-title" class="text-xl font-semibold">{action === 'password' ? '重置用户密码' : action === 'active' ? selected?.is_active ? '禁用用户' : '启用用户' : selected?.showcase_enabled ? '关闭个人展示' : '开启个人展示'}</h2>
    {#if selected}<p>操作账号：{selected.display_name}（@{selected.username}）</p>{/if}
    {#if action === 'password'}
      <p class="text-sm text-muted-foreground">设置新密码后，该用户的全部登录会话将立即退出。</p>
      <label>新密码<input type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={password} disabled={busy} /></label>
      <label>再次输入新密码<input type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={repeatedPassword} disabled={busy} /></label>
    {:else if action === 'active'}<p>{selected?.is_active ? '禁用会保留数据，立即退出全部设备，并停止个人展示及旧摘要分享。' : '启用后可重新登录；旧会话和公开展示不会自动恢复。'}</p>
    {:else}<p>{selected?.showcase_enabled ? '关闭后访客无法访问此用户的完整展示页；本人仍可登录工作区。' : publicWarning}</p>{/if}
    {#if dialogError}<FeedbackState kind="error" title={dialogError} />{/if}
    <div class="flex flex-wrap gap-3"><button type="submit" class="delete-confirm rounded bg-primary px-4 py-2 text-primary-foreground" disabled={busy}>{busy ? '处理中…' : action === 'password' ? '确认重置密码' : '确认操作'}</button><button type="button" class="button-secondary" disabled={busy} onclick={() => confirmation.close()}>取消</button></div>
  </form>
</dialog>
<style>
  .filter-form { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-4); }
  .filter-form > div:first-child { flex: 1 1 16rem; }
  .table-scroll { max-width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: var(--space-4); border-bottom: 1px solid var(--border); vertical-align: top; }
  tbody th { min-width: 13rem; font-weight: inherit; }
  .user-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 18rem; align-items: center; }
  dialog { margin: auto; width: min(36rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-6); color: var(--foreground); background: var(--surface); }
  dialog::backdrop { background: var(--surface-backdrop); }
  .user-form { display: grid; gap: var(--space-4); }
  .user-form label:not(.checkbox-field) { display: grid; gap: var(--space-2); }
  .user-form input:not([type='checkbox']), .user-form textarea { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-control); padding: var(--space-2) var(--space-3); }
  .checkbox-field { display: flex; align-items: center; gap: var(--space-3); }
</style>
