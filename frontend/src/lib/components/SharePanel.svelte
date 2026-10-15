<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import { readShares, sharingWrite, type Share, type CreatedShare } from '#lib/api/sharing.ts';
  import { ActivityError, type Activity } from '#lib/api/activities.ts';
  let { activity }: { activity: Activity } = $props();
  let visibility = $state<'private'|'unlisted'|'public'>('private'), saved = $state<'private'|'unlisted'|'public'>('private'), links = $state<Share[]>([]), url = $state(''), expires = $state('30'), busy = $state(false), loadingShares = $state(true), message = $state(''), error = $state('');
  let sharesError = $state('');
  async function reloadShares() { if (busy || loadingShares) return; loadingShares=true; sharesError=''; error=''; try { await refresh(); } catch(cause) { sharesError=cause instanceof Error?cause.message:'分享链接读取失败'; fail(cause); } finally { loadingShares=false; } }
  const base = $derived(`/api/v1/activities/${activity.id}`);
  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : '操作失败，请重试'; if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/login?reason=expired'); }
  async function refresh() { links = (await readShares(activity.id)).items; sharesError=''; }
  async function run(action: () => Promise<void>) { if (busy) return; busy=true;error='';message='';try { await action(); } catch(cause) { fail(cause); } finally { busy=false; } }
  function save() { void run(async () => { await sharingWrite(base,'PATCH',{visibility}); saved=visibility; url=''; await refresh(); message=saved==='private'?'已设为私人，所有旧分享链接已撤销。':'可见性已保存。'; }); }
  function create() { void run(async () => { const body=expires==='forever'?{expires_at:null}:{}; const r=await sharingWrite<CreatedShare>(base+'/shares','POST',body);url=r.share_url;await refresh();message='分享链接已创建，请复制保存。令牌只在创建时显示。'; }); }
  function revoke(id: string) { void run(async () => { await sharingWrite(`${base}/shares/${id}`,'DELETE'); url=''; await refresh(); message='分享已撤销，旧链接立即失效。'; }); }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); message='链接已复制。';error=''; } catch { error='复制失败，请手动选择并复制链接。'; } }
  onMount(() => { visibility=activity.visibility; saved=activity.visibility; void refresh().catch(cause => { sharesError=cause instanceof Error?cause.message:'分享链接读取失败'; fail(cause); }).finally(() => { loadingShares = false; }); });
</script>
<section class="share-card" aria-labelledby="share-title" aria-busy={busy}>
  <h2 id="share-title" class="text-xl font-semibold">公开与分享</h2>
  <p class="mt-3 text-sm text-muted-foreground">自主决定谁可以看到这条记录。分享仅包含运动摘要，不公开路线与私人资料。</p><details class="mt-3 text-sm text-muted-foreground"><summary class="w-fit font-medium">分享范围与撤销说明</summary><p class="mt-2 leading-6">分享只包含标题、日期及运动指标，不包含轨迹坐标、精确起终点、邮箱、备注或原始 GPX。已被他人保存的摘要无法收回。</p></details>
  <p class="mt-4 text-sm font-semibold text-primary">已保存权限：{saved === 'private' ? '私人（仅本人）' : saved === 'unlisted' ? '仅链接可见' : '公开'}</p>
  {#if visibility !== saved}<p role="status" class="mt-2 text-sm">选择尚未保存</p>{/if}
  <div class="visibility-control"><label>记录可见性 <select aria-label="记录可见性" bind:value={visibility} disabled={busy} class="ml-2 rounded border p-2"><option value="private">私人（仅本人）</option><option value="unlisted">仅链接可见</option><option value="public">公开（可按记录地址访问）</option></select></label>
  <button onclick={save} disabled={busy} class="rounded bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">保存可见性</button></div>
  {#if saved === 'public'}<p class="mt-3"><a href={`/public/activities/${activity.id}`} data-sveltekit-reload class="text-primary underline">查看公开记录</a></p><p class="text-sm text-muted-foreground">单条公开记录不受主页开关控制。需要停止按 ID 访问时，请设为私人或仅链接可见。</p>{/if}
  <div class="mt-5 flex flex-wrap items-center gap-3"><label>链接有效期 <select aria-label="链接有效期" bind:value={expires} disabled={busy} class="rounded border p-2"><option value="30">30天</option><option value="forever">永久（直到撤销）</option></select></label><button onclick={create} disabled={busy || saved === 'private'} class="rounded border px-4 py-2 disabled:opacity-50">创建分享链接</button></div>
  {#if saved === 'private'}<p class="mt-2 text-sm text-muted-foreground">先保存“仅链接可见”或“公开”才能创建链接；历史记录默认私人。</p>{/if}
  {#if url}<div class="mt-4"><label class="block">新分享链接<input aria-label="新分享链接" readonly value={url} class="mt-2 w-full rounded border p-2" /></label><button onclick={() => void copy(url)} disabled={busy} class="button-secondary mt-2">复制分享链接</button><a href={url} data-sveltekit-reload class="ml-4 text-primary underline">预览分享</a></div>{/if}
  {#if loadingShares}<div class="mt-4"><FeedbackState kind="loading" title="正在读取分享链接…" /></div>{:else if sharesError}<button onclick={() => void reloadShares()} class="button-secondary mt-4">重试读取分享链接</button>{:else if links.length}<ul class="mt-4 space-y-3">{#each links as link}<li class="flex flex-wrap items-center gap-3 text-sm"><span>{new Date(link.created_at).toLocaleString()} · {link.status==='active'?'有效':link.status==='revoked'?'已撤销':'已到期'} · {link.expires_at?`到期：${new Date(link.expires_at).toLocaleDateString()}`:'永久'}</span>{#if link.status==='active'}<button onclick={() => revoke(link.link_id)} disabled={busy} class="text-destructive underline">撤销链接</button>{/if}</li>{/each}</ul>{:else}<p class="mt-4 text-sm text-muted-foreground">尚无分享链接。</p>{/if}
  {#if busy}<div class="mt-4"><FeedbackState kind="loading" title="正在处理分享操作，请勿重复提交。" /></div>{/if}
  {#if message}<div class="mt-4"><FeedbackState kind="success" title={message} /></div>{/if}{#if error}<div class="mt-4"><FeedbackState kind="error" title={error} /></div>{/if}
</section>

<style>
  .share-card { margin-top: var(--space-6); padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  .visibility-control { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-4); }
  @media (max-width: 639px) { .share-card { padding: var(--space-4); } .visibility-control label { display: grid; width: 100%; gap: var(--space-2); } .visibility-control label select { margin-left: 0; } }
</style>
