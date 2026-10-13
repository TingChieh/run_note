<script lang="ts">
  import { onMount } from 'svelte';
  import { readPublicActivity, publicProfilePath, type PublicActivity } from '#lib/api/sharing.ts';
  import { formatDistance, formatDuration, formatPace } from '#lib/api/activities.ts';
  let { apiPath }: { apiPath: string } = $props();
  let activity=$state<PublicActivity|null>(null), message=$state(''), loading=$state(true), serial=0, disposed=false;
  async function load() { const n=++serial;activity=null;message='';loading=true;try { const result=await readPublicActivity(apiPath);if(!disposed && n===serial) activity=result; } catch(cause) { if(!disposed && n===serial) message=cause instanceof Error?cause.message:'分享暂不可用'; } finally { if(!disposed && n===serial) loading=false; } }
  onMount(()=>{void load();const visible=()=>{if(document.visibilityState==='visible') void load();else {++serial;activity=null;}};const focus=()=>void load();const restored=(e:PageTransitionEvent)=>{if(e.persisted) void load();};window.addEventListener('focus',focus);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',visible);return()=>{disposed=true;++serial;window.removeEventListener('focus',focus);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',visible);};});
</script>
<svelte:head><title>{activity?.title || '运动分享'} · Run Note</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></svelte:head>
{#if loading}<p role="status">正在读取公开运动摘要…</p>{:else if message}<h1 class="text-3xl font-semibold">分享不可用</h1><p role="alert" class="mt-4 text-red-700">{message}</p><p class="mt-2 text-muted-foreground">记录可能不存在、已设为私人、链接已到期或被撤销。</p><button onclick={()=>void load()} class="mt-4 text-primary underline">重新读取分享</button>
{:else if activity}
  <h1 class="text-3xl font-semibold">{activity.title || '未命名活动'}</h1><p class="mt-3 text-muted-foreground">{activity.author.display_name} · {activity.activity_date}</p>
  <dl class="mt-6 grid gap-4 sm:grid-cols-3"><div class="rounded-xl border p-5"><dt>距离</dt><dd class="mt-2 text-2xl">{formatDistance(activity.distance_m)}</dd></div><div class="rounded-xl border p-5"><dt>用时</dt><dd class="mt-2 text-2xl">{formatDuration(activity.elapsed_seconds)}</dd></div><div class="rounded-xl border p-5"><dt>配速</dt><dd class="mt-2 text-2xl">{formatPace(activity.avg_pace_seconds_per_km)}</dd></div></dl>
  <p class="mt-5 text-sm text-muted-foreground">为保护位置隐私，此分享不公开轨迹坐标和精确起终点。“—”表示缺失或无法可靠计算。</p>
  <a href={publicProfilePath(activity.author.username)} data-sveltekit-reload class="mt-5 inline-block text-primary underline">查看作者公开主页</a><p class="mt-2 text-sm text-muted-foreground">作者可独立关闭主页，不影响此条分享。</p>
{/if}
