<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { sharingWrite, publicProfilePath } from '#lib/api/sharing.ts';
  import { changePassword } from '#lib/api/auth.ts';
  import { onMount } from 'svelte';
  import type { User } from '#lib/api/auth.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  let name=$state(page.data.user?.display_name ?? ''), bio=$state(page.data.user?.bio ?? ''), enabled=$state(page.data.user?.profile_is_public ?? false), busy=$state(false), message=$state(''), error=$state('');
  let baseline = $state({name: page.data.user?.display_name ?? '', bio: page.data.user?.bio ?? '', enabled: page.data.user?.profile_is_public ?? false});
  let currentPassword=$state(''), newPassword=$state(''), passwordBusy=$state(false), passwordError=$state(''), passwordReady=$state(false), disposed=false;
  onMount(() => { passwordReady=true; return () => { disposed=true; currentPassword=''; newPassword=''; }; });
  async function updatePassword(event: SubmitEvent) {
    event.preventDefault(); if(passwordBusy || !passwordReady) return;
    passwordBusy=true; passwordError='';
    try { await changePassword(currentPassword,newPassword,fetch); if(!disposed) { currentPassword='';newPassword='';window.location.assign('/admin?reason=changed'); } }
    catch(cause) { if(!disposed) { currentPassword='';newPassword='';passwordError=cause instanceof Error?cause.message:'密码修改失败'; } }
    finally { if(!disposed) passwordBusy=false; }
  }
  const dirty = $derived(name !== baseline.name || bio !== baseline.bio || enabled !== baseline.enabled);
  async function save() { if(busy) return;busy=true;message='';error='';try { const saved=await sharingWrite<User>('/api/v1/me','PATCH',{display_name:name,bio,profile_is_public:enabled});name=saved.display_name;bio=saved.bio;enabled=saved.profile_is_public;baseline={name,bio,enabled};await invalidateAll();message=saved.profile_is_public?'资料已保存，主页已开启。仅公开记录进入主页。':'资料已保存，主页已关闭。独立记录分享仍需单独撤销。'; } catch(cause) { error=cause instanceof Error?cause.message:'保存失败，请重试';if(cause instanceof ActivityError && cause.status===401) window.location.replace('/admin?reason=expired'); } finally { busy=false; } }
</script>
<svelte:head><title>设置 · Run Note</title></svelte:head>
<PageHeader title="设置" description="管理账户资料与公开主页。" />
{#if view.manage}
<p class="mt-4 text-sm text-muted-foreground">开启完整展示后，个人展示页将展示全部记录和完整路线；下方公开主页设置仅影响旧版摘要主页。私人备注和原始文件不公开。</p>
  <section class="aux-panel mt-6" aria-label="账户信息"><h2 class="text-xl font-semibold">账户信息</h2><dl class="mt-4 grid gap-4 sm:grid-cols-3"><div class="min-w-0"><dt class="text-sm text-muted-foreground">邮箱</dt><dd class="mt-1 break-all">{page.data.user.email}</dd></div><div><dt class="text-sm text-muted-foreground">用户名</dt><dd class="mt-1">@{page.data.user.username}</dd></div><div><dt class="text-sm text-muted-foreground">时区</dt><dd class="mt-1">{page.data.user.timezone}</dd></div></dl></section>
  <form onsubmit={(event)=>{event.preventDefault();void save();}} class="aux-panel mt-6 space-y-5" aria-busy={busy}>
    <h2 class="text-xl font-semibold">个人资料</h2>
    <label class="block">昵称<input required maxlength="80" bind:value={name} disabled={busy} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">个人简介<textarea maxlength="500" bind:value={bio} disabled={busy} rows="4" class="mt-2 block w-full rounded border p-2"></textarea></label>
    <h2 class="border-t border-border pt-5 text-xl font-semibold">公开主页</h2>
    <p class="text-sm text-muted-foreground">已保存状态：{baseline.enabled ? '已开启' : '已关闭'}</p>
    <label class="flex items-center gap-3"><input type="checkbox" bind:checked={enabled} disabled={busy} />开启公开个人主页</label>
    <p class="text-sm text-muted-foreground">主页仅展示主动设为公开的记录、统计和日历。开启主页不会公开历史私人记录。关闭主页不会撤销独立分享链接或单条公开记录。</p><details class="text-sm text-muted-foreground"><summary>关闭与隐私说明</summary><p class="mt-2">关闭主页会立即关闭主页及其资料、统计、日历和列表接口。独立记录需到详情单独撤销链接或设为私人；已被他人保存的摘要无法收回。</p></details>
    {#if dirty}<p class="text-sm text-primary" role="status">有未保存的更改</p>{/if}
    <button disabled={busy} class="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy?'保存中…':'保存公开设置'}</button>
    {#if busy}<FeedbackState kind="loading" title="正在保存资料与公开设置…" />{/if}
    {#if message}<FeedbackState kind="success" title={message} />{/if}{#if error}<FeedbackState kind="error" title={error} />{/if}
  </form>
  <form onsubmit={updatePassword} class="aux-panel mt-6 space-y-5" aria-busy={passwordBusy}>
    <h2 class="text-xl font-semibold">修改本人密码</h2>
    <p class="text-sm text-muted-foreground">修改成功后全部会话失效，请使用新密码重新登录。</p>
    <label class="block">当前密码<input type="password" autocomplete="current-password" required minlength="12" maxlength="128" bind:value={currentPassword} disabled={passwordBusy} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">新密码<input type="password" autocomplete="new-password" required minlength="12" maxlength="128" bind:value={newPassword} disabled={passwordBusy} class="mt-2 block w-full rounded border p-2" /></label>
    <button class="button-primary" disabled={passwordBusy || !passwordReady}>{passwordBusy?'修改中…':'修改密码并重新登录'}</button>
    {#if passwordError}<FeedbackState kind="error" title={passwordError} />{/if}
  </form>
  <p class="mt-5">主页地址：<a href={publicProfilePath(page.data.user.username)} data-sveltekit-reload class="text-primary underline">{publicProfilePath(page.data.user.username)}</a></p>
  <p class="mt-3"><a href={view.href("/activities")}  class="text-primary underline">管理记录与分享 →</a></p>
{/if}
