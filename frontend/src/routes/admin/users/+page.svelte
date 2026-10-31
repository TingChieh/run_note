<script lang="ts">
  import { revealFromLeft, unfoldBar } from '#lib/styles/reveal-from-left.ts';
  import { pageTitle } from '#lib/site.ts';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { useSettingsHeader } from '#lib/settings-header.svelte.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { AdminUserError, createAdminUser, deleteAdminUsers, readAdminUsers, resetAdminUserPassword, updateAdminUser, type AdminUser, type AdminUserList } from '#lib/api/admin-users.ts';

  const administrator = $derived(!!page.data.user && 'is_admin' in page.data.user && page.data.user.is_admin === true);
  let users = $state<AdminUserList | null>(null), loading = $state(true), busy = $state(false), slow = $state(false);
  let search = $state(''), filterState = $state('all'), appliedSearch = '', appliedState = 'all';
  let error = $state(''), notice = $state(''), dialogError = $state('');
  let selected = $state<AdminUser | null>(null), mode = $state<'create' | 'edit'>('create');
  let email = $state(''), username = $state(''), displayName = $state(''), timezone = $state('Asia/Shanghai'), bio = $state('');
  let password = $state(''), repeatedPassword = $state(''), active = $state(true), published = $state(false);
  let action = $state<'active' | 'showcase' | 'password'>('active');
  const header = useSettingsHeader();
  $effect(() => { header.create = administrator ? () => void edit(null) : null; header.createDisabled = busy; return () => { header.create = null; header.createDisabled = false; }; });
  let editor: HTMLDialogElement, confirmation: HTMLDialogElement, deletion: HTMLDialogElement;
  let chosen = $state<string[]>([]), removing = $state<AdminUser[]>([]), removal = $state('');
  const selectable = $derived(users?.items.filter(user => !user.is_admin) ?? []);
  // Keep the last count while the bar folds away, so it never flashes "已选 0 个".
  let shownCount = $state(0);
  $effect(() => { if (chosen.length) shownCount = chosen.length; });
  const allChosen = $derived(selectable.length > 0 && selectable.every(user => chosen.includes(user.id)));
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
    loading = true; error = ''; chosen = [];
    try {
      const result = await readAdminUsers({ search: appliedSearch, ...(appliedState === 'all' ? {} : { is_active: appliedState === 'active' }), offset });
      if (disposed || token !== requestToken) return;
      if (!result.items.length && result.total && offset >= result.total) { void load(Math.floor((result.total - 1) / result.limit) * result.limit); return; }
      users = result;
    } catch (cause) { if (!disposed && token === requestToken) error = failed(cause); }
    finally { if (!disposed && token === requestToken) loading = false; }
  }
  onMount(() => { const wait = setTimeout(() => { slow = true; }, 250); if (administrator) void load(); else loading = false; return () => { clearTimeout(wait); disposed = true; requestToken++; password = ''; repeatedPassword = ''; }; });
  const stateOptions = [{ value: 'all', label: '全部' }, { value: 'active', label: '已启用' }, { value: 'inactive', label: '已禁用' }];
  function setState(value: string) { if (busy) return; filterState = value; appliedSearch = search.trim(); appliedState = value; void load(); }
  function filter(event: SubmitEvent) { event.preventDefault(); if (busy) return; appliedSearch = search.trim(); appliedState = filterState; void load(); }
  function rememberFocus() { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; }
  function restoreFocus() { password = ''; repeatedPassword = ''; dialogError = ''; selected = null; removal = ''; removing = []; if (returnFocus?.isConnected) returnFocus.focus(); }
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
  // Not tied to `busy`: flipping `disabled` on every row button would re-run the glass layer and flash the table.
  let switching = false;
  async function toggleSwitch(user: AdminUser, field: 'is_active' | 'showcase_enabled') {
    if (busy || switching || user.is_admin) return;
    switching = true; error = ''; notice = '';
    try {
      const updated = await updateAdminUser(user.id, { [field]: !user[field] });
      // Patch the row in place: reloading the list would flash the skeleton and shift the layout.
      if (!disposed && users) users = { ...users, items: users.items.map(item => item.id === updated.id ? updated : item) };
    } catch (cause) { if (!disposed) error = failed(cause); }
    finally { switching = false; }
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
  function choose(id: string, checked: boolean) { chosen = checked ? [...new Set([...chosen, id])] : chosen.filter(value => value !== id); }
  async function confirmDeletion() {
    if (busy || !chosen.length) return;
    rememberFocus(); removing = selectable.filter(user => chosen.includes(user.id)); removal = ''; dialogError = '';
    await tick(); if (!disposed) deletion.showModal();
  }
  async function removeChosen(event: SubmitEvent) {
    event.preventDefault(); if (busy || removal !== '删除' || !removing.length) return;
    busy = true; dialogError = ''; notice = '';
    let done = false;
    try {
      const count = await deleteAdminUsers(removing.map(user => user.id));
      if (disposed) return;
      notice = `已删除 ${count} 个用户。`;
      returnFocus = null; deletion.close();
      await load(users?.offset ?? 0); done = true;
    } catch (cause) { if (!disposed) dialogError = failed(cause); }
    finally { if (!disposed) busy = false; }
    // Focus only after busy clears; the trigger button disappeared with the selection.
    if (done && !disposed) { await tick(); (document.getElementById('select-page') ?? document.getElementById('create-user'))?.focus(); }
  }
  async function copy(user: AdminUser) {
    error = ''; notice = '';
    try {
      await navigator.clipboard.writeText(new URL(`/p/${encodeURIComponent(user.username)}`, window.location.origin).href);
      if (!disposed) notice = `已复制 ${user.display_name} 的展示链接。`;
    } catch { if (!disposed) error = '无法自动复制，请复制该用户的“查看展示”链接地址。'; }
  }
</script>

<svelte:head><title>{pageTitle('用户管理', page.data.site)}</title></svelte:head>
{#if !administrator}
  <div class="mt-6"><FeedbackState kind="error" title="仅站主可管理用户。" /></div>
{:else}
  <div class="aux-stack">
    <section class="user-toolbar" aria-label="筛选用户">
      <form onsubmit={filter} class="toolbar-search" role="search">
        <label for="user-search" class="sr-only">邮箱或用户名</label>
        <input class="text-field" id="user-search" maxlength="254" placeholder="搜索邮箱或用户名" bind:value={search} />
        <button type="submit" class="button-secondary button-compact" disabled={busy}>搜索</button>
      </form>
      <div class="mode-switch compact-switch" role="group" aria-label="登录状态">
        {#each stateOptions as option}<button type="button" aria-pressed={filterState === option.value} disabled={busy} onclick={() => setState(option.value)}>{option.label}</button>{/each}
      </div>
      <span class="toolbar-count">共 {users?.total ?? 0} 位</span>
    </section>
    {#if notice}<FeedbackState kind="success" title={notice} />{/if}
    {#if error}<FeedbackState kind="error" title={error}><button type="button" class="button-secondary mt-3" disabled={busy} onclick={() => load(users?.offset ?? 0)}>重新读取用户</button></FeedbackState>{/if}
    {#if loading && slow && !users}<FeedbackState kind="loading" title="正在读取用户…" />{/if}
    {#if users && !users.items.length && !loading}<FeedbackState kind="empty" title="没有符合条件的用户。" />{:else if users}
      <section class="aux-panel" aria-label="用户列表" aria-busy={loading}>
        {#if chosen.length}<div transition:unfoldBar class="selection-toolbar" role="region" aria-label="批量管理用户">
          <span class="selected-count">已选 {shownCount} 个</span>
          <button type="button" class="button-secondary" disabled={busy} onclick={() => chosen = []}>清除选择</button>
          <button type="button" class="delete-button" disabled={busy} onclick={confirmDeletion}>删除所选</button>
        </div>{/if}
        <div class="table-scroll" role="region" aria-label="用户表格，可横向滚动">
          <table><caption class="sr-only">账号资料、登录状态和公开展示状态</caption><thead><tr><th scope="col" class="select-cell">{#if selectable.length}<input id="select-page" type="checkbox" aria-label="全选本页" checked={allChosen} indeterminate={chosen.length > 0 && !allChosen} disabled={busy} onchange={event => chosen = event.currentTarget.checked ? selectable.map(user => user.id) : []} />{:else}<span class="sr-only">选择</span>{/if}</th><th scope="col">用户</th><th scope="col">登录状态</th><th scope="col">个人展示</th><th scope="col">操作</th></tr></thead>
            <tbody class="stagger">{#each users.items as user (user.id)}<tr>
              <td class="select-cell">{#if !user.is_admin}<input type="checkbox" aria-label={`选择 ${user.display_name} @${user.username}`} checked={chosen.includes(user.id)} disabled={busy} onchange={event => choose(user.id, event.currentTarget.checked)} />{/if}</td>
              <th scope="row"><div class="user-cell"><span class="user-avatar" aria-hidden="true">{Array.from(user.display_name || user.username)[0]}</span><div class="min-w-0"><span class="block font-semibold">{user.display_name}{user.is_admin ? ' · 站主' : ''}</span><span class="block text-sm text-muted-foreground">@{user.username}</span><span class="block break-all text-sm text-muted-foreground">{user.email}</span></div></div></th>
              <td><button type="button" role="switch" class="rn-switch" aria-checked={user.is_admin || user.is_active} disabled={user.is_admin} onclick={() => toggleSwitch(user, 'is_active')} aria-label={user.is_admin ? `允许登录 ${user.display_name}（站主受保护，不可调节）` : `允许登录 ${user.display_name}`}><span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span></button></td><td><button type="button" role="switch" class="rn-switch" aria-checked={user.is_admin || (user.is_active && user.showcase_enabled)} disabled={user.is_admin || !user.is_active} onclick={() => toggleSwitch(user, 'showcase_enabled')} aria-label={user.is_admin ? `公开展示 ${user.display_name}（站主受保护，不可调节）` : `公开展示 ${user.display_name}`}><span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span></button></td>
              <td><div class="user-actions">
                <button type="button" class="button-secondary button-compact" disabled={busy} onclick={() => edit(user)} aria-label={`编辑 ${user.display_name}`}>编辑</button>
                {#if user.is_admin}<span class="text-sm text-muted-foreground">受保护账号</span>{:else}
                  <button type="button" class="button-secondary button-compact" disabled={busy} onclick={() => confirm(user, 'password')} aria-label={`重置密码 ${user.display_name}`}>重置密码</button>
                {/if}
                {#if user.is_active && user.showcase_enabled}<a transition:revealFromLeft data-reveal class="button-secondary button-compact" href={`/p/${encodeURIComponent(user.username)}`} aria-label={`查看展示 ${user.display_name}`}>查看展示</a><button transition:revealFromLeft={{ delay: 70 }} data-reveal type="button" class="button-secondary button-compact" disabled={busy} onclick={() => copy(user)} aria-label={`复制链接 ${user.display_name}`}>复制链接</button>{/if}
              </div></td>
            </tr>{/each}</tbody>
          </table>
        </div>
        <nav aria-label="用户分页" class="user-pager"><span>第 {Math.floor(users.offset / users.limit) + 1} / {Math.max(1, Math.ceil(users.total / users.limit))} 页</span><button type="button" class="button-secondary button-compact" disabled={busy || users.offset === 0} onclick={() => load(Math.max(0, users!.offset - users!.limit))}>上一页</button><button type="button" class="button-secondary button-compact" disabled={busy || users.offset + users.limit >= users.total} onclick={() => load(users!.offset + users!.limit)}>下一页</button></nav>
        <details class="block-details user-note"><summary>管理说明</summary><p>登录启用和公开展示分别控制。禁用会立即退出全部设备并关闭展示；重新启用后需另行开启展示。站主账号受保护。</p></details>
      </section>
    {/if}
  </div>
{/if}

<dialog bind:this={editor} aria-labelledby="user-editor-title" onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form onsubmit={save} class="user-form" aria-busy={busy}>
    <h2 id="user-editor-title" class="text-xl font-semibold">{mode === 'create' ? '新增用户' : '编辑用户'}</h2>
    <label>邮箱<input class="text-field" type="email" required maxlength="254" bind:value={email} disabled={busy || !!selected?.is_admin} /></label>
    <label>用户名<input class="text-field" required minlength="3" maxlength="30" pattern="[a-z0-9_]+" bind:value={username} disabled={busy || mode === 'edit'} aria-describedby="account-name-help" /></label><p id="account-name-help" class="text-sm text-muted-foreground">3–30 个小写字母、数字或下划线，创建后固定，作为展示链接地址的一部分公开。</p>
    <label>昵称<input class="text-field" required maxlength="80" bind:value={displayName} disabled={busy} /></label>
    <label>时区<input class="text-field" required maxlength="64" bind:value={timezone} disabled={busy} /></label>
    {#if mode === 'create'}
      <label>初始密码<input class="text-field" type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={password} disabled={busy} /></label>
      <label class="checkbox-field"><input type="checkbox" bind:checked={active} disabled={busy} />启用登录</label>
      <label class="checkbox-field"><input type="checkbox" bind:checked={published} disabled={busy || !active} />公开该用户的全部内容</label>
      <p class="text-sm text-muted-foreground">{publicWarning}</p>
    {:else}<label>个人简介<textarea class="text-field" rows="3" maxlength="500" bind:value={bio} disabled={busy}></textarea></label>{/if}
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
      <label>新密码<input class="text-field" type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={password} disabled={busy} /></label>
      <label>再次输入新密码<input class="text-field" type="password" required minlength="12" maxlength="128" autocomplete="new-password" bind:value={repeatedPassword} disabled={busy} /></label>
    {:else if action === 'active'}<p>{selected?.is_active ? '禁用会保留数据，立即退出全部设备，并停止个人展示及旧摘要分享。' : '启用后可重新登录；旧会话和公开展示不会自动恢复。'}</p>
    {:else}<p>{selected?.showcase_enabled ? '关闭后访客无法访问此用户的完整展示页；本人仍可登录工作区。' : publicWarning}</p>{/if}
    {#if dialogError}<FeedbackState kind="error" title={dialogError} />{/if}
    <div class="flex flex-wrap gap-3"><button type="submit" class="delete-confirm rounded bg-primary px-4 py-2 text-primary-foreground" disabled={busy}>{busy ? '处理中…' : action === 'password' ? '确认重置密码' : '确认操作'}</button><button type="button" class="button-secondary" disabled={busy} onclick={() => confirmation.close()}>取消</button></div>
  </form>
</dialog>
<dialog bind:this={deletion} aria-labelledby="user-delete-title" aria-describedby="user-delete-hint" onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form onsubmit={removeChosen} class="user-form" aria-busy={busy}>
    <h2 id="user-delete-title" class="text-xl font-semibold">永久删除 {removing.length} 个用户？</h2>
    <p id="user-delete-hint">将永久删除这些账号及其全部运动记录、轨迹、原始文件、AI 报告和分享链接，无法恢复。</p>
    <ul class="delete-list">{#each removing as user (user.id)}<li>{user.display_name}（@{user.username}）</li>{/each}</ul>
    <label>输入“删除”以确认<input class="text-field" autocomplete="off" bind:value={removal} disabled={busy} /></label>
    {#if dialogError}<FeedbackState kind="error" title={dialogError} />{/if}
    <div class="flex flex-wrap gap-3"><button type="submit" class="delete-confirm delete-submit" disabled={busy || removal !== '删除'}>{busy ? '删除中…' : '永久删除'}</button><button type="button" class="button-secondary" disabled={busy} onclick={() => deletion.close()}>取消</button></div>
  </form>
</dialog>
<style>
  /* The glass of the row buttons paints up to 12px past them; the padding (taken back by the margin) keeps that ink inside the box, so a sideways-only scroller never grows a vertical scrollbar. */
  .table-scroll { max-width: 100%; overflow-x: auto; padding-bottom: var(--space-3); margin-bottom: calc(-1 * var(--space-3)); }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: middle; }
  thead th { padding-block: var(--space-2); font-size: var(--text-small); font-weight: var(--weight-semibold); color: var(--muted-foreground); white-space: nowrap; }
  tbody tr { transition: background-color var(--transition-control); }
  @media (hover: hover) { tbody tr:hover { background: color-mix(in srgb, var(--muted) 60%, transparent); } }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody th { min-width: 14rem; font-weight: inherit; }
  .user-cell { display: flex; align-items: center; gap: var(--space-3); }
  .user-avatar { display: grid; place-items: center; flex: none; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--primary-soft); color: var(--primary); font-weight: var(--weight-bold); }
  .user-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 24rem; align-items: center; }
  dialog { margin: auto; width: min(36rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-6); color: var(--foreground); background: var(--surface); }
  dialog::backdrop { background: var(--surface-backdrop); }
  .user-form { display: grid; gap: var(--space-4); }
  .user-form label:not(.checkbox-field) { display: grid; gap: var(--space-2); }
  
  .checkbox-field { display: flex; align-items: center; gap: var(--space-3); }
  .select-cell { width: 3rem; }
  .select-cell input { width: 1.25rem; height: 1.25rem; }
  .selection-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); margin-bottom: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .selected-count { flex: 1; color: var(--muted-foreground); white-space: nowrap; font-size: var(--text-small); }
  .delete-button, .delete-submit { padding: .625rem .875rem; border-radius: var(--radius-control); font-size: var(--text-small); font-weight: var(--weight-semibold); color: var(--error); border: 1px solid var(--error-border); }
  .delete-submit:disabled, .delete-button:disabled { opacity: .5; }
  .delete-list { max-height: 12rem; overflow-y: auto; padding-left: var(--space-6); list-style: disc; }
</style>
