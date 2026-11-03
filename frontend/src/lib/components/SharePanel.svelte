<script lang="ts">
  import { onMount } from 'svelte';
  import FeedbackState from './FeedbackState.svelte';
  import { readShares, sharingWrite, type Share } from '#lib/api/sharing.ts';
  import { ActivityError, type Activity } from '#lib/api/activities.ts';
  let { activity }: { activity: Activity } = $props();
  let links = $state<Share[]>([]), busy = $state(false), loadingShares = $state(true), message = $state(''), error = $state('');
  let sharesError = $state('');
  async function reloadShares() { if (busy || loadingShares) return; loadingShares=true; sharesError=''; error=''; try { await refresh(); } catch(cause) { sharesError=cause instanceof Error?cause.message:'分享链接读取失败'; fail(cause); } finally { loadingShares=false; } }
  const base = $derived(`/api/v1/activities/${activity.id}`);
  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : '操作失败，请重试'; if (cause instanceof ActivityError && cause.status === 401) window.location.replace('/admin?reason=expired'); }
  async function refresh() { links = (await readShares(activity.id)).items; sharesError=''; }
  async function run(action: () => Promise<void>) { if (busy) return; busy=true;error='';message='';try { await action(); } catch(cause) { fail(cause); } finally { busy=false; } }
  function revoke(id: string) { void run(async () => { await sharingWrite(`${base}/shares/${id}`,'DELETE'); await refresh(); message='分享已撤销，旧链接立即失效。'; }); }
  onMount(() => { void refresh().catch(cause => { sharesError=cause instanceof Error?cause.message:'分享链接读取失败'; fail(cause); }).finally(() => { loadingShares = false; }); });
</script>
{#if loadingShares || sharesError || links.length}
<section class="share-card" aria-labelledby="share-title" aria-busy={busy}>
  <h2 id="share-title" class="text-xl font-semibold">旧版分享链接</h2>
  <p class="mt-3 text-sm text-muted-foreground">旧版摘要分享已停用，不能再创建新链接；此前创建的链接仍可在这里撤销。已被他人保存的摘要无法收回。</p>
  {#if loadingShares}<div class="mt-4"><FeedbackState kind="loading" title="正在读取分享链接…" /></div>{:else if sharesError}<button onclick={() => void reloadShares()} class="button-secondary mt-4">重试读取分享链接</button>{:else}<ul class="mt-4 space-y-3">{#each links as link}<li class="flex flex-wrap items-center gap-3 text-sm"><span>{new Date(link.created_at).toLocaleString()} · {link.status==='active'?'有效':link.status==='revoked'?'已撤销':'已到期'} · {link.expires_at?`到期：${new Date(link.expires_at).toLocaleDateString()}`:'永久'}</span>{#if link.status==='active'}<button onclick={() => revoke(link.link_id)} disabled={busy} class="text-destructive underline">撤销链接</button>{/if}</li>{/each}</ul>{/if}
  {#if busy}<div class="mt-4"><FeedbackState kind="loading" title="正在处理分享操作，请勿重复提交。" /></div>{/if}
  {#if message}<div class="mt-4"><FeedbackState kind="success" title={message} /></div>{/if}{#if error}<div class="mt-4"><FeedbackState kind="error" title={error} /></div>{/if}
</section>
{/if}

<style>
  .share-card { margin-top: var(--space-6); padding: var(--space-6); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); }
  @media (max-width: 639px) { .share-card { padding: var(--space-4); } }
</style>
