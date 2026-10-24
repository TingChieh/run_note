<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ImageUpload from '#lib/components/ImageUpload.svelte';
  import { SiteError, removeAvatar, uploadAvatar } from '#lib/api/site.ts';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { sharingWrite } from '#lib/api/sharing.ts';
  import { changePassword } from '#lib/api/auth.ts';
  import { onMount } from 'svelte';
  import { unfoldBar } from '#lib/styles/reveal-from-left.ts';
  import SaveBar from '#lib/components/SaveBar.svelte';
  import type { User } from '#lib/api/auth.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  let name=$state(page.data.user?.display_name ?? ''), bio=$state(page.data.user?.bio ?? ''), enabled=$state(page.data.user?.profile_is_public ?? false), busy=$state(false), message=$state(''), error=$state('');
  let baseline = $state({name: page.data.user?.display_name ?? '', bio: page.data.user?.bio ?? '', enabled: page.data.user?.profile_is_public ?? false});
  let currentPassword=$state(''), newPassword=$state(''), passwordBusy=$state(false), passwordError=$state(''), passwordReady=$state(false), disposed=false;
  let avatarUrl = $state<string | null>(page.data.user?.avatar_url ?? null), avatarBusy = $state(false), avatarError = $state('');
  const initial = (displayName: string): string => Array.from(displayName || '跑者')[0];
  async function changeAvatar(file: File) {
    if (avatarBusy) return; avatarBusy = true; avatarError = '';
    try { const url = await uploadAvatar(file, fetch); if (disposed) return; avatarUrl = url; await invalidateAll(); }
    catch (cause) { if (disposed) return; if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return; } avatarError = cause instanceof Error ? cause.message : '头像上传失败，请重试'; }
    finally { if (!disposed) avatarBusy = false; }
  }
  async function clearAvatar() {
    if (avatarBusy) return; avatarBusy = true; avatarError = '';
    try { await removeAvatar(fetch); if (disposed) return; avatarUrl = null; await invalidateAll(); }
    catch (cause) { if (disposed) return; if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return; } avatarError = cause instanceof Error ? cause.message : '移除失败，请重试'; }
    finally { if (!disposed) avatarBusy = false; }
  }
  onMount(() => { passwordReady=true; return () => { disposed=true; clearTimeout(messageTimer); currentPassword=''; newPassword=''; }; });
  async function updatePassword(event: SubmitEvent) {
    event.preventDefault(); if(passwordBusy || !passwordReady) return;
    passwordBusy=true; passwordError='';
    try { await changePassword(currentPassword,newPassword,fetch); if(!disposed) { currentPassword='';newPassword='';window.location.assign('/admin?reason=changed'); } }
    catch(cause) { if(!disposed) { currentPassword='';newPassword='';passwordError=cause instanceof Error?cause.message:'密码修改失败'; } }
    finally { if(!disposed) passwordBusy=false; }
  }
  let passwordOpen = $state(false), messageTimer: ReturnType<typeof setTimeout> | undefined;
  const dirty = $derived(name !== baseline.name || bio !== baseline.bio || enabled !== baseline.enabled);
  function discard() { name = baseline.name; bio = baseline.bio; enabled = baseline.enabled; error = ''; }
  $effect(() => { if (dirty) message = ''; });
  async function save() { if(busy) return;busy=true;message='';error='';clearTimeout(messageTimer);try { const saved=await sharingWrite<User>('/api/v1/me','PATCH',{display_name:name,bio,profile_is_public:enabled});name=saved.display_name;bio=saved.bio;enabled=saved.profile_is_public;baseline={name,bio,enabled};await invalidateAll();message=saved.profile_is_public?'资料已保存，主页已开启。仅公开记录进入主页。':'资料已保存，主页已关闭。独立记录分享仍需单独撤销。'; } catch(cause) { error=cause instanceof Error?cause.message:'保存失败，请重试';if(cause instanceof ActivityError && cause.status===401) window.location.replace('/admin?reason=expired'); } finally { busy=false; if (message) messageTimer = setTimeout(() => { message = ''; }, 6000); } }
</script>
<svelte:head><title>{pageTitle('设置', page.data.site)}</title></svelte:head>
{#if view.manage}
<div class="settings-stack">
  <section class="aux-panel identity-card" aria-labelledby="avatar-title">
    <h2 id="avatar-title" class="sr-only">头像与账户信息</h2>
    <ImageUpload label="头像" shape="circle" size="lg" src={avatarUrl} fallback={initial(page.data.user.display_name)} busy={avatarBusy} error={avatarError} onselect={file => void changeAvatar(file)} onremove={() => void clearAvatar()} />
    <div class="identity-meta">
      <p class="identity-name">{page.data.user.display_name}</p>
      <p class="text-sm text-muted-foreground">@{page.data.user.username}</p>
      <ul class="identity-chips" aria-label="账户信息">
        <li><span>邮箱</span>{page.data.user.email}</li>
        <li><span>时区</span>{page.data.user.timezone}</li>
      </ul>
      <p class="text-xs text-muted-foreground">头像支持 PNG、JPEG、WebP，不超过 5 MiB，自动裁成正方形并移除位置信息。</p>
      <a href={view.href("/activities")} class="text-sm text-primary underline">管理记录与分享 →</a>
    </div>
  </section>
  <form id="profile-form" onsubmit={(event)=>{event.preventDefault();void save();}} class="settings-grid" aria-busy={busy}>
    <section class="aux-panel settings-block" aria-labelledby="profile-title">
      <h2 id="profile-title">个人资料</h2>
      <p class="block-hint">昵称和简介会出现在个人展示页。</p>
      <label class="block-field" for="profile-name">昵称<input class="text-field" id="profile-name" required maxlength="80" bind:value={name} disabled={busy} /></label>
      <label class="block-field" for="profile-bio">个人简介<textarea class="text-field" id="profile-bio" maxlength="500" bind:value={bio} disabled={busy} rows="4"></textarea></label>
    </section>
    <section class="aux-panel settings-block" aria-labelledby="public-profile-label">
      <div class="block-title-row">
        <h2 id="public-profile-label">公开个人主页</h2>
        <button type="button" role="switch" class="rn-switch" aria-checked={enabled} aria-labelledby="public-profile-label" disabled={busy} onclick={() => enabled = !enabled}><span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span></button>
      </div>
      <p class="block-hint">仅展示主动设为公开的记录、统计和日历，不会公开历史私人记录。</p>
      <p class="status-badge" class:on={baseline.enabled}>已保存：{baseline.enabled ? '已开启' : '已关闭'}</p>
      <details class="block-details"><summary>展示与隐私说明</summary><p>开启完整展示后，个人展示页将展示全部记录和完整路线；这里的公开主页设置仅影响旧版摘要主页。私人备注和原始文件不公开。</p><p>关闭主页会立即关闭主页及其资料、统计、日历和列表接口。关闭主页不会撤销独立分享链接或单条公开记录；独立记录需到详情单独撤销链接或设为私人，已被他人保存的摘要无法收回。</p></details>
    </section>
  </form>
  <section class="aux-panel settings-block" aria-labelledby="password-title">
    <div class="block-title-row">
      <div><h2 id="password-title">账户安全</h2><p class="block-hint">修改成功后全部会话失效，请使用新密码重新登录。</p></div>
      <button type="button" class="button-secondary" aria-expanded={passwordOpen} aria-controls="password-form" disabled={!passwordReady} onclick={() => passwordOpen = !passwordOpen}>{passwordOpen ? '收起' : '修改密码'}</button>
    </div>
    {#if passwordOpen}<div transition:unfoldBar id="password-form"><form onsubmit={updatePassword} class="password-form" aria-busy={passwordBusy}>
      <label class="block-field" for="current-password">当前密码<input class="text-field" id="current-password" type="password" autocomplete="current-password" required minlength="12" maxlength="128" bind:value={currentPassword} disabled={passwordBusy} /></label>
      <label class="block-field" for="new-password">新密码（至少 12 位）<input class="text-field" id="new-password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" bind:value={newPassword} disabled={passwordBusy} /></label>
      <div><button class="button-primary" disabled={passwordBusy || !passwordReady}>{passwordBusy?'修改中…':'修改密码并重新登录'}</button></div>
      {#if passwordError}<FeedbackState kind="error" title={passwordError} />{/if}
    </form></div>{/if}
  </section>
  <SaveBar form="profile-form" {dirty} {busy} {message} {error} label="保存公开设置" busyLabel="正在保存资料与公开设置…" ondiscard={discard} />
</div>
{/if}
