<script lang="ts">
  import { onMount } from 'svelte';
  import { readShares, sharingWrite, type Share, type CreatedShare } from '#lib/api/sharing.ts';
  import { ActivityError, type Activity } from '#lib/api/activities.ts';
  let { activity }: { activity: Activity } = $props();
  let visibility = $state<'private'|'unlisted'|'public'>('private'), saved = $state<'private'|'unlisted'|'public'>('private'), links = $state<Share[]>([]), url = $state(''), expires = $state('30'), busy = $state(false), message = $state(''), error = $state('');
  const base = $derived(`/api/v1/activities/${activity.id}`);
  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : '操作失败，请重试'; if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/login?reason=expired'); }
  async function refresh() { links = (await readShares(activity.id)).items; }
  async function run(action: () => Promise<void>) { if (busy) return; busy=true;error='';message='';try { await action(); } catch(cause) { fail(cause); } finally { busy=false; } }
  function save() { void run(async () => { await sharingWrite(base,'PATCH',{visibility}); saved=visibility; url=''; await refresh(); message=saved==='private'?'已设为私人，所有旧分享链接已撤销。':'可见性已保存。'; }); }
  function create() { void run(async () => { const body=expires==='forever'?{expires_at:null}:{}; const r=await sharingWrite<CreatedShare>(base+'/shares','POST',body);url=r.share_url;await refresh();message='分享链接已创建，请复制保存。令牌只在创建时显示。'; }); }
  function revoke(id: string) { void run(async () => { await sharingWrite(`${base}/shares/${id}`,'DELETE'); url=''; await refresh(); message='分享已撤销，旧链接立即失效。'; }); }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); message='链接已复制。';error=''; } catch { error='复制失败，请手动选择并复制链接。'; } }
  onMount(() => { visibility=activity.visibility; saved=activity.visibility; void refresh().catch(fail); });
</script>
<section class="mt-7 rounded-xl border border-border bg-white p-5" aria-labelledby="share-title">
  <h2 id="share-title" class="text-xl font-semibold">公开与分享</h2>
  <p class="mt-3 text-sm text-muted-foreground">分享只包含标题、日期及运动指标，不包含轨迹坐标、精确起终点、邮箱、备注或原始 GPX。已被他人保存的摘要无法收回。</p>
  <label class="mt-4 block">记录可见性 <select aria-label="记录可见性" bind:value={visibility} disabled={busy} class="ml-2 rounded border p-2"><option value="private">私人（仅本人）</option><option value="unlisted">仅链接可见</option><option value="public">公开（可按记录地址访问）</option></select></label>
  <button onclick={save} disabled={busy} class="mt-3 rounded bg-primary px-4 py-2 text-white disabled:opacity-50">保存可见性</button>
  {#if saved === 'public'}<p class="mt-3"><a href={`/public/activities/${activity.id}`} data-sveltekit-reload class="text-primary underline">查看公开记录</a></p><p class="text-sm text-muted-foreground">单条公开记录不受主页开关控制。需要停止按 ID 访问时，请设为私人或仅链接可见。</p>{/if}
  <div class="mt-5 flex flex-wrap items-center gap-3"><label>链接有效期 <select aria-label="链接有效期" bind:value={expires} disabled={busy} class="rounded border p-2"><option value="30">30天</option><option value="forever">永久（直到撤销）</option></select></label><button onclick={create} disabled={busy || saved === 'private'} class="rounded border px-4 py-2 disabled:opacity-50">创建分享链接</button></div>
  {#if saved === 'private'}<p class="mt-2 text-sm text-muted-foreground">先保存“仅链接可见”或“公开”才能创建链接；历史记录默认私人。</p>{/if}
  {#if url}<div class="mt-4"><label class="block">新分享链接<input aria-label="新分享链接" readonly value={url} class="mt-2 w-full rounded border p-2" /></label><button onclick={() => void copy(url)} class="mt-2 text-primary underline">复制分享链接</button><a href={url} data-sveltekit-reload class="ml-4 text-primary underline">预览分享</a></div>{/if}
  {#if links.length}<ul class="mt-4 space-y-3">{#each links as link}<li class="flex flex-wrap items-center gap-3 text-sm"><span>{new Date(link.created_at).toLocaleString()} · {link.status==='active'?'有效':link.status==='revoked'?'已撤销':'已到期'} · {link.expires_at?`到期：${new Date(link.expires_at).toLocaleDateString()}`:'永久'}</span>{#if link.status==='active'}<button onclick={() => revoke(link.link_id)} disabled={busy} class="text-red-700 underline">撤销链接</button>{/if}</li>{/each}</ul>{:else}<p class="mt-4 text-sm text-muted-foreground">尚无分享链接。</p>{/if}
  {#if message}<p role="status" class="mt-3 text-primary">{message}</p>{/if}{#if error}<p role="alert" class="mt-3 text-red-700">{error}</p>{/if}
</section>
