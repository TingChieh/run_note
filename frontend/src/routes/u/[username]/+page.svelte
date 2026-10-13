<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import CalendarGrid from '#lib/components/CalendarGrid.svelte';
  import { readProfile,readPublicCalendar,readPublicList,type PublicProfile,type PublicList } from '#lib/api/sharing.ts';
  import { formatDistance } from '#lib/api/activities.ts';
  import { currentYear, type Calendar } from '#lib/api/statistics.ts';
  let profile=$state<PublicProfile|null>(null), calendar=$state<Calendar|null>(null), list=$state<PublicList|null>(null), year=$state(currentYear('Asia/Shanghai')), selected=$state<string|null>(null), offset=$state(0), message=$state(''), loading=$state(true), serial=0, disposed=false;
  const username=page.params.username ?? '';
  async function load() { const n=++serial;profile=null;calendar=null;list=null;message='';loading=true;try { const [p,c,l]=await Promise.all([readProfile(username),readPublicCalendar(username,year),readPublicList(username,offset,selected)]);if(!disposed && n===serial){profile=p;calendar=c;list=l;} } catch(cause) {if(!disposed && n===serial) message=cause instanceof Error?cause.message:'公开主页暂不可用';} finally{if(!disposed && n===serial) loading=false;} }
  function choose(day:string|null) { selected=day;offset=0;void load(); }
  function changeYear() { selected=null;offset=0;void load(); }
  onMount(()=>{const y=Number(page.url.searchParams.get('year'));if(Number.isInteger(y)&&y>=1900&&y<=2100)year=y;void load();const focus=()=>void load();const visible=()=>{if(document.visibilityState==='visible')void load();else {++serial;profile=null;calendar=null;list=null;}};const restored=(e:PageTransitionEvent)=>{if(e.persisted) void load();};window.addEventListener('focus',focus);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',visible);return()=>{disposed=true;++serial;window.removeEventListener('focus',focus);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',visible);};});
</script>
<svelte:head><title>{profile?.display_name || '公开主页'} · Run Note</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></svelte:head>
{#if loading}<p role="status">正在读取公开主页…</p>{:else if message}<h1 class="text-3xl font-semibold">主页不可用</h1><p role="alert" class="mt-4 text-red-700">{message}</p><p class="mt-2 text-muted-foreground">主页可能未开启或已关闭。</p><button onclick={()=>void load()} class="mt-4 text-primary underline">重新读取主页</button>
{:else if profile && calendar && list}
  <h1 class="text-3xl font-semibold">{profile.display_name}</h1><p class="mt-2 text-muted-foreground">@{profile.username}</p><p class="mt-4 whitespace-pre-wrap">{profile.bio || '这位跑者还没有填写个人简介。'}</p>
  <dl class="mt-6 grid gap-4 sm:grid-cols-3"><div class="rounded-xl border p-5"><dt>公开运动总数</dt><dd class="mt-2 text-2xl">{profile.summary.activity_count} 次</dd></div><div class="rounded-xl border p-5"><dt>公开运动总距离</dt><dd class="mt-2 text-2xl">{formatDistance(profile.summary.distance_m)}</dd></div><div class="rounded-xl border p-5"><dt>公开运动天数</dt><dd class="mt-2 text-2xl">{profile.summary.activity_days} 天</dd></div></dl>
  <p class="mt-3 text-sm text-muted-foreground">统计和日历仅基于公开记录，不包含私人或仅链接可见的记录。</p>
  {#if profile.summary.activity_count===0}<p class="mt-5 rounded border p-4">尚无公开跑步记录。</p>{/if}
  <section class="mt-7"><h2 class="text-xl font-semibold">年度公开运动日历</h2><form onsubmit={(e)=>{e.preventDefault();changeYear();}} class="mt-3 flex gap-3"><label>年份 <input aria-label="年份" type="number" min="1900" max="2100" required bind:value={year} class="w-24 rounded border p-2" /></label><button class="rounded border px-3">查看年份</button></form><CalendarGrid {calendar} metric="distance" {selected} onselect={choose} />{#if calendar.activity_count===0}<p class="mt-3 text-muted-foreground">本年尚无公开运动。</p>{/if}</section>
  <section class="mt-7"><h2 class="text-xl font-semibold">{selected?`${selected} 的公开记录`:'全部公开记录'}</h2>{#if selected}<button onclick={()=>choose(null)} class="mt-2 text-primary underline">显示全部公开记录</button>{/if}
  {#if list.items.length}<ul class="mt-4 divide-y rounded border">{#each list.items as item}<li class="p-4"><a href={`/public/activities/${item.id}`} data-sveltekit-reload class="text-primary underline">{item.title || '未命名活动'}</a><p class="mt-1 text-sm">{item.activity_date} · {formatDistance(item.distance_m)}</p></li>{/each}</ul>{:else}<p class="mt-3 text-muted-foreground">没有符合条件的公开记录。</p>{/if}
  <div class="mt-4 flex gap-4"><button disabled={offset===0} onclick={()=>{offset=Math.max(0,offset-20);void load();}} class="text-primary underline disabled:opacity-40">上一页</button><span>共 {list.total} 条</span><button disabled={offset+20>=list.total} onclick={()=>{offset+=20;void load();}} class="text-primary underline disabled:opacity-40">下一页</button></div></section>
{/if}
