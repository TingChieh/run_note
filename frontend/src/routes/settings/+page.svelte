<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { sharingWrite, publicProfilePath } from '#lib/api/sharing.ts';
  import type { User } from '#lib/api/auth.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  let name=$state(page.data.user?.display_name ?? ''), bio=$state(page.data.user?.bio ?? ''), enabled=$state(page.data.user?.profile_is_public ?? false), busy=$state(false), message=$state(''), error=$state('');
  async function save() { if(busy) return;busy=true;message='';error='';try { const saved=await sharingWrite<User>('/api/v1/me','PATCH',{display_name:name,bio,profile_is_public:enabled});name=saved.display_name;bio=saved.bio;enabled=saved.profile_is_public;await invalidateAll();message=saved.profile_is_public?'资料已保存，主页已开启。仅公开记录进入主页。':'资料已保存，主页已关闭。独立记录分享仍需单独撤销。'; } catch(cause) { error=cause instanceof Error?cause.message:'保存失败，请重试';if(cause instanceof ActivityError && cause.status===401) window.location.replace('/login?reason=expired'); } finally { busy=false; } }
</script>
<svelte:head><title>设置 · Run Note</title></svelte:head>
<h1 class="text-3xl font-semibold">设置</h1>
{#if page.data.user}
  <p class="mt-4 text-muted-foreground">邮箱：{page.data.user.email} · 用户名：{page.data.user.username} · 时区：{page.data.user.timezone}</p>
  <form onsubmit={(event)=>{event.preventDefault();void save();}} class="mt-6 space-y-4 rounded-xl border border-border bg-white p-6">
    <label class="block">昵称<input required maxlength="80" bind:value={name} disabled={busy} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">个人简介<textarea maxlength="500" bind:value={bio} disabled={busy} rows="4" class="mt-2 block w-full rounded border p-2"></textarea></label>
    <label class="flex gap-2"><input type="checkbox" bind:checked={enabled} disabled={busy} />开启公开个人主页</label>
    <p class="text-sm text-muted-foreground">主页仅展示主动设为公开的记录、统计和日历。开启主页不会公开历史私人记录。关闭主页会立即关闭主页及其资料、统计、日历和列表接口，但不会撤销独立分享链接或单条公开记录；请到记录详情单独撤销或设为私人。</p>
    <button disabled={busy} class="rounded bg-primary px-4 py-2 text-white disabled:opacity-50">{busy?'保存中…':'保存公开设置'}</button>
    {#if message}<p role="status" class="text-primary">{message}</p>{/if}{#if error}<p role="alert" class="text-red-700">{error}</p>{/if}
  </form>
  <p class="mt-5">主页地址：<a href={publicProfilePath(page.data.user.username)} data-sveltekit-reload class="text-primary underline">{publicProfilePath(page.data.user.username)}</a></p>
  <p class="mt-3"><a href="/activities" data-sveltekit-reload class="text-primary underline">管理记录与分享 →</a></p>
{/if}
