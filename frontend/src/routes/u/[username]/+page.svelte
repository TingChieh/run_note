<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import MetricSummary from '#lib/components/MetricSummary.svelte';
  import CalendarGrid from '#lib/components/CalendarGrid.svelte';
  import { readProfile,readPublicCalendar,readPublicList,type PublicProfile,type PublicList } from '#lib/api/sharing.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  import { currentYear, type Calendar } from '#lib/api/statistics.ts';
  let profile=$state<PublicProfile|null>(null), calendar=$state<Calendar|null>(null), list=$state<PublicList|null>(null), year=$state(currentYear('Asia/Shanghai')), selected=$state<string|null>(null), offset=$state(0), message=$state(''), loading=$state(true), serial=0, disposed=false;
  const username=page.params.username ?? '';
  async function load() { const n=++serial;profile=null;calendar=null;list=null;message='';loading=true;try { const [p,c,l]=await Promise.all([readProfile(username),readPublicCalendar(username,year),readPublicList(username,offset,selected)]);if(!disposed && n===serial){profile=p;calendar=c;list=l;} } catch(cause) {if(!disposed && n===serial) message=cause instanceof Error?cause.message:'公开主页暂不可用';} finally{if(!disposed && n===serial) loading=false;} }
  function choose(day:string|null) { selected=day;offset=0;void load(); }
  function changeYear() { if (!Number.isInteger(year) || year < 1900 || year > 2100) return; selected=null;offset=0;void load(); }
  onMount(()=>{const y=Number(page.url.searchParams.get('year'));if(Number.isInteger(y)&&y>=1900&&y<=2100)year=y;void load();const focus=()=>void load();const visible=()=>{if(document.visibilityState==='visible')void load();else {++serial;profile=null;calendar=null;list=null;}};const restored=(e:PageTransitionEvent)=>{if(e.persisted) void load();};window.addEventListener('focus',focus);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',visible);return()=>{disposed=true;++serial;window.removeEventListener('focus',focus);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',visible);};});
</script>
<svelte:head><title>{pageTitle(profile?.display_name || '公开主页', page.data.site)}</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></svelte:head>
{#if loading}<FeedbackState kind="loading" title="正在读取公开主页…" />
{:else if message}<PageHeader title="主页不可用" /><div class="mt-6"><FeedbackState kind="error" title={message}><p>主页可能未开启或已关闭。</p></FeedbackState></div><button onclick={()=>void load()} class="button-secondary mt-4">重新读取主页</button>
{:else if profile && calendar && list}
  <PageHeader title={profile.display_name} description={`@${profile.username} · 公开运动主页`} />
  <p class="mt-4 whitespace-pre-wrap">{profile.bio || '这位跑者还没有填写个人简介。'}</p>
  <div class="mt-6"><MetricSummary items={[{label:'公开运动总数',icon:'count',value:`${profile.summary.activity_count} 次`},{label:'公开运动总距离',icon:'distance',value:dashboardDistance(profile.summary.distance_m)},{label:'公开运动天数',icon:'days',value:`${profile.summary.activity_days} 天`}]} /></div>
  <p class="mt-3 text-sm text-muted-foreground">统计和日历仅基于公开记录，不包含私人或仅链接可见的记录。</p>
  {#if profile.summary.activity_count===0}<div class="mt-5"><FeedbackState kind="empty" title="尚无公开跑步记录。" /></div>{/if}
  <section class="aux-panel mt-6" aria-label="年度公开运动日历">
    <div class="flex flex-wrap items-center justify-between gap-4"><h2 class="text-xl font-semibold">年度公开运动日历</h2>
      <form onsubmit={(e)=>{e.preventDefault();changeYear();}} class="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="上一年" disabled={year<=1900} onclick={()=>{year--;changeYear();}} class="button-secondary">←</button>
        <label class="sr-only" for="public-year">年份</label><input id="public-year" type="number" min="1900" max="2100" required bind:value={year} class="w-24 rounded border p-2" />
        <button class="button-secondary">查看年份</button><button type="button" aria-label="下一年" disabled={year>=2100} onclick={()=>{year++;changeYear();}} class="button-secondary">→</button>
      </form>
    </div>
    <CalendarGrid {calendar} metric="distance" {selected} onselect={choose} enhanced />
    {#if calendar.activity_count===0}<p class="mt-3 text-sm text-muted-foreground">本年尚无公开运动。</p>{/if}
    <details class="mt-4 text-sm text-muted-foreground"><summary>日历颜色与日期归属</summary><p class="mt-2">颜色按本年最大每日距离分为四档；零距离活动用浅绿，灰色为无记录。历史日期按活动保存时的当地日期归属。</p></details>
  </section>
  <section class="aux-panel mt-6" aria-label="公开运动记录"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{selected?`${selected} 的公开记录`:'全部公开记录'}</h2>{#if selected}<button onclick={()=>choose(null)} class="button-secondary">显示全部公开记录</button>{/if}</div>
  {#if list.items.length}<ul class="public-records mt-4 divide-y divide-border">{#each list.items as item}<li><a href={`/public/activities/${item.id}`} data-sveltekit-reload>{item.title || '未命名活动'} →</a><p class="mt-2 text-sm text-muted-foreground">{item.activity_date} · {dashboardDistance(item.distance_m)}</p></li>{/each}</ul>{:else}<div class="mt-4"><FeedbackState kind="empty" title="没有符合条件的公开记录。" /></div>{/if}
  <div class="mt-4 flex flex-wrap items-center gap-3"><button disabled={offset===0} onclick={()=>{offset=Math.max(0,offset-20);void load();}} class="button-secondary">上一页</button><span class="text-sm text-muted-foreground">共 {list.total} 条</span><button disabled={offset+20>=list.total} onclick={()=>{offset+=20;void load();}} class="button-secondary">下一页</button></div></section>
{/if}
