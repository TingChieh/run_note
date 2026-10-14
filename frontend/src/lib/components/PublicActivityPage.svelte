<script lang="ts">
  import PageHeader from './PageHeader.svelte';
  import FeedbackState from './FeedbackState.svelte';
  import MetricSummary from './MetricSummary.svelte';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { onMount } from 'svelte';
  import { readPublicActivity, publicProfilePath, type PublicActivity } from '#lib/api/sharing.ts';
  import { formatDuration, formatPace } from '#lib/api/activities.ts';
  let { apiPath }: { apiPath: string } = $props();
  let activity=$state<PublicActivity|null>(null), message=$state(''), loading=$state(true), serial=0, disposed=false;
  async function load() { const n=++serial;activity=null;message='';loading=true;try { const result=await readPublicActivity(apiPath);if(!disposed && n===serial) activity=result; } catch(cause) { if(!disposed && n===serial) message=cause instanceof Error?cause.message:'分享暂不可用'; } finally { if(!disposed && n===serial) loading=false; } }
  onMount(()=>{void load();const visible=()=>{if(document.visibilityState==='visible') void load();else {++serial;activity=null;}};const focus=()=>void load();const restored=(e:PageTransitionEvent)=>{if(e.persisted) void load();};window.addEventListener('focus',focus);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',visible);return()=>{disposed=true;++serial;window.removeEventListener('focus',focus);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',visible);};});
</script>
<svelte:head><title>{activity?.title || '运动分享'} · Run Note</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></svelte:head>
{#if loading}<FeedbackState kind="loading" title="正在读取公开运动摘要…" />
{:else if message}<PageHeader title="分享不可用" /><div class="mt-6"><FeedbackState kind="error" title={message}><p>记录可能不存在、已设为私人、链接已到期或被撤销。</p></FeedbackState></div><button onclick={()=>void load()} class="button-secondary mt-4">重新读取分享</button>
{:else if activity}
  <PageHeader title={activity.title || '未命名活动'} description={`${activity.author.display_name} · ${activity.activity_date}`} />
  <div class="mt-6"><MetricSummary items={[{label:'距离',value:dashboardDistance(activity.distance_m)},{label:'用时',value:formatDuration(activity.elapsed_seconds)},{label:'配速',value:formatPace(activity.avg_pace_seconds_per_km)}]} /></div>
  <section class="aux-panel mt-6" aria-label="分享范围"><h2 class="text-xl font-semibold">公开运动摘要</h2><p class="mt-3 text-sm text-muted-foreground">为保护位置隐私，此分享不公开轨迹坐标和精确起终点。“—”表示缺失或无法可靠计算。</p>
  <a href={publicProfilePath(activity.author.username)} data-sveltekit-reload class="button-secondary mt-5">查看作者公开主页</a><p class="mt-3 text-sm text-muted-foreground">作者可独立关闭主页，不影响此条分享。</p></section>
{/if}
